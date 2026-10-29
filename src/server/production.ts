// ============================================================
// Mise — production documents (ADR 0040 Q3, Q6, Q7)
// ============================================================
// One act of making prepped stock at one branch: bones and onions in, soup
// out (PRODUCE), or one whole fish in, fillet + belly + head out (TRIM). Each
// line posts one movement — inputs leave as PRODUCTION_OUT, outputs arrive as
// PRODUCTION_IN — and NOTHING about money is written: what the soup is worth
// is what FIFO says the bones cost, handed over at replay time
// (`fifo-chain.ts`, Q4).
//
// What this file refuses, and why each is an inability rather than a policy:
//   * an output that is not a PREPPED product — raw stock is bought, not made;
//   * a production whose output feeds, through earlier productions at the
//     same branch, back into one of its own inputs — the replay could never
//     decide which pile to walk first (D1's price);
//   * a trim whose input is not the trim recipe's whole thing, or whose
//     outputs are not its parts — the % value split would be meaningless.
// Nothing here forces anyone to weigh anything (Q3).
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient, Production, ProductionItem } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { bangkokDayStartUtc, computeBangkokToday } from "@/lib/bangkok-date";
import { acquireCounterLock } from "@/server/counter-lock";
import { assertRefBelongsToTenant } from "@/server/product";
import {
  createStockMovementLogic,
  QtyRoundsToZeroError,
  StockUnitMismatchError,
  toBaseQty,
} from "@/server/stock-movement";
import type {
  CreateProductionInput,
  ProductionLineInput,
  VoidProductionInput,
} from "@/lib/validations/production";

const HUNDRED = new Prisma.Decimal(100);
const SHARE_SCALE = 4;

export class ProductionNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Production ${id} not found`);
    this.name = "ProductionNotFoundError";
  }
}

export class ProductionAlreadyVoidedError extends Error {
  constructor(readonly id: string) {
    super(`Production ${id} is already voided`);
    this.name = "ProductionAlreadyVoidedError";
  }
}

/** An output must be a PREPPED product: raw stock is bought, not made. */
export class ProductionOutputNotPreppedError extends Error {
  constructor(readonly productId: string) {
    super(`Production output ${productId} is not a PREPPED product`);
    this.name = "ProductionOutputNotPreppedError";
  }
}

/**
 * The new production would close a loop: its output is already (through
 * earlier productions at this branch) an ingredient of one of its inputs.
 * The replay walks inputs before outputs (D1); a loop has no "before".
 */
export class ProductionLoopError extends Error {
  constructor(readonly outputProductId: string, readonly inputProductId: string) {
    super(`Production of ${outputProductId} would loop back into its input ${inputProductId}`);
    this.name = "ProductionLoopError";
  }
}

/** The recipe named is not a production recipe for this output. */
export class ProductionRecipeMismatchError extends Error {
  constructor(readonly recipeId: string) {
    super(`Recipe ${recipeId} does not produce this output`);
    this.name = "ProductionRecipeMismatchError";
  }
}

/** The trim does not match its trim recipe (wrong whole thing, or a non-part). */
export class TrimRecipeMismatchError extends Error {
  constructor(readonly trimRecipeId: string, readonly productId: string) {
    super(`Product ${productId} does not belong to trim recipe ${trimRecipeId}`);
    this.name = "TrimRecipeMismatchError";
  }
}

export type ProductionWithItems = Production & { items: ProductionItem[] };

/**
 * When a production's legs happen. Today is NOW — the soup is on the shelf from
 * the moment it is recorded. An earlier day is the START of that Bangkok day, so
 * what was made that morning is available to the same day's sales, which post
 * at the day's end (`costSortKey`). Deliberately not a day value: a day value
 * sorts to the END of its day, after that day's consumption.
 */
export function producedAtFor(producedOn: Date, now: Date = new Date()): Date {
  const today = computeBangkokToday();
  return producedOn.getTime() >= today.getTime() ? now : bangkokDayStartUtc(producedOn);
}

async function generatePdNumber(tx: PrismaClient, tenantId: string, branchCode: string) {
  await acquireCounterLock(tx, `pd_number:${tenantId}:${branchCode}`);
  const prefix = `${branchCode}-PD-`;
  const rows = await tx.production.findMany({
    where: { tenantId, pdNumber: { startsWith: prefix } },
    select: { pdNumber: true },
  });
  const re = new RegExp(`^${branchCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-PD-(\\d+)$`);
  let max = 0;
  for (const { pdNumber } of rows) {
    const m = re.exec(pdNumber);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** A line in base units, with the unit the person chose kept for display. */
type ResolvedLine = ProductionLineInput & { qty: Prisma.Decimal };

async function resolveLine(
  tx: PrismaClient,
  tenantId: string,
  line: ProductionLineInput
): Promise<ResolvedLine> {
  await assertRefBelongsToTenant(tx, tenantId, "product", line.productId);
  const unit = await tx.productUnit.findFirst({
    where: { id: line.inputUnitId, productId: line.productId },
    select: { unitName: true, toBaseRatio: true },
  });
  if (!unit) throw new StockUnitMismatchError(line.inputUnitId, line.productId);
  const qty = toBaseQty(line.inputQty, unit.toBaseRatio);
  if (qty.isZero()) {
    const base = await tx.productUnit.findFirst({
      where: { productId: line.productId, isBase: true },
      select: { unitName: true },
    });
    throw new QtyRoundsToZeroError(
      new Prisma.Decimal(line.inputQty),
      unit.unitName,
      base?.unitName ?? null
    );
  }
  return { ...line, qty };
}

/**
 * Refuse a production that would close a loop in the "made from" graph at
 * this branch. Voided productions count too: their legs stay in the ledger,
 * and the replay builds its order from the ledger.
 */
async function assertNoLoop(
  tx: PrismaClient,
  tenantId: string,
  branchId: string,
  inputIds: string[],
  outputIds: string[]
) {
  const rows = await tx.productionItem.findMany({
    where: { tenantId, reversalOfItemId: null, production: { branchId } },
    select: { productionId: true, productId: true, role: true },
  });
  const byProduction = new Map<string, { ins: string[]; outs: string[] }>();
  for (const r of rows) {
    const p = byProduction.get(r.productionId) ?? { ins: [], outs: [] };
    (r.role === "INPUT" ? p.ins : p.outs).push(r.productId);
    byProduction.set(r.productionId, p);
  }
  // X → everything made from X.
  const madeFrom = new Map<string, Set<string>>();
  for (const { ins, outs } of byProduction.values()) {
    for (const i of ins) {
      const set = madeFrom.get(i) ?? new Set<string>();
      for (const o of outs) set.add(o);
      madeFrom.set(i, set);
    }
  }
  const inputs = new Set(inputIds);
  for (const out of outputIds) {
    const seen = new Set<string>([out]);
    const queue = [out];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of madeFrom.get(cur) ?? []) {
        if (inputs.has(next)) throw new ProductionLoopError(out, next);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }
}

/**
 * Freeze the trim recipe's % value onto the outputs actually recorded,
 * re-normalised to 100 so the document reads as it will be costed. A part the
 * kitchen did not keep this time hands its share to the parts it did — the
 * fish's whole cost lands on what is on the shelf. Remainder on the largest.
 */
function normaliseShares(
  outputs: { productId: string; share: Prisma.Decimal }[]
): Map<string, Prisma.Decimal> {
  const sum = outputs.reduce((a, o) => a.plus(o.share), new Prisma.Decimal(0));
  const out = new Map<string, Prisma.Decimal>();
  if (outputs.length === 0) return out;
  const weights = sum.isZero()
    ? outputs.map((o) => ({ id: o.productId, w: new Prisma.Decimal(1) }))
    : outputs.map((o) => ({ id: o.productId, w: o.share }));
  const total = weights.reduce((a, w) => a.plus(w.w), new Prisma.Decimal(0));
  let largest = 0;
  weights.forEach((w, i) => {
    if (w.w.greaterThan(weights[largest].w)) largest = i;
  });
  let used = new Prisma.Decimal(0);
  weights.forEach((w, i) => {
    if (i === largest) return;
    const v = w.w.mul(HUNDRED).div(total).toDecimalPlaces(SHARE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
    out.set(w.id, v);
    used = used.plus(v);
  });
  out.set(weights[largest].id, HUNDRED.minus(used));
  return out;
}

/**
 * Record a production or a trim and post its movements, in one transaction.
 * Idempotent by `submitKey` (the document's id).
 */
export async function createProductionLogic(
  tenantId: string,
  input: CreateProductionInput,
  recordedBy: string
): Promise<ProductionWithItems> {
  return withTenantContext(tenantId, async (tx) => {
    const replay = await tx.production.findFirst({
      where: { tenantId, id: input.submitKey },
      include: { items: true },
    });
    if (replay) return replay;

    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
    const branch = await tx.branch.findUniqueOrThrow({
      where: { id: input.branchId },
      select: { code: true },
    });

    const inputs: ResolvedLine[] = [];
    for (const l of input.inputs) inputs.push(await resolveLine(tx, tenantId, l));
    const outputs: ResolvedLine[] = [];
    for (const l of input.outputs) outputs.push(await resolveLine(tx, tenantId, l));

    const outputProducts = await tx.product.findMany({
      where: { tenantId, id: { in: outputs.map((o) => o.productId) } },
      select: { id: true, type: true },
    });
    for (const p of outputProducts) {
      if (p.type !== "PREPPED") throw new ProductionOutputNotPreppedError(p.id);
    }

    // Shares of the inputs' money, frozen on the outputs (Q7).
    let shares: Map<string, Prisma.Decimal>;
    if (input.kind === "TRIM") {
      const trim = await tx.trimRecipe.findFirst({
        where: { tenantId, id: input.trimRecipeId!, deletedAt: null },
        select: {
          id: true,
          parentProductId: true,
          parts: {
            where: { deletedAt: null, productId: { not: null } },
            select: { productId: true, valuePct: true },
          },
        },
      });
      if (!trim) throw new TrimRecipeMismatchError(input.trimRecipeId!, inputs[0].productId);
      if (inputs[0].productId !== trim.parentProductId) {
        throw new TrimRecipeMismatchError(trim.id, inputs[0].productId);
      }
      const partShare = new Map(trim.parts.map((p) => [p.productId!, p.valuePct]));
      for (const o of outputs) {
        if (!partShare.has(o.productId)) throw new TrimRecipeMismatchError(trim.id, o.productId);
      }
      shares = normaliseShares(
        outputs.map((o) => ({ productId: o.productId, share: partShare.get(o.productId)! }))
      );
    } else {
      if (input.recipeId) {
        const recipe = await tx.recipe.findFirst({
          where: { tenantId, id: input.recipeId },
          select: { outputProductId: true },
        });
        if (!recipe || recipe.outputProductId !== outputs[0].productId) {
          throw new ProductionRecipeMismatchError(input.recipeId);
        }
      }
      shares = new Map([[outputs[0].productId, HUNDRED]]);
    }

    await assertNoLoop(
      tx,
      tenantId,
      input.branchId,
      inputs.map((i) => i.productId),
      outputs.map((o) => o.productId)
    );

    const producedAt = producedAtFor(input.producedOn);
    const pdNumber = await generatePdNumber(tx, tenantId, branch.code);

    await tx.production.create({
      data: {
        id: input.submitKey,
        tenantId,
        branchId: input.branchId,
        pdNumber,
        kind: input.kind,
        origin: "MANUAL",
        producedAt,
        recipeId: input.kind === "PRODUCE" ? (input.recipeId ?? null) : null,
        trimRecipeId: input.kind === "TRIM" ? input.trimRecipeId! : null,
        recordedBy,
        notes: input.notes ?? null,
      },
    });

    // Inputs leave before outputs arrive, at the same instant: the writes go
    // in that order so `createdAt` breaks the tie the way the making happened.
    for (const line of inputs) {
      const item = await tx.productionItem.create({
        data: {
          tenantId,
          productionId: input.submitKey,
          productId: line.productId,
          role: "INPUT",
          qty: line.qty,
          inputQty: new Prisma.Decimal(line.inputQty),
          inputUnitId: line.inputUnitId,
        },
      });
      await createStockMovementLogic(tx, {
        tenantId,
        productId: line.productId,
        branchId: input.branchId,
        qty: line.qty.negated(),
        type: "PRODUCTION_OUT",
        sourceType: "PRODUCTION",
        sourceId: item.id,
        occurredAt: producedAt,
        createdBy: recordedBy,
      });
    }
    for (const line of outputs) {
      const item = await tx.productionItem.create({
        data: {
          tenantId,
          productionId: input.submitKey,
          productId: line.productId,
          role: "OUTPUT",
          qty: line.qty,
          inputQty: new Prisma.Decimal(line.inputQty),
          inputUnitId: line.inputUnitId,
          valueSharePct: shares.get(line.productId)!,
        },
      });
      await createStockMovementLogic(tx, {
        tenantId,
        productId: line.productId,
        branchId: input.branchId,
        qty: line.qty,
        type: "PRODUCTION_IN",
        sourceType: "PRODUCTION",
        sourceId: item.id,
        occurredAt: producedAt,
        createdBy: recordedBy,
      });
    }

    return tx.production.findUniqueOrThrow({
      where: { id: input.submitKey },
      include: { items: true },
    });
  });
}

/**
 * Void a production: give every input back and take every output off the
 * shelf, as reversal lines in the same document (the staff_meal_item shape).
 * The document is never deleted (Q6).
 *
 * The reversal happens NOW, like every void in this ledger: a ledger reverses
 * on the day the mistake is found (Part 15, Part 17). Whatever sales took the
 * soup in between is put right by the re-post (Q5), not by backdating here.
 */
export async function voidProductionLogic(
  tenantId: string,
  input: VoidProductionInput,
  voidedBy: string
): Promise<ProductionWithItems> {
  return withTenantContext(tenantId, async (tx) => {
    const doc = await tx.production.findFirst({
      where: { tenantId, id: input.id },
      include: { items: true },
    });
    if (!doc) throw new ProductionNotFoundError(input.id);
    if (doc.voidedAt) throw new ProductionAlreadyVoidedError(input.id);

    // A concurrent void waits here and then sees voided_at; the partial unique
    // on reversal_of_item_id is the backstop.
    const locked = await tx.production.updateMany({
      where: { tenantId, id: input.id, voidedAt: null },
      data: { voidedAt: new Date(), voidedBy, voidReason: input.reason ?? null },
    });
    if (locked.count === 0) throw new ProductionAlreadyVoidedError(input.id);

    const now = new Date();
    const originals = doc.items.filter((i) => i.reversalOfItemId === null);
    // Outputs come off the shelf first, then inputs go back — the mirror of
    // the making, so a replay never sees the soup outlive its own void.
    const ordered = [
      ...originals.filter((i) => i.role === "OUTPUT"),
      ...originals.filter((i) => i.role === "INPUT"),
    ];
    for (const orig of ordered) {
      const rev = await tx.productionItem.create({
        data: {
          tenantId,
          productionId: doc.id,
          productId: orig.productId,
          role: orig.role,
          qty: orig.qty,
          reversalOfItemId: orig.id,
        },
      });
      await createStockMovementLogic(tx, {
        tenantId,
        productId: orig.productId,
        branchId: doc.branchId,
        qty: orig.role === "OUTPUT" ? orig.qty.negated() : orig.qty,
        type: orig.role === "OUTPUT" ? "PRODUCTION_IN_REVERSAL" : "PRODUCTION_OUT_REVERSAL",
        sourceType: "PRODUCTION",
        sourceId: rev.id,
        occurredAt: now,
        createdBy: voidedBy,
      });
    }

    return tx.production.findUniqueOrThrow({
      where: { id: doc.id },
      include: { items: true },
    });
  });
}

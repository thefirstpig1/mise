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

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient, Production, ProductionItem } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { bangkokDayStartUtc, computeBangkokToday, isDayValue } from "@/lib/bangkok-date";
import type { ProductionOrigin } from "@prisma/client";
import { explodeToRaw, productKey } from "@/server/recipe-graph";
import { loadRecipeGraph } from "@/server/recipe-resolve";
import {
  hasMethod,
  preppedAvailableInTx,
  settlePreppedDemand,
} from "@/server/prepped-first";
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

/**
 * Up to 50 inputs, each written as a line and a movement (~5 round trips to
 * Singapore apiece): the default 5 s would cut a large batch off half-written.
 * The posting paths' limit, for the same reason they have it.
 */
const PRODUCTION_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;
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
  }, PRODUCTION_TX_OPTIONS);
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
  }, PRODUCTION_TX_OPTIONS);
}

// ------------------------------------------------------------
// ADR 0040 Q9 — what was used beyond the shelf was made, unrecorded
// ------------------------------------------------------------

const BANGKOK_OFFSET_MS = 7 * 3600 * 1000;

/** The Bangkok business day an instant falls on, as a day value. */
function bangkokDayOf(at: Date): Date {
  if (isDayValue(at)) return at;
  const bkk = new Date(at.getTime() + BANGKOK_OFFSET_MS);
  return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()));
}

/**
 * Before a document takes a prepped product off the shelf BY NAME — waste, a
 * write-down, a transfer — make up whatever the shelf cannot cover.
 *
 * Q9: "โอนซุปที่ครัวกลางมีไม่พอ = ครัวกลางผลิตโดยไม่บันทึก". The soup that was
 * thrown away, or sent to another branch, existed; if the ledger never saw it
 * made, it was made without a record. Writing that production is what lets
 * the named product leave in full at the right value — the receiving branch
 * gets soup priced by the bones it was made from, and the waste report shows
 * soup, not a scatter of raw ingredients nobody threw away.
 *
 * A dish is different (`prepped-first.ts`): a sale names a MENU, and the
 * system infers what went into it, so there the shortfall walks down the
 * recipe directly. Here a person named the prepped product itself.
 *
 * Does nothing for a RAW product, for a prepped product the shelf covers (D2:
 * the lowest balance from `at` on), or for one with no way to be made — that
 * one leaves as itself and may go negative, the way a raw product does when a
 * receipt is missing (ADR 0014 Q7).
 *
 * Call it BEFORE posting the outflow: the production's legs are written first
 * at the same instant, so the replay puts the making ahead of the using.
 */
export async function produceShortfallInTx(
  tx: PrismaClient,
  tenantId: string,
  params: {
    branchId: string;
    productId: string;
    /** Positive, in base units: how much the document is about to take. */
    qty: Prisma.Decimal;
    at: Date;
    origin: Exclude<ProductionOrigin, "MANUAL">;
    originId: string;
    recordedBy: string;
  }
): Promise<ProductionWithItems | null> {
  const { branchId, productId, qty, at } = params;
  const product = await tx.product.findFirst({
    where: { tenantId, id: productId },
    select: { type: true },
  });
  if (!product || product.type !== "PREPPED" || qty.lessThanOrEqualTo(0)) return null;

  const onShelf =
    (await preppedAvailableInTx(tx, tenantId, branchId, [productId], at)).get(productId) ??
    new Prisma.Decimal(0);
  const short = qty.minus(onShelf);
  if (short.lessThanOrEqualTo(0)) return null;

  const graph = await loadRecipeGraph(
    tx,
    tenantId,
    [{ kind: "product", id: productId }],
    branchId,
    bangkokDayOf(at)
  );
  if (!hasMethod(graph, productId)) return null;

  // One level down, then the same shelf rule for what that needs: stock on
  // the stock shelf is used before the bones under it.
  const oneLevel = explodeToRaw(graph, productKey(productId), short, { stopAtPrepped: true });
  const preppedBelow = oneLevel
    .map((l) => l.productId)
    .filter((id) => graph.products.get(id)?.type === "PREPPED");
  const available = preppedBelow.length
    ? await preppedAvailableInTx(tx, tenantId, branchId, [...new Set(preppedBelow)], at)
    : new Map<string, Prisma.Decimal>();
  const settled = settlePreppedDemand(
    graph,
    new Map(oneLevel.map((l) => [l.productId, l.qty])),
    available
  );
  const inputs = [...settled.demand.entries()]
    .map(([id, q]) => ({ productId: id, qty: q.toDecimalPlaces(3) }))
    .filter((l) => l.qty.greaterThan(0));
  if (inputs.length === 0) return null;

  const branch = await tx.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { code: true },
  });
  const pdNumber = await generatePdNumber(tx, tenantId, branch.code);
  const node = graph.products.get(productId);
  const doc = await tx.production.create({
    data: {
      tenantId,
      branchId,
      pdNumber,
      kind: "PRODUCE",
      origin: params.origin,
      originId: params.originId,
      producedAt: at,
      recipeId: node?.productionRecipe?.id ?? null,
      recordedBy: params.recordedBy,
    },
  });

  for (const line of inputs) {
    const item = await tx.productionItem.create({
      data: {
        tenantId,
        productionId: doc.id,
        productId: line.productId,
        role: "INPUT",
        qty: line.qty,
      },
    });
    await createStockMovementLogic(tx, {
      tenantId,
      productId: line.productId,
      branchId,
      qty: line.qty.negated(),
      type: "PRODUCTION_OUT",
      sourceType: "PRODUCTION",
      sourceId: item.id,
      occurredAt: at,
      createdBy: params.recordedBy,
    });
  }
  const outQty = short.toDecimalPlaces(3);
  const out = await tx.productionItem.create({
    data: {
      tenantId,
      productionId: doc.id,
      productId,
      role: "OUTPUT",
      qty: outQty,
      valueSharePct: HUNDRED,
    },
  });
  await createStockMovementLogic(tx, {
    tenantId,
    productId,
    branchId,
    qty: outQty,
    type: "PRODUCTION_IN",
    sourceType: "PRODUCTION",
    sourceId: out.id,
    occurredAt: at,
    createdBy: params.recordedBy,
  });

  return tx.production.findUniqueOrThrow({ where: { id: doc.id }, include: { items: true } });
}

// ------------------------------------------------------------
// ADR 0040 Q5 — a late or voided production re-posts the days it changes
// ------------------------------------------------------------

/** One day the re-post looked at, and what happened to it. */
export type RepostedDay = {
  businessDate: Date;
  /** Re-posted; or kept as it was, with the reason. */
  outcome: "REPOSTED" | "KEPT_OUTSIDE_WINDOW" | "KEPT_FAILED";
  /** For KEPT_FAILED: the error's message, logged, never shown raw. */
  error?: string;
};

/**
 * Re-post every standing day at `branchId` from `fromDate` on that the
 * products in question touched — either cut from their recipe instead (a
 * `prepped_shortfall`), or taken off their shelf (a consumption item).
 *
 * Q5: "ระบบตัดสต๊อกใหม่เองทุกวันที่ได้รับผล" — with the mechanism ADR 0022
 * already has, void + post the whole day. Each day is its own transaction and
 * computes before it swaps: a day that cannot be re-posted keeps what it had
 * and is reported, so no day is ever left "not cut". Oldest first, because a
 * day may take only what the days after it have not used (D2), and the days
 * after it are about to be re-posted too.
 *
 * A day outside the ledger's backdate window is KEPT and reported: re-posting
 * it would void its run and post nothing, which erases a day instead of
 * correcting it.
 */
export async function repostAffectedDaysLogic(
  tenantId: string,
  params: { branchId: string; productIds: string[]; fromDate: Date },
  actor: string
): Promise<RepostedDay[]> {
  const { branchId, productIds, fromDate } = params;
  if (productIds.length === 0) return [];
  const days = await withTenantContext(tenantId, async (tx) => {
    const runs = await tx.salesConsumptionRun.findMany({
      where: {
        tenantId,
        branchId,
        voidedAt: null,
        businessDate: { gte: fromDate },
        OR: [
          { preppedShortfalls: { some: { productId: { in: productIds } } } },
          { items: { some: { productId: { in: productIds }, reversalOfItemId: null } } },
        ],
      },
      select: { businessDate: true },
      orderBy: { businessDate: "asc" },
    });
    return runs.map((r) => r.businessDate);
  });

  // Imported lazily: the consumption modules reach the waste and transfer
  // writers, which import this one.
  const { postConsumptionForDayLogic } = await import("@/server/consumption-post");
  const { isWithinBackdateWindow } = await import("@/server/consumption");
  const out: RepostedDay[] = [];
  for (const businessDate of days) {
    if (!isWithinBackdateWindow(businessDate)) {
      out.push({ businessDate, outcome: "KEPT_OUTSIDE_WINDOW" });
      continue;
    }
    try {
      await postConsumptionForDayLogic(
        tenantId,
        { submitKey: randomUUID(), branchId, businessDate, acknowledgeRepost: true },
        actor
      );
      out.push({ businessDate, outcome: "REPOSTED" });
    } catch (e) {
      console.error("[production] re-post failed", businessDate.toISOString().slice(0, 10), e);
      out.push({ businessDate, outcome: "KEPT_FAILED", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** The Bangkok day a production happened on. */
const productionDay = (p: { producedAt: Date }) => bangkokDayOf(p.producedAt);

/**
 * Record a production and re-post the days it changes (Q5). The production
 * commits FIRST — re-posting reads the shelf it creates — and the days follow,
 * each in its own transaction.
 */
export async function recordProductionLogic(
  tenantId: string,
  input: CreateProductionInput,
  recordedBy: string
): Promise<{ production: ProductionWithItems; reposted: RepostedDay[] }> {
  const production = await createProductionLogic(tenantId, input, recordedBy);
  const reposted = await repostAffectedDaysLogic(
    tenantId,
    {
      branchId: production.branchId,
      productIds: production.items.filter((i) => i.role === "OUTPUT").map((i) => i.productId),
      fromDate: productionDay(production),
    },
    recordedBy
  );
  return { production, reposted };
}

/**
 * Void a production and re-post the days that took its output off the shelf
 * (Q5: "ยกเลิกการผลิตย้อนหลังใช้กลไกเดียวกัน") — those days must now cut the
 * recipe instead, or the shelf goes negative for soup that never existed.
 */
export async function voidProductionAndRepostLogic(
  tenantId: string,
  input: VoidProductionInput,
  voidedBy: string
): Promise<{ production: ProductionWithItems; reposted: RepostedDay[] }> {
  const production = await voidProductionLogic(tenantId, input, voidedBy);
  const reposted = await repostAffectedDaysLogic(
    tenantId,
    {
      branchId: production.branchId,
      productIds: production.items
        .filter((i) => i.role === "OUTPUT" && i.reversalOfItemId === null)
        .map((i) => i.productId),
      fromDate: productionDay(production),
    },
    voidedBy
  );
  return { production, reposted };
}

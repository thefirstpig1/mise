// ============================================================
// Mise — staff meal write logic (Sprint 5 Part 26 L3, ADR 0028)
// ============================================================
// Two shapes, one document, one rule about refusing.
//
// **NOTHING HERE BLOCKS ON A POLICY, AND THAT IS THE DECISION.** A ceiling on
// the dish price and a daily quota are both real, both configured, and both
// reported — and neither refuses a write. The food is already eaten by the time
// anybody types it in: refusing the record does not put the pork back, it makes
// the stock wrong AND hides that anyone went over. Every incentive of a block
// points at not recording it at all. So this Part warns, labels, and posts —
// the same call Part 20a made about an incomplete POS file and Q6 makes about
// a possible double deduction.
//
// What DOES refuse: a menu whose recipe cannot be exploded. That is not a
// policy, it is an inability — there is no set of stock movements to write, and
// a document that deducts nothing while claiming a meal happened is worse than
// no document. Rule N2's "whole or not at all", at a grain of one dish.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient, StaffMealPriceSource } from "@prisma/client";
import { createHash } from "node:crypto";
import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";
import { createStockMovementLogic } from "@/server/stock-movement";
import { recipelessComponent } from "@/server/consumption";
import {
  explodeToRaw,
  menuKey,
  GraphNodeMissingError,
  RecipeCycleError,
  RecipeDepthExceededError,
  RecipeMethodMissingError,
} from "@/server/recipe-graph";
import { loadRecipeGraph, resolveRecipeIds } from "@/server/recipe-resolve";
import {
  StockUnitMismatchError,
  QtyRoundsToZeroError,
  reversalInstantFor,
  toBaseQty,
} from "@/server/stock-movement";
import type {
  CreateStaffMealInput,
  CreateStaffMemberInput,
  UpdateStaffMemberInput,
  VoidStaffMealInput,
} from "@/lib/validations/staff-meal";

const ZERO = new Prisma.Decimal(0);
const QTY_SCALE = 3;
const MONEY_SCALE = 2;

/** Same ceiling the consumption post uses — Singapore, through pgbouncer. */
const POST_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

// ------------------------------------------------------------
// Refusals
// ------------------------------------------------------------

/** The dish has no recipe this branch can resolve on that day. */
export class StaffMealNoRecipeError extends Error {
  constructor(readonly menuId: string) {
    super(`Menu ${menuId} has no recipe resolvable for this branch and date`);
    this.name = "StaffMealNoRecipeError";
  }
}

/**
 * A set menu whose component has no recipe of its own. Detected BEFORE the walk
 * rather than inferred from a short answer afterwards, because `explodeToRaw`
 * returns silently for one — the dish would deduct less than it should and
 * nothing would look wrong (rule N2's dangerous case, at one dish).
 */
export class StaffMealComponentNoRecipeError extends Error {
  constructor(readonly menuId: string, readonly componentMenuId: string) {
    super(`Component menu ${componentMenuId} of ${menuId} has no recipe`);
    this.name = "StaffMealComponentNoRecipeError";
  }
}

/** The graph would not walk: a cycle, a depth cap, a missing node. */
export class StaffMealRecipeUnresolvableError extends Error {
  constructor(readonly menuId: string, readonly detail: string) {
    super(`Recipe for ${menuId} could not be exploded: ${detail}`);
    this.name = "StaffMealRecipeUnresolvableError";
  }
}

/**
 * A PREPPED product came out as a leaf, which means it has neither a parent +
 * yield nor a production recipe (recipe-graph.ts:387).
 *
 * For COST that is an honest answer — it prices UNPRICED and drags confidence
 * to LOW. For STOCK it is not: nothing in Mise can RAISE a prepped balance
 * (ADR 0021 Q11), so deducting against one drives it negative for ever and
 * `/cost` reports negative stock on a product nobody can restock. Part 22 holds
 * the dish back for this; so does this.
 */
export class StaffMealPreppedIngredientError extends Error {
  constructor(readonly menuId: string, readonly productId: string) {
    super(`Menu ${menuId} explodes to PREPPED product ${productId}`);
    this.name = "StaffMealPreppedIngredientError";
  }
}

export class StaffMealNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Staff meal ${id} not found`);
    this.name = "StaffMealNotFoundError";
  }
}

export class StaffMealAlreadyVoidedError extends Error {
  constructor(readonly id: string) {
    super(`Staff meal ${id} is already voided`);
    this.name = "StaffMealAlreadyVoidedError";
  }
}

export class StaffMemberNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Staff member ${id} not found`);
    this.name = "StaffMemberNotFoundError";
  }
}

// ------------------------------------------------------------
// Ids that survive a double press
// ------------------------------------------------------------

/**
 * A stable id derived from the submission key, in the shape of a v5 UUID.
 *
 * `submitKey` becomes `staff_meal.id` directly, but the ITEMS need ids of their
 * own — and they are the ledger's sources, so minting them fresh would let a
 * replayed press write a second set and deduct the food twice with every row in
 * the ledger looking perfectly ordinary. Same device, and the same reason, as
 * `runIdFor` in consumption-post.ts and `versionIdFor` in recipe.ts: one
 * submission produces N rows, so the key has to spread deterministically across
 * all N rather than fixing only the first.
 *
 * Salted by product id, which is unique within a document by
 * `staff_meal_item_product_unique`.
 */
export function staffMealItemIdFor(submitKey: string, salt: string): string {
  const digest = createHash("sha1").update(`${submitKey}:${salt}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ------------------------------------------------------------
// What the dish took off the shelf
// ------------------------------------------------------------

/** One raw product and the base-unit magnitude (POSITIVE) the meal consumed. */
export type StaffMealDemandLine = {
  productId: string;
  /** Positive magnitude in the base unit. The sign is applied at posting. */
  qty: Prisma.Decimal;
};

/**
 * Explode one menu, as of one business day, for one branch.
 *
 * The recipe is resolved AS OF `businessDate` (ADR 0021 Q4) — the same rule a
 * consumption run follows, and for the same reason: backdating a staff meal a
 * fortnight and costing it against today's recipe would deduct the wrong pork
 * with nothing on screen looking wrong.
 *
 * Whole or not at all. Every path out of here is either a full set of lines or
 * a refusal that names what is in the way — never a short list.
 */
export async function explodeStaffMealMenuLogic(
  tx: PrismaClient,
  tenantId: string,
  params: { menuId: string; branchId: string; businessDate: Date; servings: Prisma.Decimal }
): Promise<StaffMealDemandLine[]> {
  const { menuId, branchId, businessDate, servings } = params;

  const resolved = await resolveRecipeIds(
    tx,
    tenantId,
    [{ kind: "menu", id: menuId }],
    branchId,
    businessDate
  );
  if (!resolved.has(`menu:${menuId}`)) throw new StaffMealNoRecipeError(menuId);

  const graph = await loadRecipeGraph(
    tx,
    tenantId,
    [{ kind: "menu", id: menuId }],
    branchId,
    businessDate
  );

  const root = menuKey(menuId);

  const orphan = recipelessComponent(graph, root, menuId);
  if (orphan !== null) throw new StaffMealComponentNoRecipeError(menuId, orphan);

  let leaves;
  try {
    leaves = explodeToRaw(graph, root, servings);
  } catch (e) {
    if (
      e instanceof RecipeMethodMissingError ||
      e instanceof RecipeCycleError ||
      e instanceof RecipeDepthExceededError ||
      e instanceof GraphNodeMissingError
    ) {
      throw new StaffMealRecipeUnresolvableError(menuId, e.message);
    }
    throw e;
  }

  const prepped = leaves.find(
    (l) => graph.products.get(l.productId)?.type === "PREPPED"
  );
  if (prepped !== undefined) {
    throw new StaffMealPreppedIngredientError(menuId, prepped.productId);
  }

  // A leaf that rounds to nothing at 3dp is dropped, not posted: a zero item is
  // noise with a stock movement attached, and `staff_meal_item_qty_check`
  // refuses it anyway. A garnish measured in milligrams is the ordinary case.
  return leaves
    .map((l) => ({
      productId: l.productId,
      qty: l.qty.toDecimalPlaces(QTY_SCALE),
    }))
    .filter((l) => !l.qty.isZero());
}

// ------------------------------------------------------------
// The price that is not a cost
// ------------------------------------------------------------

export type StaffMealPrice = {
  /** Per serving, excluding VAT and service charge. Null only with NONE. */
  unitPrice: Prisma.Decimal | null;
  source: StaffMealPriceSource;
};

/**
 * What one serving of this dish is WORTH — the control figure, never a cost
 * (rule S1/S2).
 *
 * There is no `menu.sale_price` to read: ADR 0021 Q10 refused it because a typed
 * price goes stale the day the POS price changes. So the sold price is derived
 * the way Menu Lab derives it, `sum(net_amount) / sum(qty)` over live sales —
 * and by ADR 0025 Q2 that IS the price once a dish sells.
 *
 * Fallback order, and each step is labelled rather than blended:
 *   SOLD    — what it actually sold for.
 *   PLANNED — `recipe.planned_price`, **ราคาที่ตั้งใจ**, for a dish nobody has
 *             bought yet. Common in exactly this feature: shops keep dishes that
 *             only staff eat.
 *   NONE    — null, and the quota says so out loud. Never 0.00, which would read
 *             as "the meal was free" rather than "we cannot say" (ADR 0019).
 *
 * Sales are read across the WHOLE tenant rather than this branch alone. A price
 * is a property of the dish, not of the shelf it came off — unlike cost, which
 * ADR 0014 Q9 makes branch-scoped — and a new branch would otherwise report NONE
 * for dishes the business has sold for years.
 */
export async function resolveStaffMealPriceLogic(
  tx: PrismaClient,
  tenantId: string,
  menuId: string,
  asOf: Date
): Promise<StaffMealPrice> {
  const sold = await tx.salesLine.aggregate({
    where: {
      tenantId,
      menuId,
      supersededAt: null,
      businessDate: { lte: asOf },
    },
    _sum: { netAmount: true, qty: true },
  });

  const qty = sold._sum.qty ?? ZERO;
  const net = sold._sum.netAmount ?? ZERO;
  // `qty` can be zero or negative on a day of cancellations, and dividing by it
  // would either throw or invent a price out of a refund.
  if (qty.greaterThan(ZERO)) {
    return {
      unitPrice: net.dividedBy(qty).toDecimalPlaces(MONEY_SCALE),
      source: "SOLD",
    };
  }

  // The live recipe's planned price. `is_draft` is excluded: a draft is true on
  // no day (ADR 0025 Q4), so it may not price a meal that really happened.
  const planned = await tx.recipe.findFirst({
    where: {
      tenantId,
      menuId,
      isDraft: false,
      deletedAt: null,
      supersededAt: null,
      plannedPrice: { not: null },
    },
    orderBy: { effectiveFrom: "desc" },
    select: { plannedPrice: true },
  });

  if (planned?.plannedPrice != null) {
    return {
      unitPrice: planned.plannedPrice.toDecimalPlaces(MONEY_SCALE),
      source: "PLANNED",
    };
  }

  return { unitPrice: null, source: "NONE" };
}

// ------------------------------------------------------------
// Writing
// ------------------------------------------------------------

export type CreateStaffMealResult = {
  id: string;
  itemCount: number;
  /** Frozen at entry — see `resolveStaffMealPriceLogic`. */
  unitPrice: Prisma.Decimal | null;
  priceSource: StaffMealPriceSource;
  /** Already recorded when this key was submitted before. */
  replayed: boolean;
};

export async function createStaffMealLogic(
  tenantId: string,
  input: CreateStaffMealInput,
  recordedBy: string
): Promise<CreateStaffMealResult> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      // `submitKey` IS the document id, so a replayed press finds itself here
      // rather than writing a second meal. The items are keyed off it too, so
      // the ledger cannot be reached twice even by a request that got past this.
      const replay = await tx.staffMeal.findFirst({
        where: { tenantId, id: input.submitKey },
        select: {
          id: true,
          frozenUnitPrice: true,
          priceSource: true,
          _count: { select: { items: true } },
        },
      });
      if (replay) {
        return {
          id: replay.id,
          itemCount: replay._count.items,
          unitPrice: replay.frozenUnitPrice,
          priceSource: replay.priceSource,
          replayed: true,
        };
      }

      await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);

      if (input.staffMemberId !== null) {
        const member = await tx.staffMember.findFirst({
          where: { id: input.staffMemberId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!member) throw new StaffMemberNotFoundError(input.staffMemberId);
        // `isActive` is NOT checked. Someone who left last week can still have
        // eaten last week, and this document is dated — refusing here would make
        // a backdated correction impossible for exactly the person most likely
        // to need one (rule S7: is_active is a claim about the future).
      }

      const servings = new Prisma.Decimal(input.servings);

      // --- what left the shelf -------------------------------------------
      let lines: StaffMealDemandLine[];
      let price: StaffMealPrice = { unitPrice: null, source: "NONE" };

      if (input.menuId !== null) {
        await assertRefBelongsToTenant(tx, tenantId, "menu", input.menuId);
        lines = await explodeStaffMealMenuLogic(tx, tenantId, {
          menuId: input.menuId,
          branchId: input.branchId,
          businessDate: input.businessDate,
          servings,
        });
        price = await resolveStaffMealPriceLogic(
          tx,
          tenantId,
          input.menuId,
          input.businessDate
        );
      } else {
        lines = [];
        for (const item of input.items) {
          await assertRefBelongsToTenant(tx, tenantId, "product", item.productId);

          // The unit must belong to THIS product. Matching on productId is also
          // what makes a cross-tenant unit unreachable — the product is already
          // asserted. Same guard, and the same wording, as waste.
          const unit = await tx.productUnit.findFirst({
            where: { id: item.inputUnitId, productId: item.productId },
            select: { id: true, unitName: true, toBaseRatio: true },
          });
          if (!unit) {
            throw new StockUnitMismatchError(item.inputUnitId, item.productId);
          }

          const magnitude = toBaseQty(item.inputQty, unit.toBaseRatio);
          if (magnitude.isZero()) {
            const base = await tx.productUnit.findFirst({
              where: { productId: item.productId, isBase: true },
              select: { unitName: true },
            });
            throw new QtyRoundsToZeroError(
              new Prisma.Decimal(item.inputQty),
              unit.unitName,
              base?.unitName ?? null
            );
          }
          lines.push({ productId: item.productId, qty: magnitude });
        }
      }

      // A menu that explodes to nothing at all is not a meal. It cannot happen
      // through the form (a recipe with no ingredients is refused at Part 21),
      // but a document with no items would deduct nothing while claiming a meal
      // happened — the exact thing rule N2 exists to prevent.
      if (lines.length === 0) {
        throw new StaffMealRecipeUnresolvableError(
          input.menuId ?? "",
          "recipe explodes to no raw ingredients"
        );
      }

      // --- the document --------------------------------------------------
      const meal = await tx.staffMeal.create({
        data: {
          id: input.submitKey,
          tenantId,
          branchId: input.branchId,
          businessDate: input.businessDate,
          staffMemberId: input.staffMemberId,
          menuId: input.menuId,
          servings,
          frozenUnitPrice: price.unitPrice,
          priceSource: price.source,
          recordedBy,
          recordedByName: input.recordedByName,
          notes: input.notes,
        },
      });

      // --- the ledger ----------------------------------------------------
      for (const line of lines) {
        const item = await tx.staffMealItem.create({
          data: {
            id: staffMealItemIdFor(input.submitKey, line.productId),
            tenantId,
            staffMealId: meal.id,
            productId: line.productId,
            // Signed here, never typed. The input is a magnitude and the DB
            // CHECK keeps it that way; stock leaving is negative.
            qty: line.qty.negated(),
            inputQty:
              input.menuId === null
                ? new Prisma.Decimal(
                    input.items.find((i) => i.productId === line.productId)!.inputQty
                  )
                : null,
            inputUnitId:
              input.menuId === null
                ? input.items.find((i) => i.productId === line.productId)!.inputUnitId
                : null,
          },
        });

        await createStockMovementLogic(tx, {
          tenantId,
          productId: line.productId,
          branchId: input.branchId,
          qty: item.qty,
          type: "CONSUMPTION",
          sourceType: "STAFF_MEAL",
          sourceId: item.id,
          occurredAt: input.businessDate,
          createdBy: recordedBy,
        });
      }

      return {
        id: meal.id,
        itemCount: lines.length,
        unitPrice: price.unitPrice,
        priceSource: price.source,
        replayed: false,
      };
    },
    POST_TX_OPTIONS
  );
}

/**
 * Void a meal: append reversal items to the SAME document and post the
 * compensating `CONSUMPTION_REVERSAL`.
 *
 * **The reversal is valued from the ORIGINAL ITEM, never recomputed** — `qty` is
 * read back from the posted row rather than re-derived from today's recipe or
 * today's unit ratios. Part 17 established that instinct and Part 22 needed it:
 * a recipe edited between the meal and its correction would otherwise give back
 * a different quantity than was taken, leaving the ledger permanently off.
 *
 * The reversal occurs NOW, not at the original `businessDate`: a ledger reverses
 * on the day the error is found, and backdating would silently move a balance
 * that has already been reported.
 */
export async function voidStaffMealLogic(
  tenantId: string,
  input: VoidStaffMealInput,
  voidedBy: string
): Promise<{ id: string; reversedItems: number }> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const meal = await tx.staffMeal.findFirst({
        where: { tenantId, id: input.id },
        select: {
          id: true,
          branchId: true,
          businessDate: true,
          voidedAt: true,
          items: {
            where: { reversalOfItemId: null },
            select: { id: true, productId: true, qty: true },
          },
        },
      });
      if (!meal) throw new StaffMealNotFoundError(input.id);
      if (meal.voidedAt !== null) throw new StaffMealAlreadyVoidedError(meal.id);

      // NOT a bare  — see reversalInstantFor. A meal recorded and
      // corrected on the same day would otherwise be walked in the wrong order
      // and give its stock back at last-known cost.
      const occurredAt = reversalInstantFor(meal.businessDate);

      for (const original of meal.items) {
        const reversal = await tx.staffMealItem.create({
          data: {
            tenantId,
            staffMealId: meal.id,
            productId: original.productId,
            qty: original.qty.negated(),
            reversalOfItemId: original.id,
          },
        });

        await createStockMovementLogic(tx, {
          tenantId,
          productId: original.productId,
          branchId: meal.branchId,
          qty: reversal.qty,
          // A type of its own rather than ADJUST_GAIN, because the FIFO walk
          // must give back the layers this meal TOOK, at the values it took
          // them at (ADR 0014 Q8). That lookup is the one Part 26 had to teach
          // stock-cost.ts about — see ADR 0028 Consequence 1.
          type: "CONSUMPTION_REVERSAL",
          sourceType: "STAFF_MEAL",
          sourceId: reversal.id,
          occurredAt,
          createdBy: voidedBy,
        });
      }

      await tx.staffMeal.update({
        where: { id: meal.id },
        // The DOCUMENT records when the void happened; the MOVEMENT records
        // when costing should see it. They agree except on a same-day fix.
        data: { voidedAt: new Date(), voidedBy, voidReason: input.voidReason },
      });

      return { id: meal.id, reversedItems: meal.items.length };
    },
    POST_TX_OPTIONS
  );
}

// ------------------------------------------------------------
// The roster
// ------------------------------------------------------------

export async function createStaffMemberLogic(
  tenantId: string,
  input: CreateStaffMemberInput
): Promise<{ id: string }> {
  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
    const member = await tx.staffMember.create({
      data: {
        tenantId,
        branchId: input.branchId,
        name: input.name,
        dailyQuotaAmount: input.dailyQuotaAmount,
      },
      select: { id: true },
    });
    return member;
  });
}

/**
 * There is deliberately no uniqueness on the name. Two people called สมชาย is
 * a fact about a kitchen, not a data-entry error, and a unique index would make
 * the second one unrecordable — which is worse than an ambiguous list, because
 * the ambiguity is at least visible.
 */
export async function updateStaffMemberLogic(
  tenantId: string,
  input: UpdateStaffMemberInput
): Promise<{ id: string }> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.staffMember.findFirst({
      where: { id: input.id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new StaffMemberNotFoundError(input.id);
    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);

    await tx.staffMember.update({
      where: { id: input.id },
      data: {
        name: input.name,
        branchId: input.branchId,
        dailyQuotaAmount: input.dailyQuotaAmount,
        isActive: input.isActive,
      },
    });
    return { id: input.id };
  });
}

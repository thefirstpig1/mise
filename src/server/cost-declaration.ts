// ============================================================
// Mise — cost declaration WRITE logic (Sprint 2 Part 14 L3b, ADR 0014 Q6)
// ============================================================
// The only cost a human types anywhere in the system. Everything else is derived
// from a document; this exists for the stock that has no document — the 10 kg
// found during a recount, which the ledger records the quantity of and nothing
// else (ADR 0011 Q10 gave `stock_adjustment` no price column, deliberately).
//
// APPEND + SUPERSEDE, the shape ADR 0009 already uses for supplier prices: a
// correction opens a new row and closes the previous one. Nothing is ever
// overwritten, because the feature exists so that a person can put their name to
// a number, and a statement nobody can trace is not a statement.
//
// **This file deliberately imports nothing from `stock-movement.ts` or
// `stock-cost.ts`.** Both of those need it — the adjustment write path writes a
// declaration inside its own transaction, and the cost read reads them back —
// and keeping the dependency one-way avoids a circular import between the three.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient, StockCostDeclaration } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type {
  CostDeclarationBody,
  DeclareStockCostInput,
} from "@/lib/validations/stock-cost";

/** `unit_cost` is Decimal(15,4) — the rate is rounded here, never at the driver. */
const COST_SCALE = 4;

/**
 * Thrown when the movement being priced is missing, belongs to another tenant, or
 * is not an `ADJUST_GAIN`.
 *
 * The GAIN-only rule (Q6) cannot be a DB CHECK — it reads `stock_movement.type`,
 * and a CHECK cannot cross tables — so this assertion is the whole enforcement.
 * A received item's price belongs to its receipt, and ADR 0013 Q6 already decided
 * a receipt is voided rather than edited; a second way to change a receipt's
 * price would be a second answer to the same question.
 */
export class CostDeclarationTargetError extends Error {
  constructor(
    public readonly movementId: string,
    public readonly reason: "NOT_FOUND" | "NOT_A_GAIN"
  ) {
    super(
      reason === "NOT_FOUND"
        ? `Movement "${movementId}" does not exist for this tenant`
        : `Movement "${movementId}" is not an ADJUST_GAIN — its cost belongs to its document`
    );
    this.name = "CostDeclarationTargetError";
  }
}

/**
 * Thrown when the unit the cost was typed in is not a unit of the product the
 * movement moved. Mirror of `StockUnitMismatchError` on the adjustment path —
 * kept separate because the field it attaches to and the message differ.
 */
export class CostUnitMismatchError extends Error {
  constructor(
    public readonly unitId: string,
    public readonly productId: string
  ) {
    super(`Unit "${unitId}" is not a unit of product "${productId}"`);
    this.name = "CostUnitMismatchError";
  }
}

/**
 * Write a declaration against a movement that is ALREADY in this transaction.
 *
 * Takes `tx` rather than `tenantId` — the same deliberate break with the
 * tenantId-first convention `createStockMovementLogic` makes, and for the same
 * reason: the adjustment and its declaration must commit together or a form
 * submission could record stock at a price nobody typed.
 *
 * `movementType` is passed in rather than re-read: the caller has just written
 * the row and a second query would only prove the caller's own state back to it.
 */
export async function writeCostDeclaration(
  tx: PrismaClient,
  params: {
    tenantId: string;
    movementId: string;
    productId: string;
    movementType: string;
    body: CostDeclarationBody;
    declaredBy: string;
  }
): Promise<StockCostDeclaration> {
  const { tenantId, movementId, productId, movementType, body, declaredBy } = params;

  if (movementType !== "ADJUST_GAIN") {
    throw new CostDeclarationTargetError(movementId, "NOT_A_GAIN");
  }

  // The unit must belong to THIS product — which is also what makes a
  // cross-tenant unit unreachable, since the product is the movement's own.
  const unit = await tx.productUnit.findFirst({
    where: { id: body.unitId, productId },
    select: { id: true, toBaseRatio: true },
  });
  if (!unit) throw new CostUnitMismatchError(body.unitId, productId);

  // "กระสอบละ 4,500" at 25 kg a sack is 180 ฿/kg. The rate is rounded to the
  // column's scale HERE so the number stored is the number the app computed;
  // the layer's MONEY is a separate rounding at replay time (Q12), which is what
  // keeps the satang-level invariant intact regardless of what happens here.
  const unitCost = new Prisma.Decimal(body.unitCost)
    .div(unit.toBaseRatio)
    .toDecimalPlaces(COST_SCALE, Prisma.Decimal.ROUND_HALF_UP);

  // Close whatever was open first. The partial unique
  // (movement_id) WHERE superseded_at IS NULL turns a concurrent second writer
  // into a constraint violation rather than two live statements about one fact.
  await tx.stockCostDeclaration.updateMany({
    where: { tenantId, movementId, supersededAt: null },
    data: { supersededAt: new Date() },
  });

  return tx.stockCostDeclaration.create({
    data: {
      tenantId,
      movementId,
      inputUnitCost: new Prisma.Decimal(body.unitCost),
      inputUnitId: body.unitId,
      unitCost,
      note: body.note,
      declaredBy,
    },
  });
}

/**
 * Declare (or correct) the cost of stock that arrived without a document — the
 * "I found the invoice in November" path.
 *
 * Input must already be parsed by `declareStockCostInputSchema`.
 */
export async function declareStockCostLogic(
  tenantId: string,
  input: DeclareStockCostInput,
  declaredBy: string
): Promise<StockCostDeclaration> {
  return withTenantContext(tenantId, async (tx) => {
    const movement = await tx.stockMovement.findFirst({
      where: { id: input.movementId, tenantId },
      select: { id: true, productId: true, type: true },
    });
    if (!movement) {
      throw new CostDeclarationTargetError(input.movementId, "NOT_FOUND");
    }

    return writeCostDeclaration(tx, {
      tenantId,
      movementId: movement.id,
      productId: movement.productId,
      movementType: movement.type,
      body: { unitCost: input.unitCost, unitId: input.unitId, note: input.note },
      declaredBy,
    });
  });
}

/** One declaration, with the unit it was typed in and who signed it. */
export type CostDeclarationRecord = StockCostDeclaration & {
  inputUnit: { id: string; unitName: string };
  declaredByUser: { id: string; name: string | null; email: string | null };
};

/**
 * The full series for a movement, newest first — live row included.
 *
 * Superseded rows are returned, not filtered: the UI shows the history so a
 * corrected number can be defended to whoever asks, which is the whole reason
 * the table appends instead of overwriting.
 */
export async function getCostDeclarationsLogic(
  tenantId: string,
  movementId: string
): Promise<CostDeclarationRecord[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.stockCostDeclaration.findMany({
      where: { tenantId, movementId },
      include: {
        inputUnit: { select: { id: true, unitName: true } },
        declaredByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { declaredAt: "desc" },
    })
  );
}

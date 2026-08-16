// ============================================================
// Mise — cost view serializers (Sprint 2 Part 14 L4, ADR 0014)
// ============================================================
// Every Decimal leaves as a STRING (Pitfall #20). Two reasons stack here: a
// Prisma Decimal cannot cross the Server→Client boundary at all, and these are
// money figures — a `Number` round-trip on a Decimal(15,4) with a long integer
// part silently corrupts exactly the numbers the whole Part exists to protect.
//
// Dates are formatted HERE, on the server, not in the components (the Part 10
// L5c lesson): a list that grows client-side would format its first page in Node
// and the rest in the browser, with different locale and timezone defaults and a
// hydration mismatch on the SSR rows.
// ============================================================

import type { CostSource } from "@/lib/validations/stock-cost";
import {
  COST_SOURCE_HINTS_TH,
  COST_SOURCE_LABELS_TH,
} from "@/lib/validations/stock-cost";
import type { LayerPricing } from "@/server/fifo-replay";
import type { ProductCost, BranchCostSummary } from "@/server/stock-cost";
import type { CostDeclarationRecord } from "@/server/cost-declaration";

const BANGKOK = "Asia/Bangkok";

const dateTime = new Intl.DateTimeFormat("th-TH", {
  timeZone: BANGKOK,
  dateStyle: "medium",
  timeStyle: "short",
});

const dateOnly = new Intl.DateTimeFormat("th-TH", {
  timeZone: BANGKOK,
  dateStyle: "medium",
});

/** Money for display: grouped, always 2 decimals. Takes a STRING, never a number. */
export const formatMoney = (value: string): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/** Quantity for display: up to the ledger's 3 decimals, without trailing zeros. */
export const formatQty = (value: string): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("th-TH", { maximumFractionDigits: 3 });
};

export type CostLayerView = {
  movementId: string;
  sourceType: string;
  occurredAtLabel: string;
  /** Base-unit quantity still in this layer. Negative = stock owed (Q7). */
  qty: string;
  /** Money still attached to that quantity. */
  value: string;
  /** `value / qty`, for reading — the layer stores money, not this (Q12). */
  unitCost: string;
  pricing: LayerPricing;
};

export type ProductCostView = {
  productId: string;
  branchId: string;
  qtyOnHand: string;
  inventoryValue: string;
  costPerBaseUnit: string;
  costSource: CostSource;
  costSourceLabel: string;
  costSourceHint: string;
  lastKnownUnitCost: string | null;
  hasUnpricedLayers: boolean;
  negativeStock: boolean;
  layers: CostLayerView[];
};

export function toProductCostView(cost: ProductCost): ProductCostView {
  return {
    productId: cost.productId,
    branchId: cost.branchId,
    qtyOnHand: cost.qtyOnHand.toString(),
    inventoryValue: cost.inventoryValue.toString(),
    costPerBaseUnit: cost.costPerBaseUnit.toString(),
    costSource: cost.costSource,
    costSourceLabel: COST_SOURCE_LABELS_TH[cost.costSource],
    costSourceHint: COST_SOURCE_HINTS_TH[cost.costSource],
    lastKnownUnitCost: cost.lastKnownUnitCost?.toString() ?? null,
    hasUnpricedLayers: cost.hasUnpricedLayers,
    negativeStock: cost.negativeStock,
    layers: cost.layers.map((l) => ({
      movementId: l.movementId,
      sourceType: l.sourceType,
      occurredAtLabel: dateTime.format(l.occurredAt),
      qty: l.qty.toString(),
      value: l.value.toString(),
      unitCost: l.qty.isZero() ? "0" : l.value.div(l.qty).toString(),
      pricing: l.pricing,
    })),
  };
}

export type BranchCostSummaryView = {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  purchaseSpend: string;
  inventoryValue: string;
  wasteValue: string;
  /** Stock a count found missing (ADR 0015 Q5) — a different problem from spoilage. */
  countVarianceValue: string;
  excessSpend: string;
  negativeStockProducts: number;
  unpricedProducts: number;
  /** null until POS sync lands in Sprint 4 — "not measurable", never zero. */
  revenue: null;
  grossProfit: null;
};

export const toBranchCostSummaryView = (
  row: BranchCostSummary
): BranchCostSummaryView => ({
  branchId: row.branchId,
  branchName: row.branchName,
  branchCode: row.branchCode,
  purchaseSpend: row.purchaseSpend.toString(),
  inventoryValue: row.inventoryValue.toString(),
  wasteValue: row.wasteValue.toString(),
  countVarianceValue: row.countVarianceValue.toString(),
  excessSpend: row.excessSpend.toString(),
  negativeStockProducts: row.negativeStockProducts,
  unpricedProducts: row.unpricedProducts,
  revenue: null,
  grossProfit: null,
});

export type CostDeclarationView = {
  id: string;
  /** Per base unit — what the replay uses. */
  unitCost: string;
  /** As typed, with the unit it was typed in ("กระสอบละ 4,500"). */
  inputUnitCost: string;
  inputUnitName: string;
  note: string | null;
  declaredAtLabel: string;
  declaredByName: string;
  /** true = superseded by a later statement; kept visible, never deleted. */
  superseded: boolean;
  supersededAtLabel: string | null;
};

export const toCostDeclarationView = (
  d: CostDeclarationRecord
): CostDeclarationView => ({
  id: d.id,
  unitCost: d.unitCost.toString(),
  inputUnitCost: d.inputUnitCost.toString(),
  inputUnitName: d.inputUnit.unitName,
  note: d.note,
  declaredAtLabel: dateTime.format(d.declaredAt),
  // The email is the fallback identity: a user who never set a name is still a
  // person who signed this, and "—" would defeat the point of recording it.
  declaredByName: d.declaredByUser.name ?? d.declaredByUser.email ?? "ไม่ทราบผู้ระบุ",
  superseded: d.supersededAt !== null,
  supersededAtLabel: d.supersededAt ? dateOnly.format(d.supersededAt) : null,
});

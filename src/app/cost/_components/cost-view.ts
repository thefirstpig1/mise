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
  /** Materials — expense lines under `account = COGS` (ADR 0016 Q4). */
  cogsSpend: string;
  /** Everything else: rent, utilities, wages, the accountant. */
  opexSpend: string;
  inventoryValue: string;
  wasteValue: string;
  /** Stock a count found missing (ADR 0015 Q5) — a different problem from spoilage. */
  varianceValue: string;
  excessSpend: string;
  negativeStockProducts: number;
  unpricedProducts: number;
  /** From Part 19's imported sales: after discount, excl VAT and service charge.
   *  Null when this branch has had no file imported — "not measurable", never zero. */
  revenue: string | null;
  /** Revenue minus the cost of what was SOLD. Null when it cannot be worked out
   *  honestly — "not measurable", never zero. */
  grossProfit: string | null;
  grossProfitMethod: string;
  cogsSold: string | null;
  openingInventoryValue: string;
  /** The sentence that goes under the figure: how good is it, and why. */
  grossProfitNote: string;
  /**
   * Days of this period whose consumption is posted, out of the days that had
   * sales (rule N10). Rendered beside the สูตรอาหาร figure, never behind it — a
   * gross profit computed from three of thirty days is a real number about a
   * tenth of a month, and printing it bare is how it gets read as a month.
   */
  consumptionDaysPosted: number;
  salesDaysInPeriod: number;
  /** Share of the period's revenue those days account for, 0–100, or null. */
  consumptionCoveragePercent: number | null;
};

export const toBranchCostSummaryView = (
  row: BranchCostSummary
): BranchCostSummaryView => ({
  branchId: row.branchId,
  branchName: row.branchName,
  branchCode: row.branchCode,
  cogsSpend: row.cogsSpend.toString(),
  opexSpend: row.opexSpend.toString(),
  inventoryValue: row.inventoryValue.toString(),
  wasteValue: row.wasteValue.toString(),
  varianceValue: row.varianceValue.toString(),
  excessSpend: row.excessSpend.toString(),
  negativeStockProducts: row.negativeStockProducts,
  unpricedProducts: row.unpricedProducts,
  revenue: row.revenue ? row.revenue.toString() : null,
  grossProfit: row.grossProfit ? row.grossProfit.toString() : null,
  grossProfitMethod: row.grossProfitMethod,
  cogsSold: row.cogsSold ? row.cogsSold.toString() : null,
  openingInventoryValue: row.openingInventoryValue.toString(),
  grossProfitNote: grossProfitNote(row),
  consumptionDaysPosted: row.consumptionDaysPosted,
  salesDaysInPeriod: row.salesDaysInPeriod,
  consumptionCoveragePercent: coveragePercent(row),
});

/**
 * Coverage as a share of REVENUE, not of dishes or of days (rule N3): the
 * question behind it is how wrong the cost of goods sold is, and a ฿20 water is
 * not a ฿300 steak.
 *
 * Null when there is no revenue to be a share of — a period with no sales has no
 * coverage rather than 0% coverage, and the two read very differently.
 */
function coveragePercent(row: BranchCostSummary): number | null {
  if (row.revenue === null || row.revenue.isZero()) return null;
  return Number(
    row.consumptionCoveredNetAmount.div(row.revenue).mul(100).toFixed(1)
  );
}

const COUNT_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * Why the gross profit figure is what it is — or why there is not one.
 *
 * Never omitted. Under นับสต๊อก the number is exactly as good as the counts that
 * bound the period, and a shop that has not counted since March is entitled to
 * know that before it believes a margin.
 */
function grossProfitNote(row: BranchCostSummary): string {
  if (row.revenue === null) {
    return "ยังไม่มียอดขายนำเข้าในช่วงนี้";
  }

  // Part 22 (rule N10). The placeholder this replaces said the method was not
  // built yet; it is now, and what the note has to carry instead is how much of
  // the period it actually saw.
  if (row.grossProfitMethod === "RECIPE_CONSUMPTION") {
    const posted = row.consumptionDaysPosted;
    const days = row.salesDaysInPeriod;
    if (posted === 0) {
      return days === 0
        ? "ยังไม่มียอดขายนำเข้าในช่วงนี้"
        : `ยังไม่ได้ตัดสต๊อกตามสูตรสักวันในช่วงนี้ (${days} วันที่มียอดขาย) — กดตัดสต๊อกก่อน จึงจะคิดกำไรขั้นต้นวิธีนี้ได้`;
    }
    const pct = coveragePercent(row);
    const share =
      pct === null ? "" : ` · ครอบคลุม ${pct}% ของยอดขายในช่วงนี้`;
    return posted >= days
      ? `คิดจากสูตรอาหาร — ตัดสต๊อกครบทุกวันที่มียอดขาย (${posted} วัน)${share}`
      : `คิดจากสูตรอาหาร — ตัดสต๊อกแล้ว ${posted} จาก ${days} วันที่มียอดขาย${share} · วันที่เหลือยังไม่ถูกนับเป็นต้นทุน ตัวเลขจึงดูดีเกินจริง`;
  }

  if (row.lastCountedAt === null) {
    return "สาขานี้ยังไม่เคยปิดการนับสต๊อก — ตัวเลขนี้จึงมาจากยอดคงเหลือที่ระบบเชื่อ ไม่ใช่ของที่นับจริง และมักดูดีเกินจริง";
  }
  return `คิดจาก สต๊อกต้นงวด + ซื้อ − สต๊อกปลายงวด · แม่นเท่าที่นับสต๊อก (นับล่าสุด ${COUNT_DATE.format(row.lastCountedAt)})`;
}

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

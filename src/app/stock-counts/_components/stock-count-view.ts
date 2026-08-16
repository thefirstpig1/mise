// ============================================================
// Mise — stock count view serializers (Sprint 3 Part 15 L4, ADR 0015)
// ============================================================
// Every Decimal leaves as a STRING (Pitfall #20), and dates are formatted here
// on the server rather than in the components (the Part 10 L5c lesson: a list
// that grows client-side would format its first page in Node and the rest in the
// browser, with different locale defaults and a hydration mismatch).
//
// Variance is computed HERE — `qtyCounted − qtyExpected` is arithmetic on two
// stored columns, not a third fact to keep in step (ADR 0015 Q3).
//
// Money is NOT computed here. The count stores none (Q4); a page that wants to
// show what a variance cost asks the cost engine and passes the answer in.
// ============================================================

import { Prisma } from "@prisma/client";
import type { StockCountStatus } from "@prisma/client";
import { STOCK_COUNT_STATUS_LABELS_TH } from "@/lib/validations/stock-count";
import type { StockCountDetail, StockCountListRow } from "@/server/stock-count";

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

/** Quantity for display: up to the ledger's 3 decimals, no trailing zeros. */
export const formatQty = (value: string): string => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("th-TH", { maximumFractionDigits: 3 }) : value;
};

export const formatMoney = (value: string): string => {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value;
};

const personName = (u: { name: string | null; email: string | null } | null) =>
  u?.name ?? u?.email ?? null;

export type StockCountEntryView = {
  id: string;
  unitId: string;
  unitName: string;
  qtyInUnit: string;
};

export type StockCountItemView = {
  id: string;
  lineNo: number;
  productId: string;
  productName: string;
  productSku: string;
  productDeleted: boolean;
  baseUnitName: string | null;
  qtyCounted: string;
  qtyExpected: string;
  /** counted − expected. Negative = short, positive = found more. */
  variance: string;
  varianceIsShort: boolean;
  varianceIsZero: boolean;
  countedAtLabel: string;
  /** Who is accountable for the entry (the account), and who walked (the name). */
  countedByUser: string | null;
  countedByName: string | null;
  notes: string | null;
  /** A compensating line appended by a void — never something a user typed. */
  isReversal: boolean;
  entries: StockCountEntryView[];
};

export type StockCountDetailView = {
  id: string;
  scNumber: string;
  branchId: string;
  branchName: string;
  branchCode: string | null;
  countDateLabel: string;
  status: StockCountStatus;
  statusLabel: string;
  showExpected: boolean;
  notes: string | null;
  startedBy: string | null;
  closedAtLabel: string | null;
  closedBy: string | null;
  voidedAtLabel: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  items: StockCountItemView[];
  /** Totals over the non-reversal lines — quantities only; money is not stored. */
  totalShortQty: string;
  totalOverQty: string;
  countedLineCount: number;
};

export function toStockCountItemView(
  item: StockCountDetail["items"][number]
): StockCountItemView {
  const variance = item.qtyCounted.minus(item.qtyExpected);
  return {
    id: item.id,
    lineNo: item.lineNo,
    productId: item.productId,
    productName: item.product.name,
    productSku: item.product.sku,
    productDeleted: item.product.deletedAt !== null,
    baseUnitName: item.product.productUnits[0]?.unitName ?? null,
    qtyCounted: item.qtyCounted.toString(),
    qtyExpected: item.qtyExpected.toString(),
    variance: variance.toString(),
    varianceIsShort: variance.isNegative(),
    varianceIsZero: variance.isZero(),
    countedAtLabel: dateTime.format(item.countedAt),
    countedByUser: personName(item.countedByUser),
    countedByName: item.countedByName,
    notes: item.notes,
    isReversal: item.reversalOfItemId !== null,
    entries: item.entries.map((e) => ({
      id: e.id,
      unitId: e.productUnit.id,
      unitName: e.productUnit.unitName,
      qtyInUnit: e.qtyInUnit.toString(),
    })),
  };
}

export function toStockCountDetailView(count: StockCountDetail): StockCountDetailView {
  const items = count.items.map(toStockCountItemView);
  const real = items.filter((i) => !i.isReversal);

  let short = new Prisma.Decimal(0);
  let over = new Prisma.Decimal(0);
  for (const i of real) {
    const v = new Prisma.Decimal(i.variance);
    if (v.isNegative()) short = short.plus(v.negated());
    else over = over.plus(v);
  }

  return {
    id: count.id,
    scNumber: count.scNumber,
    branchId: count.branchId,
    branchName: count.branch.name,
    branchCode: count.branch.code,
    countDateLabel: dateOnly.format(count.countDate),
    status: count.status,
    statusLabel: STOCK_COUNT_STATUS_LABELS_TH[count.status],
    showExpected: count.showExpected,
    notes: count.notes,
    startedBy: personName(count.startedByUser),
    closedAtLabel: count.closedAt ? dateTime.format(count.closedAt) : null,
    closedBy: personName(count.closedByUser),
    voidedAtLabel: count.voidedAt ? dateTime.format(count.voidedAt) : null,
    voidedBy: personName(count.voidedByUser),
    voidReason: count.voidReason,
    items,
    // Quantities are not comparable across products (5 kg + 5 ชิ้น means
    // nothing), so these are line counts' worth of context, not a total to
    // reason with — the money figure on /cost is the one that adds up.
    totalShortQty: short.toString(),
    totalOverQty: over.toString(),
    countedLineCount: real.length,
  };
}

export type StockCountListView = {
  id: string;
  scNumber: string;
  branchName: string;
  countDateLabel: string;
  status: StockCountStatus;
  statusLabel: string;
  lineCount: number;
};

export const toStockCountListView = (row: StockCountListRow): StockCountListView => ({
  id: row.id,
  scNumber: row.scNumber,
  branchName: row.branch.name,
  countDateLabel: dateOnly.format(row.countDate),
  status: row.status,
  statusLabel: STOCK_COUNT_STATUS_LABELS_TH[row.status],
  lineCount: row._count.items,
});

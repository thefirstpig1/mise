// ============================================================
// คิดครัว — the document behind each ledger row (2026-10-31)
// ============================================================
// Lifted out of the stock card (Kong 2026-10-25) so the raw Excel export
// (Kong 2026-10-31: "ดึงข้อมูลดิบเป็น Excel") names a movement's document with
// the SAME words the card prints. Two copies of this lookup would drift the
// first time a source type is added, and the file and the screen would then
// disagree about where a row came from.
//
// One query per source kind, never one per row. A ledger row carries only the
// LINE it came from (source_type, source_id — ADR 0011), so the document number
// is one join away.
// ============================================================

import type { PrismaClient, SourceType } from "@prisma/client";

export type MovementDoc = { label: string; href: string | null } | null;

type Move = { id: string; sourceType: SourceType; sourceId: string; branchId: string; productId: string };

const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const th = (d: Date) => `${d.getUTCDate()} ${MTH[d.getUTCMonth()]}`;

/** Movement id → its document (number and link), for every row given. */
export async function movementDocumentsInTx(tx: PrismaClient, moves: readonly Move[]): Promise<Map<string, MovementDoc>> {
  const ids = (...t: SourceType[]) => moves.filter((m) => t.includes(m.sourceType)).map((m) => m.sourceId);
  const grIds = ids("GR_LINE");
  const scIds = ids("STOCK_COUNT");
  const tfIds = ids("TRANSFER_OUT", "TRANSFER_IN", "TRANSFER_SHORTAGE");
  const runIds = ids("SALES_CONSUMPTION");
  const mealIds = ids("STAFF_MEAL");
  const [gr, sc, tf, run, meal] = await Promise.all([
    grIds.length
      ? tx.goodsReceiptItem.findMany({ where: { id: { in: grIds } }, select: { id: true, goodsReceipt: { select: { id: true, grNumber: true } } } })
      : [],
    scIds.length
      ? tx.stockCountItem.findMany({ where: { id: { in: scIds } }, select: { id: true, stockCount: { select: { id: true, scNumber: true } } } })
      : [],
    tfIds.length
      ? tx.stockTransferItem.findMany({ where: { id: { in: tfIds } }, select: { id: true, stockTransfer: { select: { id: true, tfNumber: true } } } })
      : [],
    runIds.length
      ? tx.salesConsumptionItem.findMany({ where: { id: { in: runIds } }, select: { id: true, run: { select: { businessDate: true } } } })
      : [],
    mealIds.length
      ? tx.staffMealItem.findMany({ where: { id: { in: mealIds } }, select: { id: true, staffMeal: { select: { businessDate: true } } } })
      : [],
  ]);
  const grBy = new Map(gr.map((x) => [x.id, x.goodsReceipt]));
  const scBy = new Map(sc.map((x) => [x.id, x.stockCount]));
  const tfBy = new Map(tf.map((x) => [x.id, x.stockTransfer]));
  const runBy = new Map(run.map((x) => [x.id, x.run.businessDate]));
  const mealBy = new Map(meal.map((x) => [x.id, x.staffMeal.businessDate]));

  const docOf = (m: Move): MovementDoc => {
    switch (m.sourceType) {
      case "GR_LINE": {
        const g = grBy.get(m.sourceId);
        return g ? { label: g.grNumber, href: `/goods-receipts/${g.id}` } : null;
      }
      case "STOCK_COUNT": {
        const c = scBy.get(m.sourceId);
        return c ? { label: c.scNumber, href: `/stock-counts/${c.id}` } : null;
      }
      case "TRANSFER_OUT":
      case "TRANSFER_IN":
      case "TRANSFER_SHORTAGE": {
        const f = tfBy.get(m.sourceId);
        return f ? { label: f.tfNumber, href: `/transfers/${f.id}` } : null;
      }
      case "SALES_CONSUMPTION": {
        const d = runBy.get(m.sourceId);
        return d ? { label: `ยอดขาย ${th(d)}`, href: `/sales?branch=${m.branchId}&from=${iso(d)}&to=${iso(d)}&day=${iso(d)}` } : null;
      }
      case "STAFF_MEAL": {
        const d = mealBy.get(m.sourceId);
        return d ? { label: `มื้อพนักงาน ${th(d)}`, href: `/staff-meals` } : null;
      }
      case "WASTE_LOG":
        return { label: "ของเสีย", href: `/waste?branch=${m.branchId}&product=${m.productId}` };
      default:
        return null;
    }
  };
  return new Map(moves.map((m) => [m.id, docOf(m)]));
}

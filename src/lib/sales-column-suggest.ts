// ============================================================
// Mise — guess a new POS file's columns from its header (2026-10-29)
// ============================================================
// Kong: "ได้ แต่ระวังนะ บางทีไฟล์ POS มันก็มีภาษาแปลกๆ". Careful by
// construction, because a wrong guess on the amount column shifts every
// figure the shop reads afterwards:
//   * an EXACT name after normalising case, spaces and punctuation — never a
//     resemblance (no trigram, no "contains");
//   * names that could mean two things ("ยอดขาย", "Total", a bare "เวลา") are
//     not on any list;
//   * a field two headers could both be is left for the person;
//   * a header row that did not decode (mojibake, replacement characters)
//     guesses nothing — the person changes the encoding first.
// Every guess is shown as a guess on the form; nothing is saved until the
// person presses save. A page focused on mapping POS files is planned
// (Kong has ideas) — this is the floor, not that page.
// ============================================================

import type { ColumnMapField } from "@/lib/validations/sales-import";

/** Names each field may carry, already normalised (see `norm`). */
const NAMES: Record<ColumnMapField, string[]> = {
  businessDate: ["วันที่", "วันที่ขาย", "วันขาย", "วันที่ทำรายการ", "date", "saledate", "salesdate", "businessdate", "transactiondate"],
  soldAt: ["วันเวลา", "วันเวลาขาย", "วันที่และเวลา", "วันที่เวลา", "datetime", "timestamp"],
  menuName: ["ชื่อเมนู", "เมนู", "ชื่อสินค้า", "สินค้า", "ชื่อรายการ", "รายการ", "item", "itemname", "menu", "menuname", "product", "productname"],
  menuCode: ["รหัสเมนู", "รหัสสินค้า", "รหัส", "code", "itemcode", "menucode", "productcode", "sku", "plu"],
  categoryName: ["หมวด", "หมวดหมู่", "หมวดเมนู", "หมวดสินค้า", "category", "categoryname"],
  qty: ["จำนวน", "จำนวนขาย", "จำนวนที่ขาย", "qty", "quantity"],
  grossAmount: ["ยอดก่อนส่วนลด", "ยอดขายก่อนส่วนลด", "ยอดรวมก่อนส่วนลด", "gross", "grosssales", "grossamount"],
  discountAmount: ["ส่วนลด", "ยอดส่วนลด", "discount", "discountamount"],
  netAmount: ["ยอดสุทธิ", "ยอดขายสุทธิ", "สุทธิ", "net", "netsales", "netamount"],
  serviceChargeAmount: ["ค่าบริการ", "เซอร์วิสชาร์จ", "servicecharge", "sc"],
  vatAmount: ["vat", "ภาษี", "ภาษีมูลค่าเพิ่ม", "vatamount"],
  channel: ["ช่องทาง", "ช่องทางขาย", "ประเภทการขาย", "channel", "ordertype"],
  billId: ["เลขบิล", "เลขที่บิล", "บิล", "เลขที่ใบเสร็จ", "ใบเสร็จ", "billno", "billid", "receiptno", "orderno", "orderid"],
};

/** Lower case, no spaces, no punctuation. Thai letters and digits stay. */
const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\s._\-/\\()[\]{}:#*'"`.,+]/g, "");

/** UTF-8 read as a single-byte encoding, or bytes that did not decode at all. */
const GARBLED = /�|à¸|à¹|Ã./;

export function suggestColumnMap(header: string[]): {
  map: Partial<Record<ColumnMapField, number>>;
  garbled: boolean;
} {
  if (header.some((h) => GARBLED.test(h))) return { map: {}, garbled: true };
  const normalised = header.map(norm);
  const map: Partial<Record<ColumnMapField, number>> = {};
  const taken = new Set<number>();
  for (const field of Object.keys(NAMES) as ColumnMapField[]) {
    const hits = normalised.flatMap((h, i) => (h !== "" && NAMES[field].includes(h) ? [i] : []));
    if (hits.length !== 1 || taken.has(hits[0])) continue; // ambiguous or already someone else's
    map[field] = hits[0];
    taken.add(hits[0]);
  }
  return { map, garbled: false };
}

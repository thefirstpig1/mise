// ============================================================
// คิดครัว — why นับสต๊อก cannot name a gross profit yet (rule PG1)
// ============================================================
// Kong 2026-10-30, after setting up a shop from scratch: the dashboard read
// "กำไรสุทธิ 100% ของยอดขาย" for a shop that had never recorded a purchase.
// stock-cost.ts now withholds the figure; this is the sentence that goes with
// the null, shared so /cost and the dashboard say the same thing.
// Plain module on purpose — server pages import it (no "use client" here).
// ============================================================

export type GrossProfitBlocker =
  /** No count was closed with a line counted before the period began. */
  | { kind: "NO_OPENING_COUNT" }
  /** Stock at the opening or the close holds layers nobody has priced. */
  | { kind: "UNPRICED_STOCK"; products: number };

/** The full sentence, for the line under the figure on /cost. */
export function grossProfitBlockerNote(b: GrossProfitBlocker): string {
  return b.kind === "NO_OPENING_COUNT"
    ? "ยังไม่ได้นับสต๊อกต้นงวด — วิธีนับสต๊อกต้องรู้ว่าต้นงวดมีของเท่าไร จึงจะคิดต้นทุนขายได้ กำไรขั้นต้นจะเริ่มคิดได้ในช่วงที่เริ่มหลังวันที่นับครั้งแรก"
    : `ของในสต๊อก ${b.products.toLocaleString("th-TH")} รายการยังไม่มีราคา — มูลค่าสต๊อกจึงต่ำกว่าจริงและกำไรจะดูดีเกินจริง ใส่ราคาทุนของรายการเหล่านั้นก่อน`;
}

/** A few words, for a card that names several branches. */
export function grossProfitBlockerShort(b: GrossProfitBlocker): string {
  return b.kind === "NO_OPENING_COUNT"
    ? "ยังไม่ได้นับสต๊อกต้นงวด"
    : `ของ ${b.products.toLocaleString("th-TH")} รายการยังไม่มีราคา`;
}

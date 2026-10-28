// ============================================================
// Mise — the column guesser for a new POS file format (2026-10-29)
// ============================================================
// Kong: "ได้ แต่ระวังนะ บางทีไฟล์ POS มันก็มีภาษาแปลกๆ". So the guesser is
// careful by construction: an exact name only (after trimming case, spaces and
// punctuation), never a resemblance; a field two headers could be is left for
// the person; and a header row that did not decode guesses nothing at all.
// ============================================================

import { describe, it, expect } from "vitest";
import { suggestColumnMap } from "@/lib/sales-column-suggest";

describe("suggestColumnMap (careful: exact names only)", () => {
  it("S1: a plain Thai daily-summary header maps its obvious columns", () => {
    const r = suggestColumnMap(["วันที่", "รหัสเมนู", "ชื่อเมนู", "จำนวน", "ยอดสุทธิ"]);
    expect(r.garbled).toBe(false);
    expect(r.map).toEqual({ businessDate: 0, menuCode: 1, menuName: 2, qty: 3, netAmount: 4 });
  });

  it("S2: English headers and stray case/spaces/punctuation still match", () => {
    const r = suggestColumnMap([" Date ", "Item Code", "item_name", "QTY", "Net Sales", "Discount", "Bill No."]);
    expect(r.map).toEqual({
      businessDate: 0,
      menuCode: 1,
      menuName: 2,
      qty: 3,
      netAmount: 4,
      discountAmount: 5,
      billId: 6,
    });
  });

  it("S3: a name that only RESEMBLES a field is not guessed", () => {
    // "ยอดขาย" could be gross, net or incl. VAT; "Total" the same. Guessing
    // the required net-amount column wrong would shift every figure.
    const r = suggestColumnMap(["วันที่", "เมนู", "จำนวนจาน", "ยอดขาย", "Total"]);
    expect(r.map.netAmount).toBeUndefined();
    expect(r.map.businessDate).toBe(0);
    expect(r.map.menuName).toBe(1);
  });

  it("S4: two headers that could both be the field -> neither is chosen", () => {
    const r = suggestColumnMap(["วันที่", "Date", "ชื่อเมนู", "จำนวน"]);
    expect(r.map.businessDate).toBeUndefined();
    expect(r.map.menuName).toBe(2);
  });

  it("S5: a header row that did not decode guesses nothing", () => {
    // UTF-8 read as Latin-1 ("วันที่" -> mojibake), and a replacement char.
    expect(suggestColumnMap(["à¸§à¸±à¸™à¸—à¸µà¹ˆ", "qty"])).toEqual({ map: {}, garbled: true });
    expect(suggestColumnMap(["�ѹ���", "qty"])).toEqual({ map: {}, garbled: true });
  });

  it("S6: a bare time column is not taken for the sale's date-time", () => {
    const r = suggestColumnMap(["วันที่", "เวลา", "ชื่อเมนู", "จำนวน"]);
    expect(r.map.soldAt).toBeUndefined();
    expect(suggestColumnMap(["วันเวลา"]).map.soldAt).toBe(0);
  });
});

// ============================================================
// คิดครัว — the shop's AI maps a POS sales file (Kong 2026-11-02, คิวข้อ 11 ก.)
// ============================================================
// The AI only POINTS at columns, and every pointer is checked against the file
// that was uploaded: position AND header text must agree. These pin what is
// refused, because a pointer resolved to "the nearest column" would shift every
// figure while each one still looked plausible.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  buildSalesMapPrompt,
  pickPromptRows,
  readSalesMapAnswer,
  readingFor,
  SALES_MAP_TAG,
} from "@/lib/sales-map-ai";
import { readDateCandidates } from "@/lib/sales-setup";
import { profilesMatchingHeader } from "@/server/sales-setup";
import { computeHeaderSignature } from "@/lib/sales-file";

const HEADER = ["วันที่", "เลขที่บิล", "ชื่อสินค้า", "จำนวน", "@", "ส่วนลด", "ยอดสุทธิ", "VAT 7%"];

const code = (o: Record<string, unknown>) => "```json\n" + JSON.stringify({ kitkrua: SALES_MAP_TAG, ...o }) + "\n```";

describe("readSalesMapAnswer", () => {
  it("M1: a clean answer maps by position and name, and reads the four questions", () => {
    const r = readSalesMapAnswer(
      "นี่คือคำตอบครับ\n" +
        code({
          columns: { date: [1, "วันที่"], billId: [2, "เลขที่บิล"], menuName: [3, "ชื่อสินค้า"], qty: [4, "จำนวน"], discountAmount: [6, "ส่วนลด"], netAmount: [7, "ยอดสุทธิ"], vatAmount: [8, "VAT 7%"], menuCode: null },
          dateOrder: "DMY",
          yearEra: "BE",
          amountsIncludeVat: true,
          amountsIncludeServiceCharge: false,
          why: { vat: "ยอดสุทธิ 107 = 100 + VAT 7", serviceCharge: "ไม่มีคอลัมน์ค่าบริการ" },
          unsure: {},
        }),
      HEADER
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.columns).toEqual({ date: 0, billId: 1, menuName: 2, qty: 3, discountAmount: 5, netAmount: 6, vatAmount: 7 });
    expect(r.answer.dateOrder).toBe("DMY");
    expect(r.answer.buddhistYear).toBe(true);
    expect(r.answer.includesVat).toBe(true);
    expect(r.answer.includesServiceCharge).toBe(false);
    expect(r.answer.why.vat).toContain("107");
    expect(r.answer.refused).toEqual([]);
  });

  it("M2: a name the file does not have is REFUSED, never resolved to a near one", () => {
    const r = readSalesMapAnswer(code({ columns: { date: [1, "วันที่"], netAmount: [7, "ยอดขายสุทธิ"] } }), HEADER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.columns).toEqual({ date: 0 });
    expect(r.answer.refused).toEqual([{ field: "netAmount", said: "คอลัมน์ 7 “ยอดขายสุทธิ”", kind: "missing" }]);
  });

  it("M3: a miscounted position is forgiven only when the name occurs exactly once", () => {
    const ok = readSalesMapAnswer(code({ columns: { menuName: [4, "ชื่อสินค้า"] } }), HEADER);
    expect(ok.ok && ok.answer.columns).toEqual({ menuName: 2 });
    const twice = readSalesMapAnswer(code({ columns: { qty: [9, "จำนวน"] } }), ["จำนวน", "ชื่อ", "จำนวน"]);
    expect(twice.ok && twice.answer.columns).toEqual({});
    expect(twice.ok && twice.answer.refused[0].field).toBe("qty");
  });

  it("M4: a bare position with no name cannot be checked, so it is refused", () => {
    const r = readSalesMapAnswer(code({ columns: { qty: 4 } }), HEADER);
    expect(r.ok && r.answer.columns).toEqual({});
    expect(r.ok && r.answer.refused.map((x) => x.field)).toEqual(["qty"]);
  });

  it("M5: two answers on one column — the earlier field keeps it, the later is refused", () => {
    const r = readSalesMapAnswer(code({ columns: { netAmount: [7, "ยอดสุทธิ"], grossAmount: [7, "ยอดสุทธิ"] } }), HEADER);
    expect(r.ok && r.answer.columns).toEqual({ netAmount: 6 });
    expect(r.ok && r.answer.refused[0]).toMatchObject({ field: "grossAmount", kind: "clash" });
  });

  it("M6: an answer about another file is refused whole", () => {
    const r = readSalesMapAnswer(code({ columns: { date: [1, "Date"], menuName: [2, "Item"], qty: [3, "Qty"], netAmount: [4, "Net"] } }), HEADER);
    expect(r).toEqual({ ok: false, reason: "OTHER_FILE" });
  });

  it("M7: text with no code, and a code that is not ours, are told apart", () => {
    expect(readSalesMapAnswer("ขอโทษครับ ผมเปิดไฟล์ไม่ได้", HEADER)).toEqual({ ok: false, reason: "NO_CODE" });
    expect(readSalesMapAnswer('{"columns":{}}', HEADER)).toEqual({ ok: false, reason: "NOT_OURS" });
  });

  it("M8: curly quotes from a rendered chat still read; spaces and case in a header name do not matter", () => {
    const pasted = `{“kitkrua”:“${SALES_MAP_TAG}”,“columns”:{“vatAmount”:[8,“ vat  7% ”]}}`;
    const r = readSalesMapAnswer(pasted, HEADER);
    expect(r.ok && r.answer.columns).toEqual({ vatAmount: 7 });
  });

  it("M9: anything that is not a plain answer stays open (null), never a default", () => {
    const r = readSalesMapAnswer(code({ dateOrder: "dd/mm", yearEra: "2026", amountsIncludeVat: "maybe", amountsIncludeServiceCharge: null }), HEADER);
    expect(r.ok && r.answer).toMatchObject({ dateOrder: null, buddhistYear: null, includesVat: null, includesServiceCharge: null });
  });

  it("M10: the AI's reasons for leaving something open come back in its words, tied to the field", () => {
    const r = readSalesMapAnswer(code({ unsure: { amountsIncludeVat: "ไม่มีคอลัมน์ VAT ดูจากตัวเลขไม่ได้", netAmount: "มีสองคอลัมน์ยอด" } }), HEADER);
    expect(r.ok && r.answer.unsure).toEqual([
      { key: "amountsIncludeVat", note: "ไม่มีคอลัมน์ VAT ดูจากตัวเลขไม่ได้" },
      { key: "netAmount", note: "มีสองคอลัมน์ยอด" },
    ]);
  });
});

describe("readingFor (the AI never overrules the file)", () => {
  it("D1: a day-first answer picks the day-first reading of an ambiguous column", () => {
    const c = readDateCandidates(["05/06/2026", "07/06/2026"]);
    expect(c.length).toBeGreaterThan(1);
    const i = readingFor(c, "DMY", false);
    expect(i).not.toBeNull();
    expect(c[i!].days[0].day.getUTCMonth()).toBe(5); // June
  });

  it("D2: an order no reading supports picks nothing", () => {
    const c = readDateCandidates(["25/06/2026"]); // only day-first can read 25
    expect(readingFor(c, "MDY", false)).toBeNull();
    expect(readingFor(c, null, null)).toBeNull();
  });
});

describe("the prompt", () => {
  it("P1: carries every header with its position, and the rows spread to the end of the file", () => {
    const body = Array.from({ length: 100 }, (_, i) => [`${String((i % 28) + 1).padStart(2, "0")}/10/2569`, `B${i}`, "ข้าวผัด|หมู", "1", "50", "0", "50", "3.27"]);
    const rows = pickPromptRows(body);
    expect(rows).toHaveLength(30);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[29].rowNumber).toBe(101); // the last data row
    const p = buildSalesMapPrompt({ posLabel: "FoodStory", header: HEADER, rows, rowCount: body.length });
    expect(p).toContain("5. @");
    expect(p).toContain("8. VAT 7%");
    expect(p).toContain("ข้าวผัด¦หมู"); // a pipe inside a cell cannot split it
    expect(p).toContain(`"kitkrua":"${SALES_MAP_TAG}"`);
  });

  it("P2: blank rows are not shown to the AI", () => {
    const rows = pickPromptRows([["a"], ["", " "], ["b"]]);
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });
});

describe("profilesMatchingHeader (later imports pick their format from the header)", () => {
  const sig = computeHeaderSignature(HEADER);
  const other = computeHeaderSignature(["Date", "Item", "Qty", "Net"]);
  const at = (d: string) => new Date(`${d}T00:00:00Z`);

  it("H1: only formats whose header IS the file's, newest first", () => {
    const ids = profilesMatchingHeader(
      [
        { id: "old", encoding: "UTF8", headerSignature: sig, createdAt: at("2026-10-01") },
        { id: "other", encoding: "UTF8", headerSignature: other, createdAt: at("2026-10-20") },
        { id: "new", encoding: "UTF8", headerSignature: sig, createdAt: at("2026-10-15") },
      ],
      () => sig
    );
    expect(ids).toEqual(["new", "old"]);
  });

  it("H2: each format is compared in its own encoding", () => {
    const ids = profilesMatchingHeader(
      [
        { id: "tis", encoding: "TIS620", headerSignature: sig, createdAt: at("2026-10-01") },
        { id: "utf", encoding: "UTF8", headerSignature: sig, createdAt: at("2026-10-02") },
      ],
      (e) => (e === "TIS620" ? sig : null) // the bytes only decode as TIS-620
    );
    expect(ids).toEqual(["tis"]);
  });

  it("H3: no match is an empty list — never the nearest format", () => {
    expect(profilesMatchingHeader([{ id: "a", encoding: "UTF8", headerSignature: other, createdAt: at("2026-10-01") }], () => sig)).toEqual([]);
  });
});

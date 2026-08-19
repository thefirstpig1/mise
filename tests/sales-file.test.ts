// ============================================================
// Mise — sales file primitives unit tests (Sprint 4 Part 19 L2)
// ============================================================
// Pure functions, no DB, no zod. Every case here is a way the previous Apps
// Script pipeline went wrong while its screen stayed green — that is the
// selection criterion, not coverage for its own sake.
//
// The load-bearing group is I20–I28: a blank cell must never become a zero.
// `sales_line` has no sign check and no `.positive()` (ADR 0019 Q14), because a
// refund is negative and a giveaway is zero — so this parser is the ONLY place
// in the entire Part where that mistake can still be caught.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  computeHeaderSignature,
  decodeSalesFile,
  looksLikeUtf8Bom,
  normaliseAmounts,
  normalizeMenuName,
  parseCsv,
  parseFileNumber,
  parseSalesDate,
  resolveSalesDay,
  SALES_DATE_FORMATS,
} from "@/lib/sales-file";

/** "กะเพรา" as TIS-620 bytes — what Thai Excel actually writes. */
const KAPRAO_TIS620 = new Uint8Array([0xa1, 0xd0, 0xe0, 0xbe, 0xc3, 0xd2]);
const utf8 = (s: string) => new TextEncoder().encode(s);

describe("sales file primitives (Part 19 L2 — the parser is the last line of defence)", () => {
  // ------------------------------------------------------------
  // Decoding
  // ------------------------------------------------------------

  it("I1: TIS-620 bytes decode to Thai when the profile says so", () => {
    expect(decodeSalesFile(KAPRAO_TIS620, "TIS620")).toBe("กะเพรา");
  });

  it("I2: the same bytes read as UTF-8 do NOT throw — they come back mangled", () => {
    // This is the whole reason encoding is declared rather than guessed. Nothing
    // fails; the menu names simply become different unrecognised strings, and the
    // import creates a full duplicate set of stub menus that look like garbage.
    const wrong = decodeSalesFile(KAPRAO_TIS620, "UTF8");
    expect(wrong).not.toBe("กะเพรา");
    expect(wrong).toContain("�");
  });

  it("I3: a UTF-8 BOM is stripped, so the first header cell is not invisibly different", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("วันที่,เมนู")]);
    expect(decodeSalesFile(withBom, "UTF8")).toBe("วันที่,เมนู");
    expect(looksLikeUtf8Bom(withBom)).toBe(true);
    expect(looksLikeUtf8Bom(utf8("วันที่"))).toBe(false);
  });

  // ------------------------------------------------------------
  // CSV
  // ------------------------------------------------------------

  it("I4: a quoted comma stays inside its field instead of shifting every column", () => {
    const rows = parseCsv('เมนู,จำนวน\n"ข้าวผัด, พิเศษ",2\n');
    expect(rows).toEqual([
      ["เมนู", "จำนวน"],
      ["ข้าวผัด, พิเศษ", "2"],
    ]);
  });

  it("I5: doubled quotes are an escaped quote, and a newline may live inside a field", () => {
    const rows = parseCsv('a,"say ""hi""","two\nlines"\n');
    expect(rows).toEqual([["a", 'say "hi"', "two\nlines"]]);
  });

  it("I6: CRLF and LF produce the same rows", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual(parseCsv("a,b\nc,d\n"));
  });

  it("I7: a trailing newline does not invent an empty final row", () => {
    expect(parseCsv("a,b\n")).toHaveLength(1);
    expect(parseCsv("a,b")).toHaveLength(1);
  });

  it("I8: a blank line in the MIDDLE is kept — it is a row that failed to be written", () => {
    // The previous system's `if (csvRow.length < 17) continue;` made rows like
    // this vanish, so a format change could empty a file in silence.
    const rows = parseCsv("a,b\n\nc,d\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([""]);
  });

  // ------------------------------------------------------------
  // Header signature
  // ------------------------------------------------------------

  it("I9: the same header produces the same signature", () => {
    const h = ["วันที่", "เมนู", "จำนวน"];
    expect(computeHeaderSignature(h)).toBe(computeHeaderSignature([...h]));
  });

  it("I10: an INSERTED column changes the signature — the failure this exists for", () => {
    const before = computeHeaderSignature(["วันที่", "เมนู", "จำนวน", "ยอดสุทธิ"]);
    const after = computeHeaderSignature(["วันที่", "สาขา", "เมนู", "จำนวน", "ยอดสุทธิ"]);
    expect(after).not.toBe(before);
  });

  it("I11: REORDERING columns changes the signature even though the words are identical", () => {
    expect(computeHeaderSignature(["a", "b"])).not.toBe(computeHeaderSignature(["b", "a"]));
  });

  it("I12: incidental spacing and case do not change the signature", () => {
    expect(computeHeaderSignature([" Menu  Name ", "QTY"])).toBe(
      computeHeaderSignature(["menu name", "qty"])
    );
  });

  it("I13: the same text split across a different number of columns does not collide", () => {
    expect(computeHeaderSignature(["ab", "c"])).not.toBe(computeHeaderSignature(["abc"]));
  });

  // ------------------------------------------------------------
  // Names
  // ------------------------------------------------------------

  it("I14: a stray space is absorbed with no guessing at all", () => {
    expect(normalizeMenuName("  ผัดกะเพรา   หมู  ")).toBe("ผัดกะเพรา หมู");
  });

  it("I15: an invisible zero-width space does not create a second menu", () => {
    // \s does not match U+200B, so without the explicit strip these two compare
    // unequal while looking identical on every screen a human will ever check.
    expect(normalizeMenuName("ผัด​กะเพรา")).toBe(normalizeMenuName("ผัดกะเพรา"));
  });

  it("I16: a non-breaking space is treated as the space it looks like", () => {
    expect(normalizeMenuName("ข้าว ผัด")).toBe("ข้าว ผัด");
  });

  it("I17: two genuinely different dishes stay different after normalising", () => {
    // The guardrail behind the whole matching design: normalisation must never
    // be the thing that merges ผัดกะเพราหมู with ผัดกะเพราไก่.
    expect(normalizeMenuName("ผัดกะเพราหมู")).not.toBe(normalizeMenuName("ผัดกะเพราไก่"));
  });

  // ------------------------------------------------------------
  // Numbers — blank is not zero
  // ------------------------------------------------------------

  it("I18: an ordinary number reads as itself", () => {
    expect(parseFileNumber("42")).toEqual({ ok: true, value: 42 });
    expect(parseFileNumber("42.50")).toEqual({ ok: true, value: 42.5 });
    expect(parseFileNumber(7)).toEqual({ ok: true, value: 7 });
  });

  it("I19: a real zero in the file IS a zero — giveaways and tastings are legal", () => {
    expect(parseFileNumber("0")).toEqual({ ok: true, value: 0 });
    expect(parseFileNumber("0.00")).toEqual({ ok: true, value: 0 });
  });

  it("I20: an EMPTY cell is BLANK, not zero — the Part 18 lesson, one layer down", () => {
    for (const blank of ["", "   ", null, undefined]) {
      expect(parseFileNumber(blank)).toEqual({ ok: false, reason: "BLANK" });
    }
  });

  it("I21: unreadable text is UNPARSEABLE — a different mistake from blank", () => {
    // They must not share a message: "the file is missing a number here" and
    // "the file has something that is not a number here" send a shop looking in
    // two different places.
    for (const junk of ["abc", "-", "1.2.3", "๑๒a", "12%"]) {
      expect(parseFileNumber(junk)).toEqual({ ok: false, reason: "UNPARSEABLE" });
    }
  });

  it("I22: thousands separators and a currency symbol are stripped", () => {
    expect(parseFileNumber("1,234.50")).toEqual({ ok: true, value: 1234.5 });
    expect(parseFileNumber("฿ 1,234")).toEqual({ ok: true, value: 1234 });
  });

  it("I23: negatives arrive three ways, and all of them mean a refund", () => {
    expect(parseFileNumber("-120")).toEqual({ ok: true, value: -120 });
    expect(parseFileNumber("(120.00)")).toEqual({ ok: true, value: -120 });
    expect(parseFileNumber("120.00-")).toEqual({ ok: true, value: -120 });
  });

  it("I24: Thai numerals are read as numbers", () => {
    expect(parseFileNumber("๑๒๓")).toEqual({ ok: true, value: 123 });
  });

  it("I25: NaN and Infinity never become a silent 0", () => {
    expect(parseFileNumber(Number.NaN)).toEqual({ ok: false, reason: "UNPARSEABLE" });
    expect(parseFileNumber(Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      reason: "UNPARSEABLE",
    });
  });

  it("I26: this is exactly what `parseFloat(x) || 0` got wrong", () => {
    // The previous system read every column this way. Four different situations
    // collapsed into the single value 0, and a menu's sales for a day would
    // disappear with nothing on screen looking wrong.
    const legacy = (x: unknown) => parseFloat(x as string) || 0;
    for (const cell of ["", "  ", "abc", undefined]) {
      expect(legacy(cell)).toBe(0);
      expect(parseFileNumber(cell).ok).toBe(false);
    }
    // ...and it could not tell any of them from a genuine zero either.
    expect(legacy("0")).toBe(0);
    expect(parseFileNumber("0")).toEqual({ ok: true, value: 0 });
  });

  // ------------------------------------------------------------
  // Dates
  // ------------------------------------------------------------

  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("I27: a Gregorian date in the declared format reads as a day value", () => {
    const r = parseSalesDate("31/12/2025", { format: "dd/MM/yyyy", isBuddhistYear: false });
    expect(r).toEqual({ ok: true, day: day("2025-12-31"), minutesOfDay: null });
  });

  it("I28: a Buddhist year is converted only because the profile said so", () => {
    const r = parseSalesDate("31/12/2568", { format: "dd/MM/yyyy", isBuddhistYear: true });
    expect(r.ok && r.day).toEqual(day("2025-12-31"));
  });

  it("I29: a Buddhist year with the flag OFF is refused, never silently corrected", () => {
    // The previous system fixed this with `if (year > 2100) year -= 543`, which
    // works right up until a shop has one file of each kind and no way to tell
    // which one it is looking at.
    expect(parseSalesDate("31/12/2568", { format: "dd/MM/yyyy", isBuddhistYear: false })).toEqual({
      ok: false,
      reason: "YEAR_LOOKS_BUDDHIST",
    });
  });

  it("I30: the declared format decides — the same text reads as two different days", () => {
    const asDMY = parseSalesDate("01/02/2025", { format: "dd/MM/yyyy", isBuddhistYear: false });
    const asMDY = parseSalesDate("01/02/2025", { format: "MM/dd/yyyy", isBuddhistYear: false });
    expect(asDMY.ok && asDMY.day).toEqual(day("2025-02-01"));
    expect(asMDY.ok && asMDY.day).toEqual(day("2025-01-02"));
  });

  it("I31: every declared format actually parses", () => {
    const samples: Record<(typeof SALES_DATE_FORMATS)[number], string> = {
      "dd/MM/yyyy": "05/03/2025",
      "d/M/yyyy": "5/3/2025",
      "dd-MM-yyyy": "05-03-2025",
      "yyyy-MM-dd": "2025-03-05",
      "yyyy/MM/dd": "2025/03/05",
      "MM/dd/yyyy": "03/05/2025",
    };
    for (const format of SALES_DATE_FORMATS) {
      const r = parseSalesDate(samples[format], { format, isBuddhistYear: false });
      expect(r.ok && r.day, format).toEqual(day("2025-03-05"));
    }
  });

  it("I32: a time is carried through as minutes past midnight", () => {
    const r = parseSalesDate("31/12/2025 01:30", { format: "dd/MM/yyyy", isBuddhistYear: false });
    expect(r).toEqual({ ok: true, day: day("2025-12-31"), minutesOfDay: 90 });
  });

  it("I33: an impossible calendar date is refused, not rolled forward", () => {
    expect(
      parseSalesDate("31/02/2025", { format: "dd/MM/yyyy", isBuddhistYear: false })
    ).toEqual({ ok: false, reason: "UNPARSEABLE" });
  });

  it("I34: a two-digit year is refused — it is ambiguous by 100 years AND by 543", () => {
    expect(parseSalesDate("31/12/25", { format: "dd/MM/yyyy", isBuddhistYear: false })).toEqual({
      ok: false,
      reason: "UNPARSEABLE",
    });
  });

  it("I35: a blank date cell is BLANK, distinct from unreadable", () => {
    expect(parseSalesDate("", { format: "dd/MM/yyyy", isBuddhistYear: false })).toEqual({
      ok: false,
      reason: "BLANK",
    });
    expect(parseSalesDate("เมื่อวาน", { format: "dd/MM/yyyy", isBuddhistYear: false })).toEqual({
      ok: false,
      reason: "UNPARSEABLE",
    });
  });

  // ------------------------------------------------------------
  // The sales day
  // ------------------------------------------------------------

  it("I36: a bill closed at 01:30 belongs to the night before", () => {
    expect(resolveSalesDay(day("2025-12-31"), 90, 300)).toEqual(day("2025-12-30"));
  });

  it("I37: the cut-off itself starts the new day, and the evening stays put", () => {
    expect(resolveSalesDay(day("2025-12-31"), 300, 300)).toEqual(day("2025-12-31"));
    expect(resolveSalesDay(day("2025-12-31"), 23 * 60, 300)).toEqual(day("2025-12-31"));
  });

  it("I38: a branch that closes early can set the cut-off to midnight and get calendar days", () => {
    expect(resolveSalesDay(day("2025-12-31"), 30, 0)).toEqual(day("2025-12-31"));
  });

  // ------------------------------------------------------------
  // Money
  // ------------------------------------------------------------

  const bill = { gross: 1000, discount: 100, net: 900, serviceCharge: 90, vat: 69.3 };

  it("I39: amounts that already exclude VAT and service charge pass through", () => {
    const r = normaliseAmounts(bill, {
      amountsIncludeVat: false,
      amountsIncludeServiceCharge: false,
    });
    expect(r.net).toBe(900);
    expect(r.consistencyDelta).toBe(0);
  });

  it("I40: VAT and service charge are stripped back out when the file included them", () => {
    // The worked example from ADR 0019 Q10: the customer paid 1,059.30 and
    // revenue is 900 — not 1,059.30, and not 990.
    const inclusive = { ...bill, net: 1059.3 };
    const r = normaliseAmounts(inclusive, {
      amountsIncludeVat: true,
      amountsIncludeServiceCharge: true,
    });
    expect(r.net).toBe(900);
    expect(r.vat).toBe(69.3);
    expect(r.serviceCharge).toBe(90);
    expect(r.consistencyDelta).toBe(0);
  });

  it("I41: the five raw figures are all still stored — ภพ.30 and O17 need them", () => {
    const r = normaliseAmounts(bill, {
      amountsIncludeVat: false,
      amountsIncludeServiceCharge: false,
    });
    expect(r.gross).toBe(1000);
    expect(r.discount).toBe(100);
    expect(r.vat).toBe(69.3);
    expect(r.serviceCharge).toBe(90);
  });

  it("I42: a wrongly-set VAT flag shows up as a consistency delta, not as silence", () => {
    // This is the silent-7% error the whole profile design exists to prevent. It
    // cannot be made impossible — a file cannot be asked what it means — so it is
    // made VISIBLE, and the preview surfaces the delta before anyone commits.
    const inclusive = { ...bill, net: 1059.3 };
    const wrong = normaliseAmounts(inclusive, {
      amountsIncludeVat: false,
      amountsIncludeServiceCharge: false,
    });
    expect(wrong.net).toBe(1059.3);
    expect(wrong.consistencyDelta).toBeCloseTo(159.3, 2);
  });

  it("I43: money is rounded to the satang, and a refund keeps its sign", () => {
    const refund = { gross: -100, discount: 0, net: -100, serviceCharge: 0, vat: 0 };
    const r = normaliseAmounts(refund, {
      amountsIncludeVat: false,
      amountsIncludeServiceCharge: false,
    });
    expect(r.net).toBe(-100);
    expect(r.consistencyDelta).toBe(0);
  });
});

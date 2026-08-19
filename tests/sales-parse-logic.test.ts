// ============================================================
// Mise — sales file parse/stage tests (Sprint 4 Part 19 L3a)
// ============================================================
// `parseSalesFileLogic` touches no database, so these run in milliseconds and
// can be exhaustive about the thing that matters: what happens to a file that is
// *almost* right.
//
// ADR 0019 decisions exercised: a file is imported whole or not at all (Q14) ·
// nothing is skipped in silence · a blank cell is never a zero (rule P21) · the
// POS states the sales day and Mise does not recompute it (Q15/rule P14) · VAT
// and service charge are stripped back out at import (Q10/rule P10) · an
// unrecognised channel stops the file rather than becoming a quiet OTHER (Q12).
// ============================================================

import { describe, it, expect } from "vitest";
import { computeHeaderSignature } from "@/lib/sales-file";
import {
  CONSISTENCY_TOLERANCE,
  MAX_REPORTED_ERRORS,
  distinctSalesDays,
  parseSalesFileLogic,
  type ParseProfile,
} from "@/server/sales-import";

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

const HEADER = ["วันที่", "หมวด", "เมนู", "จำนวน", "ยอดก่อนหัก", "ส่วนลด", "ยอดสุทธิ", "SC", "VAT"];
const SIG = computeHeaderSignature(HEADER);

const COLUMN_MAP = {
  businessDate: 0,
  categoryName: 1,
  menuName: 2,
  qty: 3,
  grossAmount: 4,
  discountAmount: 5,
  netAmount: 6,
  serviceChargeAmount: 7,
  vatAmount: 8,
};

const profile = (over: Partial<ParseProfile> = {}): ParseProfile => ({
  fileKind: "DAILY_SUMMARY",
  encoding: "UTF8",
  dateFormat: "dd/MM/yyyy",
  isBuddhistYear: true,
  headerSignature: SIG,
  columnMap: COLUMN_MAP,
  amountsIncludeVat: false,
  amountsIncludeServiceCharge: false,
  defaultChannel: null,
  ...over,
});

const OPTS = { salesDayCutoffMinutes: 300 };

const csv = (rows: string[][]) =>
  new TextEncoder().encode(rows.map((r) => r.join(",")).join("\n") + "\n");

/** date,category,menu,qty,gross,discount,net,sc,vat */
const dataRow = (over: Record<number, string> = {}) => {
  const base = ["31/12/2568", "อาหารจานเดียว", "ผัดกะเพราหมู", "3", "300", "0", "300", "0", "0"];
  for (const [k, v] of Object.entries(over)) base[Number(k)] = v;
  return base;
};

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const messages = (r: ReturnType<typeof parseSalesFileLogic>) =>
  r.ok ? [] : r.errors.map((e) => e.message);

describe("sales file parse + stage (Part 19 L3a)", () => {
  // ------------------------------------------------------------
  // The happy path
  // ------------------------------------------------------------

  it("K1: a well-formed daily-summary file stages its rows", () => {
    const r = parseSalesFileLogic(csv([HEADER, dataRow()]), profile(), OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].businessDate).toEqual(day("2025-12-31"));
    expect(r.rows[0].posMenuName).toBe("ผัดกะเพราหมู");
    expect(r.rows[0].menuMatchKey).toBe("ผัดกะเพราหมู");
    expect(r.rows[0].categoryName).toBe("อาหารจานเดียว");
    expect(r.rows[0].qty).toBe(3);
    expect(r.rows[0].netAmount).toBe(300);
    expect(r.coveredFrom).toEqual(day("2025-12-31"));
    expect(r.coveredTo).toEqual(day("2025-12-31"));
  });

  it("K2: a row number matches what the shop sees in Excel", () => {
    // Header is row 1, so the first sale is row 2. A message pointing at the
    // wrong row costs more time than no message at all.
    const r = parseSalesFileLogic(
      csv([HEADER, dataRow(), dataRow({ 3: "" })]),
      profile(),
      OPTS
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].rowNumber).toBe(3);
  });

  it("K3: a file with several days reports the span it covers", () => {
    const r = parseSalesFileLogic(
      csv([
        HEADER,
        dataRow({ 0: "29/12/2568" }),
        dataRow({ 0: "31/12/2568" }),
        dataRow({ 0: "30/12/2568" }),
      ]),
      profile(),
      OPTS
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coveredFrom).toEqual(day("2025-12-29"));
    expect(r.coveredTo).toEqual(day("2025-12-31"));
    expect(distinctSalesDays(r.rows)).toEqual([
      day("2025-12-29"),
      day("2025-12-30"),
      day("2025-12-31"),
    ]);
  });

  // ------------------------------------------------------------
  // The header signature
  // ------------------------------------------------------------

  it("K4: a changed header stops the file instead of shifting every figure", () => {
    // The previous system read hard-coded indexes, so an inserted column would
    // have moved every number one place while they all still looked plausible.
    const changed = ["วันที่", "สาขา", ...HEADER.slice(1)];
    const r = parseSalesFileLogic(csv([changed, dataRow()]), profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("หัวตารางของไฟล์ไม่ตรงกับรูปแบบที่ตั้งไว้");
  });

  it("K5: an empty file says so rather than importing nothing quietly", () => {
    const r = parseSalesFileLogic(new TextEncoder().encode(""), profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("ไฟล์ว่าง");
  });

  it("K6: a file with a header and no sales says that too", () => {
    const r = parseSalesFileLogic(csv([HEADER]), profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("ไม่พบรายการขาย");
  });

  // ------------------------------------------------------------
  // Nothing is skipped in silence
  // ------------------------------------------------------------

  it("K7: a SHORT row is an error, not a `continue`", () => {
    // `if (csvRow.length < 17) continue;` is how the previous system could empty
    // a file without leaving a trace.
    const short = ["31/12/2568", "อาหาร", "ผัดกะเพรา"];
    const r = parseSalesFileLogic(csv([HEADER, short]), profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("คอลัมน์");
  });

  it("K8: a wholly blank row is skipped but COUNTED and reported", () => {
    const bytes = new TextEncoder().encode(
      [HEADER.join(","), dataRow().join(","), "", dataRow().join(",")].join("\n") + "\n"
    );
    const r = parseSalesFileLogic(bytes, profile(), OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    expect(r.blankRowsSkipped).toBe(1);
  });

  it("K9: a file of nothing but blank rows does not import as success", () => {
    const bytes = new TextEncoder().encode([HEADER.join(","), "", ""].join("\n") + "\n");
    const r = parseSalesFileLogic(bytes, profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("แถวว่าง");
  });

  // ------------------------------------------------------------
  // Blank is never zero
  // ------------------------------------------------------------

  it("K10: a blank QUANTITY stops the file and says why", () => {
    const r = parseSalesFileLogic(csv([HEADER, dataRow({ 3: "" })]), profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("ระบบไม่เดาว่าเป็น 0");
  });

  it("K11: a blank MAPPED money column does the same", () => {
    const r = parseSalesFileLogic(csv([HEADER, dataRow({ 6: "" })]), profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("ยอดสุทธิ");
  });

  it("K12: an UNMAPPED money column is a genuine zero, and no error", () => {
    // A shop with no service charge has none to report. That is different from a
    // report that has the column and left it empty.
    const map = { ...COLUMN_MAP } as Record<string, number>;
    delete map.serviceChargeAmount;
    delete map.vatAmount;
    const sig = computeHeaderSignature(HEADER);
    const r = parseSalesFileLogic(
      csv([HEADER, dataRow()]),
      profile({ columnMap: map, headerSignature: sig }),
      OPTS
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].serviceChargeAmount).toBe(0);
    expect(r.rows[0].vatAmount).toBe(0);
  });

  it("K13: a real 0 and a real negative both import — giveaways and refunds", () => {
    const r = parseSalesFileLogic(
      csv([
        HEADER,
        dataRow({ 3: "2", 4: "0", 6: "0" }), // ของแถม
        dataRow({ 3: "-1", 4: "-100", 6: "-100" }), // คืนเงิน
      ]),
      profile(),
      OPTS
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].netAmount).toBe(0);
    expect(r.rows[1].qty).toBe(-1);
    expect(r.rows[1].netAmount).toBe(-100);
  });

  it("K14: unreadable text is refused with a different message from a blank", () => {
    const r = parseSalesFileLogic(csv([HEADER, dataRow({ 3: "สาม" })]), profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("ไม่ใช่ตัวเลข");
  });

  // ------------------------------------------------------------
  // Whole or not at all
  // ------------------------------------------------------------

  it("K15: one bad row among many fails the WHOLE file — no partial import", () => {
    // Half a day of sales is worse than none, because nothing on screen looks
    // wrong afterwards.
    const r = parseSalesFileLogic(
      csv([HEADER, dataRow(), dataRow({ 6: "" }), dataRow(), dataRow()]),
      profile(),
      OPTS
    );
    expect(r.ok).toBe(false);
    expect("rows" in r).toBe(false);
  });

  it("K16: the error list is capped so a wrong profile does not produce a wall of text", () => {
    const rows = Array.from({ length: MAX_REPORTED_ERRORS + 20 }, () => dataRow({ 6: "" }));
    const r = parseSalesFileLogic(csv([HEADER, ...rows]), profile(), OPTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(MAX_REPORTED_ERRORS);
  });

  // ------------------------------------------------------------
  // Dates
  // ------------------------------------------------------------

  it("K17: a Buddhist year with the profile set to Gregorian is refused, never corrected", () => {
    const r = parseSalesFileLogic(csv([HEADER, dataRow()]), profile({ isBuddhistYear: false }), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("พ.ศ.");
  });

  it("K18: a missing date says that every row must carry its own", () => {
    const r = parseSalesFileLogic(csv([HEADER, dataRow({ 0: "" })]), profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("ทุกแถวต้องมีวันที่ของตัวเอง");
  });

  it("K19: with only a timestamp, the branch cut-off decides the sales day", () => {
    // 01:30 belongs to the night before, because that is when the shop was open.
    const header = ["วันเวลา", "หมวด", "เมนู", "จำนวน", "ยอดสุทธิ"];
    const map = { soldAt: 0, categoryName: 1, menuName: 2, qty: 3, netAmount: 4 };
    const p = profile({
      fileKind: "BILL_DETAIL",
      columnMap: map,
      headerSignature: computeHeaderSignature(header),
    });
    const r = parseSalesFileLogic(
      csv([
        header,
        ["31/12/2568 01:30", "อาหาร", "ผัดกะเพรา", "1", "100"],
        ["31/12/2568 19:30", "อาหาร", "ผัดกะเพรา", "1", "100"],
      ]),
      p,
      OPTS
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].businessDate).toEqual(day("2025-12-30"));
    expect(r.rows[1].businessDate).toEqual(day("2025-12-31"));
    expect(r.rows[0].soldAt).toEqual(new Date("2025-12-31T01:30:00.000Z"));
  });

  it("K20: when the file states BOTH, the stated day wins over the clock (rule P14)", () => {
    // Mise is not the owner of the truth of sales. If our number disagrees with
    // the POS screen, nobody believes any of our numbers.
    const header = ["วันที่", "วันเวลา", "เมนู", "จำนวน", "ยอดสุทธิ"];
    const map = { businessDate: 0, soldAt: 1, menuName: 2, qty: 3, netAmount: 4 };
    const p = profile({
      fileKind: "BILL_DETAIL",
      columnMap: map,
      headerSignature: computeHeaderSignature(header),
    });
    const r = parseSalesFileLogic(
      csv([header, ["31/12/2568", "01/01/2569 01:30", "ผัดกะเพรา", "1", "100"]]),
      p,
      OPTS
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].businessDate).toEqual(day("2025-12-31"));
  });

  // ------------------------------------------------------------
  // Money
  // ------------------------------------------------------------

  it("K21: VAT and service charge are stripped back out when the file included them", () => {
    // ADR 0019 Q10's worked example: the customer paid 1,059.30, revenue is 900.
    const r = parseSalesFileLogic(
      csv([HEADER, dataRow({ 3: "1", 4: "1000", 5: "100", 6: "1059.30", 7: "90", 8: "69.30" })]),
      profile({ amountsIncludeVat: true, amountsIncludeServiceCharge: true }),
      OPTS
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].netAmount).toBe(900);
    expect(r.rows[0].vatAmount).toBe(69.3);
    expect(r.rows[0].serviceChargeAmount).toBe(90);
    expect(r.inconsistentRows).toBe(0);
  });

  it("K22: a wrongly-set flag is surfaced as an inconsistency, not swallowed", () => {
    // It cannot be made impossible — a file cannot be asked what it means — so
    // the preview shows it before anyone commits.
    const r = parseSalesFileLogic(
      csv([HEADER, dataRow({ 3: "1", 4: "1000", 5: "100", 6: "1059.30", 7: "90", 8: "69.30" })]),
      profile(),
      OPTS
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inconsistentRows).toBe(1);
    expect(r.largestConsistencyDelta).toBeGreaterThan(CONSISTENCY_TOLERANCE);
    expect(r.largestConsistencyDelta).toBeCloseTo(159.3, 2);
  });

  // ------------------------------------------------------------
  // Identity and channel
  // ------------------------------------------------------------

  it("K23: a row identified by code alone is fine — identity is the code (Q7)", () => {
    const header = ["วันที่", "รหัส", "จำนวน", "ยอดสุทธิ"];
    const p = profile({
      columnMap: { businessDate: 0, menuCode: 1, qty: 2, netAmount: 3 },
      headerSignature: computeHeaderSignature(header),
    });
    const r = parseSalesFileLogic(csv([header, ["31/12/2568", "M-014", "2", "200"]]), p, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].posMenuCode).toBe("M-014");
    expect(r.rows[0].posMenuName).toBeNull();
  });

  it("K24: a row with neither name nor code is refused", () => {
    const r = parseSalesFileLogic(csv([HEADER, dataRow({ 2: "" })]), profile(), OPTS);
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("ไม่มีทั้งชื่อเมนูและรหัสเมนู");
  });

  it("K25: with no channel column, every row inherits the profile's channel", () => {
    const r = parseSalesFileLogic(
      csv([HEADER, dataRow()]),
      profile({ defaultChannel: "DELIVERY_GRAB" }),
      OPTS
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].channel).toBe("DELIVERY_GRAB");
  });

  it("K26: a mapped channel column is read, and platform names are recognised", () => {
    const header = ["วันที่", "ช่องทาง", "เมนู", "จำนวน", "ยอดสุทธิ"];
    const p = profile({
      columnMap: { businessDate: 0, channel: 1, menuName: 2, qty: 3, netAmount: 4 },
      headerSignature: computeHeaderSignature(header),
      defaultChannel: "DINE_IN",
    });
    const r = parseSalesFileLogic(
      csv([
        header,
        ["31/12/2568", "Grab", "ผัดกะเพรา", "1", "100"],
        ["31/12/2568", "ทานที่ร้าน", "ผัดกะเพรา", "1", "100"],
        ["31/12/2568", "", "ผัดกะเพรา", "1", "100"],
      ]),
      p,
      OPTS
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((x) => x.channel)).toEqual(["DELIVERY_GRAB", "DINE_IN", "DINE_IN"]);
  });

  it("K27: an unrecognised channel stops the file rather than becoming a quiet OTHER", () => {
    // A value we silently bucket is a value nobody ever tells us about, and the
    // point of keeping the channel is to know WHICH platform ate the margin.
    const header = ["วันที่", "ช่องทาง", "เมนู", "จำนวน", "ยอดสุทธิ"];
    const p = profile({
      columnMap: { businessDate: 0, channel: 1, menuName: 2, qty: 3, netAmount: 4 },
      headerSignature: computeHeaderSignature(header),
    });
    const r = parseSalesFileLogic(
      csv([header, ["31/12/2568", "ตู้กดหน้าร้าน", "ผัดกะเพรา", "1", "100"]]),
      p,
      OPTS
    );
    expect(r.ok).toBe(false);
    expect(messages(r)[0]).toContain("ไม่รู้จักช่องทางขาย");
  });

  // ------------------------------------------------------------
  // Encoding
  // ------------------------------------------------------------

  it("K28: a TIS-620 file decodes to Thai menu names, not to a set of new stubs", () => {
    // Read as UTF-8 these bytes become replacement characters, so every menu name
    // turns into a different unrecognised string and the import creates a full
    // duplicate set of stubs. The header is ASCII here only to keep the fixture
    // readable — the Thai sits where the test is actually looking.
    const header = ["A", "B", "C", "D"];
    const p = profile({
      encoding: "TIS620",
      columnMap: { businessDate: 0, menuName: 1, qty: 2, netAmount: 3 },
      headerSignature: computeHeaderSignature(header),
    });
    const KAPRAO_TIS620 = [0xa1, 0xd0, 0xe0, 0xbe, 0xc3, 0xd2];
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("A,B,C,D\n31/12/2568,"),
      ...KAPRAO_TIS620,
      ...new TextEncoder().encode(",1,100\n"),
    ]);

    const r = parseSalesFileLogic(bytes, p, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].posMenuName).toBe("กะเพรา");

    const asUtf8 = parseSalesFileLogic(bytes, profile({ ...p, encoding: "UTF8" }), OPTS);
    expect(asUtf8.ok).toBe(true);
    if (!asUtf8.ok) return;
    expect(asUtf8.rows[0].posMenuName).not.toBe("กะเพรา");
  });
});

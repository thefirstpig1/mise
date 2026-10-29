// ============================================================
// คิดครัว — the month-end file, in each program's own shape (Kong 2026-10-29)
// ============================================================
// Pure, plus one real workbook written and read back. What is pinned is what
// a program checks when it imports: PEAK's column order and rules (from its
// own form, NA005), Xero's signed amounts, the BOM a CSV needs for Thai.
// ============================================================

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildMonthEndJournal } from "@/lib/month-end-journal";
import { journalFigures, readinessOf, type MonthEndView } from "@/lib/month-end-view";
import { PROGRAMS, fileNameFor, journalSheet, programOf, sheetsFor, toCsv } from "@/lib/accounting-formats";
import { missingCodes } from "@/lib/accounting-codes";
import { readAccountingExportSettings } from "@/lib/validations/accounting-export";
import { writeMonthEndFile } from "@/server/month-end-export";

const branch = (over: Partial<MonthEndView["total"]>): MonthEndView["total"] => ({
  branchId: "b",
  branchName: "สาขาอารีย์",
  branchCode: "ARY",
  opening: 0,
  purchases: 0,
  transfersIn: 0,
  transfersOut: 0,
  closing: 0,
  cogs: 0,
  sold: null,
  waste: 0,
  staffMeals: 0,
  shortage: 0,
  other: 0,
  lastCountDate: "2026-09-28",
  unpricedProducts: 0,
  negativeStockProducts: 0,
  inTransitCount: 0,
  inTransitValue: 0,
  draftReceipts: 0,
  ...over,
});

const ari = branch({ opening: 171266.58, purchases: 390645.36, closing: 315702.21, cogs: 246209.73, sold: 230287.61, waste: 206.71, shortage: 15164.14, other: 551.27 });
const view: MonthEndView = {
  month: "2026-09",
  from: "2026-09-01",
  to: "2026-09-30",
  monthEnded: true,
  recipeMethod: true,
  vatRegistered: true,
  branches: [ari],
  total: { ...ari, branchId: "ALL", branchName: "รวมทั้งร้าน" },
  stock: [{ productName: "กุ้งขาว", unitName: "kg", branchName: "สาขาอารีย์", qty: 158.559, value: 50582.48, unpriced: false }],
  billCount: 0,
  bills: [],
};

const settings = readAccountingExportSettings({
  accountingExport: {
    accounts: { inventory: { code: "113101" }, purchases: { code: "511101" }, cogs: { code: "510101" } },
  },
});
const journal = buildMonthEndJournal({ branches: journalFigures(view), mode: "full", split: false, scope: "company", accounts: settings.accounts });

describe("accounting file formats", () => {
  it("F1 PEAK: its own columns in its own order, the date as YYYYMMDD (Christian year), the entry's details on its first line only", () => {
    const s = journalSheet("peak", view, journal);
    expect(s.name).toBe("Import Multiple Journal");
    expect(s.columns.map((c) => c.header)).toEqual([
      "ลำดับที่",
      "สมุดบัญชี",
      "วันที่รายการ (YYYYMMDD)",
      "อ้างอิง",
      "ผู้ติดต่อ",
      "คำอธิบายการบันทึกบัญชี",
      "เลขที่บัญชี*",
      "บัญชีย่อย",
      "คำอธิบายรายการ (ว่างเพื่อให้ระบบใส่ให้)",
      "เดบิต",
      "เครดิต",
      "กลุ่มจัดประเภท",
    ]);
    expect(s.rows[0].slice(0, 4)).toEqual([1, "รายวันทั่วไป", 20260930, "KK2026-09"]);
    expect(s.rows.every((r) => r[0] === 1)).toBe(true);
    expect(s.rows.slice(1).every((r) => r[1] === null && r[2] === null && r[5] === null)).toBe(true);
    expect(s.rows.map((r) => r[6])).toEqual([113101, 510101, 113101, 511101]);
    expect(String(s.rows[0][3]).length).toBeLessThanOrEqual(32);
  });

  it("F2 PEAK refuses to be produced without 6-digit account codes; a keyed file never needs them", () => {
    const blank = buildMonthEndJournal({ branches: journalFigures(view), mode: "full", split: false, scope: "company", accounts: readAccountingExportSettings(null).accounts });
    expect(missingCodes(programOf("peak"), blank)).toEqual(["inventory", "cogs", "purchases"]);
    expect(missingCodes(programOf("peak"), journal)).toEqual([]);
    const fourDigit = buildMonthEndJournal({
      branches: journalFigures(view),
      mode: "full",
      split: false,
      scope: "company",
      accounts: { ...settings.accounts, cogs: { code: "5101", name: "ต้นทุนขาย" } },
    });
    expect(missingCodes(programOf("peak"), fourDigit)).toEqual(["cogs"]);
    expect(missingCodes(programOf("flowaccount"), blank)).toEqual([]);
    expect(missingCodes(programOf("excel"), blank)).toEqual([]);
  });

  it("F3 Xero: one signed amount per line, and they sum to nothing", () => {
    const s = journalSheet("xero", view, journal);
    expect(s.columns.map((c) => c.header).slice(0, 6)).toEqual(["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount"]);
    const total = s.rows.reduce((t, r) => t + Math.round(Number(r[5]) * 100), 0);
    expect(total).toBe(0);
    expect(s.rows[0][1]).toBe("30/09/2026");
  });

  it("F4 QuickBooks: grouped by Journal No., dated MM/DD/YYYY, matched by account NAME", () => {
    const s = journalSheet("quickbooks", view, journal);
    expect(s.rows.every((r) => r[0] === "KK2026-09" && r[1] === "09/30/2026")).toBe(true);
    expect(s.rows.map((r) => r[2])).toContain("ต้นทุนขาย");
  });

  it("F5 a CSV opens as Thai in Excel (BOM) and quotes what needs quoting", () => {
    const csv = toCsv(journalSheet("xero", view, journal));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"ปรับปรุงสินค้าคงเหลือปลายงวด ก.ย. 2569 (คิดครัว)"');
    expect(csv.split("\r\n")).toHaveLength(journal.groups[0].lines.length + 2);
  });

  it("F6 every program has a file name, and a workbook carries the warnings as a sheet (rule ME5)", () => {
    for (const p of PROGRAMS) {
      const n = fileNameFor(p.id, "2026-09");
      expect(n.thai.endsWith(`.${p.ext}`)).toBe(true);
      expect(/^[\x20-\x7e]+$/.test(n.ascii)).toBe(true);
    }
    const warned: MonthEndView = { ...view, branches: [{ ...ari, unpricedProducts: 3 }] };
    expect(readinessOf(warned).some((n) => n.tone === "warn")).toBe(true);
    const sheets = sheetsFor("peak", { view: warned, journal, include: { stock: true, branches: false, bills: false } }, new Date());
    expect(sheets.map((s) => s.name)).toEqual(["Import Multiple Journal", "สต๊อกสิ้นเดือน", "หมายเหตุ"]);
    expect(sheets[2].rows.some((r) => String(r[1]).includes("ยังไม่มีราคาทุน"))).toBe(true);
  });

  it("F7 the written workbook reads back with the journal first and numbers as numbers", async () => {
    const file = await writeMonthEndFile("peak", { view, journal, include: { stock: true, branches: false, bills: false } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Import Multiple Journal");
    expect(ws.getCell("C2").value).toBe(20260930);
    expect(ws.getCell("G2").value).toBe(113101);
    expect(ws.getCell("J2").value).toBe(315702.21);
    let dr = 0;
    let cr = 0;
    ws.eachRow((row, i) => {
      if (i === 1) return;
      dr += Math.round(Number(row.getCell(10).value ?? 0) * 100);
      cr += Math.round(Number(row.getCell(11).value ?? 0) * 100);
    });
    expect(dr).toBe(cr);
  });
});

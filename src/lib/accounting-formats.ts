// ============================================================
// คิดครัว — one month-end file, in each accounting program's own shape
// ============================================================
// Kong 2026-10-29: "เอาให้เขาเลือกได้ว่าจะให้มันformatไปโปรแกรมไหน".
//
// What each layout rests on (checked 2026-10-29, sources in
// docs/calculation-rules.md ME7):
//   PEAK        — its own import form "Import Multiple Journal", column for
//                 column, from the screenshots in PEAK's manual (NA005) and
//                 the rules on its Description sheet: ลำดับที่ groups the
//                 lines of one entry, the date is YYYYMMDD in the Christian
//                 year, the account is PEAK's 6-digit number.
//   FlowAccount — no journal import found; a sheet laid out to key in.
//   Express     — no import of its own (resellers sell it as a service); a
//                 voucher (JV) laid out to key in.
//   Xero        — Manual journals → Import, CSV, signed amounts.
//   QuickBooks  — Import data → Journal entries, CSV, matched by account name.
//   Excel       — every table, for an accountant who arranges it themselves.
//
// Pure and dependency-free, so the export dialog previews exactly the cells
// the server writes. The workbook itself is written in
// src/server/month-end-export.ts.
// ============================================================

import type { AccountingProgram } from "@/lib/validations/accounting-export";
import { fromSatang, type Journal } from "@/lib/month-end-journal";
import { monthTitleTh, readinessOf, type MonthEndView } from "@/lib/month-end-view";

export type Cell = string | number | null;
export type Column = { header: string; width?: number; money?: boolean; qty?: boolean };
export type Sheet = { name: string; columns: Column[]; rows: Cell[][] };

export type ProgramSpec = {
  id: AccountingProgram;
  label: string;
  mono: string;
  /** import = the program reads the file; key = laid out to type in; generic = every table. */
  kind: "import" | "key" | "generic";
  ext: "xlsx" | "csv";
  what: string;
  howLabel: string;
  steps: string[];
  note?: string;
  /** Accounts must carry a code before this file can be read by the program. */
  needsCodes: boolean;
  /** PEAK reads a 6-digit account number and leaves anything else blank. */
  codePattern?: RegExp;
  codeHint?: string;
};

export const PROGRAMS: ProgramSpec[] = [
  {
    id: "peak",
    label: "PEAK",
    mono: "PK",
    kind: "import",
    ext: "xlsx",
    what: "สมุดบัญชีรายวัน ตามแบบฟอร์มนำเข้าของ PEAK",
    howLabel: "นำเข้าได้ทันที",
    steps: [
      "เปิด PEAK ไปที่เมนู รายรับ › นำเข้าเอกสาร",
      "กดลูกศรข้างปุ่ม นำเข้าเอกสาร › เลือก รูปแบบ PEAK › ประเภท บัญชีรายวัน",
      "ลากไฟล์นี้ใส่ › นำเข้าไฟล์ › ตรวจแล้วกด สร้างสมุดรายวันทั้งหมด",
    ],
    needsCodes: true,
    codePattern: /^\d{6}$/,
    codeHint: "PEAK ใช้เลขที่บัญชี 6 หลัก เช่น 113101",
  },
  {
    id: "flowaccount",
    label: "FlowAccount",
    mono: "FA",
    kind: "key",
    ext: "xlsx",
    what: "รายการบันทึกบัญชี เรียงตามช่องที่ต้องคีย์",
    howLabel: "ได้ไฟล์ไว้คีย์ตาม",
    steps: [
      "เปิดหน้าบันทึกบัญชี (สมุดรายวัน) ใน FlowAccount",
      "สร้างรายการใหม่ ลงวันที่สิ้นเดือน",
      "คีย์ตามไฟล์ทีละบรรทัด — มีไม่กี่บรรทัด",
    ],
    note: "ไฟล์นี้ใช้คีย์ตาม — หาก FlowAccount เปิดให้นำเข้าสมุดรายวันจากไฟล์ได้ เราจะเปลี่ยนเป็นไฟล์นำเข้าให้",
    needsCodes: false,
  },
  {
    id: "express",
    label: "Express",
    mono: "EX",
    kind: "key",
    ext: "xlsx",
    what: "ใบสำคัญทั่วไป (JV) เรียงแบบที่คีย์ใน Express",
    howLabel: "ได้ไฟล์ไว้คีย์ตาม",
    steps: [
      "เปิดระบบบัญชีแยกประเภท › บันทึกรายการรายวัน",
      "เลือกสมุดรายวันทั่วไป ลงวันที่สิ้นเดือน",
      "คีย์ตามใบสำคัญในไฟล์",
    ],
    needsCodes: false,
  },
  {
    id: "xero",
    label: "Xero",
    mono: "XR",
    kind: "import",
    ext: "csv",
    what: "Manual journal ตามแบบไฟล์นำเข้าของ Xero",
    howLabel: "นำเข้าได้ทันที",
    steps: [
      "Accounting › Manual journals",
      "กด Import แล้วเลือกไฟล์นี้",
      "ตรวจแล้วกด Post",
    ],
    note: "ไฟล์ CSV มีแค่รายการปรับปรุง — สต๊อกรายสินค้าและหมายเหตุ เลือก Excel ทั่วไปแยกอีกไฟล์",
    needsCodes: true,
  },
  {
    id: "quickbooks",
    label: "QuickBooks Online",
    mono: "QB",
    kind: "import",
    ext: "csv",
    what: "Journal entries ตามแบบไฟล์นำเข้าของ QuickBooks",
    howLabel: "นำเข้าได้ทันที",
    steps: [
      "⚙ Settings › Import data",
      "เลือก Journal Entries แล้วเลือกไฟล์นี้",
      "จับคู่บัญชีที่ระบบถาม แล้วกด Import",
    ],
    note: "QuickBooks จับคู่ด้วยชื่อบัญชี — ชื่อในคิดครัวต้องตรงกับชื่อในผังบัญชีของ QuickBooks",
    needsCodes: false,
  },
  {
    id: "excel",
    label: "Excel ทั่วไป",
    mono: "XL",
    kind: "generic",
    ext: "xlsx",
    what: "สรุปปิดเดือน · รายการปรับปรุง · สต๊อกรายสินค้า",
    howLabel: "ทุกตารางในไฟล์เดียว",
    steps: [
      "ส่งไฟล์ให้นักบัญชี (อีเมล / LINE)",
      "แท็บ “รายการปรับปรุง” คือสิ่งที่ลงบัญชี",
      "แท็บอื่นเป็นเอกสารประกอบ",
    ],
    needsCodes: false,
  },
];

export const programOf = (id: AccountingProgram): ProgramSpec => PROGRAMS.find((p) => p.id === id)!;

export type FileContext = {
  view: MonthEndView;
  journal: Journal;
  /** Which optional tables go in (xlsx only). */
  include: { stock: boolean; branches: boolean; bills: boolean };
};

const amount = (satang: number): number | null => (satang === 0 ? null : fromSatang(satang));

function lastDay(view: MonthEndView) {
  const [y, m, d] = view.to.split("-");
  return { y: Number(y), m, d };
}

function entryText(view: MonthEndView, branchName: string | null): string {
  return `ปรับปรุงสินค้าคงเหลือปลายงวด ${monthTitleTh(view.month)}${branchName ? ` · ${branchName}` : ""} (คิดครัว)`;
}

/** The journal, in the chosen program's own layout. */
export function journalSheet(program: AccountingProgram, view: MonthEndView, journal: Journal): Sheet {
  const { y, m, d } = lastDay(view);
  const be = y + 543;
  const multi = journal.groups.length > 1;
  const ref = (no: number) => `KK${y}-${m}${multi ? `-${no}` : ""}`;
  const rows: Cell[][] = [];

  switch (program) {
    case "peak": {
      for (const g of journal.groups) {
        g.lines.forEach((l, i) => {
          const first = i === 0;
          rows.push([
            g.no,
            first ? "รายวันทั่วไป" : null,
            first ? Number(`${y}${m}${d}`) : null,
            first ? ref(g.no) : null,
            null,
            first ? entryText(view, g.branchName) : null,
            /^\d+$/.test(l.code) ? Number(l.code) : l.code || null,
            null,
            l.memo,
            amount(l.debit),
            amount(l.credit),
            null,
          ]);
        });
      }
      return {
        name: "Import Multiple Journal",
        columns: [
          { header: "ลำดับที่", width: 9 },
          { header: "สมุดบัญชี", width: 14 },
          { header: "วันที่รายการ (YYYYMMDD)", width: 14 },
          { header: "อ้างอิง", width: 14 },
          { header: "ผู้ติดต่อ", width: 10 },
          { header: "คำอธิบายการบันทึกบัญชี", width: 40 },
          { header: "เลขที่บัญชี*", width: 12 },
          { header: "บัญชีย่อย", width: 10 },
          { header: "คำอธิบายรายการ (ว่างเพื่อให้ระบบใส่ให้)", width: 34 },
          { header: "เดบิต", width: 14, money: true },
          { header: "เครดิต", width: 14, money: true },
          { header: "กลุ่มจัดประเภท", width: 14 },
        ],
        rows,
      };
    }
    case "xero": {
      for (const g of journal.groups) {
        for (const l of g.lines) {
          rows.push([
            entryText(view, g.branchName),
            `${d}/${m}/${y}`,
            l.memo,
            l.code || null,
            "Tax Exempt",
            fromSatang(l.debit - l.credit),
            g.branchName ? "สาขา" : null,
            g.branchName,
          ]);
        }
      }
      return {
        name: "Manual journal",
        columns: [
          { header: "*Narration" },
          { header: "*Date" },
          { header: "Description" },
          { header: "*AccountCode" },
          { header: "*TaxRate" },
          { header: "*Amount", money: true },
          { header: "TrackingName1" },
          { header: "TrackingOption1" },
        ],
        rows,
      };
    }
    case "quickbooks": {
      for (const g of journal.groups) {
        for (const l of g.lines) {
          rows.push([ref(g.no), `${m}/${d}/${y}`, l.name, amount(l.debit), amount(l.credit), l.memo, g.branchName]);
        }
      }
      return {
        name: "Journal entries",
        columns: [
          { header: "Journal No." },
          { header: "Journal Date" },
          { header: "Account Name" },
          { header: "Debits", money: true },
          { header: "Credits", money: true },
          { header: "Description" },
          { header: "Location" },
        ],
        rows,
      };
    }
    case "express": {
      for (const g of journal.groups) {
        for (const l of g.lines) {
          rows.push([
            `JV${String(be).slice(-2)}${m}-${String(g.no).padStart(2, "0")}`,
            `${d}/${m}/${be}`,
            l.code || null,
            l.name,
            amount(l.debit),
            amount(l.credit),
            `${l.memo}${g.branchName ? ` · ${g.branchName}` : ""}`,
          ]);
        }
      }
      return {
        name: "ใบสำคัญ JV",
        columns: [
          { header: "เลขที่ใบสำคัญ", width: 14 },
          { header: "วันที่", width: 12 },
          { header: "รหัสบัญชี", width: 12 },
          { header: "ชื่อบัญชี", width: 28 },
          { header: "เดบิต", width: 14, money: true },
          { header: "เครดิต", width: 14, money: true },
          { header: "คำอธิบาย", width: 40 },
        ],
        rows,
      };
    }
    default: {
      // FlowAccount and Excel ทั่วไป: the same plain voucher, branch named.
      for (const g of journal.groups) {
        for (const l of g.lines) {
          rows.push([
            `${d}/${m}/${be}`,
            ref(g.no),
            g.branchName ?? "ทั้งร้าน",
            l.code || null,
            l.name,
            amount(l.debit),
            amount(l.credit),
            l.memo,
          ]);
        }
      }
      return {
        name: "รายการปรับปรุง",
        columns: [
          { header: "วันที่", width: 12 },
          { header: "อ้างอิง", width: 12 },
          { header: "สาขา", width: 16 },
          { header: "รหัสบัญชี", width: 12 },
          { header: "ชื่อบัญชี", width: 28 },
          { header: "เดบิต", width: 14, money: true },
          { header: "เครดิต", width: 14, money: true },
          { header: "คำอธิบาย", width: 36 },
        ],
        rows,
      };
    }
  }
}

const SUMMARY_ROWS: [string, (b: MonthEndView["total"]) => number | null][] = [
  ["สต๊อกต้นเดือน", (b) => b.opening],
  ["ซื้อเข้า", (b) => b.purchases],
  ["รับโอนจากสาขาอื่น", (b) => b.transfersIn],
  ["โอนออกให้สาขาอื่น", (b) => b.transfersOut],
  ["สต๊อกสิ้นเดือน", (b) => b.closing],
  ["ต้นทุนขาย (ยกมา + ซื้อ + รับโอน − โอนออก − คงเหลือ)", (b) => b.cogs],
  ["  ขายไปตามสูตร", (b) => b.sold],
  ["  ทิ้ง (มีใบบันทึกของเสีย)", (b) => b.waste],
  ["  มื้อพนักงาน", (b) => b.staffMeals],
  ["  ของขาดจากการนับ", (b) => b.shortage],
  ["  อื่น ๆ (นับเจอเกิน · ปรับยอด)", (b) => b.other],
];

export function summarySheet(view: MonthEndView): Sheet {
  const cols = [...view.branches, ...(view.branches.length > 1 ? [view.total] : [])];
  return {
    name: "สรุปปิดเดือน",
    columns: [{ header: `ปิดเดือน ${monthTitleTh(view.month)}`, width: 46 }, ...cols.map((b) => ({ header: b.branchName, width: 16, money: true }))],
    rows: SUMMARY_ROWS.filter(([label]) => view.recipeMethod || !label.startsWith("  ขายไป")).map(([label, pick]) => [
      label,
      ...cols.map((b) => pick(b)),
    ]),
  };
}

export function stockSheet(view: MonthEndView): Sheet {
  return {
    name: "สต๊อกสิ้นเดือน",
    columns: [
      { header: "สินค้า", width: 30 },
      { header: "สาขา", width: 16 },
      { header: "คงเหลือ", width: 12, qty: true },
      { header: "หน่วย", width: 8 },
      { header: "ทุนต่อหน่วย", width: 12, money: true },
      { header: "มูลค่า", width: 14, money: true },
      { header: "หมายเหตุ", width: 22 },
    ],
    rows: view.stock.map((s) => [
      s.productName,
      s.branchName,
      s.qty,
      s.unitName,
      s.qty !== 0 ? Math.round((s.value / s.qty) * 100) / 100 : null,
      s.value,
      s.unpriced ? "มีบางส่วนยังไม่มีราคาทุน" : null,
    ]),
  };
}

export function branchesSheet(view: MonthEndView): Sheet {
  return {
    name: "แยกสาขา",
    columns: [
      { header: "สาขา", width: 18 },
      { header: "สต๊อกต้นเดือน", width: 14, money: true },
      { header: "ซื้อเข้า", width: 14, money: true },
      { header: "รับโอน", width: 12, money: true },
      { header: "โอนออก", width: 12, money: true },
      { header: "สต๊อกสิ้นเดือน", width: 14, money: true },
      { header: "ต้นทุนขาย", width: 14, money: true },
      { header: "นับสต๊อกล่าสุด", width: 14 },
    ],
    rows: [...view.branches, view.total].map((b) => [
      b.branchName,
      b.opening,
      b.purchases,
      b.transfersIn,
      b.transfersOut,
      b.closing,
      b.cogs,
      b.lastCountDate,
    ]),
  };
}

export function billsSheet(view: MonthEndView): Sheet {
  return {
    name: "บิลซื้อและค่าใช้จ่าย",
    columns: [
      { header: "วันที่บิล", width: 12 },
      { header: "เลขที่บิล", width: 14 },
      { header: "เลขที่ใบกำกับภาษี", width: 16 },
      { header: "ผู้ขาย", width: 28 },
      { header: "เลขประจำตัวผู้เสียภาษี", width: 16 },
      { header: "สาขา", width: 14 },
      { header: "ประเภท", width: 16 },
      { header: "ก่อน VAT", width: 13, money: true },
      { header: "VAT", width: 11, money: true },
      { header: "หัก ณ ที่จ่าย", width: 12, money: true },
      { header: "ยอดรวม", width: 13, money: true },
      { header: "ยอดจ่ายจริง", width: 13, money: true },
      { header: "จ่ายแล้ว", width: 9 },
    ],
    rows: view.bills.map((b) => [
      b.billDate,
      b.billNo,
      b.vatInvoiceNo,
      b.supplierName,
      b.supplierTaxId,
      b.branchName,
      b.kind,
      b.subtotal,
      b.vat || null,
      b.wht || null,
      b.total,
      b.netPayment,
      b.paid ? "จ่ายแล้ว" : "ยังไม่จ่าย",
    ]),
  };
}

export function notesSheet(view: MonthEndView, generatedAt: Date): Sheet {
  const notes = readinessOf(view);
  const rows: Cell[][] = notes.map((n) => [n.tone === "ok" ? "✓" : n.tone === "warn" ? "!" : "i", n.title, n.detail]);
  rows.push([null, null, null]);
  rows.push([null, "วิธีคิด", "ต้นทุนขาย = สต๊อกต้นเดือน + ซื้อเข้า + รับโอน − โอนออก − สต๊อกสิ้นเดือน · มูลค่าสต๊อกคิดแบบเข้าก่อนออกก่อน (FIFO)"]);
  rows.push([
    null,
    "ยอดซื้อ",
    view.vatRegistered
      ? "บิลวัตถุดิบของเดือน ไม่รวม VAT เพราะร้านจด VAT และขอคืนภาษีซื้อได้"
      : "บิลวัตถุดิบของเดือน รวม VAT เพราะร้านไม่ได้จด VAT ภาษีซื้อจึงเป็นต้นทุน",
  ]);
  rows.push([null, "สร้างโดย", `คิดครัว ${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`]);
  return {
    name: "หมายเหตุ",
    columns: [{ header: "", width: 4 }, { header: "เรื่อง", width: 44 }, { header: "รายละเอียด", width: 90 }],
    rows,
  };
}

/** Every sheet that goes into this program's file, journal first. */
export function sheetsFor(program: AccountingProgram, ctx: FileContext, generatedAt: Date): Sheet[] {
  const spec = programOf(program);
  const journal = journalSheet(program, ctx.view, ctx.journal);
  if (spec.ext === "csv") return [journal];
  const sheets: Sheet[] = program === "excel" ? [summarySheet(ctx.view), journal] : [journal];
  if (ctx.include.stock) sheets.push(stockSheet(ctx.view));
  if (ctx.include.branches && ctx.view.branches.length > 1) sheets.push(branchesSheet(ctx.view));
  if (ctx.include.bills && ctx.view.bills.length > 0) sheets.push(billsSheet(ctx.view));
  sheets.push(notesSheet(ctx.view, generatedAt));
  return sheets;
}

/** "คิดครัว-ปิดเดือน-2569-09-PEAK.xlsx" and an ASCII twin for old browsers. */
export function fileNameFor(program: AccountingProgram, month: string): { thai: string; ascii: string } {
  const spec = programOf(program);
  const [y, m] = month.split("-");
  const tag = program === "excel" ? "" : `-${spec.label.replace(/\s+/g, "")}`;
  return {
    thai: `คิดครัว-ปิดเดือน-${Number(y) + 543}-${m}${tag}.${spec.ext}`,
    ascii: `kitkrua-month-end-${y}-${m}${program === "excel" ? "" : `-${program}`}.${spec.ext}`,
  };
}

/** RFC 4180, every field quoted, with a BOM so Excel opens Thai as UTF-8. */
export function toCsv(sheet: Sheet): string {
  const q = (c: Cell) => `"${c === null ? "" : String(c).replace(/"/g, '""')}"`;
  const lines = [sheet.columns.map((c) => q(c.header)).join(","), ...sheet.rows.map((r) => r.map(q).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

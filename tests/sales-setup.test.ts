// ============================================================
// Mise — the first sales import (Kong 2026-11-01, mockup 225p68BDqKAZTpd9MqDeph)
// ============================================================
//   X1–X3  an Excel file reads into the same table a CSV does, so every
//          parse rule applies to it unchanged
//   D1–D5  the date is asked about by what it READS as, and two readings
//          that disagree are both offered — never one picked
//   W1–W4  nothing is saved until the end, and the end saves the POS and the
//          format together or neither (real Neon)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { withRlsBypass } from "@/lib/db-admin";
import { computeHeaderSignature, parseCsv } from "@/lib/sales-file";
import { readDateCandidates, tellingSample, thaiDateLabel } from "@/lib/sales-setup";
import { isXlsxBytes, readSalesTable, readXlsxSalesTable } from "@/server/sales-table";
import { parseSalesTableLogic } from "@/server/sales-import";
import { setupSalesFileLogic, trialReadSalesFileLogic } from "@/server/sales-setup";
import { PosIntegrationNotFoundError } from "@/server/menu";

const HEADER = ["วันที่", "เลขที่บิล", "รายการ", "จำนวน", "@", "รวม"];
const ROWS = [
  ["28/10/2026", "B0001", "ผัดกะเพราหมูสับ", "2", "60", "120"],
  ["28/10/2026", "B0001", "ชาไทยเย็น", "2", "35", "70"],
  ["29/10/2026", "B0002", "ผัดกะเพราหมูสับ", "3", "60", "180"],
];
const MAP = { businessDate: 0, billId: 1, menuName: 2, qty: 3, netAmount: 5 };
const DRAFT = {
  fileKind: "BILL_DETAIL" as const,
  encoding: "UTF8" as const,
  dateFormat: "dd/MM/yyyy" as const,
  isBuddhistYear: false,
  columnMap: MAP,
  amountsIncludeVat: false,
  amountsIncludeServiceCharge: false,
  defaultChannel: null,
};

async function workbook(rows: (string | number | Date | { formula: string; result: number | Date })[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ยอดขาย");
  for (const r of rows) ws.addRow(r);
  ws.addRow([]); // a trailing blank row Excel often keeps
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const csvBytes = (rows: string[][]) => new TextEncoder().encode(rows.map((r) => r.join(",")).join("\n") + "\n");

describe("an Excel sales file", () => {
  it("X1: is told by its bytes, not its name", async () => {
    expect(isXlsxBytes(await workbook([HEADER]))).toBe(true);
    expect(isXlsxBytes(csvBytes([HEADER]))).toBe(false);
  });

  it("X2: date cells keep their time, numbers stay plain, formulas give their result", async () => {
    const bytes = await workbook([
      ["วันเวลา", "รายการ", "จำนวน", "รวม"],
      [new Date(Date.UTC(2026, 9, 28, 13, 45)), "ผัดกะเพราหมูสับ", 2, { formula: "2*60", result: 120 }],
      [{ formula: "DATE(2026,10,29)", result: new Date(Date.UTC(2026, 9, 29)) }, "ชาไทยเย็น", 1234.5, 35],
    ]);
    const table = await readXlsxSalesTable(bytes);
    expect(table).toEqual([
      ["วันเวลา", "รายการ", "จำนวน", "รวม"],
      ["2026-10-28 13:45", "ผัดกะเพราหมูสับ", "2", "120"],
      ["2026-10-29", "ชาไทยเย็น", "1234.5", "35"],
    ]);
  });

  it("X3: parses to the same rows as the same file saved as CSV", async () => {
    const opts = { salesDayCutoffMinutes: 300 };
    const profile = { ...DRAFT, headerSignature: computeHeaderSignature(HEADER) };
    const fromCsv = parseSalesTableLogic(parseCsv(new TextDecoder().decode(csvBytes([HEADER, ...ROWS]))), profile, opts);
    const read = await readSalesTable(await workbook([HEADER, ...ROWS]), "UTF8");
    expect(read.ok && read.excel).toBe(true);
    const fromXlsx = read.ok ? parseSalesTableLogic(read.table, profile, opts) : null;
    expect(fromCsv.ok).toBe(true);
    expect(fromXlsx).toEqual(fromCsv);
  });

  it("X4: a file that only looks like a workbook is refused, not read as text", async () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    expect(await readSalesTable(broken, "UTF8")).toEqual({ ok: false, reason: "UNREADABLE_XLSX" });
  });
});

describe("the date, asked by what it reads as", () => {
  it("D1: a day-first Gregorian file has one reading", () => {
    const c = readDateCandidates(["28/10/2026", "29/10/2026"]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ format: "dd/MM/yyyy", isBuddhistYear: false, hasTime: false });
    expect(thaiDateLabel(c[0].days[0].day, false)).toBe("28 ต.ค. 2026");
  });

  it("D2: a Buddhist-year file is read as one, and shown in its own calendar", () => {
    const c = readDateCandidates(["28/10/2569"]);
    expect(c).toHaveLength(1);
    expect(c[0].isBuddhistYear).toBe(true);
    expect(c[0].days[0].day.toISOString().slice(0, 10)).toBe("2026-10-28");
    expect(thaiDateLabel(c[0].days[0].day, true)).toBe("28 ต.ค. 2569");
  });

  it("D3: 5/6 and 7/6 read two ways — both are offered, on the value that tells them apart", () => {
    const c = readDateCandidates(["05/06/2026", "07/06/2026"]);
    expect(c.map((x) => x.format)).toEqual(["dd/MM/yyyy", "MM/dd/yyyy"]);
    const i = tellingSample(c);
    expect(c.map((x) => thaiDateLabel(x.days[i].day, false))).toEqual(["5 มิ.ย. 2026", "6 พ.ค. 2026"]);
  });

  it("D4: one value that only month-first can read settles it", () => {
    const c = readDateCandidates(["05/06/2026", "12/31/2026"]);
    expect(c.map((x) => x.format)).toEqual(["MM/dd/yyyy"]);
  });

  it("D5: a time is noticed, and a column that is not a date reads nothing", () => {
    const c = readDateCandidates(["2026-10-28 13:45"]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ format: "yyyy-MM-dd", hasTime: true });
    expect(thaiDateLabel(c[0].days[0].day, false, c[0].days[0].minutes)).toBe("28 ต.ค. 2026 13:45");
    expect(readDateCandidates(["ผัดกะเพราหมูสับ"])).toEqual([]);
    expect(readDateCandidates(["", " "])).toEqual([]);
  });
});

describe("the wizard's read-back and its one save (real Neon)", () => {
  let tenant: string;
  let branchA: string;
  let branchB: string;
  let posOfB: string;

  const counts = () =>
    withRlsBypass(async (tx) => ({
      pos: await tx.posIntegration.count({ where: { tenantId: tenant } }),
      profiles: await tx.salesImportProfile.count({ where: { tenantId: tenant } }),
    }));

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Sales Setup Test Tenant" } });
      tenant = t.id;
      const [a, b] = await Promise.all([
        tx.branch.create({ data: { tenantId: t.id, name: "สาขาหลัก", code: "MAIN", salesDayCutoffMinutes: 300 } }),
        tx.branch.create({ data: { tenantId: t.id, name: "ลาดพร้าว", code: "LPW" } }),
      ]);
      branchA = a.id;
      branchB = b.id;
      posOfB = (await tx.posIntegration.create({ data: { tenantId: t.id, branchId: b.id, posType: "OCHA", name: "Ocha" } })).id;
    });
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenant } });
      await tx.posIntegration.deleteMany({ where: { tenantId: tenant } });
      await tx.branch.deleteMany({ where: { tenantId: tenant } });
      await tx.tenant.deleteMany({ where: { id: tenant } });
    });
  });

  it("W1: the read-back says what each day holds, and writes nothing", async () => {
    const before = await counts();
    const r = await trialReadSalesFileLogic(tenant, branchA, DRAFT, [HEADER, ...ROWS]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.days.map((d) => [d.date, d.net])).toEqual([
      ["2026-10-28", 190],
      ["2026-10-29", 180],
    ]);
    expect(r.days[0].lines[0]).toEqual({ name: "ผัดกะเพราหมูสับ", qty: 2, net: 120, discount: 0 });
    expect(r).toMatchObject({ totalDays: 2, totalRows: 3, totalNet: 370, menus: 2, usedCutoff: false });
    expect(await counts()).toEqual(before);
  });

  it("W2: a wrong answer comes back as the parser's own row messages", async () => {
    const r = await trialReadSalesFileLogic(tenant, branchA, { ...DRAFT, columnMap: { ...MAP, qty: 2 } }, [HEADER, ...ROWS]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].rowNumber).toBe(2);
  });

  it("W3: a new brand saves the POS and its format together", async () => {
    const before = await counts();
    const saved = await setupSalesFileLogic(tenant, {
      ...DRAFT,
      branchId: branchA,
      posIntegrationId: null,
      posType: "FOODSTORY",
      posName: "FoodStory",
      headerSignature: computeHeaderSignature(HEADER),
    });
    const after = await counts();
    expect(after).toEqual({ pos: before.pos + 1, profiles: before.profiles + 1 });
    const profile = await withRlsBypass((tx) =>
      tx.salesImportProfile.findUniqueOrThrow({ where: { id: saved.profileId }, include: { posIntegration: true } })
    );
    expect(profile.name).toBe("FoodStory · ไฟล์รายบิล");
    expect(profile.posIntegration.branchId).toBe(branchA);
  });

  it("W4: another branch's POS is refused, and nothing is left behind", async () => {
    const before = await counts();
    await expect(
      setupSalesFileLogic(tenant, {
        ...DRAFT,
        branchId: branchA,
        posIntegrationId: posOfB,
        posType: null,
        posName: null,
        headerSignature: computeHeaderSignature(HEADER),
      })
    ).rejects.toBeInstanceOf(PosIntegrationNotFoundError);
    expect(await counts()).toEqual(before);
    // …while the same POS for its own branch takes a second format.
    const ok = await setupSalesFileLogic(tenant, {
      ...DRAFT,
      fileKind: "DAILY_SUMMARY",
      columnMap: { businessDate: 0, menuName: 2, qty: 3, netAmount: 5 },
      branchId: branchB,
      posIntegrationId: posOfB,
      posType: null,
      posName: null,
      headerSignature: computeHeaderSignature(HEADER),
    });
    expect(ok.posIntegrationId).toBe(posOfB);
    expect(await counts()).toEqual({ pos: before.pos, profiles: before.profiles + 1 });
  });

  it("W5: the read-back says when the day came from a time and the cut-off", async () => {
    const table = [
      ["วันเวลา", "รายการ", "จำนวน", "รวม"],
      ["2026-10-29 01:30", "ผัดกะเพราหมูสับ", "1", "60"],
    ];
    const r = await trialReadSalesFileLogic(
      tenant,
      branchA,
      { ...DRAFT, dateFormat: "yyyy-MM-dd", columnMap: { soldAt: 0, menuName: 1, qty: 2, netAmount: 3 } },
      table
    );
    expect(r.ok && r.usedCutoff).toBe(true);
    // 01:30 before a 05:00 cut-off belongs to the night before.
    expect(r.ok && r.days[0].date).toBe("2026-10-28");
  });
});

// ============================================================
// คิวงานข้อ 5c — past purchase bills → suppliers and prices
// ============================================================
// Kong 2026-10-30 (mockup YFU35adTUBXVQ6PPppFcHP round 2): keep the suppliers,
// who sells what and the price on each date — never stock, never an expense.
// A bill's wording is matched remembered → same name / the AI's pick from the
// shop's list → a close name; anything else is skipped, never guessed.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prismaBypass, withRlsBypass } from "@/lib/db-admin";
import {
  buildBillImportPrompt,
  draftBills,
  judgeLine,
  lineKind,
  parseBillDate,
  readBillTable,
  toBillSave,
  type BillContext,
  type RawBillRow,
} from "@/lib/bill-import";
import { splitPastedTable } from "@/lib/product-import";
import { getBillContextLogic, importBillsLogic } from "@/server/bill-import";
import { getSupplierItemNamesLogic } from "@/server/supplier-product-mapping";
import { UnitNeedsRatioError } from "@/server/product";
import { sweepTestTenants } from "./support/sweep";

const row = (over: Partial<RawBillRow>): RawBillRow => ({
  line: 2,
  date: "12/10/2569",
  supplier: "ร้านข้าวเจ๊ใหญ่",
  billNo: "0457",
  item: "",
  shopItem: "",
  qty: "",
  unit: "",
  unitPrice: "",
  total: "",
  original: "",
  unsure: "",
  ...over,
});

const CTX: BillContext = {
  products: [
    { id: "p-rice", name: "ข้าวหอมมะลิ", sku: "P-0001", dimension: "WEIGHT", units: [{ id: "u-kg", unitName: "kg", toBaseRatio: 1, isBase: true }, { id: "u-sack", unitName: "กระสอบ", toBaseRatio: 15, isBase: false }] },
    { id: "p-pork", name: "หมูสับ", sku: "P-0002", dimension: "WEIGHT", units: [{ id: "u-kg2", unitName: "kg", toBaseRatio: 1, isBase: true }] },
    { id: "p-syrup", name: "น้ำเชื่อม", sku: "P-0003", dimension: "COUNT", units: [{ id: "u-btl", unitName: "ขวด", toBaseRatio: 1, isBase: true }] },
    { id: "p-chili", name: "พริกแห้ง", sku: "P-0004", dimension: "WEIGHT", units: [{ id: "u-kg3", unitName: "kg", toBaseRatio: 1, isBase: true }] },
    { id: "p-fish", name: "น้ำปลา", sku: "P-0005", dimension: "COUNT", units: [{ id: "u-btl2", unitName: "ขวด", toBaseRatio: 1, isBase: true }] },
  ],
  suppliers: [{ id: "s-makro", name: "แม็คโคร" }],
  remembered: [{ supplierId: "s-makro", productId: "p-pork", itemName: "หมูบดอนามัย" }],
  templates: [
    { unitName: "g", unitDimension: "WEIGHT", toSiRatio: 1 },
    { unitName: "kg", unitDimension: "WEIGHT", toSiRatio: 1000 },
    { unitName: "ขวด", unitDimension: "COUNT", toSiRatio: null },
    { unitName: "แผง", unitDimension: "COUNT", toSiRatio: null },
  ],
  openingDate: "2026-10-20",
  today: "2026-10-30",
};

describe("reading bills", () => {
  it("B-1 the header is found under a title line; Thai dates read in either era", () => {
    const t = readBillTable(
      splitPastedTable(
        ["บิลที่อ่านได้", "| วันที่ | ผู้ขาย | เลขที่บิล | รายการ | วัตถุดิบของร้าน | จำนวน | หน่วย | ราคาต่อหน่วย | ยอดรวม | ข้อความเดิม | ไม่แน่ใจ |", "|---|---|---|---|---|---|---|---|---|---|---|", "| 12/10/2569 | แม็คโคร | 1 | หมูบดอนามัย | หมูสับ | 5.2 | กก | 145 | 754 | | |"].join("\n")
      )
    );
    expect(t.ok && t.rows[0]).toMatchObject({ date: "12/10/2569", supplier: "แม็คโคร", item: "หมูบดอนามัย", shopItem: "หมูสับ", qty: "5.2", unit: "กก", total: "754" });
    expect(parseBillDate("12/10/2569")).toEqual({ day: "2026-10-12", guessedYear: false });
    expect(parseBillDate("12/10/69")).toEqual({ day: "2026-10-12", guessedYear: true });
    expect(parseBillDate("12/10/26")).toEqual({ day: "2026-10-12", guessedYear: true });
    expect(parseBillDate("2026-10-12")).toEqual({ day: "2026-10-12", guessedYear: false });
    expect(parseBillDate("31/02/2569").day).toBeNull();
    expect(readBillTable([["ชื่อ", "หน่วย"]])).toEqual({ ok: false, reason: "NO_HEADER" });
  });

  it("B-2 VAT, discounts, delivery and totals are set aside by their wording", () => {
    expect(lineKind("ภาษีมูลค่าเพิ่ม 7%")).toBe("VAT");
    expect(lineKind("VAT")).toBe("VAT");
    expect(lineKind("ส่วนลดท้ายบิล")).toBe("DISCOUNT");
    expect(lineKind("ค่าส่ง")).toBe("SHIPPING");
    expect(lineKind("รวมทั้งสิ้น")).toBe("TOTAL");
    expect(lineKind("หมูสับ")).toBe("ITEM");
    expect(lineKind("รวมมิตรทะเล")).toBe("ITEM");
  });

  it("B-3 the prompt carries the shop's own names and the matching column", () => {
    const p = buildBillImportPrompt(["น้ำเชื่อม", "หมูสับ"]);
    expect(p).toContain("น้ำเชื่อม · หมูสับ");
    expect(p).toContain("วัตถุดิบของร้าน");
    expect(p).toContain("ห้ามตั้งชื่อใหม่");
  });
});

describe("matching and judging", () => {
  const bills = draftBills(
    [
      row({ line: 2, item: "ข้าวหอมมะลิ", qty: "2", unit: "กระสอบ", unitPrice: "650", total: "1300" }),
      row({ line: 3, item: "ไข่ไก่ เบอร์2", qty: "3", unit: "แผง", unitPrice: "120", total: "380" }),
      row({ line: 4, item: "VAT 7%", total: "127.68" }),
      row({ line: 5, date: "28/10/2569", supplier: "แม็คโคร", billNo: "9", item: "หมูบดอนามัย", qty: "5.2", unit: "กก", unitPrice: "145", total: "754" }),
      row({ line: 6, date: "28/10/2569", supplier: "แม็คโคร", billNo: "9", item: "MP SWEET SYRUP 750ML", shopItem: "น้ำเชื่อม", qty: "6", unit: "ขวด", unitPrice: "39", total: "234" }),
      row({ line: 7, date: "28/10/2569", supplier: "แม็คโคร", billNo: "9", item: "พริกแห้ง", qty: "1", unit: "ถุง", unitPrice: "85" }),
      row({ line: 8, date: "28/10/2569", supplier: "แม็คโคร", billNo: "9", item: "ถุงขยะดำ", shopItem: "ถุงขยะ", qty: "1", unit: "แพ็ค", total: "59" }),
      row({ line: 9, date: "28/10/2569", supplier: "แม็คโคร", billNo: "9", item: "น้ำปลาทิพรส 700cc", qty: "1", unit: "ขวด", total: "42" }),
    ],
    CTX
  );
  const [jai, makro] = bills;
  const v = (b: typeof jai, i: number) => judgeLine(b, b.lines[i], CTX);

  it("B-4 lines group into bills; a known supplier is matched, an unknown one is new, a VAT line marks the bill", () => {
    expect(bills).toHaveLength(2);
    expect(jai).toMatchObject({ date: "2026-10-12", supplier: { kind: "NEW", name: "ร้านข้าวเจ๊ใหญ่" }, supplierHow: "NEW", hasVat: true });
    expect(makro).toMatchObject({ supplier: { kind: "EXISTING", id: "s-makro" }, supplierHow: "EXACT", hasVat: false });
  });

  it("B-5 three layers: remembered, the AI's pick from the shop's list, then a close name; nothing else is guessed", () => {
    expect(makro.lines[0].proposal).toEqual({ productId: "p-pork", how: "REMEMBERED" });
    expect(makro.lines[1].proposal).toEqual({ productId: "p-syrup", how: "AI" });
    expect(makro.lines[3]).toMatchObject({ proposal: null, aiUnknown: "ถุงขยะ", choice: { kind: "SKIP" } });
    expect(makro.lines[4].proposal).toMatchObject({ productId: "p-fish", how: "SIMILAR" });
    expect(v(makro, 3)).toEqual({ kind: "SKIP", why: "NO_MATCH" });
    expect(jai.lines[0].proposal).toEqual({ productId: "p-rice", how: "EXACT" });
    expect(v(jai, 2)).toEqual({ kind: "SKIP", why: "NOT_ITEM" });
  });

  it("B-6 quantity × price must come to the total; the person decides which figure to believe", () => {
    // ไข่ไก่ has no match, so choose it as rice for the arithmetic only.
    const eggs = { ...jai.lines[1], choice: { kind: "PRODUCT" as const, id: "p-syrup" } };
    const egg = judgeLine(jai, { ...eggs, unit: "ขวด" }, CTX);
    expect(egg.kind === "PRICE" && egg.flags).toContain("FIGURES_DISAGREE");
    expect(egg.kind === "PRICE" && egg.unitPrice).toBe(120);
    const trustTotal = judgeLine(jai, { ...eggs, unit: "ขวด", trust: "TOTAL" }, CTX);
    expect(trustTotal.kind === "PRICE" && trustTotal.unitPrice).toBeCloseTo(126.6667, 3);
    // Only a total: the system divides, the AI never does.
    const fish = v(makro, 4);
    expect(fish).toMatchObject({ kind: "PRICE", unitPrice: 42, unitName: "ขวด" });
    expect(fish.kind === "PRICE" && fish.flags).toEqual(expect.arrayContaining(["PRICE_FROM_TOTAL", "MATCH_TO_CHECK"]));
    // The sack is a unit rice already has; remembered pork is clean.
    expect(v(jai, 0)).toMatchObject({ kind: "PRICE", unitPrice: 650, unitName: "กระสอบ", unitIsNew: false, flags: [] });
    expect(v(makro, 0)).toMatchObject({ kind: "PRICE", unitPrice: 145, unitName: "kg", flags: [] });
  });

  it("B-7 a unit the product lacks: a known size converts itself, a bag must be told its size", () => {
    const grams = judgeLine(makro, { ...makro.lines[0], unit: "g", unitPrice: 0.145, qty: 100, total: 14.5 }, CTX);
    expect(grams).toMatchObject({ kind: "PRICE", unitName: "g", unitIsNew: true, ratio: 0.001 });
    expect(v(makro, 2)).toEqual({ kind: "NEED", why: "RATIO" });
    expect(judgeLine(makro, { ...makro.lines[2], ratio: 0.5 }, CTX)).toMatchObject({ kind: "PRICE", unitName: "ถุง", unitIsNew: true, ratio: 0.5, unitPrice: 85 });
  });

  it("B-8 a bill with no date, or one in the future, cannot be saved", () => {
    expect(judgeLine({ ...jai, date: null }, jai.lines[0], CTX)).toEqual({ kind: "NEED", why: "DATE" });
    expect(judgeLine({ ...jai, date: "2026-11-02" }, jai.lines[0], CTX)).toEqual({ kind: "NEED", why: "FUTURE_DATE" });
  });

  it("B-9 the save names each new supplier once, and carries the supplier's own wording", () => {
    const save = toBillSave(bills, CTX);
    expect(save.suppliers).toEqual([
      { ref: "new:ร้านข้าวเจ๊ใหญ่", id: null, name: "ร้านข้าวเจ๊ใหญ่", vat: true },
      { ref: "id:s-makro", id: "s-makro", name: "", vat: false },
    ]);
    expect(save.prices.map((p) => [p.itemName, p.unitPrice, p.date])).toEqual([
      ["ข้าวหอมมะลิ", 650, "2026-10-12"],
      ["หมูบดอนามัย", 145, "2026-10-28"],
      ["MP SWEET SYRUP 750ML", 39, "2026-10-28"],
      ["น้ำปลาทิพรส 700cc", 42, "2026-10-28"],
    ]);
  });
});

describe("the write", () => {
  let tenant: string;
  let rice: string;
  let pork: string;
  let kg: string;
  let makro: string;

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Bill Import Test" } })).id;
      makro = (await tx.supplier.create({ data: { tenantId: tenant, nameFull: "แม็คโคร" } })).id;
      const r = await tx.product.create({ data: { tenantId: tenant, sku: "P-0001", name: "ข้าวหอมมะลิ", type: "RAW", primaryDimension: "WEIGHT" } });
      rice = r.id;
      kg = (await tx.productUnit.create({ data: { productId: rice, unitName: "kg", unitDimension: "WEIGHT", toBaseRatio: 1, isBase: true } })).id;
      const p = await tx.product.create({ data: { tenantId: tenant, sku: "P-0002", name: "หมูสับ", type: "RAW", primaryDimension: "WEIGHT" } });
      pork = p.id;
      const pkg = await tx.productUnit.create({ data: { productId: pork, unitName: "kg", unitDimension: "WEIGHT", toBaseRatio: 1, isBase: true } });
      // The shop already knows pork from Makro at ฿140 since 1 Oct, as its main supplier.
      await tx.supplierProductMapping.create({
        data: { tenantId: tenant, supplierId: makro, productId: pork, orderUnitId: pkg.id, currentUnitPrice: 140, isPreferred: true, effectiveFrom: new Date("2026-10-01") },
      });
    });
  });
  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
  }, 180_000);

  it("B-10 suppliers, units and a price series are written; the shop's own row is closed, never overwritten", async () => {
    const out = await importBillsLogic(tenant, {
      suppliers: [
        { ref: "new:jai", id: null, name: "ร้านข้าวเจ๊ใหญ่", vat: true },
        { ref: "id:makro", id: makro, name: "", vat: false },
      ],
      newProducts: [{ ref: "new:egg", name: "ไข่ไก่", baseUnitName: "ฟอง" }],
      prices: [
        { supplierRef: "new:jai", product: { id: rice }, unitName: "กระสอบ", ratio: 15, unitPrice: 640, date: "2026-09-12", itemName: "ข้าวหอมมะลิ 15กก" },
        { supplierRef: "new:jai", product: { id: rice }, unitName: "กระสอบ", ratio: 15, unitPrice: 640, date: "2026-09-26", itemName: "ข้าวหอมมะลิ 15กก" },
        { supplierRef: "new:jai", product: { id: rice }, unitName: "กระสอบ", ratio: 15, unitPrice: 650, date: "2026-10-12", itemName: "ข้าวหอมมะลิ 15กก" },
        { supplierRef: "id:makro", product: { id: pork }, unitName: "kg", ratio: null, unitPrice: 135, date: "2026-09-20", itemName: "หมูบดอนามัย" },
        { supplierRef: "id:makro", product: { id: pork }, unitName: "kg", ratio: null, unitPrice: 145, date: "2026-10-28", itemName: "หมูบดอนามัย" },
        { supplierRef: "new:jai", product: { ref: "new:egg" }, unitName: "แผง", ratio: 30, unitPrice: 120, date: "2026-10-12", itemName: "ไข่ไก่ เบอร์2" },
      ],
    });
    expect(out).toEqual({ suppliersCreated: 1, productsCreated: 1, unitsAdded: 2, pricesWritten: 4, skippedOlder: 1 });

    const jai = await prismaBypass.supplier.findFirstOrThrow({ where: { tenantId: tenant, nameFull: "ร้านข้าวเจ๊ใหญ่" } });
    expect(jai.isVatRegistered).toBe(true);

    // Rice: 640 twice is one row, then 650 — the newest is the main supplier (rice had none).
    const riceRows = await prismaBypass.supplierProductMapping.findMany({ where: { productId: rice, deletedAt: null }, orderBy: { effectiveFrom: "asc" }, include: { orderUnit: true } });
    expect(riceRows.map((m) => [m.effectiveFrom.toISOString().slice(0, 10), m.effectiveTo?.toISOString().slice(0, 10) ?? null, Number(m.currentUnitPrice), m.orderUnit?.unitName, m.isPreferred, m.supplierItemName])).toEqual([
      ["2026-09-12", "2026-10-11", 640, "กระสอบ", false, "ข้าวหอมมะลิ 15กก"],
      ["2026-10-12", null, 650, "กระสอบ", true, "ข้าวหอมมะลิ 15กก"],
    ]);
    const sack = await prismaBypass.productUnit.findFirstOrThrow({ where: { productId: rice, unitName: "กระสอบ" } });
    expect(Number(sack.toBaseRatio)).toBe(15);

    // Pork: 135 (20 Sep) is older than the shop's 140 (1 Oct) and is kept out; 145 closes the shop's row.
    const porkRows = await prismaBypass.supplierProductMapping.findMany({ where: { productId: pork, deletedAt: null }, orderBy: { effectiveFrom: "asc" } });
    expect(porkRows.map((m) => [m.effectiveFrom.toISOString().slice(0, 10), m.effectiveTo?.toISOString().slice(0, 10) ?? null, Number(m.currentUnitPrice), m.isPreferred])).toEqual([
      ["2026-10-01", "2026-10-27", 140, true],
      ["2026-10-28", null, 145, false],
    ]);

    // No stock and no expense — the whole point.
    expect(await prismaBypass.stockMovement.count({ where: { tenantId: tenant } })).toBe(0);
    expect(await prismaBypass.expense.count({ where: { tenantId: tenant } })).toBe(0);
    expect(kg).toBeTruthy();
  });

  it("B-11 the next bill from the same supplier is matched by the remembered wording", async () => {
    const ctx = await getBillContextLogic(tenant);
    const [bill] = draftBills([row({ supplier: "แม็คโคร", date: "29/10/2569", item: "หมูบดอนามัย", qty: "1", unit: "กก", unitPrice: "146" })], ctx);
    expect(bill.lines[0].proposal).toEqual({ productId: pork, how: "REMEMBERED" });
  });

  it("B-11b an order to Makro can name pork the way Makro does", async () => {
    const branch = await withRlsBypass((tx) => tx.branch.create({ data: { tenantId: tenant, name: "สาขาหลัก", code: "MAIN" } }));
    const names = await getSupplierItemNamesLogic(tenant, makro, [pork, rice], branch.id, new Date("2026-10-29T03:00:00Z"));
    expect([...names]).toEqual([[pork, "หมูบดอนามัย"]]);
  });

  it("B-12 a unit with no size writes nothing at all — not even the supplier", async () => {
    const before = await prismaBypass.supplier.count({ where: { tenantId: tenant } });
    await expect(
      importBillsLogic(tenant, {
        suppliers: [{ ref: "new:x", id: null, name: "ร้านใหม่ " + randomUUID().slice(0, 4), vat: false }],
        newProducts: [],
        prices: [{ supplierRef: "new:x", product: { id: rice }, unitName: "ถุงใหญ่", ratio: null, unitPrice: 80, date: "2026-10-29", itemName: "ข้าวถุงใหญ่" }],
      })
    ).rejects.toBeInstanceOf(UnitNeedsRatioError);
    expect(await prismaBypass.supplier.count({ where: { tenantId: tenant } })).toBe(before);
  });
});

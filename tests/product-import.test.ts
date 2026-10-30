// ============================================================
// คิวงานข้อ 5 — products from a file the shop's own AI prepared
// ============================================================
// Kong 2026-10-30 (mockup R3vZEuvaWr2gWQosAgYfkA round 3): the AI only
// reshapes; matching, units and the decision to write happen here, and nothing
// is written until the person presses save.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { prismaBypass, withRlsBypass } from "@/lib/db-admin";
import {
  FROM_METHOD_MARK,
  buildProductImportPrompt,
  draftFromRaw,
  draftStatus,
  matchDrafts,
  nameSimilarity,
  normalizeUnit,
  readProductTable,
  splitPastedTable,
  toCreate,
  type RawProductRow,
  type UnitTemplate,
} from "@/lib/product-import";
import { ImportUnitError, getUnitTemplatesForImport, importProductsLogic, readImportFile } from "@/server/product-import";
import { sweepTestTenants } from "./support/sweep";

const TEMPLATES: UnitTemplate[] = [
  { unitName: "g", unitDimension: "WEIGHT" },
  { unitName: "kg", unitDimension: "WEIGHT" },
  { unitName: "ml", unitDimension: "VOLUME" },
  { unitName: "ขวด", unitDimension: "COUNT" },
  { unitName: "มัด", unitDimension: "COUNT" },
];
const CATS = [
  { id: "c-meat", label: "เนื้อสัตว์" },
  { id: "c-dry", label: "ของแห้งและเครื่องปรุง" },
];
const raw = (over: Partial<RawProductRow>): RawProductRow => ({
  line: 2,
  name: "",
  category: "",
  buyUnit: "",
  packQty: "",
  packUnit: "",
  original: "",
  unsure: "",
  ...over,
});
const draft = (over: Partial<RawProductRow>) => draftFromRaw(raw(over), { templates: TEMPLATES, categories: CATS });

describe("reading what the AI gave back", () => {
  it("I-1 a table copied off the screen is tab-separated; a markdown table drops its --- row", () => {
    expect(splitPastedTable("ชื่อ\tซื้อเป็น\nหมูสับ\tกก.")).toEqual([["ชื่อ", "ซื้อเป็น"], ["หมูสับ", "กก."]]);
    expect(splitPastedTable("| ชื่อ | ซื้อเป็น |\n|---|:---:|\n| หมูสับ | กก. |")).toEqual([["ชื่อ", "ซื้อเป็น"], ["หมูสับ", "กก."]]);
    expect(splitPastedTable("ชื่อ | ซื้อเป็น\nหมูสับ | กก.")).toEqual([["ชื่อ", "ซื้อเป็น"], ["หมูสับ", "กก."]]);
    expect(splitPastedTable('ชื่อ,ซื้อเป็น\n"ข้าว, หอมมะลิ",กระสอบ')).toEqual([["ชื่อ", "ซื้อเป็น"], ["ข้าว, หอมมะลิ", "กระสอบ"]]);
  });

  it("I-2 the header is found under a title line, and the table stops where the recipes begin", () => {
    const grid = splitPastedTable(
      [
        "แผ่น “วัตถุดิบ”",
        "| ชื่อ | หมวด | ซื้อเป็น | บรรจุ | หน่วยในบรรจุ | ข้อความเดิม | ไม่แน่ใจ |",
        "|---|---|---|---|---|---|---|",
        "| ข้าวหอมมะลิ | ของแห้งและเครื่องปรุง | กระสอบ | 15 | กก. | ข้าวหอมมะลิ กระสอบ 15 กก. 650 | |",
        "| | | | | | | |",
        "| พริก | | | | | | อ่านไม่ออก |",
        "แผ่น “สูตร”",
        "| ชื่อเมนู | ได้ | หน่วยที่ได้ | วัตถุดิบ | ปริมาณ | หน่วย | ข้อความเดิม | ไม่แน่ใจ |",
        "| ข้าวผัดหมู | 1 | จาน | หมูสับ | 1 | ขีด | หมูสับ 1 ขีด | |",
      ].join("\n")
    );
    const t = readProductTable(grid);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.rows.map((r) => r.name)).toEqual(["ข้าวหอมมะลิ", "พริก"]);
    expect(t.rows[0]).toMatchObject({ category: "ของแห้งและเครื่องปรุง", buyUnit: "กระสอบ", packQty: "15", packUnit: "กก." });
    expect(t.rows[1].unsure).toBe("อ่านไม่ออก");
  });

  it("I-3 a file with no products table says which table it does have", () => {
    expect(readProductTable([["ชื่อเมนู", "วัตถุดิบ"], ["ข้าวผัด", "หมู"]])).toEqual({ ok: false, reason: "ONLY_RECIPES" });
    expect(readProductTable([["menu", "qty"]])).toEqual({ ok: false, reason: "NO_HEADER" });
    expect(readProductTable([["ชื่อ", "ซื้อเป็น"], ["", ""]])).toEqual({ ok: false, reason: "EMPTY" });
  });
});

describe("one row, decided", () => {
  it("I-4 spellings of one size fold into the system's name; nothing converts a kitchen unit", () => {
    expect(normalizeUnit("กก.")).toBe("kg");
    expect(normalizeUnit(" กิโล ")).toBe("kg");
    expect(normalizeUnit("ซีซี")).toBe("ml");
    expect(normalizeUnit("แพค")).toBe("แพ็ค");
    expect(normalizeUnit("ทัพพี")).toBe("ทัพพี");
    expect(normalizeUnit("  ")).toBeNull();
  });

  it("I-5 a sack of 15 kg is counted in kg and bought by the sack", () => {
    const d = draft({ name: "ข้าวหอมมะลิ", buyUnit: "กระสอบ", packQty: "15", packUnit: "กก.", category: "ของแห้งและเครื่องปรุง" });
    expect(d).toMatchObject({ baseUnit: "kg", extraUnit: "กระสอบ", extraRatio: 15, categoryId: "c-dry", categoryText: "" });
    expect(toCreate(d)).toEqual({ name: "ข้าวหอมมะลิ", baseUnitName: "kg", categoryId: "c-dry", extraUnit: { unitName: "กระสอบ", toBaseRatio: 15 } });
  });

  it("I-6 a unit the system does not know is a question, not a guess", () => {
    const d = draft({ name: "กะเพรา", buyUnit: "กำ" });
    expect(d).toMatchObject({ baseUnit: null, extraUnit: "กำ", extraRatio: null });
    expect(draftStatus(d, null, TEMPLATES)).toEqual({ kind: "NEED", why: "UNIT" });
    // The person picks มัด and leaves the ratio empty: กำ is dropped, not invented.
    const fixed = { ...d, baseUnit: "มัด" };
    expect(draftStatus(fixed, null, TEMPLATES)).toEqual({ kind: "CREATE", review: false });
    expect(toCreate(fixed).extraUnit).toBeNull();
  });

  it("I-7 a pack the AI could not read is flagged, and the row falls back to the buy unit", () => {
    const d = draft({ name: "ไข่", buyUnit: "ขวด", packQty: "2-3", packUnit: "ขวด" });
    expect(d).toMatchObject({ packUnreadable: true, baseUnit: "ขวด", extraUnit: null });
    expect(draftStatus(d, null, TEMPLATES)).toEqual({ kind: "CREATE", review: true });
  });

  it("I-8 no name must be filled or skipped; the AI's doubt and the method marker are carried", () => {
    expect(draftStatus(draft({ buyUnit: "ขวด" }), null, TEMPLATES)).toEqual({ kind: "NEED", why: "NAME" });
    const m = draft({ name: "น้ำมันหอย", unsure: FROM_METHOD_MARK, buyUnit: "ขวด" });
    expect(m.fromMethod).toBe(true);
    expect(draftStatus(m, null, TEMPLATES)).toEqual({ kind: "CREATE", review: true });
    expect(draftStatus({ ...m, skip: true }, null, TEMPLATES)).toEqual({ kind: "SKIP", why: "PRESSED" });
  });

  it("I-9 a category the shop does not have is left empty and shown", () => {
    const d = draft({ name: "หมู", buyUnit: "kg", category: "เนื้อหมู" });
    expect(d).toMatchObject({ categoryId: null, categoryText: "เนื้อหมู" });
  });
});

describe("matching against the shop's products", () => {
  const existing = [
    { id: "p1", name: "หมูสับ", sku: "P-0001" },
    { id: "p2", name: "กะเพรา", sku: "P-0002" },
  ];

  it("I-10 the same name is skipped; a close name is a question that defaults to 'the same'", () => {
    expect(nameSimilarity("กระเพรา", "กะเพรา")).toBeGreaterThanOrEqual(0.4);
    expect(nameSimilarity("หมู", "หมูสับ")).toBeLessThan(0.4);
    const drafts = [draft({ name: " หมูสับ ", buyUnit: "kg" }), draft({ name: "กระเพรา", buyUnit: "มัด" }), draft({ name: "หมู", buyUnit: "kg" })];
    const m = matchDrafts(drafts, existing);
    expect(m[0]).toMatchObject({ kind: "EXISTS", product: { id: "p1" } });
    expect(m[1]).toMatchObject({ kind: "SIMILAR", product: { id: "p2" } });
    expect(m[2]).toBeNull();
    expect(draftStatus(drafts[1], m[1], TEMPLATES)).toEqual({ kind: "SKIP", why: "SAME_AS_SIMILAR" });
    expect(draftStatus({ ...drafts[1], sameAsSimilar: false }, m[1], TEMPLATES)).toEqual({ kind: "CREATE", review: true });
  });

  it("I-11 the second row with a name is a duplicate — unless the first was skipped", () => {
    const a = { ...draft({ name: "พริก", buyUnit: "kg" }), line: 2 };
    const b = { ...draft({ name: "พริก", buyUnit: "kg" }), line: 5 };
    expect(matchDrafts([a, b], [])[1]).toEqual({ kind: "DUPLICATE", line: 2 });
    expect(matchDrafts([{ ...a, skip: true }, b], [])[1]).toBeNull();
  });

  it("I-12 the prompt lists the shop's own categories and asks for the method ingredients", () => {
    const p = buildProductImportPrompt(["เนื้อสัตว์", "ผักและผลไม้"]);
    expect(p).toContain("เนื้อสัตว์ · ผักและผลไม้");
    expect(p).toContain(FROM_METHOD_MARK);
    expect(p).toContain("ไม่ต้องใส่ราคาและชื่อผู้ขาย");
  });
});

describe("the server side", () => {
  let tenant: string;
  let meat: string;

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Product Import Test" } })).id;
      meat = (await tx.category.create({ data: { tenantId: tenant, account: "COGS", accountingSection: "อาหาร", groupName: "เนื้อสัตว์" } })).id;
      await tx.product.create({ data: { tenantId: tenant, sku: "P-0007", name: "หมูสับ", type: "RAW", primaryDimension: "WEIGHT" } });
    });
  });
  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
  }, 180_000);

  it("I-13 an .xlsx is read from its products sheet, and its recipes sheet is counted", async () => {
    const wb = new ExcelJS.Workbook();
    const p = wb.addWorksheet("วัตถุดิบ");
    p.addRow(["ชื่อ", "หมวด", "ซื้อเป็น", "บรรจุ", "หน่วยในบรรจุ", "ข้อความเดิม", "ไม่แน่ใจ"]);
    p.addRow(["น้ำปลา", "ของแห้งและเครื่องปรุง", "ลัง", 12, "ขวด", "น้ำปลา ลัง 12 ขวด", ""]);
    const r = wb.addWorksheet("สูตร");
    r.addRow(["ชื่อเมนู", "ได้", "หน่วยที่ได้", "วัตถุดิบ", "ปริมาณ", "หน่วย", "ข้อความเดิม", "ไม่แน่ใจ"]);
    r.addRow(["ข้าวผัดหมู", 1, "จาน", "หมูสับ", 1, "ขีด", "", ""]);
    r.addRow(["ข้าวผัดหมู", 1, "จาน", "ข้าว", 1, "ทัพพี", "", ""]);
    r.addRow(["กะเพราหมู", 1, "จาน", "หมูสับ", 1, "ขีด", "", ""]);
    const read = await readImportFile(new Uint8Array(await wb.xlsx.writeBuffer()), "จาก-ai.xlsx");
    expect("error" in read).toBe(false);
    if ("error" in read) return;
    expect(read.recipeMenus).toBe(2);
    expect(read.table.ok && read.table.rows[0]).toMatchObject({ name: "น้ำปลา", buyUnit: "ลัง", packQty: "12", packUnit: "ขวด" });
  });

  it("I-14 the reviewed list is created in one go: units, the buy unit as default, skus in order", async () => {
    const out = await importProductsLogic(tenant, [
      { name: "ข้าวหอมมะลิ", baseUnitName: "kg", categoryId: null, extraUnit: { unitName: "กระสอบ", toBaseRatio: 15 } },
      { name: "สันคอหมู", baseUnitName: "kg", categoryId: meat, extraUnit: null },
      { name: " หมูสับ ", baseUnitName: "kg", categoryId: meat, extraUnit: null },
    ]);
    expect(out.skipped).toEqual([" หมูสับ "]);
    expect(out.created.map((p) => [p.name, p.sku])).toEqual([
      ["ข้าวหอมมะลิ", "P-0008"],
      ["สันคอหมู", "P-0009"],
    ]);
    const rice = await prismaBypass.product.findFirstOrThrow({ where: { id: out.created[0].id }, include: { productUnits: { orderBy: { displayOrder: "asc" } } } });
    expect(rice).toMatchObject({ type: "RAW", primaryDimension: "WEIGHT", categoryId: null });
    expect(rice.productUnits.map((u) => [u.unitName, u.toBaseRatio.toNumber(), u.isBase, u.isDefaultBuyUnit, u.source])).toEqual([
      ["kg", 1, true, false, "system"],
      ["กระสอบ", 15, false, true, "custom"],
    ]);
    const pork = await prismaBypass.product.findFirstOrThrow({ where: { id: out.created[1].id }, include: { productUnits: true } });
    expect(pork.categoryId).toBe(meat);
    expect(pork.productUnits.map((u) => [u.unitName, u.isDefaultBuyUnit])).toEqual([["kg", true]]);
  });

  it("I-15 a unit that cannot be a stock unit is refused before anything is written", async () => {
    const before = await prismaBypass.product.count({ where: { tenantId: tenant } });
    await expect(
      importProductsLogic(tenant, [
        { name: "พริกขี้หนู", baseUnitName: "kg", categoryId: null, extraUnit: null },
        { name: "ข้าวสวย", baseUnitName: "ทัพพี", categoryId: null, extraUnit: null },
      ])
    ).rejects.toBeInstanceOf(ImportUnitError);
    expect(await prismaBypass.product.count({ where: { tenantId: tenant } })).toBe(before);
  });

  it("I-15b a failure AFTER the products were inserted takes them back out — all or nothing", async () => {
    const before = await prismaBypass.product.count({ where: { tenantId: tenant } });
    // The units insert overflows Decimal(15,6) — the products insert has already run.
    await expect(
      importProductsLogic(tenant, [
        { name: "ซีอิ๊วขาว", baseUnitName: "ml", categoryId: null, extraUnit: null },
        { name: "น้ำตาลทราย", baseUnitName: "kg", categoryId: null, extraUnit: { unitName: "กระสอบ", toBaseRatio: 1e12 } },
      ])
    ).rejects.toThrow();
    expect(await prismaBypass.product.count({ where: { tenantId: tenant } })).toBe(before);
  });

  it("I-16 the units the review offers are the system's templates", async () => {
    const units = await getUnitTemplatesForImport();
    expect(units.map((u) => u.unitName)).toEqual(expect.arrayContaining(["kg", "g", "ml", "l", "ขวด", "มัด"]));
  });
});

// ============================================================
// Raw Excel export (Kong 2026-10-31: "ดึงข้อมูลดิบเป็น Excel")
// ============================================================
// The file must never show more than the page it comes from:
//   R1 a reader sees only the branches in their reach — a branch id outside
//      it matches nothing, even when asked for by name;
//   R2 supplier prices on the product sheet need the cost ticket;
//   R3 a blind count's expected quantity reaches a cost reader only.
// And it must be the data as recorded: voided receipts are left out unless
// asked for, and the dialog's count is the number of rows in the file.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prismaBypass, withRlsBypass } from "@/lib/db-admin";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { goodsReceiptInputSchema, voidGoodsReceiptInputSchema } from "@/lib/validations/goods-receipt";
import { confirmGoodsReceiptLogic, createGoodsReceiptLogic, voidGoodsReceiptLogic } from "@/server/goods-receipt";
import { closeStockCountInputSchema, openStockCountInputSchema, saveStockCountLineInputSchema } from "@/lib/validations/stock-count";
import { closeStockCountLogic, openStockCountLogic, saveStockCountLineLogic } from "@/server/stock-count";
import { rawExportQuerySchema } from "@/lib/validations/raw-export";
import { buildRawExportLogic, countRawExportLogic, type ExportSheet } from "@/server/raw-export";
import { getStockCardLogic } from "@/server/stock-card";
import { sweepTestTenants } from "./support/sweep";
import { computeBangkokToday } from "@/lib/bangkok-date";

describe("raw Excel export", () => {
  let tenant: string;
  let ari: string;
  let lad: string;
  let user: string;
  let supplierId: string;
  let pork: ProductWithUnits;
  let voidedGr: string;

  const ALL = { allBranches: true, allowedBranchIds: [] as string[] };
  const ARI_ONLY = () => ({ allBranches: false, allowedBranchIds: [ari] });
  // Bangkok's today, as the page hands it to the dialog — a UTC date is
  // yesterday between midnight and 07:00 in Bangkok.
  const today = computeBangkokToday().toISOString().slice(0, 10);
  const monthAgo = new Date(computeBangkokToday().getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const unit = (p: ProductWithUnits, name: string) => p.productUnits.find((u) => u.unitName === name)!.id;
  const q = (extra: Record<string, string>) => rawExportQuerySchema.parse({ from: monthAgo, to: today, ...extra });
  const sheet = (sheets: ExportSheet[], name: string) => sheets.find((s) => s.name === name)!;
  const col = (s: ExportSheet, header: string) => s.columns.findIndex((c) => c.header === header);

  const receive = async (branchId: string, kg: number, price: number) => {
    const gr = await createGoodsReceiptLogic(
      tenant,
      goodsReceiptInputSchema.parse({
        submitKey: randomUUID(),
        branchId,
        supplierId,
        purchaseOrderId: null,
        invoiceNo: null,
        receivedAt: new Date(Date.now() - 60_000),
        notes: null,
        lines: [{ purchaseOrderItemId: null, productId: pork.id, receivedUnitId: unit(pork, "kg"), qtyReceivedActual: kg, unitPriceActual: price, notes: null }],
      }),
      user
    );
    await confirmGoodsReceiptLogic(tenant, gr.id, user);
    return gr.id;
  };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Raw Export Test" } })).id;
      ari = (await tx.branch.create({ data: { tenantId: tenant, name: "อารีย์", code: "ARY" } })).id;
      lad = (await tx.branch.create({ data: { tenantId: tenant, name: "ลาดพร้าว", code: "LAD" } })).id;
      user = (await tx.user.create({ data: { email: `raw-export-${randomUUID()}@example.com`, name: "เจ้าของ" } })).id;
      supplierId = (await tx.supplier.create({ data: { tenantId: tenant, code: "S1", nameFull: "ตลาดสด" } })).id;
      await tx.department.create({ data: { tenantId: tenant, name: "ครัว", code: "MAIN" } });
    });
    pork = await createProductLogic(
      tenant,
      productInputSchema.parse({ name: `EXP-pork-${randomUUID().slice(0, 6)}`, primaryDimension: "WEIGHT", baseUnitName: "kg", additionalUnits: [] })
    );
    await withRlsBypass((tx) =>
      tx.supplierProductMapping.create({
        data: { tenantId: tenant, supplierId, productId: pork.id, orderUnitId: unit(pork, "kg"), currentUnitPrice: 150, isPreferred: true, effectiveFrom: new Date("2026-01-01") },
      })
    );
    await receive(ari, 5, 150);
    await receive(lad, 3, 160);
    voidedGr = await receive(ari, 2, 155);
    await voidGoodsReceiptLogic(tenant, voidGoodsReceiptInputSchema.parse({ id: voidedGr, voidReason: "รับซ้ำ" }), user);

    // A blind count at Ari: the counter never saw the system's 5 kg.
    const sheetId = (
      await openStockCountLogic(tenant, openStockCountInputSchema.parse({ branchId: ari, countDate: today, showExpected: false, notes: null }), user)
    ).id;
    await saveStockCountLineLogic(
      tenant,
      saveStockCountLineInputSchema.parse({ stockCountId: sheetId, productId: pork.id, mode: "new", entries: [{ productUnitId: unit(pork, "kg"), qtyInUnit: 4 }], notes: null }),
      { userId: user, canCloseAny: true, reach: ALL }
    );
    await closeStockCountLogic(tenant, closeStockCountInputSchema.parse({ id: sheetId, prices: [] }), { userId: user, canCloseAny: true, reach: ALL });
  }, 180_000);

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
  });

  it("X1 receipts: a reader with one branch gets that branch only, even when the URL names another (R1)", async () => {
    const mine = await buildRawExportLogic({ tenantId: tenant, reach: ARI_ONLY(), withMoney: true, q: q({ dataset: "goods-receipts" }) });
    expect(sheet(mine, "รายการ").rows.map((r) => r[col(sheet(mine, "รายการ"), "สาขา")])).toEqual(["อารีย์"]);
    const asked = await buildRawExportLogic({ tenantId: tenant, reach: ARI_ONLY(), withMoney: true, q: q({ dataset: "goods-receipts", branch: lad }) });
    expect(sheet(asked, "รายการ").rows).toEqual([]);
    const every = await buildRawExportLogic({ tenantId: tenant, reach: ALL, withMoney: true, q: q({ dataset: "goods-receipts" }) });
    expect(sheet(every, "รายการ").rows.map((r) => r[col(sheet(every, "รายการ"), "สาขา")]).sort()).toEqual(["ลาดพร้าว", "อารีย์"]);
  });

  it("X2 receipts: a voided receipt is left out unless its status is asked for, and the count says so", async () => {
    const ctx = { tenantId: tenant, reach: ALL, withMoney: true };
    const plain = await buildRawExportLogic({ ...ctx, q: q({ dataset: "goods-receipts" }) });
    const statuses = sheet(plain, "ใบรับสินค้า").rows.map((r) => r[col(sheet(plain, "ใบรับสินค้า"), "สถานะ")]);
    expect(statuses).toEqual(["รับเข้าคลังแล้ว", "รับเข้าคลังแล้ว"]);
    expect(await countRawExportLogic({ ...ctx, q: q({ dataset: "goods-receipts" }) })).toEqual({ docs: 2, rows: 2, voidedLeftOut: true });

    const voided = await buildRawExportLogic({ ...ctx, q: q({ dataset: "goods-receipts", status: "VOIDED" }) });
    // The voided receipt keeps its own line once — its reversal line is not a second row.
    expect(sheet(voided, "รายการ").rows.map((r) => r[col(sheet(voided, "รายการ"), "จำนวน")])).toEqual([2]);
  });

  it("X3 expenses: each confirmed receipt's bill, narrowed to the reach, and the count matches the rows", async () => {
    const ctx = { tenantId: tenant, reach: ARI_ONLY(), withMoney: true, q: q({ dataset: "expenses" }) };
    const sheets = await buildRawExportLogic(ctx);
    const bills = sheet(sheets, "บิล");
    expect(bills.rows.map((r) => r[col(bills, "สาขา")])).toEqual(["อารีย์"]);
    expect(bills.rows.map((r) => r[col(bills, "ยอดก่อน VAT")])).toEqual([750]);
    const c = await countRawExportLogic(ctx);
    expect({ docs: c.docs, rows: c.rows }).toEqual({ docs: bills.rows.length, rows: sheet(sheets, "รายการ").rows.length });
  });

  it("X4 a blind count's expected quantity reaches a cost reader only (R3)", async () => {
    const read = async (withMoney: boolean) => {
      const items = sheet(await buildRawExportLogic({ tenantId: tenant, reach: ALL, withMoney, q: q({ dataset: "stock-counts" }) }), "รายการ");
      const r = items.rows[0];
      return [r[col(items, "จำนวนในระบบ")], r[col(items, "นับได้")], r[col(items, "ส่วนต่าง (นับได้ − ในระบบ)")]];
    };
    expect(await read(false)).toEqual([null, 4, null]);
    expect(await read(true)).toEqual([5, 4, -1]);
  });

  it("X5 supplier prices are a second sheet for a cost reader only (R2)", async () => {
    const without = await buildRawExportLogic({ tenantId: tenant, reach: ALL, withMoney: false, q: rawExportQuerySchema.parse({ dataset: "products" }) });
    expect(without.map((s) => s.name)).toEqual(["สินค้า"]);
    const withPrices = await buildRawExportLogic({ tenantId: tenant, reach: ALL, withMoney: true, q: rawExportQuerySchema.parse({ dataset: "products" }) });
    expect(withPrices.map((s) => s.name)).toEqual(["สินค้า", "ราคาที่จ่ายล่าสุด", "ราคาตามผู้ขาย"]);
    // The latest CONFIRMED receipt — not the voided one at ฿155 that came after it.
    const paid = sheet(withPrices, "ราคาที่จ่ายล่าสุด");
    expect(paid.rows.map((r) => r[col(paid, "ราคาต่อหน่วย")])).toEqual([160]);
    const list = sheet(withPrices, "ราคาตามผู้ขาย");
    expect(list.rows.map((r) => r[col(list, "ราคาปัจจุบัน")])).toEqual([150]);
  });

  it("X6 stock movements name each document exactly as the stock card does", async () => {
    const moves = sheet(await buildRawExportLogic({ tenantId: tenant, reach: ALL, withMoney: false, q: q({ dataset: "stock-movements", branch: ari }) }), "ความเคลื่อนไหวสต๊อก");
    const card = (await getStockCardLogic(tenant, { productId: pork.id, branchId: ari, from: new Date(`${monthAgo}T00:00:00Z`), to: new Date(`${today}T00:00:00Z`), withCost: false }))!;
    expect(moves.rows.map((r) => r[col(moves, "เอกสาร")])).toEqual(card.rows.map((r) => r.doc?.label ?? null));
    expect(moves.rows.map((r) => r[col(moves, "จำนวน (+ เข้า / − ออก)")])).toEqual(card.rows.map((r) => r.qty));
  });

  it("X7 a period longer than 12 months, or with no dates, is refused before any read", () => {
    expect(rawExportQuerySchema.safeParse({ dataset: "sales", from: "2025-01-01", to: "2026-03-01" }).success).toBe(false);
    expect(rawExportQuerySchema.safeParse({ dataset: "sales" }).success).toBe(false);
    expect(rawExportQuerySchema.safeParse({ dataset: "products" }).success).toBe(true);
  });
});

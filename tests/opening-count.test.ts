// ============================================================
// Rule PG4 — the opening count (นับเปิดระบบ), Kong 2026-10-30 chose A
// ============================================================
// A branch's first closed count is the stock it starts from. Each line that
// enters stock needs a price, or the shelf is worth ฿0 and gross profit stays
// "—" (PG1). The price is filled in at close — the cost the ledger already
// knows, else the price set on a supplier — and written as the line's cost.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prismaBypass, withRlsBypass } from "@/lib/db-admin";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { createStockAdjustmentLogic } from "@/server/stock-movement";
import { createStockAdjustmentInputSchema } from "@/lib/validations/stock-movement";
import { closeStockCountInputSchema, openStockCountInputSchema, saveStockCountLineInputSchema } from "@/lib/validations/stock-count";
import {
  OpeningPriceTargetError,
  closeStockCountLogic,
  declareOpeningPricesLogic,
  getCountVarianceCostsLogic,
  getOpeningPricesLogic,
  getUnpricedOpeningLogic,
  isOpeningCountLogic,
  openStockCountLogic,
  openingPricesWaitingLogic,
  saveStockCountLineLogic,
} from "@/server/stock-count";
import { goodsReceiptInputSchema } from "@/lib/validations/goods-receipt";
import { confirmGoodsReceiptLogic, createGoodsReceiptLogic } from "@/server/goods-receipt";
import { getProductCostsLogic } from "@/server/stock-cost";
import { getProductCostsQuerySchema } from "@/lib/validations/stock-cost";
import { sweepTestTenants } from "./support/sweep";
import { costAccessFor } from "@/lib/permissions/cost-access";

describe("rule PG4 — the opening count", () => {
  let tenant: string;
  let thonglor: string;
  let ari: string;
  let user: string;
  let rice: ProductWithUnits; // a supplier sells it by the sack
  let salt: ProductWithUnits; // nobody knows its price
  let pork: ProductWithUnits; // already priced in Ari's ledger

  const ALL = { allBranches: true, allowedBranchIds: [] as string[] };
  const actor = () => ({ userId: user, canCloseAny: true, reach: ALL });
  const unit = (p: ProductWithUnits, name: string) => p.productUnits.find((u) => u.unitName === name)!.id;
  const product = (tag: string) =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `OPN-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "กระสอบ", toBaseRatio: 25 }],
      })
    );
  const open = (branchId: string) =>
    openStockCountLogic(tenant, openStockCountInputSchema.parse({ branchId, countDate: new Date().toISOString().slice(0, 10), notes: null }), user);
  const count = (stockCountId: string, p: ProductWithUnits, kg: number) =>
    saveStockCountLineLogic(
      tenant,
      saveStockCountLineInputSchema.parse({ stockCountId, productId: p.id, mode: "new", entries: [{ productUnitId: unit(p, "kg"), qtyInUnit: kg }], notes: null }),
      actor()
    );
  const costAt = async (p: ProductWithUnits, branchId: string) =>
    (await getProductCostsLogic(tenant, getProductCostsQuerySchema.parse({ productIds: [p.id], branchId }))).get(p.id)!;

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Opening Count Test" } });
      tenant = t.id;
      thonglor = (await tx.branch.create({ data: { tenantId: tenant, name: "ทองหล่อ", code: "THL" } })).id;
      ari = (await tx.branch.create({ data: { tenantId: tenant, name: "อารีย์", code: "ARY" } })).id;
      user = (await tx.user.create({ data: { email: `opening-${randomUUID()}@example.com`, name: "เจ้าของ" } })).id;
    });
    rice = await product("rice");
    salt = await product("salt");
    pork = await product("pork");
    await withRlsBypass(async (tx) => {
      const supplier = await tx.supplier.create({ data: { tenantId: tenant, code: "S1", nameFull: "ร้านข้าว" } });
      await tx.supplierProductMapping.create({
        data: { tenantId: tenant, supplierId: supplier.id, productId: rice.id, orderUnitId: unit(rice, "กระสอบ"), currentUnitPrice: 1250, isPreferred: true, effectiveFrom: new Date("2026-01-01") },
      });
    });
    // Ari already holds pork at ฿180/kg — a gain someone priced by hand.
    await createStockAdjustmentLogic(
      tenant,
      createStockAdjustmentInputSchema.parse({
        submitKey: randomUUID(),
        productId: pork.id,
        branchId: ari,
        type: "ADJUST_GAIN",
        reason: "RECOUNT",
        inputQty: 2,
        inputUnitId: unit(pork, "kg"),
        occurredAt: new Date(Date.now() - 3_600_000),
        notes: null,
        costDeclaration: { unitCost: 180, unitId: unit(pork, "kg"), note: null },
      }),
      user
    );
  }, 120_000);

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await prismaBypass.user.deleteMany({ where: { id: user } });
  }, 180_000);

  it("PG4-1 the close sheet fills in the supplier's price, and leaves a price nobody knows empty", async () => {
    const sheet = await open(thonglor);
    expect(await isOpeningCountLogic(tenant, sheet.id)).toBe(true);
    await count(sheet.id, rice, 50);
    await count(sheet.id, salt, 3);

    const lines = (await getOpeningPricesLogic(tenant, sheet.id))!;
    const r = lines.find((l) => l.productId === rice.id)!;
    expect(r).toMatchObject({ qty: "50", unitId: unit(rice, "กระสอบ"), unitCost: "1250", source: "SUPPLIER" });
    const s = lines.find((l) => l.productId === salt.id)!;
    expect(s).toMatchObject({ unitCost: null, source: null });
  });

  it("PG4-2 closing writes the prices as the cost of what was found — per sack becomes per kilo", async () => {
    const sheet = (await prismaBypass.stockCount.findFirstOrThrow({ where: { tenantId: tenant, branchId: thonglor, status: "DRAFT" } })).id;
    await closeStockCountLogic(
      tenant,
      closeStockCountInputSchema.parse({ id: sheet, prices: [{ productId: rice.id, unitId: unit(rice, "กระสอบ"), unitCost: "1250" }] }),
      actor()
    );
    const r = await costAt(rice, thonglor);
    expect(r.costPerBaseUnit.toString()).toBe("50");
    expect(r.inventoryValue.toString()).toBe("2500");
    expect(r.hasUnpricedLayers).toBe(false);
    // Salt was left unpriced: the warning was a warning, and the shelf says so.
    expect((await costAt(salt, thonglor)).hasUnpricedLayers).toBe(true);
    expect(await isOpeningCountLogic(tenant, sheet)).toBe(true);
  });

  it("PG4-2b the count's money card leaves a product nobody priced OUT — it is unknown, not ฿0 (Kong 2026-10-30)", async () => {
    const costs = (await getCountVarianceCostsLogic(tenant, costAccessFor("owner"), thonglor, [rice.id, salt.id]))!;
    expect(costs[rice.id]).toBe("50");
    expect(salt.id in costs).toBe(false);
  });

  it("PG4-3 the next count is not an opening — prices sent with it are ignored", async () => {
    const sheet = await open(thonglor);
    expect(await isOpeningCountLogic(tenant, sheet.id)).toBe(false);
    expect(await getOpeningPricesLogic(tenant, sheet.id)).toBeNull();
    await count(sheet.id, salt, 5); // two kilos more than the ledger holds
    await closeStockCountLogic(
      tenant,
      closeStockCountInputSchema.parse({ id: sheet.id, prices: [{ productId: salt.id, unitId: unit(salt, "kg"), unitCost: "20" }] }),
      actor()
    );
    const declared = await prismaBypass.stockCostDeclaration.count({ where: { tenantId: tenant, movement: { productId: salt.id } } });
    expect(declared).toBe(0);
  });

  it("PG4-4 a cost the branch's ledger already knows comes first", async () => {
    const sheet = await open(ari);
    expect(await isOpeningCountLogic(tenant, sheet.id)).toBe(true);
    await count(sheet.id, pork, 5);
    const p = (await getOpeningPricesLogic(tenant, sheet.id))!.find((l) => l.productId === pork.id)!;
    expect(p).toMatchObject({ qty: "3", unitId: unit(pork, "kg"), unitCost: "180", source: "LEDGER" });
  });

  // ----------------------------------------------------------
  // Rule PG6 — opening stock left unpriced takes its first receipt's price,
  // when the shop says so (Kong 2026-10-30)
  // ----------------------------------------------------------
  const receive = async (branchId: string, p: ProductWithUnits, unitName: string, qty: number, price: number, receivedAt: Date) => {
    // A receipt lands on a department (the default one).
    if ((await prismaBypass.department.count({ where: { tenantId: tenant } })) === 0) {
      await withRlsBypass((tx) => tx.department.create({ data: { tenantId: tenant, name: "ครัว", code: "MAIN" } }));
    }
    const supplierId = (await prismaBypass.supplier.findFirstOrThrow({ where: { tenantId: tenant } })).id;
    const gr = await createGoodsReceiptLogic(
      tenant,
      goodsReceiptInputSchema.parse({
        submitKey: randomUUID(),
        branchId,
        supplierId,
        purchaseOrderId: null,
        invoiceNo: null,
        receivedAt,
        notes: null,
        lines: [{ purchaseOrderItemId: null, productId: p.id, receivedUnitId: unit(p, unitName), qtyReceivedActual: qty, unitPriceActual: price, notes: null }],
      }),
      user
    );
    await confirmGoodsReceiptLogic(tenant, gr.id, user);
  };
  const thonglorOpening = async () => (await prismaBypass.stockCount.findFirstOrThrow({ where: { tenantId: tenant, branchId: thonglor, status: "CLOSED" }, orderBy: { closedAt: "asc" } })).id;

  it("PG6-1 opening stock left unpriced waits for its first receipt — not one from before the count, nor another branch's", async () => {
    const opening = await thonglorOpening();
    const before = (await getUnpricedOpeningLogic(tenant, opening))!;
    // Salt was closed without a price in PG4-2; rice was priced.
    expect(before.map((l) => [l.productId, l.qty, l.suggestion])).toEqual([[salt.id, "3", null]]);
    expect(await openingPricesWaitingLogic(tenant, ALL)).toEqual([]);

    await receive(thonglor, salt, "kg", 1, 99, new Date(Date.now() - 3 * 86_400_000)); // before the count
    await receive(ari, salt, "kg", 1, 77, new Date(Date.now() - 2_000)); // another branch
    await receive(thonglor, salt, "กระสอบ", 2, 500, new Date(Date.now() - 1_000)); // the first here after it
    await receive(thonglor, salt, "kg", 1, 30, new Date()); // later still

    const after = (await getUnpricedOpeningLogic(tenant, opening))!;
    expect(after[0].suggestion).toMatchObject({ unitId: unit(salt, "กระสอบ"), unitName: "กระสอบ", unitCost: "500" });
    expect(await openingPricesWaitingLogic(tenant, ALL)).toEqual([{ countId: opening, branchName: "ทองหล่อ", ready: 1 }]);
    // A count that is not the opening one is not asked.
    const second = (await prismaBypass.stockCount.findFirstOrThrow({ where: { tenantId: tenant, branchId: thonglor, status: "CLOSED", id: { not: opening } } })).id;
    expect(await getUnpricedOpeningLogic(tenant, second)).toBeNull();
  });

  it("PG6-2 the confirmed price is declared on the opening gain — and only an opening gain of THAT count, all or nothing", async () => {
    const opening = await thonglorOpening();
    const [line] = (await getUnpricedOpeningLogic(tenant, opening))!;
    // PG4-3's gain is a found-stock gain, not opening stock.
    const notOpening = await prismaBypass.stockMovement.findFirstOrThrow({
      where: { tenantId: tenant, productId: salt.id, branchId: thonglor, type: "ADJUST_GAIN", id: { not: line.movementId } },
    });
    await expect(
      declareOpeningPricesLogic(
        tenant,
        {
          countId: opening,
          lines: [
            { movementId: line.movementId, unitId: unit(salt, "กระสอบ"), unitCost: 500, note: "ยอดยกมา" },
            { movementId: notOpening.id, unitId: unit(salt, "kg"), unitCost: 20, note: "ยอดยกมา" },
          ],
        },
        user
      )
    ).rejects.toBeInstanceOf(OpeningPriceTargetError);
    expect(await prismaBypass.stockCostDeclaration.count({ where: { tenantId: tenant, movement: { productId: salt.id } } })).toBe(0);

    expect(await declareOpeningPricesLogic(tenant, { countId: opening, lines: [{ movementId: line.movementId, unitId: unit(salt, "กระสอบ"), unitCost: 500, note: "ยอดยกมา · ราคารับของครั้งแรก" }] }, user)).toBe(1);
    const declared = await prismaBypass.stockCostDeclaration.findFirstOrThrow({ where: { tenantId: tenant, movementId: line.movementId, supersededAt: null } });
    // ฿500 a 25 kg sack is ฿20 a kilo.
    expect(declared.unitCost.toString()).toBe("20");
    expect(await getUnpricedOpeningLogic(tenant, opening)).toEqual([]);
    expect(await openingPricesWaitingLogic(tenant, ALL)).toEqual([]);
  });
});

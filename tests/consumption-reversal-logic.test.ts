// ============================================================
// Mise — giving a day back (Sprint 5 Part 22 L3c)
// ============================================================
// The two things L3c owns:
//
//   1. the `fifo-replay.ts` case that makes a CONSUMPTION_REVERSAL return the
//      money that LEFT rather than today's price (rule N8). This is the first
//      change to that file since Part 18, and the whole reason the reversal got
//      a movement type of its own instead of borrowing waste's ADJUST_GAIN;
//
//   2. the wiring that makes a re-import take a posted day back automatically,
//      inside the import's own transaction (rule N6).
//
// Unlike L3a and L3b this fixture BUYS, because the point is what the stock is
// worth. Two layers at two prices, which is the only shape where "give back what
// it took" and "give back at the latest price" differ — and they differ by ฿400
// per re-imported file.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, withTenantContext} from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { computeHeaderSignature } from "@/lib/sales-file";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { createSupplierLogic } from "@/server/supplier";
import { purchaseOrderInputSchema } from "@/lib/validations/purchase-order";
import {
  createPurchaseOrderLogic,
  sendPurchaseOrderLogic,
} from "@/server/purchase-order";
import { goodsReceiptInputSchema } from "@/lib/validations/goods-receipt";
import {
  confirmGoodsReceiptLogic,
  createGoodsReceiptLogic,
} from "@/server/goods-receipt";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { getProductCostLogic } from "@/server/stock-cost";
import {
  commitSalesImportLogic,
  previewCounts,
  previewSalesImportLogic,
} from "@/server/sales-import";
import {
  postConsumptionForDayLogic,
  voidConsumptionForDayInTx,
} from "@/server/consumption-post";

const HEADER = ["วันที่", "หมวด", "เมนู", "จำนวน", "ยอดสุทธิ"];
const SIG = computeHeaderSignature(HEADER);
const COLUMN_MAP = {
  businessDate: 0,
  categoryName: 1,
  menuName: 2,
  qty: 3,
  netAmount: 4,
};

const fileOf = (rows: string[][]) =>
  new TextEncoder().encode(
    [HEADER, ...rows].map((r) => r.join(",")).join("\n") + "\n"
  );

/** dd/MM/yyyy in the Buddhist era, which is what the profile below declares. */
const thaiDate = (d: Date) => {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear() + 543}`;
};

describe("consumption reversal and the import's auto-void (ADR 0022 Part 22 L3c)", () => {
  let tenantA: string;
  let userA: string;
  let branchA: string;
  let supplierA: string;
  let posA: string;
  let profileA: string;

  let pork: ProductWithUnits;
  const MENU_NAME = "กะเพราหมูจานยักษ์";

  const today = computeBangkokToday();
  const D_VALUE = addDays(today, -2);
  const D_IMPORT = addDays(today, -3);
  const D_UNPOSTED = addDays(today, -4);

  const baseUnitOf = (p: ProductWithUnits) =>
    p.productUnits.find((u) => u.isBase)!.id;

  const receive = async (qty: number, pricePerUnit: number) => {
    const po = await createPurchaseOrderLogic(
      tenantA,
      purchaseOrderInputSchema.parse({
        branchId: branchA,
        supplierId: supplierA,
        expectedDeliveryDate: "",
        vatRatePercent: 0,
        notes: null,
        lines: [
          {
            productId: pork.id,
            orderUnitId: baseUnitOf(pork),
            qtyOrdered: qty,
            unitPrice: pricePerUnit,
            supplierProductMappingId: null,
            notes: null,
          },
        ],
      }),
      userA
    );
    const sent = await sendPurchaseOrderLogic(tenantA, po.id, userA);
    const gr = await createGoodsReceiptLogic(
      tenantA,
      goodsReceiptInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branchA,
        supplierId: supplierA,
        purchaseOrderId: sent.id,
        invoiceNo: null,
        // Well before every sales day below, so the layers are in place first.
        receivedAt: addDays(today, -30),
        notes: null,
        lines: [
          {
            purchaseOrderItemId: sent.items[0].id,
            productId: pork.id,
            receivedUnitId: baseUnitOf(pork),
            qtyReceivedActual: qty,
            unitPriceActual: pricePerUnit,
            notes: null,
          },
        ],
      }),
      userA
    );
    await confirmGoodsReceiptLogic(tenantA, gr.id, userA);
  };

  const importDay = async (businessDate: Date, qty: number, net: number) => {
    const batchId = randomUUID();
    const rows = [[thaiDate(businessDate), "อาหาร", MENU_NAME, String(qty), String(net)]];
    const p = await previewSalesImportLogic(
      tenantA,
      userA,
      { batchId, profileId: profileA, fileName: `s-${batchId.slice(0, 6)}.csv` },
      fileOf(rows)
    );
    const counts = previewCounts(p);
    return commitSalesImportLogic(
      tenantA,
      userA,
      {
        batchId,
        acknowledgedReplacedDays: counts.days,
        acknowledgedNewMenus: counts.menus,
        acknowledgedNewCategories: counts.categories,
      },
      fileOf(rows)
    );
  };

  const post = (businessDate: Date, acknowledgeRepost = false) =>
    postConsumptionForDayLogic(
      tenantA,
      {
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate,
        acknowledgeRepost,
      },
      userA
    );

  const cost = () =>
    getProductCostLogic(tenantA, { productId: pork.id, branchId: branchA });

  const liveRunFor = (businessDate: Date) =>
    withRlsBypass((tx) =>
      tx.salesConsumptionRun.findFirst({
        where: { tenantId: tenantA, businessDate, voidedAt: null },
        select: { id: true },
      })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Consumption Reversal Tenant" } });
      tenantA = t.id;
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ทองหล่อ", code: "THL" },
      });
      branchA = b.id;
      await tx.department.create({
        data: { tenantId: t.id, name: "Main", code: "MAIN" },
      });
      const u = await tx.user.create({
        data: { email: `rev-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
      });
      userA = u.id;
      const pos = await tx.posIntegration.create({
        data: {
          tenantId: t.id,
          branchId: b.id,
          posType: "FOODSTORY",
          name: "เครื่องหน้าร้าน",
        },
        select: { id: true },
      });
      posA = pos.id;
      const prof = await tx.salesImportProfile.create({
        data: {
          tenantId: t.id,
          posIntegrationId: pos.id,
          name: "สรุปรายวัน",
          fileKind: "DAILY_SUMMARY",
          encoding: "UTF8",
          dateFormat: "dd/MM/yyyy",
          isBuddhistYear: true,
          headerSignature: SIG,
          columnMap: COLUMN_MAP,
          amountsIncludeVat: false,
          amountsIncludeServiceCharge: false,
        },
        select: { id: true },
      });
      profileA = prof.id;
    });

    const sup = await createSupplierLogic(
      tenantA,
      supplierInputSchema.parse({ nameFull: `ซัพ-${randomUUID().slice(0, 6)}` })
    );
    supplierA = sup.id;

    pork = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `REV-pork-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [],
        defaultBuyUnitName: "kg",
      })
    );

    // Two layers at two prices — the only shape where the two possible answers
    // for a reversal differ.
    await receive(10, 180);
    await receive(10, 220);

    // The first import creates the menu as a stub; the recipe is written against
    // it afterwards, dated back over every day under test.
    await importDay(D_IMPORT, 1, 100);
    const menu = await withRlsBypass((tx) =>
      tx.menu.findFirstOrThrow({
        where: { tenantId: tenantA },
        select: { id: true },
      })
    );
    await createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: menu.id,
        outputProductId: null,
        servings: 1,
        effectiveFrom: addDays(today, -60),
        ingredients: [
          {
            productId: pork.id,
            componentMenuId: null,
            qty: 1,
            productUnitId: baseUnitOf(pork),
            sortOrder: 0,
            notes: null,
          },
        ],
        notes: null,
      }),
      userA
    );
  }, 300_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionItem.deleteMany({
        where: { tenantId: tenantA, reversalOfItemId: { not: null } },
      });
      await tx.salesConsumptionItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesConsumptionRun.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesLine.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesDay.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportBatch.deleteMany({ where: { tenantId: tenantA } });
      await tx.salesImportProfile.deleteMany({ where: { tenantId: tenantA } });
      await tx.menuAlias.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.updateMany({
        where: { tenantId: tenantA },
        data: { supersededAt: null, supersededById: null },
      });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.menuCategory.deleteMany({ where: { tenantId: tenantA } });
      // AFTER the menus: menu.pos_integration_id is SET NULL on delete, and
      // `menu_source_check` refuses a POS menu with no integration — so dropping
      // the integration first rewrites every stub into an illegal row.
      await tx.posIntegration.deleteMany({ where: { tenantId: tenantA } });
      await tx.expenseItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.expense.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceiptItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.goodsReceipt.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplierProductMapping.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplier.deleteMany({ where: { tenantId: tenantA } });
      await tx.department.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.category.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
  }, 180_000);

  // ------------------------------------------------------------
  // Rule N8 — give back what it took
  // ------------------------------------------------------------

  it("V-01 the pile starts at ฿4,000 across two layers", async () => {
    const c = await cost();
    expect(c.qtyOnHand.toString()).toBe("20");
    expect(c.inventoryValue.toString()).toBe("4000");
  });

  it("V-02 consuming 10 kg takes the ฿180 layer, not an average", async () => {
    await importDay(D_VALUE, 10, 1000);
    await post(D_VALUE);

    const c = await cost();
    expect(c.qtyOnHand.toString()).toBe("10");
    // 4000 − 1800. Under weighted average this would be 4000 − 2000.
    expect(c.inventoryValue.toString()).toBe("2200");
  });

  it("V-03 giving the day back restores ฿1,800 — the money that LEFT", async () => {
    await withTenantContext(tenantA, (tx) =>
      voidConsumptionForDayInTx(
        tx as never,
        tenantA,
        branchA,
        D_VALUE,
        "RE_IMPORT",
        userA
      )
    );

    const c = await cost();
    expect(c.qtyOnHand.toString()).toBe("20");
    // THE test of this layer. At last-known cost the 10 kg would come back at
    // ฿220 and the pile would read ฿4,400 — ฿400 of inventory conjured by the
    // act of importing a file twice, with nothing anywhere looking wrong.
    expect(c.inventoryValue.toString()).toBe("4000");
  });

  it("V-04 money in − money out equals what is on hand, after all of that", async () => {
    const c = await cost();
    // ADR 0014 Q12's invariant, which is the reason the reversal may not simply
    // push at today's price: an inexact give-back breaks it silently.
    expect(c.totalIn.minus(c.totalOut).toString()).toBe(
      c.inventoryValue.toString()
    );
  });

  it("V-05 the restored layer does not claim a document's confidence", async () => {
    const c = await cost();
    const restored = c.layers.find((l) => l.sourceType === "SALES_CONSUMPTION");
    expect(restored).toBeTruthy();
    // The money is exactly what left, but what left came from layers of mixed
    // provenance and the walk does not track the mix. LAST_KNOWN, not DOCUMENT —
    // the same choice the transfer reversal makes.
    expect(restored!.pricing).toBe("LAST_KNOWN");
    expect(restored!.value.toString()).toBe("1800");
  });

  // ------------------------------------------------------------
  // Rule N6 — the import takes the day back by itself
  // ------------------------------------------------------------

  it("V-06 re-importing a POSTED day voids its run inside the import, and says how many", async () => {
    await post(D_IMPORT, true);
    expect(await liveRunFor(D_IMPORT)).toBeTruthy();
    const before = await cost();

    const res = await importDay(D_IMPORT, 4, 400);

    // Superseding the sales made those movements refer to rows that no longer
    // stand. The ledger must not sit knowingly wrong waiting to be noticed.
    expect(res.consumptionRunsVoided).toBe(1);
    expect(await liveRunFor(D_IMPORT)).toBeNull();
    // The one kilo that day consumed has come back.
    expect(Number((await cost()).qtyOnHand)).toBeCloseTo(
      Number(before.qtyOnHand) + 1,
      6
    );
  });

  it("V-07 the import does NOT re-post — that stays the user's own step", async () => {
    // A day whose new file lands at 3am must not be silently re-cut against
    // whatever the recipes happen to say the next morning (Q2).
    expect(await liveRunFor(D_IMPORT)).toBeNull();

    const res = await post(D_IMPORT);
    expect(res.run.menusPosted).toBe(1);
    // And now it consumes the NEW figure, not the old one.
    expect(res.items[0].qty.toString()).toBe("-4");
  });

  it("V-08 re-importing a day that was never posted voids nothing", async () => {
    await importDay(D_UNPOSTED, 2, 200);
    const res = await importDay(D_UNPOSTED, 3, 300);
    expect(res.rowsSuperseded).toBeGreaterThan(0);
    expect(res.consumptionRunsVoided).toBe(0);
  });
});

// ============================================================
// Mise — a VAT-inclusive supplier, end to end (Part 39, ADR 0036 R6)
// ============================================================
// Order → send → receive → confirm → expense → FIFO layer, against real Neon,
// with prices typed the way a Makro bill shows them. The bill below was chosen
// on purpose: 285.85 + 410.69 + 197.29 = 893.83, VAT 58.47 — and the old
// arithmetic (re-adding 7% to each line's net share, recomputing VAT from the
// net subtotal) lands on 893.84 and 58.48. Every figure must say what the bill
// says, to the satang, for a shop that can reclaim VAT and one that cannot.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withRlsBypass } from "@/lib/db-admin";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { purchaseOrderInputSchema } from "@/lib/validations/purchase-order";
import { createPurchaseOrderLogic, sendPurchaseOrderLogic } from "@/server/purchase-order";
import { goodsReceiptInputSchema, voidGoodsReceiptInputSchema } from "@/lib/validations/goods-receipt";
import { confirmGoodsReceiptLogic, createGoodsReceiptLogic, voidGoodsReceiptLogic } from "@/server/goods-receipt";
import { getExpenseByGoodsReceiptLogic } from "@/server/expense";
import { getProductCostsLogic } from "@/server/stock-cost";
import { sweepOrphanUsers, sweepTestTenants } from "./support/sweep";

const QUOTED = [285.85, 410.69, 197.29];
const BILL = 893.83;
const VAT = 58.47;
const NET = 835.36;

describe("VAT-inclusive prices, order to FIFO (ADR 0036 R6)", () => {
  const tenants: string[] = [];
  let user: string;

  const setup = async (vatRegisteredShop: boolean) => {
    const ids = await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: `R6 ${vatRegisteredShop ? "reg" : "unreg"}`, isVatRegistered: vatRegisteredShop } });
      const b = await tx.branch.create({ data: { tenantId: t.id, name: "สาขา", code: "RSX" } });
      await tx.department.create({ data: { tenantId: t.id, name: "Main", code: "MAIN" } });
      const s = await tx.supplier.create({
        data: { tenantId: t.id, nameFull: "แม็คโคร", isVatRegistered: true, defaultVatRatePercent: new Prisma.Decimal(7), pricesIncludeVat: true },
      });
      return { tenant: t.id, branch: b.id, supplier: s.id };
    });
    tenants.push(ids.tenant);
    const products: ProductWithUnits[] = [];
    for (const name of ["หมู", "ไก่", "ผัก"]) {
      products.push(
        await createProductLogic(
          ids.tenant,
          productInputSchema.parse({ name: `${name}-${randomUUID().slice(0, 6)}`, primaryDimension: "WEIGHT", baseUnitName: "kg" })
        )
      );
    }
    return { ...ids, products };
  };

  /** Order, send, receive against it at the SAME quoted prices, confirm. */
  const runFlow = async (vatRegisteredShop: boolean) => {
    const f = await setup(vatRegisteredShop);
    const po = await createPurchaseOrderLogic(
      f.tenant,
      purchaseOrderInputSchema.parse({
        branchId: f.branch,
        supplierId: f.supplier,
        expectedDeliveryDate: "",
        vatRatePercent: 7,
        pricesIncludeVat: "on",
        notes: null,
        lines: f.products.map((p, i) => ({
          productId: p.id,
          orderUnitId: p.productUnits[0].id,
          qtyOrdered: 1,
          unitPrice: QUOTED[i],
          supplierProductMappingId: null,
          notes: null,
        })),
      }),
      user
    );
    await sendPurchaseOrderLogic(f.tenant, po.id, user);
    const gr = await createGoodsReceiptLogic(
      f.tenant,
      goodsReceiptInputSchema.parse({
        submitKey: randomUUID(),
        branchId: f.branch,
        supplierId: f.supplier,
        purchaseOrderId: po.id,
        invoiceNo: "MAK-1",
        vatRatePercent: 7,
        pricesIncludeVat: "on",
        receivedAt: new Date(),
        notes: null,
        lines: po.items.map((it, i) => ({
          purchaseOrderItemId: it.id,
          productId: it.productId,
          receivedUnitId: it.orderUnitId,
          qtyReceivedActual: 1,
          unitPriceActual: QUOTED[i],
          notes: null,
        })),
      }),
      user
    );
    const { receipt } = await confirmGoodsReceiptLogic(f.tenant, gr.id, user);
    return { ...f, po, receipt };
  };

  const sum = (xs: { toString(): string }[]) =>
    Number(xs.reduce<Prisma.Decimal>((s, x) => s.plus(x.toString()), new Prisma.Decimal(0)).toFixed(2));
  const layers = async (tenant: string, branch: string, productIds: string[]) => {
    const costs = await getProductCostsLogic(tenant, { productIds, branchId: branch });
    return sum(productIds.map((id) => costs.get(id)?.inventoryValue ?? new Prisma.Decimal(0)));
  };

  beforeAll(async () => {
    user = (await withRlsBypass((tx) => tx.user.create({ data: { email: `r6-${randomUUID()}@example.com`, name: "จัดซื้อ" } }))).id;
  });

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await sweepTestTenants(tx as never, { ids: tenants });
      await sweepOrphanUsers(tx as never, { ids: [user] });
    });
  }, 300_000);

  it("the order says what the bill says; every stored money column is excluding VAT", async () => {
    const { po } = await runFlow(true);
    expect(po.pricesIncludeVat).toBe(true);
    expect(Number(po.totalAmount)).toBe(BILL);
    expect(Number(po.vatAmount)).toBe(VAT);
    expect(Number(po.subtotalExclVat)).toBe(NET);
    expect(sum(po.items.map((i) => i.lineTotal))).toBe(NET); // Σ net lines = net subtotal, exactly
    expect(po.items.map((i) => Number(i.lineTotalQuoted))).toEqual(QUOTED);
    expect(po.items.map((i) => Number(i.unitPriceQuoted))).toEqual(QUOTED);
  });

  it("R6 — a shop that CANNOT reclaim VAT: receipt, expense and FIFO layers all equal the bill", async () => {
    const { tenant, branch, products, receipt } = await runFlow(false);
    expect(receipt.pricesIncludeVat).toBe(true);
    expect(Number(receipt.vatAmount)).toBe(VAT);
    expect(receipt.hasDiscrepancy).toBe(false); // same quoted price as the order → same net price
    expect(sum(receipt.items.map((i) => i.lineTotalActual))).toBe(NET);

    const expense = await getExpenseByGoodsReceiptLogic(tenant, receipt.id);
    expect(expense?.isPriceVatInclusive).toBe(true);
    expect(Number(expense?.subtotalExclVat)).toBe(NET);
    expect(Number(expense?.vatAmount)).toBe(VAT); // copied, not recomputed (58.48)
    expect(Number(expense?.totalAmount)).toBe(BILL);

    // What the shop paid and will never get back — to the satang (not 893.84).
    expect(await layers(tenant, branch, products.map((p) => p.id))).toBe(BILL);
  });

  it("R6 — a shop that CAN reclaim VAT carries its stock at the net figure", async () => {
    const { tenant, branch, products } = await runFlow(true);
    expect(await layers(tenant, branch, products.map((p) => p.id))).toBe(NET);
  });

  it("voiding the receipt takes the layers back to nothing", async () => {
    const { tenant, branch, products, receipt } = await runFlow(false);
    await voidGoodsReceiptLogic(tenant, voidGoodsReceiptInputSchema.parse({ id: receipt.id, voidReason: "ทดสอบ" }), user);
    expect(await layers(tenant, branch, products.map((p) => p.id))).toBe(0);
  });
});

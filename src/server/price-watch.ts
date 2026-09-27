// ============================================================
// Mise — ราคาวัตถุดิบขึ้นลง (Part 35 D, after Kong's "ราคาผันผวน")
// ============================================================
// Kong's sheet tracked how each ingredient's price moved, by group and by
// supplier. Mise already holds every price it ever paid: each confirmed
// goods-receipt line carries its unit price AND the unit's ratio to the base
// unit frozen at the time (ADR 0013), so a price per kg / litre / piece can
// be compared across a "ถุง 5 กก." and a "กระสอบ 15 กก." without guessing.
//
// This is NOT pending Feature 1 (price vs a TARGET the shop sets — needs a
// new column). It is price vs the shop's own recent past, which needs
// nothing new.
//
// Rules:
//   * Confirmed receipts only; reversal lines and voided receipts never count.
//   * Price per BASE unit = unit_price_actual ÷ to_base_ratio, net of VAT as
//     stored on the line.
//   * "Change" compares the FIRST and LAST price paid in the window — the
//     honest reading of "did it get dearer", with the count of receipts beside
//     it so one receipt is never mistaken for a trend.
// ============================================================

import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { branchScopeWhere, type BranchReach } from "@/lib/permissions/service";

export interface PricePoint {
  date: Date;
  productId: string;
  productName: string;
  baseUnit: string;
  section: string;
  group: string;
  supplierId: string;
  supplierName: string;
  pricePerBase: number;
  qtyBase: number;
}

export interface PriceSeriesRow {
  key: string;
  productId: string;
  productName: string;
  baseUnit: string;
  group: string;
  supplierId: string | null;
  supplierName: string | null;
  first: number;
  last: number;
  min: number;
  max: number;
  changePct: number | null;
  receipts: number;
  firstDate: Date;
  lastDate: Date;
}

export interface PriceWatch {
  products: PriceSeriesRow[];
  rows: PriceSeriesRow[];
  groups: { group: string; avgChangePct: number; products: number }[];
  options: { groups: string[]; suppliers: { id: string; name: string }[] };
  points: PricePoint[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function series(key: string, pts: PricePoint[], bySupplier: boolean): PriceSeriesRow {
  const sorted = [...pts].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const prices = sorted.map((p) => p.pricePerBase);
  return {
    key,
    productId: first.productId,
    productName: first.productName,
    baseUnit: first.baseUnit,
    group: first.group,
    supplierId: bySupplier ? first.supplierId : null,
    supplierName: bySupplier ? first.supplierName : null,
    first: round(first.pricePerBase),
    last: round(last.pricePerBase),
    min: round(Math.min(...prices)),
    max: round(Math.max(...prices)),
    changePct: sorted.length > 1 && first.pricePerBase > 0 ? round(((last.pricePerBase - first.pricePerBase) / first.pricePerBase) * 100, 1) : null,
    receipts: sorted.length,
    firstDate: first.date,
    lastDate: last.date,
  };
}

/** Pure: everything the page shows from the window's price points. */
export function watch(all: PricePoint[], f: { group?: string; supplier?: string }): PriceWatch {
  const inGroup = all.filter((p) => !f.group || p.group === f.group);
  const points = inGroup.filter((p) => !f.supplier || p.supplierId === f.supplier);

  const byProduct = new Map<string, PricePoint[]>();
  const byPair = new Map<string, PricePoint[]>();
  for (const p of points) {
    byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p]);
    const k = `${p.productId}|${p.supplierId}`;
    byPair.set(k, [...(byPair.get(k) ?? []), p]);
  }
  const products = [...byProduct.entries()].map(([k, v]) => series(k, v, false));
  const rows = [...byPair.entries()].map(([k, v]) => series(k, v, true));

  const g = new Map<string, number[]>();
  for (const p of products) if (p.changePct !== null) g.set(p.group, [...(g.get(p.group) ?? []), p.changePct]);
  const groups = [...g.entries()]
    .map(([group, xs]) => ({ group, avgChangePct: round(xs.reduce((s, x) => s + x, 0) / xs.length, 1), products: xs.length }))
    .sort((a, b) => b.avgChangePct - a.avgChangePct);

  const sup = new Map<string, string>();
  for (const p of inGroup) sup.set(p.supplierId, p.supplierName);

  return {
    products: products.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)),
    rows: rows.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)),
    groups,
    options: {
      groups: [...new Set(all.map((p) => p.group))].sort((a, b) => a.localeCompare(b, "th")),
      suppliers: [...sup.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "th")),
    },
    points,
  };
}

export async function getPriceWatchLogic(
  tenantId: string,
  q: { from: Date; to: Date; branchId?: string; group?: string; supplier?: string },
  reach: BranchReach
): Promise<PriceWatch> {
  const lines = await withTenantContext(tenantId, async (tx) => {
    const branches = await tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach), ...(q.branchId ? { id: q.branchId } : {}) },
      select: { id: true },
    });
    return tx.goodsReceiptItem.findMany({
      where: {
        tenantId,
        reversalOfItemId: null,
        goodsReceipt: {
          tenantId,
          status: "CONFIRMED",
          deletedAt: null,
          branchId: { in: branches.map((b) => b.id) },
          receivedAt: { gte: q.from, lt: new Date(q.to.getTime() + 24 * 3600 * 1000) },
        },
      },
      select: {
        productId: true,
        qtyReceivedActual: true,
        toBaseRatio: true,
        unitPriceActual: true,
        product: {
          select: {
            name: true,
            category: { select: { accountingSection: true, groupName: true } },
            productUnits: { where: { isBase: true }, select: { unitName: true } },
          },
        },
        goodsReceipt: {
          select: { receivedAt: true, supplierId: true, supplier: { select: { nameShort: true, nameFull: true } } },
        },
      },
    });
  });

  const points: PricePoint[] = lines
    .filter((l) => new Prisma.Decimal(l.toBaseRatio).gt(0))
    .map((l) => ({
      date: l.goodsReceipt.receivedAt,
      productId: l.productId,
      productName: l.product.name,
      baseUnit: l.product.productUnits[0]?.unitName ?? "",
      section: l.product.category?.accountingSection ?? "ไม่ระบุหมวด",
      group: l.product.category?.groupName ?? "ไม่ระบุหมวด",
      supplierId: l.goodsReceipt.supplierId,
      supplierName: l.goodsReceipt.supplier.nameShort || l.goodsReceipt.supplier.nameFull,
      pricePerBase: Number(new Prisma.Decimal(l.unitPriceActual).div(l.toBaseRatio).toString()),
      qtyBase: Number(new Prisma.Decimal(l.qtyReceivedActual).mul(l.toBaseRatio).toString()),
    }));
  return watch(points, { group: q.group, supplier: q.supplier });
}

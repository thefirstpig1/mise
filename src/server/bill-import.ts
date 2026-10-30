// ============================================================
// คิดครัว — past purchase bills: read them, then write suppliers and prices
// ============================================================
// The rules live in src/lib/bill-import.ts, shared with the review screen.
// This module reads the file and does the one write, in ONE transaction:
// suppliers named on the bills, products the person chose to create, units
// the bills used, and the supplier price series (supplier_product_mapping)
// with the supplier's own wording remembered on each row.
//
// It writes NO stock movement and NO expense (Kong 2026-10-30) — see the lib.
// ============================================================

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma, withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { BILL_SHEET, readBillTable, type BillContext, type BillSave, type BillTableResult } from "@/lib/bill-import";
import { nameKey, splitPastedTable } from "@/lib/product-import";
import { ensureProductUnitInTx } from "@/server/product";
import { importProductsInTx, loadImportGrids } from "@/server/product-import";

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Everything the review screen matches against, read fresh at each upload. */
export async function getBillContextLogic(tenantId: string): Promise<BillContext> {
  const [facts, templates] = await Promise.all([
    withTenantContext(tenantId, async (tx) => {
      const products = await tx.product.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true, sku: true, primaryDimension: true, productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true } } },
        orderBy: { name: "asc" },
      });
      const suppliers = await tx.supplier.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, nameFull: true }, orderBy: { nameFull: "asc" } });
      const remembered = await tx.supplierProductMapping.findMany({
        where: { tenantId, deletedAt: null, supplierItemName: { not: null } },
        select: { supplierId: true, productId: true, supplierItemName: true },
      });
      const opening = await tx.stockCount.findFirst({
        where: { tenantId, status: "CLOSED", deletedAt: null },
        orderBy: { countDate: "asc" },
        select: { countDate: true },
      });
      return { products, suppliers, remembered, opening };
    }),
    prisma.unitTemplate.findMany({ select: { unitName: true, unitDimension: true, toSiRatio: true } }),
  ]);
  return {
    products: facts.products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      dimension: p.primaryDimension,
      units: p.productUnits.map((u) => ({ id: u.id, unitName: u.unitName, toBaseRatio: Number(u.toBaseRatio), isBase: u.isBase })),
    })),
    suppliers: facts.suppliers.map((s) => ({ id: s.id, name: s.nameFull })),
    remembered: facts.remembered.map((r) => ({ supplierId: r.supplierId, productId: r.productId, itemName: r.supplierItemName! })),
    templates: templates.map((t) => ({ unitName: t.unitName, unitDimension: t.unitDimension, toSiRatio: t.toSiRatio === null ? null : Number(t.toSiRatio) })),
    openingDate: facts.opening ? isoDay(facts.opening.countDate) : null,
    today: isoDay(computeBangkokToday()),
  };
}

/** The shop's ingredient names, for the prompt's matching list. */
export async function getBillPromptNamesLogic(tenantId: string): Promise<string[]> {
  const rows = await withTenantContext(tenantId, (tx) =>
    tx.product.findMany({ where: { tenantId, deletedAt: null, isActive: true }, select: { name: true }, orderBy: { name: "asc" } })
  );
  return rows.map((r) => r.name);
}

export async function readBillFile(bytes: Uint8Array, fileName: string): Promise<BillTableResult | { error: "UNREADABLE" | "UNSUPPORTED" }> {
  const grids = await loadImportGrids(bytes, fileName);
  if ("error" in grids) return grids;
  const named = grids.find((g) => g.name === BILL_SHEET);
  if (named) return readBillTable(named.grid);
  for (const g of grids) {
    const t = readBillTable(g.grid);
    if (t.ok) return t;
  }
  return readBillTable(grids[0]?.grid ?? []);
}

export function readBillText(text: string): BillTableResult {
  return readBillTable(splitPastedTable(text));
}

// ------------------------------------------------------------
// The write
// ------------------------------------------------------------

export class BillRefError extends Error {
  constructor(what: string) {
    super(`not a live ${what} of this tenant`);
    this.name = "BillRefError";
  }
}
export class BillDateError extends Error {
  constructor(public readonly date: string) {
    super(`bill date ${date} is in the future`);
    this.name = "BillDateError";
  }
}

export type BillOutcome = {
  suppliersCreated: number;
  productsCreated: number;
  unitsAdded: number;
  pricesWritten: number;
  /** Prices older than one the shop already has for that supplier — kept out (Kong: old never overwrites new). */
  skippedOlder: number;
};

export async function importBillsLogic(tenantId: string, save: BillSave): Promise<BillOutcome> {
  const today = isoDay(computeBangkokToday());
  for (const p of save.prices) if (p.date > today) throw new BillDateError(p.date);
  return withTenantContext(tenantId, (tx) => importBillsInTx(tx, tenantId, save, today), { timeout: 60_000 });
}

async function importBillsInTx(tx: PrismaClient, tenantId: string, save: BillSave, today: string): Promise<BillOutcome> {
  // 1. Suppliers — the bill's name when the person did not pick an existing one.
  const live = await tx.supplier.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, nameFull: true } });
  const liveIds = new Set(live.map((s) => s.id));
  const byName = new Map(live.map((s) => [nameKey(s.nameFull), s.id]));
  const supplierOf = new Map<string, string>();
  let suppliersCreated = 0;
  for (const s of save.suppliers) {
    if (s.id !== null) {
      if (!liveIds.has(s.id)) throw new BillRefError("supplier");
      supplierOf.set(s.ref, s.id);
      continue;
    }
    const existing = byName.get(nameKey(s.name));
    if (existing) {
      supplierOf.set(s.ref, existing);
      continue;
    }
    const created = await tx.supplier.create({ data: { tenantId, nameFull: s.name, isVatRegistered: s.vat }, select: { id: true } });
    byName.set(nameKey(s.name), created.id);
    supplierOf.set(s.ref, created.id);
    suppliersCreated++;
  }

  // 2. Products the person chose to create from a bill line.
  let productsCreated = 0;
  if (save.newProducts.length > 0) {
    const out = await importProductsInTx(
      tx,
      tenantId,
      save.newProducts.map((p) => ({ name: p.name, baseUnitName: p.baseUnitName, categoryId: null, extraUnit: null }))
    );
    productsCreated = out.created.length;
  }
  const products = await tx.product.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, productUnits: { select: { id: true, unitName: true } } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const productByName = new Map(products.map((p) => [nameKey(p.name), p]));
  const refName = new Map(save.newProducts.map((p) => [p.ref, p.name]));
  const productOf = (ref: { id: string } | { ref: string }) => {
    const p = "id" in ref ? productById.get(ref.id) : productByName.get(nameKey(refName.get(ref.ref) ?? ""));
    if (!p) throw new BillRefError("product");
    return p;
  };

  // 3. Units the bills priced in that the product does not have yet.
  let unitsAdded = 0;
  const unitIdOf = new Map<string, string>();
  for (const pr of save.prices) {
    const p = productOf(pr.product);
    const key = `${p.id}|${pr.unitName}`;
    if (unitIdOf.has(key)) continue;
    const have = p.productUnits.find((u) => u.unitName === pr.unitName);
    if (have) {
      unitIdOf.set(key, have.id);
      continue;
    }
    const u = await ensureProductUnitInTx(tx, tenantId, { productId: p.id, unitName: pr.unitName, toBaseRatio: pr.ratio });
    p.productUnits.push({ id: u.id, unitName: u.unitName });
    unitIdOf.set(key, u.id);
    unitsAdded++;
  }

  // 4. The price series, one per supplier × product, tenant-wide (branch null).
  type Point = { date: string; price: number; unitId: string; itemName: string };
  const series = new Map<string, { supplierId: string; productId: string; points: Point[] }>();
  for (const pr of save.prices) {
    const supplierId = supplierOf.get(pr.supplierRef);
    if (!supplierId) throw new BillRefError("supplier");
    const p = productOf(pr.product);
    const k = `${supplierId}|${p.id}`;
    if (!series.has(k)) series.set(k, { supplierId, productId: p.id, points: [] });
    series.get(k)!.points.push({ date: pr.date, price: pr.unitPrice, unitId: unitIdOf.get(`${p.id}|${pr.unitName}`)!, itemName: pr.itemName });
  }

  const productIds = [...new Set([...series.values()].map((s) => s.productId))];
  const existing = await tx.supplierProductMapping.findMany({
    where: { tenantId, deletedAt: null, branchId: null, productId: { in: productIds } },
    select: { id: true, supplierId: true, productId: true, effectiveFrom: true, effectiveTo: true, isPreferred: true },
  });
  const todayDate = dayOf(today);
  const hasPreferred = new Set(
    existing.filter((m) => m.isPreferred && (m.effectiveTo === null || m.effectiveTo >= todayDate)).map((m) => m.productId)
  );

  let skippedOlder = 0;
  const rows: Prisma.SupplierProductMappingCreateManyInput[] = [];
  const lastRowOf = new Map<string, { row: Prisma.SupplierProductMappingCreateManyInput; date: string }>(); // per product, newest series end
  for (const s of series.values()) {
    // One point per day (the later line wins), in date order, a run of the same price is one row.
    const byDay = new Map<string, Point>();
    for (const pt of s.points) byDay.set(pt.date, pt);
    const sorted = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    const mine = existing.filter((m) => m.supplierId === s.supplierId && m.productId === s.productId);
    const latest = mine.reduce<string | null>((acc, m) => {
      const d = isoDay(m.effectiveFrom);
      return acc === null || d > acc ? d : acc;
    }, null);
    const fresh = sorted.filter((pt) => latest === null || pt.date > latest);
    skippedOlder += sorted.length - fresh.length;
    const points = fresh.filter((pt, i) => i === 0 || pt.price !== fresh[i - 1].price || pt.unitId !== fresh[i - 1].unitId);
    if (points.length === 0) continue;

    // The shop's own open row ends the day before the first new price.
    const first = dayOf(points[0].date);
    for (const m of mine) {
      if (m.effectiveTo === null || m.effectiveTo >= first) {
        await tx.supplierProductMapping.update({ where: { id: m.id }, data: { effectiveTo: new Date(first.getTime() - DAY_MS) } });
      }
    }
    points.forEach((pt, i) => {
      const row: Prisma.SupplierProductMappingCreateManyInput = {
        tenantId,
        supplierId: s.supplierId,
        productId: s.productId,
        branchId: null,
        supplierItemName: pt.itemName,
        orderUnitId: pt.unitId,
        currentUnitPrice: new Prisma.Decimal(pt.price.toFixed(4)),
        isPreferred: false,
        effectiveFrom: dayOf(pt.date),
        effectiveTo: i < points.length - 1 ? new Date(dayOf(points[i + 1].date).getTime() - DAY_MS) : null,
      };
      rows.push(row);
      if (i === points.length - 1) {
        const prev = lastRowOf.get(s.productId);
        if (!prev || pt.date > prev.date) lastRowOf.set(s.productId, { row, date: pt.date });
      }
    });
  }
  // Kong: a product with no main supplier yet gets the one it was bought from last.
  for (const [productId, { row }] of lastRowOf) if (!hasPreferred.has(productId)) row.isPreferred = true;
  if (rows.length > 0) await tx.supplierProductMapping.createMany({ data: rows });

  return { suppliersCreated, productsCreated, unitsAdded, pricesWritten: rows.length, skippedOlder };
}

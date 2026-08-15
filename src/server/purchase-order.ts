// ============================================================
// Mise — Purchase Order READ logic (Sprint 2 Part 11 L3a; ADR 0012)
// ============================================================
// Same shape as src/server/{product,supplier-product-mapping,stock-movement}.ts:
// every fn takes `tenantId` FIRST, runs inside withTenantContext, and filters
// `tenantId` EXPLICITLY (app-layer isolation is the live guard; RLS inert until
// Sprint 7 — ADR 0004).
//
// The headline read here is `resolveSupplierPriceLogic` — the consumer ADR 0009
// deferred with "Sprint 2 — PO consumer". Part 8 shipped seven *Logic functions
// and none of them answers the only question the order form actually asks:
// *what does this product cost, from this supplier, at this branch, today?*
//
// Decimal values stay Prisma.Decimal here; stringification for Client Components
// is the L4/L5 view serializer's job (Pitfall #20).
// ============================================================

import type { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import type { GetPurchaseOrdersQuery } from "@/lib/validations/purchase-order";

// ------------------------------------------------------------
// Price resolution (ADR 0009's deferred consumer)
// ------------------------------------------------------------

/**
 * What the order form needs to fill a line in: the price, the unit it is priced
 * in, and where the number came from.
 *
 * `mappingId` is what the line stores as provenance (ADR 0012 Q3). `scope` says
 * which of ADR 0009's two series won — useful to show "ราคาเฉพาะสาขา" in the UI,
 * and the reason the resolver returns a shape rather than a bare Decimal.
 */
export type ResolvedSupplierPrice = {
  mappingId: string;
  unitPrice: Prisma.Decimal;
  orderUnitId: string | null;
  orderUnitName: string | null;
  toBaseRatio: Prisma.Decimal | null;
  minOrderQty: Prisma.Decimal | null;
  leadTimeDays: number | null;
  supplierItemCode: string | null;
  /** "branch" = a branch-specific override won; "tenant" = the default series. */
  scope: "branch" | "tenant";
};

const MAPPING_PRICE_SELECT = {
  id: true,
  currentUnitPrice: true,
  minOrderQty: true,
  leadTimeDays: true,
  supplierItemCode: true,
  branchId: true,
  effectiveFrom: true,
  orderUnit: { select: { id: true, unitName: true, toBaseRatio: true } },
} as const;

/**
 * Resolve today's price for one (product, supplier, branch) — ADR 0009's lookup
 * rule, implemented here for the first time.
 *
 * Three rules, in order:
 *  1. **Branch override beats the tenant default.** ADR 0009 Q7: a mapping with
 *     this `branchId` set *wholly replaces* the `branchId = null` series for that
 *     branch — it is not a discount on top of it, so the fallback only runs when
 *     the branch series has nothing current.
 *  2. **Current means the date window contains today**, Bangkok:
 *     `effectiveFrom <= today AND (effectiveTo IS NULL OR effectiveTo >= today)`.
 *     Both columns are `@db.Date`, so comparing against `computeBangkokToday()`
 *     (a UTC-midnight day value, Part 8.5) is exact — no timezone drift, which is
 *     also why the date is computed in JS rather than by Postgres `now()`.
 *  3. **Live rows only.** A soft-deleted mapping is hidden from the PO consumer
 *     by design (CONTEXT.md "Hide-not-delete"); it survives for history.
 *
 * Returns `null` when nothing current exists — NOT an error. Q5: the user may
 * then type a price by hand, and the line records `mappingId = null`.
 *
 * A price of `null` on an otherwise valid mapping (the column is nullable — Part 8
 * Q8 made price optional) is treated as "no usable price", same as no mapping:
 * the form must not prefill a blank and call it a number.
 */
export async function resolveSupplierPriceLogic(
  tenantId: string,
  productId: string,
  supplierId: string,
  branchId: string,
  asOf?: Date
): Promise<ResolvedSupplierPrice | null> {
  const today = asOf ?? computeBangkokToday();

  return withTenantContext(tenantId, async (tx) => {
    const currentWindow = {
      tenantId,
      productId,
      supplierId,
      deletedAt: null,
      currentUnitPrice: { not: null },
      effectiveFrom: { lte: today },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
    } satisfies Prisma.SupplierProductMappingWhereInput;

    // Rule 1 — the branch series first, on its own query. Ordering by
    // effectiveFrom DESC makes a same-day supersede (ADR 0010's Option ε) resolve
    // to the newer row even before the older one is closed.
    const branchRow = await tx.supplierProductMapping.findFirst({
      where: { ...currentWindow, branchId },
      select: MAPPING_PRICE_SELECT,
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });

    const row =
      branchRow ??
      (await tx.supplierProductMapping.findFirst({
        where: { ...currentWindow, branchId: null },
        select: MAPPING_PRICE_SELECT,
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      }));

    if (!row || row.currentUnitPrice === null) return null;

    return {
      mappingId: row.id,
      unitPrice: row.currentUnitPrice,
      orderUnitId: row.orderUnit?.id ?? null,
      orderUnitName: row.orderUnit?.unitName ?? null,
      toBaseRatio: row.orderUnit?.toBaseRatio ?? null,
      minOrderQty: row.minOrderQty,
      leadTimeDays: row.leadTimeDays,
      supplierItemCode: row.supplierItemCode,
      scope: branchRow ? "branch" : "tenant",
    };
  });
}

/**
 * Which supplier the order form should offer first for a product, at a branch.
 *
 * `isPreferred` does NOT participate in price resolution (the header already pins
 * the supplier — ADR 0012 consequence 4); this is the one place it is read, to
 * answer "who do we usually buy this from". Branch-specific mappings rank above
 * tenant-default ones, preferred above not, then cheapest.
 */
export async function suggestSuppliersForProductLogic(
  tenantId: string,
  productId: string,
  branchId: string
): Promise<
  { supplierId: string; supplierName: string; isPreferred: boolean; scope: "branch" | "tenant" }[]
> {
  const today = computeBangkokToday();

  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.supplierProductMapping.findMany({
      where: {
        tenantId,
        productId,
        deletedAt: null,
        supplier: { deletedAt: null },
        effectiveFrom: { lte: today },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
          { OR: [{ branchId }, { branchId: null }] },
        ],
      },
      select: {
        supplierId: true,
        branchId: true,
        isPreferred: true,
        currentUnitPrice: true,
        supplier: { select: { nameFull: true } },
      },
      orderBy: [{ isPreferred: "desc" }, { currentUnitPrice: "asc" }],
    });

    // One entry per supplier; a branch-specific row supersedes the default one.
    const bySupplier = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const kept = bySupplier.get(r.supplierId);
      if (!kept || (kept.branchId === null && r.branchId !== null)) {
        bySupplier.set(r.supplierId, r);
      }
    }

    return [...bySupplier.values()].map((r) => ({
      supplierId: r.supplierId,
      supplierName: r.supplier.nameFull,
      isPreferred: r.isPreferred,
      scope: r.branchId !== null ? ("branch" as const) : ("tenant" as const),
    }));
  });
}

// ------------------------------------------------------------
// Order reads
// ------------------------------------------------------------

const PO_LIST_INCLUDE = {
  branch: { select: { id: true, name: true, code: true } },
  supplier: { select: { id: true, nameFull: true, deletedAt: true } },
  _count: { select: { items: true } },
} as const;

const PO_DETAIL_INCLUDE = {
  branch: { select: { id: true, name: true, code: true } },
  supplier: {
    select: {
      id: true,
      nameFull: true,
      code: true,
      contactPhone: true,
      contactEmail: true,
      address: true,
      deletedAt: true,
    },
  },
  createdByUser: { select: { id: true, name: true, email: true } },
  sentByUser: { select: { id: true, name: true, email: true } },
  cancelledByUser: { select: { id: true, name: true, email: true } },
  items: {
    orderBy: { lineNo: "asc" },
    include: {
      product: {
        select: { id: true, name: true, sku: true, deletedAt: true },
      },
      allocations: {
        include: { department: { select: { id: true, name: true, code: true } } },
      },
    },
  },
} as const;

export type PurchaseOrderListRow = Prisma.PurchaseOrderGetPayload<{
  include: typeof PO_LIST_INCLUDE;
}>;

export type PurchaseOrderDetail = Prisma.PurchaseOrderGetPayload<{
  include: typeof PO_DETAIL_INCLUDE;
}>;

/**
 * The order list. Live rows only — a soft-deleted DRAFT is discarded, not hidden
 * pending review (Q9); anything that was ever sent is `CANCELLED` and still here.
 *
 * Newest first by creation, not by `po_number`: the number is a per-branch string
 * ({CODE}-PO-####), so sorting by it would interleave branches alphabetically and
 * break the ordering entirely once a counter passes 9999.
 */
export async function getPurchaseOrdersLogic(
  tenantId: string,
  query: GetPurchaseOrdersQuery = {}
): Promise<PurchaseOrderListRow[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.purchaseOrder.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: PO_LIST_INCLUDE,
      orderBy: [{ createdAt: "desc" }],
    })
  );
}

/**
 * One order with everything the detail and print views render.
 *
 * Returns `null` for an unknown id — including one belonging to another tenant,
 * which the `tenantId` filter turns into "not found" rather than a leak, and one
 * that has been soft-deleted.
 */
export async function getPurchaseOrderByIdLogic(
  tenantId: string,
  id: string
): Promise<PurchaseOrderDetail | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.purchaseOrder.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: PO_DETAIL_INCLUDE,
    })
  );
}

/**
 * Open orders for a (product, branch) — "3 กระสอบกำลังมา" on the stock page, and
 * the read Part 13 will grow into.
 *
 * SENT and PARTIALLY_RECEIVED only: a DRAFT has not been placed with anyone, and
 * RECEIVED/CANCELLED are done. Nothing here is subtracted from anything — it is
 * information, not a reservation (the ledger only ever moves on a real receipt).
 */
export async function getOpenOrderQtyForProductLogic(
  tenantId: string,
  productId: string,
  branchId: string
): Promise<{ lineCount: number; qtyOrderedBase: Prisma.Decimal | null }> {
  return withTenantContext(tenantId, async (tx) => {
    const lines = await tx.purchaseOrderItem.findMany({
      where: {
        tenantId,
        productId,
        purchaseOrder: {
          tenantId,
          branchId,
          deletedAt: null,
          status: { in: ["SENT", "PARTIALLY_RECEIVED"] },
        },
      },
      select: { qtyOrdered: true, qtyReceived: true, toBaseRatio: true },
    });

    if (lines.length === 0) return { lineCount: 0, qtyOrderedBase: null };

    // Outstanding = ordered − already received, converted with the line's OWN
    // frozen ratio (ADR 0012 Q3) — never a fresh ProductUnit lookup.
    const total = lines.reduce(
      (sum, l) => sum.plus(l.qtyOrdered.minus(l.qtyReceived).times(l.toBaseRatio)),
      lines[0].qtyOrdered.minus(lines[0].qtyOrdered) // a typed Decimal zero
    );

    return { lineCount: lines.length, qtyOrderedBase: total };
  });
}

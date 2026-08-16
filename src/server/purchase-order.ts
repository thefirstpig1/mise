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

import {
  Prisma,
  type PrismaClient,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { assertRefBelongsToTenant } from "@/server/product";
import { acquireCounterLock } from "@/server/counter-lock";
import type {
  CancelPurchaseOrderInput,
  GetPurchaseOrdersQuery,
  PurchaseOrderInput,
  PurchaseOrderLineInput,
} from "@/lib/validations/purchase-order";
import type { ClosePurchaseOrderShortInput } from "@/lib/validations/goods-receipt";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
/** THB satang — subtotal / vat / total / line_total are all Decimal(_,2). */
const MONEY_SCALE = 2;

/** Round money the app's way, so the number stored is the number shown. */
const money = (d: Prisma.Decimal): Prisma.Decimal =>
  d.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

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
      ZERO
    );

    return { lineCount: lines.length, qtyOrderedBase: total };
  });
}

// ============================================================
// WRITE PATH (L3b)
// ============================================================
// Q4 in one sentence: a DRAFT is the only thing that can be written to.
//
// **Implementation clarification of Q3.** ADR 0012 says the snapshot is copied
// "at send time". Mechanically it is written on every DRAFT save and simply stops
// changing at SENT, because the columns are NOT NULL and a draft line has to be
// storable. The guarantee is identical — from SENT nothing rewrites the line —
// and it avoids a second resolve step whose only job would be to re-read values
// the draft already holds. Recorded here rather than silently diverging.
// ============================================================

// ------------------------------------------------------------
// Typed errors (L4 maps these to Thai; anything else is a bug and rethrows)
// ------------------------------------------------------------

export class PurchaseOrderNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Purchase order "${id}" does not exist for this tenant`);
    this.name = "PurchaseOrderNotFoundError";
  }
}

/**
 * Thrown when a write targets an order that is no longer a DRAFT (Q4). Carries
 * the current status so the UI can say *why* — "this order was already sent" is
 * actionable, "cannot edit" is not.
 */
export class PurchaseOrderNotEditableError extends Error {
  constructor(
    public readonly id: string,
    public readonly status: string
  ) {
    super(`Purchase order "${id}" is ${status}; only a DRAFT can be modified`);
    this.name = "PurchaseOrderNotEditableError";
  }
}

/** Thrown when a lifecycle transition is not legal from the current status. */
export class PurchaseOrderTransitionError extends Error {
  constructor(
    public readonly id: string,
    public readonly from: string,
    public readonly to: string
  ) {
    super(`Purchase order "${id}" cannot go from ${from} to ${to}`);
    this.name = "PurchaseOrderTransitionError";
  }
}

/** Thrown when `orderUnitId` is not a unit of the line's product. */
export class OrderUnitMismatchError extends Error {
  constructor(
    public readonly unitId: string,
    public readonly productId: string
  ) {
    super(`Unit "${unitId}" is not a unit of product "${productId}"`);
    this.name = "OrderUnitMismatchError";
  }
}

/**
 * Thrown when a line's `supplierProductMappingId` does not belong to this tenant,
 * this product AND this supplier. Provenance that points somewhere else is worse
 * than no provenance: it would be believed.
 */
export class MappingProvenanceMismatchError extends Error {
  constructor(public readonly mappingId: string) {
    super(`Mapping "${mappingId}" is not a price of this product from this supplier`);
    this.name = "MappingProvenanceMismatchError";
  }
}

/**
 * Thrown when the allocation rows of a line do not sum to its `qtyOrdered`.
 *
 * zod already checks this for a client-supplied split; this is the same rule at
 * the layer that writes, so a future non-form caller (an import, Part 13) cannot
 * bypass it. It is also the invariant H.2's trigger pair would have enforced —
 * ADR 0012 Q2 moved it here deliberately.
 */
export class AllocationSumMismatchError extends Error {
  constructor(
    public readonly lineNo: number,
    public readonly allocated: string,
    public readonly ordered: string
  ) {
    super(`Line ${lineNo}: allocations total ${allocated}, line orders ${ordered}`);
    this.name = "AllocationSumMismatchError";
  }
}

/** Thrown when a tenant somehow has no live department to attribute cost to. */
export class NoDepartmentError extends Error {
  constructor(public readonly tenantId: string) {
    super(`Tenant "${tenantId}" has no live department`);
    this.name = "NoDepartmentError";
  }
}

/**
 * Thrown when the po_number generator loses a race — two orders raised for the
 * same branch in the same instant both scan the same max (Pitfall #25, inherited
 * from generateSku). The partial unique index is the backstop; the caller retries.
 */
export class PurchaseOrderNumberConflictError extends Error {
  constructor(public readonly poNumber: string) {
    super(`Purchase order number "${poNumber}" was taken by a concurrent writer`);
    this.name = "PurchaseOrderNumberConflictError";
  }
}

// ------------------------------------------------------------
// Write helpers
// ------------------------------------------------------------

/**
 * Next `{BRANCH_CODE}-PO-####` for a branch (Q8). Mirrors `generateSku`: scan the
 * existing numbers of that shape, take max + 1, pad to 4.
 *
 * Soft-deleted drafts ARE scanned. The unique index is partial, so their numbers
 * are technically free — but a number that was printed on something, even a
 * discarded draft someone screenshotted, should not come back on a different
 * order. Numbers are cheap; confusion is not.
 *
 * Serialised by the counter lock (Part 13.5) so the scan cannot be raced —
 * keyed per BRANCH, because that is the scope the counter runs in and locking
 * the whole tenant would queue up orders that were never going to collide.
 * `purchase_order_number_unique` stays as the backstop (Pitfall #25).
 */
async function generatePoNumber(
  tx: PrismaClient,
  tenantId: string,
  branchCode: string
): Promise<string> {
  await acquireCounterLock(tx, `po_number:${tenantId}:${branchCode}`);

  const prefix = `${branchCode}-PO-`;
  const rows = await tx.purchaseOrder.findMany({
    where: { tenantId, poNumber: { startsWith: prefix } },
    select: { poNumber: true },
  });

  const re = new RegExp(`^${branchCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-PO-(\\d+)$`);
  let max = 0;
  for (const { poNumber } of rows) {
    const m = re.exec(poNumber);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** The department a line falls to when the caller supplies no split (Q2). */
async function resolveDefaultDepartmentId(
  tx: PrismaClient,
  tenantId: string
): Promise<string> {
  const dept =
    (await tx.department.findFirst({
      where: { tenantId, deletedAt: null, code: "MAIN" },
      select: { id: true },
    })) ??
    (await tx.department.findFirst({
      where: { tenantId, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }));

  if (!dept) throw new NoDepartmentError(tenantId);
  return dept.id;
}

type PreparedLine = {
  productId: string;
  lineNo: number;
  qtyOrdered: Prisma.Decimal;
  orderUnitId: string;
  orderUnitName: string;
  toBaseRatio: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  supplierProductMappingId: string | null;
  notes: string | null;
  allocations: { departmentId: string; qtyAllocated: Prisma.Decimal }[];
};

/**
 * Validate one input line and resolve everything it will freeze (Q3).
 *
 * Every reference is checked against the tenant, and the unit against the
 * PRODUCT: an order unit borrowed from another product would silently convert
 * the receipt with the wrong ratio in Part 13.
 */
async function prepareLine(
  tx: PrismaClient,
  tenantId: string,
  supplierId: string,
  line: PurchaseOrderLineInput,
  lineNo: number,
  defaultDepartmentId: string
): Promise<PreparedLine> {
  await assertRefBelongsToTenant(tx, tenantId, "product", line.productId);

  const unit = await tx.productUnit.findFirst({
    where: { id: line.orderUnitId, productId: line.productId },
    select: { id: true, unitName: true, toBaseRatio: true },
  });
  if (!unit) throw new OrderUnitMismatchError(line.orderUnitId, line.productId);

  if (line.supplierProductMappingId) {
    const mapping = await tx.supplierProductMapping.findFirst({
      where: {
        id: line.supplierProductMappingId,
        tenantId,
        productId: line.productId,
        supplierId,
      },
      select: { id: true },
    });
    if (!mapping) {
      throw new MappingProvenanceMismatchError(line.supplierProductMappingId);
    }
  }

  const qtyOrdered = new Prisma.Decimal(line.qtyOrdered);
  const unitPrice = new Prisma.Decimal(line.unitPrice);
  const lineTotal = money(qtyOrdered.times(unitPrice));

  const allocations = line.allocations?.length
    ? line.allocations.map((a) => ({
        departmentId: a.departmentId,
        qtyAllocated: new Prisma.Decimal(a.qtyAllocated),
      }))
    : [{ departmentId: defaultDepartmentId, qtyAllocated: qtyOrdered }];

  // Q2's invariant, at the layer that writes (see AllocationSumMismatchError).
  const allocated = allocations.reduce((sum, a) => sum.plus(a.qtyAllocated), ZERO);
  if (!allocated.equals(qtyOrdered)) {
    throw new AllocationSumMismatchError(
      lineNo,
      allocated.toString(),
      qtyOrdered.toString()
    );
  }
  for (const a of allocations) {
    await assertRefBelongsToTenant(tx, tenantId, "department", a.departmentId);
  }

  return {
    productId: line.productId,
    lineNo,
    qtyOrdered,
    orderUnitId: unit.id,
    orderUnitName: unit.unitName,
    toBaseRatio: unit.toBaseRatio,
    unitPrice,
    lineTotal,
    supplierProductMappingId: line.supplierProductMappingId,
    notes: line.notes,
    allocations,
  };
}

/**
 * Header money from the prepared lines (Q6).
 *
 * Rounded at each step, in this order: every line total is already rounded to
 * satang, the subtotal is their exact sum, VAT is rounded once on the subtotal,
 * and the total is the exact sum of the two. Rounding VAT per line instead would
 * drift by a satang per line against the supplier's own invoice.
 */
function computeTotals(
  lines: PreparedLine[],
  vatRatePercent: Prisma.Decimal | null
): {
  subtotalExclVat: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
} {
  const subtotalExclVat = money(lines.reduce((s, l) => s.plus(l.lineTotal), ZERO));
  const vatAmount = vatRatePercent
    ? money(subtotalExclVat.times(vatRatePercent).dividedBy(HUNDRED))
    : ZERO;
  return {
    subtotalExclVat,
    vatAmount,
    totalAmount: money(subtotalExclVat.plus(vatAmount)),
  };
}

/** Translate the po_number unique violation; rethrow anything else untouched. */
function rethrowNumberConflict(e: unknown, poNumber: string): never {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    String(e.meta?.target ?? "").includes("purchase_order_number")
  ) {
    throw new PurchaseOrderNumberConflictError(poNumber);
  }
  throw e;
}

// ------------------------------------------------------------
// Writes
// ------------------------------------------------------------

/**
 * Raise a new DRAFT order with its lines and allocations, in one transaction.
 *
 * Input must already be parsed by `purchaseOrderInputSchema`.
 */
export async function createPurchaseOrderLogic(
  tenantId: string,
  input: PurchaseOrderInput,
  createdBy: string
): Promise<PurchaseOrderDetail> {
  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "supplier", input.supplierId);
    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);

    const branch = await tx.branch.findFirstOrThrow({
      where: { id: input.branchId, tenantId },
      select: { code: true },
    });

    const defaultDepartmentId = await resolveDefaultDepartmentId(tx, tenantId);
    const lines: PreparedLine[] = [];
    for (const [i, line] of input.lines.entries()) {
      lines.push(
        await prepareLine(tx, tenantId, input.supplierId, line, i + 1, defaultDepartmentId)
      );
    }

    const vatRatePercent =
      input.vatRatePercent === null ? null : new Prisma.Decimal(input.vatRatePercent);
    const totals = computeTotals(lines, vatRatePercent);
    const poNumber = await generatePoNumber(tx, tenantId, branch.code);

    try {
      return await tx.purchaseOrder.create({
        data: {
          tenantId,
          branchId: input.branchId,
          supplierId: input.supplierId,
          poNumber,
          status: "DRAFT",
          expectedDeliveryDate: input.expectedDeliveryDate,
          vatRatePercent,
          ...totals,
          notes: input.notes,
          createdBy,
          items: {
            create: lines.map((l) => ({
              tenantId,
              productId: l.productId,
              lineNo: l.lineNo,
              qtyOrdered: l.qtyOrdered,
              orderUnitId: l.orderUnitId,
              orderUnitName: l.orderUnitName,
              toBaseRatio: l.toBaseRatio,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
              supplierProductMappingId: l.supplierProductMappingId,
              notes: l.notes,
              allocations: {
                create: l.allocations.map((a) => ({
                  tenantId,
                  departmentId: a.departmentId,
                  qtyAllocated: a.qtyAllocated,
                })),
              },
            })),
          },
        },
        include: PO_DETAIL_INCLUDE,
      });
    } catch (e) {
      rethrowNumberConflict(e, poNumber);
    }
  });
}

/**
 * Replace the editable body of a DRAFT (Q4).
 *
 * Lines are replaced WHOLESALE — deleted and re-created — rather than diffed.
 * A draft line has no identity worth preserving (nothing references it until the
 * order is sent, and Part 13 only ever sees sent orders), and a wholesale replace
 * is the one shape that cannot leave a stale allocation behind. `po_number`,
 * branch and supplier are NOT re-derivable here: the number is already issued,
 * and changing the supplier would invalidate every price on the order — that is a
 * new draft, not an edit.
 */
export async function updatePurchaseOrderLogic(
  tenantId: string,
  id: string,
  input: PurchaseOrderInput
): Promise<PurchaseOrderDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.purchaseOrder.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { id: true, status: true, supplierId: true, branchId: true },
    });
    if (!existing) throw new PurchaseOrderNotFoundError(id);
    if (existing.status !== "DRAFT") {
      throw new PurchaseOrderNotEditableError(id, existing.status);
    }

    const defaultDepartmentId = await resolveDefaultDepartmentId(tx, tenantId);
    const lines: PreparedLine[] = [];
    for (const [i, line] of input.lines.entries()) {
      lines.push(
        await prepareLine(tx, tenantId, existing.supplierId, line, i + 1, defaultDepartmentId)
      );
    }

    const vatRatePercent =
      input.vatRatePercent === null ? null : new Prisma.Decimal(input.vatRatePercent);
    const totals = computeTotals(lines, vatRatePercent);

    // Allocations go with their lines (FK is ON DELETE CASCADE).
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });

    return tx.purchaseOrder.update({
      where: { id },
      data: {
        expectedDeliveryDate: input.expectedDeliveryDate,
        vatRatePercent,
        ...totals,
        notes: input.notes,
        items: {
          create: lines.map((l) => ({
            tenantId,
            productId: l.productId,
            lineNo: l.lineNo,
            qtyOrdered: l.qtyOrdered,
            orderUnitId: l.orderUnitId,
            orderUnitName: l.orderUnitName,
            toBaseRatio: l.toBaseRatio,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            supplierProductMappingId: l.supplierProductMappingId,
            notes: l.notes,
            allocations: {
              create: l.allocations.map((a) => ({
                tenantId,
                departmentId: a.departmentId,
                qtyAllocated: a.qtyAllocated,
              })),
            },
          })),
        },
      },
      include: PO_DETAIL_INCLUDE,
    });
  });
}

/**
 * DRAFT → SENT (Q4). The document leaves the building: `sent_at` is stamped and
 * the row becomes immutable to every other write path in this file.
 *
 * Nothing is re-resolved here — the draft already holds its snapshot (see the
 * clarification at the top of this section). What this transition adds is the
 * only thing that cannot be known earlier: that it was actually sent, and when.
 */
export async function sendPurchaseOrderLogic(
  tenantId: string,
  id: string,
  sentBy: string
): Promise<PurchaseOrderDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.purchaseOrder.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { id: true, status: true, _count: { select: { items: true } } },
    });
    if (!existing) throw new PurchaseOrderNotFoundError(id);
    if (existing.status !== "DRAFT") {
      throw new PurchaseOrderTransitionError(id, existing.status, "SENT");
    }
    // An order with nothing on it is not a document anyone can act on.
    if (existing._count.items === 0) {
      throw new PurchaseOrderTransitionError(id, "DRAFT (empty)", "SENT");
    }

    return tx.purchaseOrder.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), sentBy },
      include: PO_DETAIL_INCLUDE,
    });
  });
}

/**
 * → CANCELLED (Q9). Legal from DRAFT and SENT only.
 *
 * PARTIALLY_RECEIVED / RECEIVED are refused on purpose: goods have physically
 * arrived and are already in the ledger, so "cancelling" would need a reversal
 * story that belongs to Part 13, not a status flip here. RECEIVED and CANCELLED
 * are terminal.
 */
export async function cancelPurchaseOrderLogic(
  tenantId: string,
  input: CancelPurchaseOrderInput,
  cancelledBy: string
): Promise<PurchaseOrderDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.purchaseOrder.findFirst({
      where: { tenantId, id: input.id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) throw new PurchaseOrderNotFoundError(input.id);
    if (existing.status !== "DRAFT" && existing.status !== "SENT") {
      throw new PurchaseOrderTransitionError(input.id, existing.status, "CANCELLED");
    }

    return tx.purchaseOrder.update({
      where: { id: input.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy,
        cancelReason: input.cancelReason,
      },
      include: PO_DETAIL_INCLUDE,
    });
  });
}

/**
 * Soft-delete a DRAFT (Q9) — the discard button on something never sent.
 *
 * Anything else refuses: a sent document is cancelled, never hidden. The DB
 * agrees (`purchase_order_soft_delete_check`), so this guard and the constraint
 * would have to both fail for a sent order to vanish.
 */
export async function deletePurchaseOrderDraftLogic(
  tenantId: string,
  id: string
): Promise<PurchaseOrder> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.purchaseOrder.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) throw new PurchaseOrderNotFoundError(id);
    if (existing.status !== "DRAFT") {
      throw new PurchaseOrderNotEditableError(id, existing.status);
    }

    return tx.purchaseOrder.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  });
}

// ------------------------------------------------------------
// Receipt-driven status (Part 13, ADR 0013 Q2/Q8)
// ------------------------------------------------------------
// ADR 0012 Q4 reserved PARTIALLY_RECEIVED / RECEIVED for Part 13. They live here
// rather than in goods-receipt.ts because a purchase order owns its own status
// machine — a GR is just the event that moves it.

/**
 * Recompute an order's status from its lines' `qty_received`.
 *
 * DERIVED, never set by hand: called after every confirm, void and close, so the
 * status can only ever disagree with the quantities if this function is wrong.
 *
 * - every line fully received → `RECEIVED`
 * - some quantity received    → `PARTIALLY_RECEIVED`
 * - nothing received          → `SENT` (a void of the only receipt undoes it fully)
 *
 * `DRAFT` and `CANCELLED` are left alone — neither can have receipts, and a
 * cancelled order that somehow did must not be quietly resurrected. A manual
 * short-close (Q8) also wins: someone decided this order was finished, and a
 * later recompute is not entitled to reopen it.
 *
 * Takes a `tx` (like the ledger primitive) because it always runs inside the same
 * transaction as the receipt write that triggered it.
 */
export async function recalcPurchaseOrderReceiptStatus(
  tx: PrismaClient,
  tenantId: string,
  purchaseOrderId: string
): Promise<PurchaseOrderStatus | null> {
  const po = await tx.purchaseOrder.findFirst({
    where: { tenantId, id: purchaseOrderId },
    select: {
      id: true,
      status: true,
      closedShortAt: true,
      items: { select: { qtyOrdered: true, qtyReceived: true } },
    },
  });
  if (!po) return null;
  if (po.status === "DRAFT" || po.status === "CANCELLED") return po.status;

  const next: PurchaseOrderStatus = po.closedShortAt
    ? "RECEIVED"
    : po.items.length > 0 &&
        po.items.every((i) => i.qtyReceived.greaterThanOrEqualTo(i.qtyOrdered))
      ? "RECEIVED"
      : po.items.some((i) => i.qtyReceived.greaterThan(ZERO))
        ? "PARTIALLY_RECEIVED"
        : "SENT";

  if (next === po.status) return next;
  await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: next } });
  return next;
}

/**
 * Declare a short-delivered order finished (Q8).
 *
 * Legal only from `PARTIALLY_RECEIVED`: a `SENT` order with nothing received is
 * cancelled, not closed, and a `RECEIVED` one needs no help. The three stamps are
 * what stop the status from being a lie — `RECEIVED` with quantities that say
 * otherwise, and a sentence explaining why.
 */
export async function closePurchaseOrderShortLogic(
  tenantId: string,
  input: ClosePurchaseOrderShortInput,
  closedBy: string
): Promise<PurchaseOrderDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.purchaseOrder.findFirst({
      where: { tenantId, id: input.id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) throw new PurchaseOrderNotFoundError(input.id);
    if (existing.status !== "PARTIALLY_RECEIVED") {
      throw new PurchaseOrderTransitionError(input.id, existing.status, "RECEIVED");
    }

    return tx.purchaseOrder.update({
      where: { id: input.id },
      data: {
        status: "RECEIVED",
        closedShortAt: new Date(),
        closedShortBy: closedBy,
        closedShortReason: input.closedShortReason,
      },
      include: PO_DETAIL_INCLUDE,
    });
  });
}

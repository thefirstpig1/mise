// ============================================================
// Mise — Goods Receipt logic (Sprint 2 Part 13; ADR 0013)
// ============================================================
// Same shape as src/server/{product,purchase-order,stock-movement}.ts: every fn
// takes `tenantId` FIRST, runs inside withTenantContext, and filters `tenantId`
// EXPLICITLY (app-layer isolation is the live guard; RLS inert until Sprint 7 —
// ADR 0004).
//
// This is where the loop closes: PO → รับของ → ledger. A confirm writes one
// PO_RECEIVE movement per line through Part 10's primitive, increments each PO
// line's qty_received, and recomputes the order's status. A void appends
// PO_RECEIVE_REVERSAL movements through the SAME primitive — the ledger is never
// mutated (ADR 0011 Q7).
//
// Decimal values stay Prisma.Decimal here; stringification for Client Components
// is the L4/L5 view serializer's job (Pitfall #20).
// ============================================================

import {
  Prisma,
  type GoodsReceipt,
  type GoodsReceiptStatus,
  type PrismaClient,
} from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";
import { acquireCounterLock } from "@/server/counter-lock";
import {
  NoDepartmentError,
  recalcPurchaseOrderReceiptStatus,
} from "@/server/purchase-order";
import {
  createStockMovementLogic,
  QtyRoundsToZeroError,
  toBaseQty,
} from "@/server/stock-movement";
import {
  createExpenseFromGoodsReceiptTx,
  voidExpenseForGoodsReceiptTx,
} from "@/server/expense";
import {
  RECEIVABLE_PO_STATUSES,
  type GetGoodsReceiptsQuery,
  type GoodsReceiptInput,
  type VoidGoodsReceiptInput,
} from "@/lib/validations/goods-receipt";

const ZERO = new Prisma.Decimal(0);
/** THB satang — line_total_actual is Decimal(_,2). */
const MONEY_SCALE = 2;

/** Round money the app's way, so the number stored is the number shown. */
const money = (d: Prisma.Decimal): Prisma.Decimal =>
  d.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

// ============================================================
// READ PATH (L3a)
// ============================================================

const GR_LIST_INCLUDE = {
  branch: { select: { id: true, name: true, code: true } },
  supplier: { select: { id: true, nameFull: true, deletedAt: true } },
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
  receivedByUser: { select: { id: true, name: true, email: true } },
  _count: { select: { items: true } },
} as const;

const GR_DETAIL_INCLUDE = {
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
  purchaseOrder: {
    select: { id: true, poNumber: true, status: true, expectedDeliveryDate: true },
  },
  receivedByUser: { select: { id: true, name: true, email: true } },
  confirmedByUser: { select: { id: true, name: true, email: true } },
  voidedByUser: { select: { id: true, name: true, email: true } },
  items: {
    orderBy: { lineNo: "asc" },
    include: {
      product: { select: { id: true, name: true, sku: true, deletedAt: true } },
      // The ordered side, so the detail page can show variance without a second
      // query. These are the PO line's FROZEN values (ADR 0012 Q3).
      purchaseOrderItem: {
        select: {
          id: true,
          lineNo: true,
          qtyOrdered: true,
          qtyReceived: true,
          orderUnitName: true,
          unitPrice: true,
        },
      },
      allocations: {
        include: { department: { select: { id: true, name: true, code: true } } },
      },
    },
  },
} as const;

export type GoodsReceiptListRow = Prisma.GoodsReceiptGetPayload<{
  include: typeof GR_LIST_INCLUDE;
}>;

export type GoodsReceiptDetail = Prisma.GoodsReceiptGetPayload<{
  include: typeof GR_DETAIL_INCLUDE;
}>;

/**
 * The receipt list. Live rows only — a soft-deleted DRAFT is discarded (Q6);
 * anything confirmed is still here, VOIDED or not.
 *
 * Newest **received** first, not newest created: a receipt entered on Tuesday for
 * Monday's delivery belongs on Monday in the eyes of whoever is checking stock.
 * `createdAt` breaks ties so the order is total (two deliveries can share a
 * minute).
 */
export async function getGoodsReceiptsLogic(
  tenantId: string,
  query: GetGoodsReceiptsQuery = {}
): Promise<GoodsReceiptListRow[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.goodsReceipt.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.purchaseOrderId
          ? { purchaseOrderId: query.purchaseOrderId }
          : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.discrepancyOnly ? { hasDiscrepancy: true } : {}),
      },
      include: GR_LIST_INCLUDE,
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    })
  );
}

/**
 * One receipt with everything the detail and print views render.
 *
 * Returns `null` for an unknown id — including one belonging to another tenant,
 * which the `tenantId` filter turns into "not found" rather than a leak, and one
 * that has been soft-deleted.
 */
export async function getGoodsReceiptByIdLogic(
  tenantId: string,
  id: string
): Promise<GoodsReceiptDetail | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.goodsReceipt.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: GR_DETAIL_INCLUDE,
    })
  );
}

/** One PO line as the receive form needs it: what was ordered, what is still due. */
export type ReceivableLine = {
  purchaseOrderItemId: string;
  lineNo: number;
  productId: string;
  productName: string;
  productSku: string | null;
  orderUnitId: string;
  /** FROZEN on the PO line (ADR 0012 Q3) — never re-read from ProductUnit. */
  orderUnitName: string;
  toBaseRatio: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  qtyOrdered: Prisma.Decimal;
  qtyReceived: Prisma.Decimal;
  /** `qtyOrdered − qtyReceived`, floored at 0 — an over-received line is not "due". */
  qtyOutstanding: Prisma.Decimal;
};

export type ReceivablePurchaseOrder = {
  id: string;
  poNumber: string;
  status: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  expectedDeliveryDate: Date | null;
  /**
   * The rate the ORDER was raised with (Part 16). The receive form starts from
   * it, and the receiver may correct it against the tax invoice that actually
   * came with the delivery — the GR is where actuals are recorded.
   */
  vatRatePercent: Prisma.Decimal | null;
  lines: ReceivableLine[];
};

/**
 * The PO a receipt is about to be written against, with each line's outstanding
 * quantity — the form's prefill (Q1).
 *
 * The snapshot fields come straight off the PO line and are handed to the form
 * as-is, which is the whole point of ADR 0012 Consequence 1: the ratio that
 * converts this receipt to base units was decided the day the order was sent,
 * and re-deriving it from the live `ProductUnit` is exactly the bug Q3 closed.
 *
 * Returns `null` for an unknown / foreign / soft-deleted order. A DRAFT or
 * CANCELLED order is a *refusal*, not a not-found, so that is the write layer's
 * `PurchaseOrderNotReceivableError` — here it simply comes back with its status
 * for the page to render an explanation.
 */
export async function getReceivablePurchaseOrderLogic(
  tenantId: string,
  purchaseOrderId: string
): Promise<ReceivablePurchaseOrder | null> {
  return withTenantContext(tenantId, async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { tenantId, id: purchaseOrderId, deletedAt: null },
      include: {
        branch: { select: { id: true, name: true } },
        supplier: { select: { id: true, nameFull: true } },
        items: {
          orderBy: { lineNo: "asc" },
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });
    if (!po) return null;

    return {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      branchId: po.branchId,
      branchName: po.branch.name,
      supplierId: po.supplierId,
      supplierName: po.supplier.nameFull,
      expectedDeliveryDate: po.expectedDeliveryDate,
      vatRatePercent: po.vatRatePercent,
      lines: po.items.map((i) => {
        const outstanding = i.qtyOrdered.minus(i.qtyReceived);
        return {
          purchaseOrderItemId: i.id,
          lineNo: i.lineNo,
          productId: i.productId,
          productName: i.product.name,
          productSku: i.product.sku,
          orderUnitId: i.orderUnitId,
          orderUnitName: i.orderUnitName,
          toBaseRatio: i.toBaseRatio,
          unitPrice: i.unitPrice,
          qtyOrdered: i.qtyOrdered,
          qtyReceived: i.qtyReceived,
          // Floor at 0: once a line is over-received it owes nothing, and a
          // negative default in the form would read as a return.
          qtyOutstanding: outstanding.greaterThan(ZERO) ? outstanding : ZERO,
        };
      }),
    };
  });
}

/**
 * Every receipt that touched a PO, for the order detail page's progress panel.
 * VOIDED receipts are included on purpose — "this arrived and was then reversed"
 * is part of the order's story, and hiding it would make `qty_received` look
 * unexplained.
 */
export async function getGoodsReceiptsForPurchaseOrderLogic(
  tenantId: string,
  purchaseOrderId: string
): Promise<GoodsReceiptListRow[]> {
  return getGoodsReceiptsLogic(tenantId, { purchaseOrderId });
}

// ============================================================
// Shared helpers used by both paths
// ============================================================

/**
 * Split a received quantity across the PO line's department allocations, by
 * ratio (master-spec H.3).
 *
 * Rounding is largest-remainder: give everyone their floor, then hand the leftover
 * thousandths out to the biggest shares first, tie-broken by lowest id. That is
 * H.3's rule verbatim, and it guarantees the parts sum EXACTLY to the whole —
 * which the write transaction then asserts, because a rounding drift of one
 * thousandth would otherwise fail the invariant on a perfectly valid receipt.
 *
 * With departments off there is one allocation and this returns the whole
 * quantity to it (ADR 0013 Consequence 7). It is written properly anyway so that
 * the day a second department exists, only the UI is missing.
 */
export function prorateAllocations(
  poAllocations: { id: string; departmentId: string; qtyAllocated: Prisma.Decimal }[],
  qtyOrdered: Prisma.Decimal,
  qtyReceived: Prisma.Decimal
): { departmentId: string; sourcePoAllocationId: string; qty: Prisma.Decimal }[] {
  if (poAllocations.length === 0) return [];

  // Work in integer thousandths — the column's scale — so "sums exactly" is a
  // fact about integers rather than a hope about floats.
  const SCALE = new Prisma.Decimal(1000);
  const totalThousandths = qtyReceived.mul(SCALE).round().toNumber();

  const shares = poAllocations.map((a) => {
    const exact = qtyOrdered.isZero()
      ? new Prisma.Decimal(totalThousandths).div(poAllocations.length)
      : a.qtyAllocated.div(qtyOrdered).mul(totalThousandths);
    const floor = Math.floor(exact.toNumber());
    return {
      id: a.id,
      departmentId: a.departmentId,
      qtyAllocated: a.qtyAllocated,
      floor,
      remainder: exact.toNumber() - floor,
    };
  });

  let leftover = totalThousandths - shares.reduce((t, s) => t + s.floor, 0);

  // H.3: "add remainder to the largest allocation; tiebreak by lowest id."
  const order = [...shares].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.qtyAllocated.comparedTo(a.qtyAllocated) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  for (const s of order) {
    if (leftover <= 0) break;
    s.floor += 1;
    leftover -= 1;
  }

  return shares
    .filter((s) => s.floor !== 0)
    .map((s) => ({
      departmentId: s.departmentId,
      sourcePoAllocationId: s.id,
      qty: new Prisma.Decimal(s.floor).div(SCALE),
    }));
}

/** `round(qty × price, 2)` — computed in the app, stored, never re-derived. */
export function lineTotal(
  qty: Prisma.Decimal,
  unitPrice: Prisma.Decimal
): Prisma.Decimal {
  return money(qty.mul(unitPrice));
}

/**
 * The default department for a tenant with departments off: "MAIN" if it exists,
 * else the oldest live one. Mirrors `resolveDefaultDepartmentId` in
 * purchase-order.ts — duplicated rather than shared because the two Parts'
 * notions of "default" are free to diverge when departments become reachable.
 */
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

// ============================================================
// WRITE PATH (L3b)
// ============================================================
// Q2 in one sentence: a DRAFT is the only thing that can be written to, and
// CONFIRM is the single moment stock moves.
//
// The confirm and void transactions are the only places in the codebase that
// call the ledger primitive more than once, which is why they pass an explicit
// timeout (ADR 0013 Consequence 5).

/** A twenty-line receipt writes ~60 rows against Neon; 5s is not enough. */
const WRITE_TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

// ------------------------------------------------------------
// Typed errors (L4 maps these to Thai; anything else is a bug and rethrows)
// ------------------------------------------------------------

export class GoodsReceiptNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Goods receipt "${id}" does not exist for this tenant`);
    this.name = "GoodsReceiptNotFoundError";
  }
}

/** Only a DRAFT can be edited or discarded (Q2/Q6). */
export class GoodsReceiptNotEditableError extends Error {
  constructor(
    public readonly id: string,
    public readonly status: GoodsReceiptStatus
  ) {
    super(`Goods receipt "${id}" is ${status} and cannot be edited`);
    this.name = "GoodsReceiptNotEditableError";
  }
}

export class GoodsReceiptTransitionError extends Error {
  constructor(
    public readonly id: string,
    public readonly from: string,
    public readonly to: GoodsReceiptStatus
  ) {
    super(`Goods receipt "${id}" cannot go ${from} → ${to}`);
    this.name = "GoodsReceiptTransitionError";
  }
}

/** A DRAFT or CANCELLED order cannot be received against (Q1). */
export class PurchaseOrderNotReceivableError extends Error {
  constructor(
    public readonly purchaseOrderId: string,
    public readonly status: string
  ) {
    super(`Purchase order "${purchaseOrderId}" is ${status} and cannot be received`);
    this.name = "PurchaseOrderNotReceivableError";
  }
}

/** The received unit is not a unit of THIS product — a standalone-line guard. */
export class ReceivedUnitMismatchError extends Error {
  constructor(
    public readonly unitId: string,
    public readonly productId: string
  ) {
    super(`Unit "${unitId}" is not a unit of product "${productId}"`);
    this.name = "ReceivedUnitMismatchError";
  }
}

/**
 * The receipt and the order it claims to be against disagree — a line pointing at
 * another order's line, a product that is not the one ordered, or a header branch
 * / supplier that is not the order's. Every one of these would silently attribute
 * stock or cost to the wrong document.
 */
export class GoodsReceiptPoMismatchError extends Error {
  constructor(
    public readonly field: string,
    public readonly lineNo?: number
  ) {
    super(
      `Goods receipt does not match its purchase order (${field}${lineNo ? `, line ${lineNo}` : ""})`
    );
    this.name = "GoodsReceiptPoMismatchError";
  }
}

/**
 * Q3: an over-delivery is always accepted, but never silently. The note is the
 * only place the reason for the discrepancy is recorded, and a manager reviewing
 * flagged receipts has nothing else to read.
 */
export class OverReceiptNoteRequiredError extends Error {
  constructor(
    public readonly lineNo: number,
    public readonly outstanding: string,
    public readonly received: string
  ) {
    super(
      `Line ${lineNo} receives ${received} against ${outstanding} outstanding and needs a note`
    );
    this.name = "OverReceiptNoteRequiredError";
  }
}

export class GrAllocationSumMismatchError extends Error {
  constructor(
    public readonly lineNo: number,
    public readonly allocated: string,
    public readonly received: string
  ) {
    super(
      `Line ${lineNo}: allocations sum to ${allocated}, received is ${received}`
    );
    this.name = "GrAllocationSumMismatchError";
  }
}

export class GoodsReceiptNumberConflictError extends Error {
  constructor(public readonly grNumber: string) {
    super(`Goods receipt number "${grNumber}" was taken concurrently`);
    this.name = "GoodsReceiptNumberConflictError";
  }
}

// ------------------------------------------------------------
// Write helpers
// ------------------------------------------------------------

/**
 * Next `{BRANCH_CODE}-GR-####` for a branch. Mirrors `generatePoNumber`, which
 * mirrors `generateSku`: scan the numbers of that shape, take max + 1, pad to 4.
 *
 * Soft-deleted drafts ARE scanned — a number that was on screen should not come
 * back on a different document. Serialised per branch by the counter lock
 * (Part 13.5, the fix that closed Pitfall #25 for all three generators);
 * `goods_receipt_number_unique` stays as the backstop.
 */
async function generateGrNumber(
  tx: PrismaClient,
  tenantId: string,
  branchCode: string
): Promise<string> {
  await acquireCounterLock(tx, `gr_number:${tenantId}:${branchCode}`);

  const prefix = `${branchCode}-GR-`;
  const rows = await tx.goodsReceipt.findMany({
    where: { tenantId, grNumber: { startsWith: prefix } },
    select: { grNumber: true },
  });

  const re = new RegExp(
    `^${branchCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-GR-(\\d+)$`
  );
  let max = 0;
  for (const { grNumber } of rows) {
    const m = re.exec(grNumber);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** Translate the gr_number unique violation; rethrow anything else untouched. */
function rethrowNumberConflict(e: unknown, grNumber: string): never {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    String(e.meta?.target ?? "").includes("goods_receipt_number")
  ) {
    throw new GoodsReceiptNumberConflictError(grNumber);
  }
  throw e;
}

type PreparedGrLine = {
  purchaseOrderItemId: string | null;
  productId: string;
  lineNo: number;
  qtyReceivedActual: Prisma.Decimal;
  receivedUnitId: string;
  receivedUnitName: string;
  toBaseRatio: Prisma.Decimal;
  unitPriceActual: Prisma.Decimal;
  lineTotalActual: Prisma.Decimal;
  notes: string | null;
  allocations: {
    departmentId: string;
    qtyAllocatedActual: Prisma.Decimal;
    sourcePoAllocationId: string | null;
  }[];
  /** True when this line receives more than its PO line still owes (Q3). */
  isOverReceipt: boolean;
  /** True when the invoiced price differs from the ordered price (Q7). */
  isPriceVariance: boolean;
};

/**
 * Validate one input line and resolve everything it will freeze.
 *
 * The heart of ADR 0012 Consequence 1 lives here: when the line points at a PO
 * line, its unit name and `to_base_ratio` are **copied from that PO line**, not
 * looked up from the live `ProductUnit`. Order "1 sack × 25 kg" on the 1st,
 * someone edits the sack to 30 on the 5th, goods arrive on the 10th — this
 * receipt still converts at 25, because that is what the order meant.
 *
 * A standalone line has no such history, so it snapshots the live ProductUnit:
 * the receipt IS the originating record (Q1).
 */
async function prepareLine(
  tx: PrismaClient,
  tenantId: string,
  purchaseOrderId: string | null,
  line: GoodsReceiptInput["lines"][number],
  lineNo: number,
  defaultDepartmentId: string
): Promise<PreparedGrLine> {
  await assertRefBelongsToTenant(tx, tenantId, "product", line.productId);

  const qtyReceivedActual = new Prisma.Decimal(line.qtyReceivedActual);
  const unitPriceActual = new Prisma.Decimal(line.unitPriceActual);

  let receivedUnitName: string;
  let toBaseRatio: Prisma.Decimal;
  let isOverReceipt = false;
  let isPriceVariance = false;
  let allocations: PreparedGrLine["allocations"];

  if (line.purchaseOrderItemId) {
    const poItem = await tx.purchaseOrderItem.findFirst({
      where: { id: line.purchaseOrderItemId, tenantId },
      include: {
        allocations: {
          select: { id: true, departmentId: true, qtyAllocated: true },
        },
      },
    });
    if (!poItem) {
      throw new GoodsReceiptPoMismatchError("purchaseOrderItemId", lineNo);
    }
    if (poItem.purchaseOrderId !== purchaseOrderId) {
      throw new GoodsReceiptPoMismatchError("purchaseOrderId", lineNo);
    }
    if (poItem.productId !== line.productId) {
      throw new GoodsReceiptPoMismatchError("productId", lineNo);
    }
    // The receipt is denominated in the unit the order was placed in. Allowing a
    // different unit here would mean converting through a ratio the order never
    // agreed to, which is the bug ADR 0012 Q3 exists to prevent.
    if (poItem.orderUnitId !== line.receivedUnitId) {
      throw new GoodsReceiptPoMismatchError("receivedUnitId", lineNo);
    }

    receivedUnitName = poItem.orderUnitName; // FROZEN — not a ProductUnit lookup
    toBaseRatio = poItem.toBaseRatio; // FROZEN
    isPriceVariance = !unitPriceActual.equals(poItem.unitPrice);

    const outstanding = poItem.qtyOrdered.minus(poItem.qtyReceived);
    isOverReceipt = qtyReceivedActual.greaterThan(outstanding);
    if (isOverReceipt && !line.notes) {
      throw new OverReceiptNoteRequiredError(
        lineNo,
        outstanding.toString(),
        qtyReceivedActual.toString()
      );
    }

    allocations = line.allocations?.length
      ? line.allocations.map((a) => ({
          departmentId: a.departmentId,
          qtyAllocatedActual: new Prisma.Decimal(a.qtyAllocatedActual),
          sourcePoAllocationId:
            poItem.allocations.find((p) => p.departmentId === a.departmentId)?.id ??
            null,
        }))
      : // H.3 pro-rating against the order's own split.
        prorateAllocations(
          poItem.allocations,
          poItem.qtyOrdered,
          qtyReceivedActual
        ).map((a) => ({
          departmentId: a.departmentId,
          qtyAllocatedActual: a.qty,
          sourcePoAllocationId: a.sourcePoAllocationId,
        }));
  } else {
    const unit = await tx.productUnit.findFirst({
      where: { id: line.receivedUnitId, productId: line.productId },
      select: { id: true, unitName: true, toBaseRatio: true },
    });
    if (!unit) {
      throw new ReceivedUnitMismatchError(line.receivedUnitId, line.productId);
    }
    receivedUnitName = unit.unitName;
    toBaseRatio = unit.toBaseRatio;

    allocations = line.allocations?.length
      ? line.allocations.map((a) => ({
          departmentId: a.departmentId,
          qtyAllocatedActual: new Prisma.Decimal(a.qtyAllocatedActual),
          sourcePoAllocationId: null,
        }))
      : [
          {
            departmentId: defaultDepartmentId,
            qtyAllocatedActual: qtyReceivedActual,
            sourcePoAllocationId: null,
          },
        ];
  }

  // The invariant H.2's trigger pair would have enforced, at the layer that
  // writes (ADR 0012 Q2 / ADR 0013 Consequence 7).
  const allocated = allocations.reduce(
    (sum, a) => sum.plus(a.qtyAllocatedActual),
    ZERO
  );
  if (!allocated.equals(qtyReceivedActual)) {
    throw new GrAllocationSumMismatchError(
      lineNo,
      allocated.toString(),
      qtyReceivedActual.toString()
    );
  }
  for (const a of allocations) {
    await assertRefBelongsToTenant(tx, tenantId, "department", a.departmentId);
  }

  return {
    purchaseOrderItemId: line.purchaseOrderItemId,
    productId: line.productId,
    lineNo,
    qtyReceivedActual,
    receivedUnitId: line.receivedUnitId,
    receivedUnitName,
    toBaseRatio,
    unitPriceActual,
    lineTotalActual: lineTotal(qtyReceivedActual, unitPriceActual),
    notes: line.notes,
    allocations,
    isOverReceipt,
    isPriceVariance,
  };
}

/**
 * Resolve the order a receipt is being written against, and check the header
 * agrees with it. Returns null for a standalone receipt (Q1).
 */
async function resolveReceivablePo(
  tx: PrismaClient,
  tenantId: string,
  input: Pick<GoodsReceiptInput, "purchaseOrderId" | "branchId" | "supplierId">
): Promise<{ id: string; branchCode: string } | null> {
  if (!input.purchaseOrderId) return null;

  const po = await tx.purchaseOrder.findFirst({
    where: { tenantId, id: input.purchaseOrderId, deletedAt: null },
    select: {
      id: true,
      status: true,
      branchId: true,
      supplierId: true,
      branch: { select: { code: true } },
    },
  });
  if (!po) throw new GoodsReceiptPoMismatchError("purchaseOrderId");
  if (!RECEIVABLE_PO_STATUSES.includes(po.status as never)) {
    throw new PurchaseOrderNotReceivableError(po.id, po.status);
  }
  if (po.branchId !== input.branchId) {
    throw new GoodsReceiptPoMismatchError("branchId");
  }
  if (po.supplierId !== input.supplierId) {
    throw new GoodsReceiptPoMismatchError("supplierId");
  }
  return { id: po.id, branchCode: po.branch.code };
}

/** Build the nested-create payload for a prepared line. */
const lineCreateData = (tenantId: string, l: PreparedGrLine) => ({
  tenantId,
  purchaseOrderItemId: l.purchaseOrderItemId,
  productId: l.productId,
  lineNo: l.lineNo,
  qtyReceivedActual: l.qtyReceivedActual,
  receivedUnitId: l.receivedUnitId,
  receivedUnitName: l.receivedUnitName,
  toBaseRatio: l.toBaseRatio,
  unitPriceActual: l.unitPriceActual,
  lineTotalActual: l.lineTotalActual,
  notes: l.notes,
  allocations: {
    create: l.allocations.map((a) => ({
      tenantId,
      departmentId: a.departmentId,
      qtyAllocatedActual: a.qtyAllocatedActual,
      sourcePoAllocationId: a.sourcePoAllocationId,
    })),
  },
});

/**
 * The delivery's VAT, in baht (Part 16, ADR 0016 Q2).
 *
 * DERIVED from the lines and the rate, never posted by the client — which is
 * what keeps "this line's share of `vat_amount`" exactly equal to
 * `line_total_actual × rate/100`, so the cost engine can uplift one layer
 * without reading the receipt's other lines.
 *
 * Reversal lines carry negated totals, so a voided receipt's VAT nets to zero
 * for free — the same property Part 13 relied on for `line_total_actual`.
 */
const grVatAmount = (
  vatRatePercent: Prisma.Decimal | number | null,
  lineTotals: Prisma.Decimal[]
): Prisma.Decimal => {
  if (vatRatePercent === null) return ZERO;
  const rate = new Prisma.Decimal(vatRatePercent);
  if (rate.isZero()) return ZERO;
  const subtotal = lineTotals.reduce((s, t) => s.plus(t), ZERO);
  return money(subtotal.mul(rate).div(100));
};

// ------------------------------------------------------------
// Writes
// ------------------------------------------------------------

/**
 * Raise a new DRAFT receipt with its lines and allocations, in one transaction.
 *
 * **`input.submitKey` becomes the row's id.** That is what makes this call
 * idempotent at the document level: a double POST — progressive enhancement with
 * no JS, back-then-resubmit, a network retry — finds the receipt already there
 * and returns it instead of creating a second one. This is the fix for the second
 * open item in Part 10's post-completion review; the guarantee ADR 0011 Q4 makes
 * for a movement now also holds for the document above it.
 *
 * Input must already be parsed by `goodsReceiptInputSchema`.
 */
export async function createGoodsReceiptLogic(
  tenantId: string,
  input: GoodsReceiptInput,
  receivedBy: string
): Promise<GoodsReceiptDetail> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      // Idempotency, checked before anything is written. A replay returns the
      // document that already exists, whatever state it has since reached.
      const replay = await tx.goodsReceipt.findFirst({
        where: { tenantId, id: input.submitKey },
        include: GR_DETAIL_INCLUDE,
      });
      if (replay) return replay;

      await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
      await assertRefBelongsToTenant(tx, tenantId, "supplier", input.supplierId);

      const po = await resolveReceivablePo(tx, tenantId, input);

      const branch = await tx.branch.findFirst({
        where: { id: input.branchId, tenantId },
        select: { code: true },
      });
      // assertRefBelongsToTenant already proved it exists.
      const branchCode = po?.branchCode ?? branch!.code;

      const defaultDepartmentId = await resolveDefaultDepartmentId(tx, tenantId);

      const prepared: PreparedGrLine[] = [];
      for (const [i, line] of input.lines.entries()) {
        prepared.push(
          await prepareLine(
            tx,
            tenantId,
            input.purchaseOrderId,
            line,
            i + 1,
            defaultDepartmentId
          )
        );
      }

      const grNumber = await generateGrNumber(tx, tenantId, branchCode);

      try {
        return await tx.goodsReceipt.create({
          data: {
            id: input.submitKey,
            tenantId,
            branchId: input.branchId,
            supplierId: input.supplierId,
            purchaseOrderId: input.purchaseOrderId,
            grNumber,
            status: "DRAFT",
            invoiceNo: input.invoiceNo,
            vatRatePercent: input.vatRatePercent,
            vatAmount: grVatAmount(
              input.vatRatePercent,
              prepared.map((l) => l.lineTotalActual)
            ),
            receivedAt: input.receivedAt,
            receivedBy,
            notes: input.notes,
            // Computed for real at confirm, when the numbers are final (Q3/Q7).
            hasDiscrepancy: false,
            items: { create: prepared.map((l) => lineCreateData(tenantId, l)) },
          },
          include: GR_DETAIL_INCLUDE,
        });
      } catch (e) {
        rethrowNumberConflict(e, grNumber);
      }
    },
    WRITE_TX_OPTIONS
  );
}

/**
 * Replace a DRAFT's lines and editable header fields (Q2).
 *
 * Lines are deleted and re-created rather than diffed — allocations cascade with
 * them, and a receipt line has no identity worth preserving before it has posted
 * anything (same call Part 11 made for a draft order).
 *
 * The document's identity — branch, supplier, the order it is against, and its
 * number — is NOT editable. Changing which order a receipt belongs to is a
 * different receipt; the form locks these, and this asserts it rather than
 * silently ignoring what was posted.
 */
export async function updateGoodsReceiptLogic(
  tenantId: string,
  id: string,
  input: GoodsReceiptInput
): Promise<GoodsReceiptDetail> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const existing = await tx.goodsReceipt.findFirst({
        where: { tenantId, id, deletedAt: null },
        select: {
          id: true,
          status: true,
          branchId: true,
          supplierId: true,
          purchaseOrderId: true,
        },
      });
      if (!existing) throw new GoodsReceiptNotFoundError(id);
      if (existing.status !== "DRAFT") {
        throw new GoodsReceiptNotEditableError(id, existing.status);
      }
      if (existing.branchId !== input.branchId) {
        throw new GoodsReceiptPoMismatchError("branchId");
      }
      if (existing.supplierId !== input.supplierId) {
        throw new GoodsReceiptPoMismatchError("supplierId");
      }
      if (existing.purchaseOrderId !== input.purchaseOrderId) {
        throw new GoodsReceiptPoMismatchError("purchaseOrderId");
      }

      const defaultDepartmentId = await resolveDefaultDepartmentId(tx, tenantId);

      const prepared: PreparedGrLine[] = [];
      for (const [i, line] of input.lines.entries()) {
        prepared.push(
          await prepareLine(
            tx,
            tenantId,
            existing.purchaseOrderId,
            line,
            i + 1,
            defaultDepartmentId
          )
        );
      }

      await tx.goodsReceiptItem.deleteMany({ where: { goodsReceiptId: id } });

      return tx.goodsReceipt.update({
        where: { id },
        data: {
          invoiceNo: input.invoiceNo,
          vatRatePercent: input.vatRatePercent,
          vatAmount: grVatAmount(
            input.vatRatePercent,
            prepared.map((l) => l.lineTotalActual)
          ),
          receivedAt: input.receivedAt,
          notes: input.notes,
          items: { create: prepared.map((l) => lineCreateData(tenantId, l)) },
        },
        include: GR_DETAIL_INCLUDE,
      });
    },
    WRITE_TX_OPTIONS
  );
}

/** What a confirm or void reports back — the document, and where stock landed. */
export type GoodsReceiptPostResult = {
  receipt: GoodsReceiptDetail;
  /** Post-write balance per (product, branch) touched — may be negative (Q9). */
  postBalances: {
    productId: string;
    productName: string;
    balance: Prisma.Decimal;
  }[];
};

/**
 * DRAFT → CONFIRMED: the moment stock becomes real (Q2).
 *
 * In one transaction: a `PO_RECEIVE` movement per line through Part 10's
 * primitive, `qty_received` incremented on each PO line it came from, the order's
 * status recomputed, and `has_discrepancy` set from what the lines turned out to
 * say. The ledger primitive is idempotent per `(GR_LINE, line.id)`, so a
 * double-confirm re-posts nothing.
 */
export async function confirmGoodsReceiptLogic(
  tenantId: string,
  id: string,
  confirmedBy: string
): Promise<GoodsReceiptPostResult> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const gr = await tx.goodsReceipt.findFirst({
        where: { tenantId, id, deletedAt: null },
        include: {
          items: {
            orderBy: { lineNo: "asc" },
            include: {
              // `categoryId` is what puts each line on the COGS or the OpEx side
              // of /cost when this confirm writes its expense (ADR 0016 Q3).
              product: { select: { id: true, name: true, categoryId: true } },
              purchaseOrderItem: {
                select: { id: true, qtyOrdered: true, qtyReceived: true, unitPrice: true },
              },
            },
          },
        },
      });
      if (!gr) throw new GoodsReceiptNotFoundError(id);
      if (gr.status !== "DRAFT") {
        throw new GoodsReceiptTransitionError(id, gr.status, "CONFIRMED");
      }
      if (gr.items.length === 0) {
        throw new GoodsReceiptTransitionError(id, "DRAFT (empty)", "CONFIRMED");
      }

      let hasDiscrepancy = false;

      for (const item of gr.items) {
        // ADR 0012 Consequence 1: the LINE'S OWN frozen ratio, always.
        const qtyBase = toBaseQty(item.qtyReceivedActual, item.toBaseRatio);
        if (qtyBase.isZero()) {
          const base = await tx.productUnit.findFirst({
            where: { productId: item.productId, isBase: true },
            select: { unitName: true },
          });
          throw new QtyRoundsToZeroError(
            item.qtyReceivedActual,
            item.receivedUnitName,
            base?.unitName ?? null
          );
        }

        await createStockMovementLogic(tx, {
          tenantId,
          productId: item.productId,
          branchId: gr.branchId,
          qty: qtyBase,
          type: "PO_RECEIVE",
          sourceType: "GR_LINE",
          sourceId: item.id,
          occurredAt: gr.receivedAt,
          createdBy: confirmedBy,
          notes: item.notes,
        });

        if (item.purchaseOrderItem) {
          const po = item.purchaseOrderItem;
          const outstanding = po.qtyOrdered.minus(po.qtyReceived);
          if (
            !item.qtyReceivedActual.equals(outstanding) ||
            !item.unitPriceActual.equals(po.unitPrice)
          ) {
            hasDiscrepancy = true;
          }
          await tx.purchaseOrderItem.update({
            where: { id: po.id },
            data: { qtyReceived: { increment: item.qtyReceivedActual } },
          });
        }
      }

      // Part 16 Q2: whether this shop can reclaim the input VAT is SNAPSHOTTED
      // here, not read at query time. A shop that crosses the ฿1.8M threshold in
      // October and registers must not have the whole year's stock silently
      // re-valued — it did pay that VAT and nobody refunds it. Same rule ADR 0012
      // Q3 applied to `to_base_ratio`: what was true when the transaction
      // happened must not move when the present changes.
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { isVatRegistered: true },
      });

      const receipt = await tx.goodsReceipt.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          confirmedBy,
          hasDiscrepancy,
          vatReclaimable: tenant?.isVatRegistered ?? false,
          // Re-derived from the lines as they finally stand, so a draft edited
          // after its rate was set cannot confirm with a stale amount.
          vatAmount: grVatAmount(
            gr.vatRatePercent,
            gr.items.map((i) => i.lineTotalActual)
          ),
        },
        include: GR_DETAIL_INCLUDE,
      });

      // Q3.1: the bill is written in THIS transaction. `/cost` reads spend from
      // `expense` alone, so a path where stock arrives and the money does not
      // would understate a branch's spend with nothing on screen to explain it.
      await createExpenseFromGoodsReceiptTx(tx, tenantId, gr, confirmedBy);

      if (gr.purchaseOrderId) {
        await recalcPurchaseOrderReceiptStatus(tx, tenantId, gr.purchaseOrderId);
      }

      return { receipt, postBalances: await readPostBalances(tx, tenantId, gr) };
    },
    WRITE_TX_OPTIONS
  );
}

/**
 * CONFIRMED → VOIDED: undo a receipt the only way an append-only ledger allows
 * (Q6).
 *
 * A reversal line is inserted into the SAME document for each original line —
 * negative quantity, `reversal_of_item_id` pointing at what it undoes — and each
 * one posts its own `PO_RECEIVE_REVERSAL` movement. Nothing already in the ledger
 * is touched; the balance nets back to where it was.
 *
 * **The reversals occur NOW, not at the original `received_at`.** Backdating them
 * to the delivery would make the balance "as of" last week silently change, and
 * Part 14 would have to re-cost a period it already closed. A general ledger
 * reverses on the day the error is found, and so does this — the original entry
 * and its reversal are both visible, each with its own true instant.
 */
export async function voidGoodsReceiptLogic(
  tenantId: string,
  input: VoidGoodsReceiptInput,
  voidedBy: string
): Promise<GoodsReceiptPostResult> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const gr = await tx.goodsReceipt.findFirst({
        where: { tenantId, id: input.id, deletedAt: null },
        include: {
          items: {
            orderBy: { lineNo: "asc" },
            include: {
              product: { select: { id: true, name: true } },
              allocations: {
                select: {
                  departmentId: true,
                  qtyAllocatedActual: true,
                  sourcePoAllocationId: true,
                },
              },
            },
          },
        },
      });
      if (!gr) throw new GoodsReceiptNotFoundError(input.id);
      if (gr.status !== "CONFIRMED") {
        throw new GoodsReceiptTransitionError(input.id, gr.status, "VOIDED");
      }

      const voidedAt = new Date();
      const originals = gr.items.filter((i) => i.reversalOfItemId === null);
      let nextLineNo = Math.max(...gr.items.map((i) => i.lineNo)) + 1;

      for (const item of originals) {
        const reversal = await tx.goodsReceiptItem.create({
          data: {
            tenantId,
            goodsReceiptId: gr.id,
            purchaseOrderItemId: item.purchaseOrderItemId,
            productId: item.productId,
            lineNo: nextLineNo++,
            qtyReceivedActual: item.qtyReceivedActual.negated(),
            receivedUnitId: item.receivedUnitId,
            // The snapshot is copied verbatim: a reversal must undo the receipt
            // in exactly the terms the receipt was made in.
            receivedUnitName: item.receivedUnitName,
            toBaseRatio: item.toBaseRatio,
            unitPriceActual: item.unitPriceActual,
            lineTotalActual: item.lineTotalActual.negated(),
            reversalOfItemId: item.id,
            notes: input.voidReason,
            allocations: {
              create: item.allocations.map((a) => ({
                tenantId,
                departmentId: a.departmentId,
                qtyAllocatedActual: a.qtyAllocatedActual.negated(),
                sourcePoAllocationId: a.sourcePoAllocationId,
              })),
            },
          },
        });

        await createStockMovementLogic(tx, {
          tenantId,
          productId: item.productId,
          branchId: gr.branchId,
          qty: toBaseQty(item.qtyReceivedActual, item.toBaseRatio).negated(),
          type: "PO_RECEIVE_REVERSAL",
          sourceType: "GR_LINE",
          sourceId: reversal.id,
          occurredAt: voidedAt,
          createdBy: voidedBy,
          notes: input.voidReason,
        });

        if (item.purchaseOrderItemId) {
          await tx.purchaseOrderItem.update({
            where: { id: item.purchaseOrderItemId },
            data: { qtyReceived: { decrement: item.qtyReceivedActual } },
          });
        }
      }

      const receipt = await tx.goodsReceipt.update({
        where: { id: gr.id },
        data: {
          status: "VOIDED",
          voidedAt,
          voidedBy,
          voidReason: input.voidReason,
        },
        include: GR_DETAIL_INCLUDE,
      });

      // Q3.3: the bill goes with the receipt. Soft-deleted rather than reversed —
      // the ledger needs compensating rows because it is append-only, but an
      // expense is a document, and this receipt already records who voided it
      // and why. Recording that reason twice would let the two disagree.
      await voidExpenseForGoodsReceiptTx(tx, tenantId, gr.id);

      if (gr.purchaseOrderId) {
        // A manual short-close was a decision about deliveries that have now
        // been un-made; leaving it would keep the order RECEIVED on the strength
        // of goods it no longer has.
        await tx.purchaseOrder.updateMany({
          where: { id: gr.purchaseOrderId, tenantId, closedShortAt: { not: null } },
          data: { closedShortAt: null, closedShortBy: null, closedShortReason: null },
        });
        await recalcPurchaseOrderReceiptStatus(tx, tenantId, gr.purchaseOrderId);
      }

      return { receipt, postBalances: await readPostBalances(tx, tenantId, gr) };
    },
    WRITE_TX_OPTIONS
  );
}

/**
 * Soft-delete a DRAFT — the discard button on something that never posted.
 *
 * Anything else refuses: a confirmed receipt is voided, never hidden. The DB
 * agrees (`goods_receipt_soft_delete_check`), so this guard and the constraint
 * would both have to fail for a posted receipt to vanish.
 */
export async function deleteGoodsReceiptDraftLogic(
  tenantId: string,
  id: string
): Promise<GoodsReceipt> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.goodsReceipt.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) throw new GoodsReceiptNotFoundError(id);
    if (existing.status !== "DRAFT") {
      throw new GoodsReceiptNotEditableError(id, existing.status);
    }

    return tx.goodsReceipt.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  });
}

/**
 * Balances for every product this receipt touched, read INSIDE the same
 * transaction so the number returned is the one the write produced.
 *
 * A negative balance is reported, never refused (ADR 0011 Q9) — receiving cannot
 * drive stock negative on its own, but a void can, and that is information the
 * person voiding needs rather than a reason to stop them.
 */
async function readPostBalances(
  tx: PrismaClient,
  tenantId: string,
  gr: { branchId: string; items: { productId: string; product: { name: string } }[] }
): Promise<GoodsReceiptPostResult["postBalances"]> {
  const byProduct = new Map(gr.items.map((i) => [i.productId, i.product.name]));

  const sums = await tx.stockMovement.groupBy({
    by: ["productId"],
    where: {
      tenantId,
      branchId: gr.branchId,
      productId: { in: [...byProduct.keys()] },
    },
    _sum: { qty: true },
  });

  const balances = new Map(sums.map((s) => [s.productId, s._sum.qty ?? ZERO]));
  return [...byProduct].map(([productId, productName]) => ({
    productId,
    productName,
    balance: balances.get(productId) ?? ZERO,
  }));
}

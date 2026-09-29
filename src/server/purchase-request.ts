// ============================================================
// Mise — the purchase request (Sprint 7 Part 38, ADR 0036)
// ============================================================
// The kitchen's always-open list of what one branch needs. Everybody in the
// branch adds to it; each department says "พร้อมแล้ว"; a purchaser CUTS A ROUND
// into draft POs, one per supplier, in one transaction (R3).
//
// What this file stores and what it only READS:
//   - a line's STATUS is never stored (R1) — it is read from the PO lines that
//     point back at it, through requestLineStatus() in src/lib/purchase-request.ts
//   - the conversation is append-only (R2): this file never updates or deletes
//     a message
//   - money leaves this file only for a reader holding a CostAccess ticket (R5);
//     a cook's board carries the cheaper-supplier hint WITHOUT figures
// ============================================================

import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import type { CostAccess } from "@/lib/permissions/cost-access";
import { assertRefBelongsToTenant } from "@/server/product";
import { acquireCounterLock } from "@/server/counter-lock";
import { createPurchaseOrderTx, pickCurrentPrice } from "@/server/purchase-order";
import { quotedUnitPrice } from "@/server/vat-split";
import {
  cheaperElsewhere,
  defaultSupplierId,
  isOutstanding,
  kitchenCanEdit,
  latestKnownPrice,
  readiness,
  requestLineStatus,
  suggestedOrderQty,
  type CheaperHint,
  type OrderLink,
  type Readiness,
  type RequestLineStatus,
  type SupplierPrice,
} from "@/lib/purchase-request";

// ------------------------------------------------------------
// Who is asking
// ------------------------------------------------------------

export type RequestViewer = {
  userId: string;
  role: string;
  /** Holds purchase:approve — cuts rounds, rejects, edits anyone's waiting line. */
  canApprove: boolean;
  /** The ticket for money (R5); null = figures never leave this file. */
  costAccess: CostAccess | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const bangkokIso = (d: Date) => iso(new Date(d.getTime() + 7 * 3_600_000));
const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d.toString()));

// ------------------------------------------------------------
// Typed errors (L4 maps them to Thai)
// ------------------------------------------------------------

export class RequestLineNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Purchase request line "${id}" does not exist here`);
    this.name = "RequestLineNotFoundError";
  }
}

/** The line has left the kitchen's hands (R4), or was never yours to change (Q6). */
export class RequestLineNotEditableError extends Error {
  constructor(
    public readonly id: string,
    public readonly reason: "not_waiting" | "not_yours"
  ) {
    super(`Purchase request line "${id}" cannot be changed: ${reason}`);
    this.name = "RequestLineNotEditableError";
  }
}

export class RequestUnitMismatchError extends Error {
  constructor(public readonly unitId: string) {
    super(`Unit "${unitId}" is not a unit of the requested product`);
    this.name = "RequestUnitMismatchError";
  }
}

/** Cutting a round: a line that is not waiting, or no supplier chosen. */
export class CutLineNotReadyError extends Error {
  constructor(
    public readonly lineId: string,
    public readonly reason: "not_waiting" | "no_supplier" | "wrong_branch"
  ) {
    super(`Request line "${lineId}" cannot be ordered: ${reason}`);
    this.name = "CutLineNotReadyError";
  }
}

/** Q4 — moving a line with a kitchen note to another supplier needs an answer first. */
export class KitchenNoteUnansweredError extends Error {
  constructor(public readonly lineId: string) {
    super(`Request line "${lineId}" carries a kitchen note that must be answered before changing supplier`);
    this.name = "KitchenNoteUnansweredError";
  }
}

// ------------------------------------------------------------
// Shared reads
// ------------------------------------------------------------

/** The departments a line may go to: all live ones, or just Main when departments are off. */
async function departmentsOf(tx: PrismaClient, tenantId: string) {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { enableDepartments: true, defaultVatRatePercent: true },
  });
  // An inactive department is not asked to say ready (Q3) and takes no new lines.
  const all = await tx.department.findMany({
    where: { tenantId, deletedAt: null, isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { createdAt: "asc" },
  });
  const main = all.find((d) => d.code === "MAIN") ?? all[0];
  return {
    enabled: tenant.enableDepartments,
    list: tenant.enableDepartments ? all : main ? [main] : [],
    mainId: main?.id ?? null,
    defaultVatRatePercent: tenant.defaultVatRatePercent,
  };
}

/** Where a line goes when nobody chose: the person's primary department, else Main (Q3). */
async function homeDepartmentId(tx: PrismaClient, tenantId: string, userId: string, mainId: string | null) {
  const primary = await tx.userDepartmentAssignment.findFirst({
    where: {
      isPrimary: true,
      membership: { tenantId, userId, isActive: true },
      department: { deletedAt: null, isActive: true },
    },
    select: { departmentId: true },
  });
  return primary?.departmentId ?? mainId;
}

/** The PO lines pointing back at these request lines, shaped for requestLineStatus. */
async function linksFor(tx: PrismaClient, tenantId: string, lineIds: string[]) {
  const items = await tx.purchaseOrderItem.findMany({
    where: { tenantId, purchaseRequestLineId: { in: lineIds } },
    select: {
      purchaseRequestLineId: true,
      qtyOrdered: true,
      qtyReceived: true,
      orderUnitName: true,
      createdAt: true,
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          status: true,
          deletedAt: true,
          closedShortAt: true,
          expectedDeliveryDate: true,
          supplier: { select: { nameFull: true } },
        },
      },
    },
  });
  const by = new Map<string, OrderLink[]>();
  for (const i of items) {
    const po = i.purchaseOrder;
    const link: OrderLink = {
      poId: po.id,
      poNumber: po.poNumber,
      poStatus: po.status,
      poDeleted: po.deletedAt !== null,
      poClosedShort: po.closedShortAt !== null,
      qtyOrdered: Number(i.qtyOrdered),
      qtyReceived: Number(i.qtyReceived),
      unitName: i.orderUnitName,
      supplierName: po.supplier.nameFull,
      promisedDate: po.expectedDeliveryDate ? iso(po.expectedDeliveryDate) : null,
      createdAt: i.createdAt.toISOString(),
    };
    const k = i.purchaseRequestLineId!;
    by.set(k, [...(by.get(k) ?? []), link]);
  }
  return by;
}

type LineRow = {
  id: string;
  branchId: string;
  productId: string;
  departmentId: string;
  supplierId: string | null;
  requestedBy: string;
  note: string | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
};

async function statusOf(tx: PrismaClient, tenantId: string, line: LineRow): Promise<RequestLineStatus> {
  const links = (await linksFor(tx, tenantId, [line.id])).get(line.id) ?? [];
  return requestLineStatus(
    { rejectedAt: line.rejectedAt?.toISOString() ?? null, rejectReason: line.rejectReason },
    links,
    iso(computeBangkokToday())
  );
}

/** Q6 — who may change a waiting line: its author, a purchaser, or the head of its department. */
async function mayEdit(tx: PrismaClient, tenantId: string, viewer: RequestViewer, line: LineRow) {
  if (viewer.canApprove || line.requestedBy === viewer.userId) return true;
  if (viewer.role !== "dept_head") return false;
  const assigned = await tx.userDepartmentAssignment.findMany({
    where: { membership: { tenantId, userId: viewer.userId, isActive: true } },
    select: { departmentId: true },
  });
  // A head assigned to no department heads the kitchen as a whole (ADR 0034 Q6).
  return assigned.length === 0 || assigned.some((a) => a.departmentId === line.departmentId);
}

const LINE_SELECT = {
  id: true,
  branchId: true,
  productId: true,
  departmentId: true,
  supplierId: true,
  requestedBy: true,
  note: true,
  rejectedAt: true,
  rejectReason: true,
} as const;

async function loadLine(tx: PrismaClient, tenantId: string, id: string): Promise<LineRow> {
  const line = await tx.purchaseRequestLine.findFirst({ where: { id, tenantId, deletedAt: null }, select: LINE_SELECT });
  if (!line) throw new RequestLineNotFoundError(id);
  return line;
}

/** "พร้อมแล้ว" is taken back whenever the department's list changes (Q3). */
async function unready(tx: PrismaClient, tenantId: string, branchId: string, departmentId: string) {
  await tx.purchaseRequestReady.deleteMany({ where: { tenantId, branchId, departmentId } });
}

// ------------------------------------------------------------
// Prices (rule PR2) — per base unit, excl VAT
// ------------------------------------------------------------

/**
 * Every supplier's latest known price for each product: the last price PAID
 * at a confirmed receipt (this branch first, then anywhere — rule SC3's
 * order), else today's price-list price. Two reads for the whole board.
 */
async function supplierPrices(
  tx: PrismaClient,
  tenantId: string,
  branchId: string,
  productIds: string[]
): Promise<Map<string, SupplierPrice[]>> {
  const out = new Map<string, SupplierPrice[]>();
  if (productIds.length === 0) return out;
  const today = computeBangkokToday();

  const [paid, mappings] = await Promise.all([
    tx.goodsReceiptItem.findMany({
      where: {
        tenantId,
        productId: { in: productIds },
        reversalOfItemId: null,
        reversedBy: { none: {} },
        qtyReceivedActual: { gt: 0 },
        goodsReceipt: { status: "CONFIRMED", deletedAt: null, supplier: { deletedAt: null } },
      },
      select: {
        productId: true,
        unitPriceActual: true,
        toBaseRatio: true,
        goodsReceipt: {
          select: { receivedAt: true, branchId: true, supplierId: true, supplier: { select: { nameFull: true } } },
        },
      },
      orderBy: [{ goodsReceipt: { receivedAt: "desc" } }],
    }),
    tx.supplierProductMapping.findMany({
      where: {
        tenantId,
        productId: { in: productIds },
        deletedAt: null,
        supplier: { deletedAt: null },
        OR: [{ branchId }, { branchId: null }],
      },
      select: {
        productId: true,
        supplierId: true,
        branchId: true,
        currentUnitPrice: true,
        effectiveFrom: true,
        effectiveTo: true,
        createdAt: true,
        orderUnit: { select: { toBaseRatio: true } },
        supplier: { select: { nameFull: true } },
      },
    }),
  ]);

  type Acc = { name: string; paidHere?: SupplierPrice; paidAny?: SupplierPrice; list?: SupplierPrice };
  const acc = new Map<string, Map<string, Acc>>();
  const slot = (productId: string, supplierId: string, name: string) => {
    let m = acc.get(productId);
    if (!m) acc.set(productId, (m = new Map()));
    let a = m.get(supplierId);
    if (!a) m.set(supplierId, (a = { name }));
    return a;
  };

  // Newest first, so the first one seen per slot is the latest.
  for (const r of paid) {
    const ratio = Number(r.toBaseRatio);
    if (!(ratio > 0)) continue;
    const a = slot(r.productId, r.goodsReceipt.supplierId, r.goodsReceipt.supplier.nameFull);
    const p: SupplierPrice = {
      supplierId: r.goodsReceipt.supplierId,
      supplierName: r.goodsReceipt.supplier.nameFull,
      pricePerBase: Number(r.unitPriceActual) / ratio,
      asOf: bangkokIso(r.goodsReceipt.receivedAt),
      source: "paid",
    };
    if (r.goodsReceipt.branchId === branchId && !a.paidHere) a.paidHere = p;
    if (!a.paidAny) a.paidAny = p;
  }

  const series = new Map<string, typeof mappings>();
  for (const m of mappings) {
    const k = `${m.productId}|${m.supplierId}`;
    series.set(k, [...(series.get(k) ?? []), m]);
  }
  for (const rows of series.values()) {
    const picked = pickCurrentPrice(rows, branchId, today);
    if (!picked) continue;
    const ratio = picked.row.orderUnit ? Number(picked.row.orderUnit.toBaseRatio) : 1;
    if (!(ratio > 0)) continue;
    const a = slot(picked.row.productId, picked.row.supplierId, picked.row.supplier.nameFull);
    a.list = {
      supplierId: picked.row.supplierId,
      supplierName: picked.row.supplier.nameFull,
      pricePerBase: Number(picked.row.currentUnitPrice) / ratio,
      asOf: iso(picked.row.effectiveFrom),
      source: "list",
    };
  }

  for (const [productId, m] of acc) {
    const list: SupplierPrice[] = [];
    for (const [supplierId, a] of m) {
      const paidP = a.paidHere ?? a.paidAny ?? null;
      const known = latestKnownPrice(
        paidP ? { pricePerBase: paidP.pricePerBase, asOf: paidP.asOf } : null,
        a.list ? { pricePerBase: a.list.pricePerBase, asOf: a.list.asOf } : null
      );
      if (known) list.push({ supplierId, supplierName: a.name, ...known });
    }
    out.set(productId, list);
  }
  return out;
}

/** Q11 — preferred supplier, else the one this branch bought from last. */
async function proposedSupplierId(tx: PrismaClient, tenantId: string, branchId: string, productId: string) {
  const today = computeBangkokToday();
  const preferred = await tx.supplierProductMapping.findFirst({
    where: {
      tenantId,
      productId,
      isPreferred: true,
      deletedAt: null,
      supplier: { deletedAt: null },
      effectiveFrom: { lte: today },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }, { OR: [{ branchId }, { branchId: null }] }],
    },
    orderBy: [{ branchId: { sort: "desc", nulls: "last" } }, { effectiveFrom: "desc" }],
    select: { supplierId: true },
  });
  const last = preferred
    ? null
    : await tx.goodsReceiptItem.findFirst({
        where: {
          tenantId,
          productId,
          reversalOfItemId: null,
          qtyReceivedActual: { gt: 0 },
          goodsReceipt: { branchId, status: "CONFIRMED", deletedAt: null, supplier: { deletedAt: null } },
        },
        orderBy: { goodsReceipt: { receivedAt: "desc" } },
        select: { goodsReceipt: { select: { supplierId: true } } },
      });
  return defaultSupplierId(preferred?.supplierId ?? null, last?.goodsReceipt.supplierId ?? null);
}

// ------------------------------------------------------------
// The board
// ------------------------------------------------------------

export type BoardLine = {
  id: string;
  product: { id: string; name: string; sku: string; baseUnitName: string | null };
  qty: number;
  unit: { id: string; name: string; toBase: number };
  department: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  onHandQty: number | null;
  note: string | null;
  requestedBy: { id: string; name: string };
  requestedAt: string;
  status: RequestLineStatus;
  canEdit: boolean;
  messageCount: number;
  lastMessageAt: string | null;
  /** Rule PR2; `money` present only for a reader holding cost:view (R5). */
  cheaper: CheaperHint | null;
};

export type ParSuggestion = {
  product: { id: string; name: string; sku: string; baseUnitName: string | null };
  parBase: number;
  onHandBase: number;
  onOrderBase: number;
  /** In `unit`, rounded up (rule PR1); null = covered. */
  suggestedQty: number | null;
  unit: { id: string; name: string; toBase: number };
};

export type RequestBoard = {
  branchId: string;
  departments: { id: string; name: string }[];
  departmentsEnabled: boolean;
  homeDepartmentId: string | null;
  lines: BoardLine[];
  readiness: Readiness;
  /** Products below par with nothing already asked for (Q5's side panel). */
  belowPar: ParSuggestion[];
  /** The latest sales day whose stock deduction is posted — how old "on hand" is (Q5). */
  stockAsOfSalesDay: string | null;
};

/** How long a finished line stays on the board before it is only history. */
const FINISHED_VISIBLE_DAYS = 7;

export async function getRequestBoardLogic(tenantId: string, branchId: string, viewer: RequestViewer): Promise<RequestBoard> {
  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "branch", branchId);
    const depts = await departmentsOf(tx, tenantId);
    const home = await homeDepartmentId(tx, tenantId, viewer.userId, depts.mainId);
    const today = computeBangkokToday();
    const since = addDays(today, -60);

    const rows = await tx.purchaseRequestLine.findMany({
      where: { tenantId, branchId, deletedAt: null, requestedAt: { gte: since } },
      include: {
        product: {
          select: { id: true, name: true, sku: true, productUnits: { where: { isBase: true }, select: { unitName: true } } },
        },
        unit: { select: { id: true, unitName: true, toBaseRatio: true } },
        department: { select: { id: true, name: true } },
        supplier: { select: { id: true, nameFull: true } },
        requestedByUser: { select: { id: true, name: true, email: true } },
        messages: { select: { createdAt: true }, orderBy: { createdAt: "desc" } },
      },
      orderBy: { requestedAt: "asc" },
    });

    const links = await linksFor(tx, tenantId, rows.map((r) => r.id));
    const todayIso = iso(today);
    const cutoff = iso(addDays(today, -FINISHED_VISIBLE_DAYS));

    const assigned =
      viewer.role === "dept_head"
        ? (
            await tx.userDepartmentAssignment.findMany({
              where: { membership: { tenantId, userId: viewer.userId, isActive: true } },
              select: { departmentId: true },
            })
          ).map((a) => a.departmentId)
        : [];

    const withStatus = rows
      .map((r) => {
        const status = requestLineStatus(
          { rejectedAt: r.rejectedAt?.toISOString() ?? null, rejectReason: r.rejectReason },
          links.get(r.id) ?? [],
          todayIso
        );
        return { r, status };
      })
      .filter(({ r, status }) => {
        // Finished lines fade out after a week; anything still moving stays.
        if (status.kind === "received" || status.kind === "closed_short") {
          return (status.link.createdAt.slice(0, 10) >= cutoff);
        }
        if (status.kind === "rejected") return iso(r.rejectedAt!) >= cutoff;
        return true;
      });

    const prices = await supplierPrices(tx, tenantId, branchId, [...new Set(withStatus.map(({ r }) => r.productId))]);
    const withMoney = viewer.costAccess !== null;

    const lines: BoardLine[] = withStatus.map(({ r, status }) => {
      const editable =
        kitchenCanEdit(status) &&
        (viewer.canApprove ||
          r.requestedBy === viewer.userId ||
          (viewer.role === "dept_head" && (assigned.length === 0 || assigned.includes(r.departmentId))));
      return {
        id: r.id,
        product: {
          id: r.product.id,
          name: r.product.name,
          sku: r.product.sku,
          baseUnitName: r.product.productUnits[0]?.unitName ?? null,
        },
        qty: Number(r.qty),
        unit: { id: r.unit.id, name: r.unit.unitName, toBase: Number(r.unit.toBaseRatio) },
        department: { id: r.department.id, name: r.department.name },
        supplier: r.supplier ? { id: r.supplier.id, name: r.supplier.nameFull } : null,
        onHandQty: num(r.onHandQty),
        note: r.note,
        requestedBy: { id: r.requestedByUser.id, name: r.requestedByUser.name ?? r.requestedByUser.email ?? "" },
        requestedAt: r.requestedAt.toISOString(),
        status,
        canEdit: editable,
        messageCount: r.messages.length,
        lastMessageAt: r.messages[0]?.createdAt.toISOString() ?? null,
        // Only while a supplier can still be changed does "cheaper" mean anything.
        cheaper:
          status.kind === "waiting" ? cheaperElsewhere(r.supplierId, prices.get(r.productId) ?? [], withMoney) : null,
      };
    });

    // ---- readiness (Q3) ----
    const waitingByDept = new Map<string, number>();
    for (const l of lines) {
      if (l.status.kind === "waiting") waitingByDept.set(l.department.id, (waitingByDept.get(l.department.id) ?? 0) + 1);
    }
    const readyRows = await tx.purchaseRequestReady.findMany({
      where: { tenantId, branchId },
      select: { departmentId: true, readyAt: true, readyByUser: { select: { name: true, email: true } } },
    });
    const ready = new Map(
      readyRows.map((r) => [r.departmentId, { by: r.readyByUser.name ?? r.readyByUser.email ?? "", at: r.readyAt.toISOString() }])
    );

    // ---- below par (Q5) ----
    const asked = new Set(lines.filter((l) => isOutstanding(l.status)).map((l) => l.product.id));
    const belowPar = await belowParFor(tx, tenantId, branchId, asked);

    const lastRun = await tx.salesConsumptionRun.findFirst({
      where: { tenantId, branchId, voidedAt: null },
      orderBy: { businessDate: "desc" },
      select: { businessDate: true },
    });

    return {
      branchId,
      departments: depts.list.map((d) => ({ id: d.id, name: d.name })),
      departmentsEnabled: depts.enabled,
      homeDepartmentId: home,
      lines,
      readiness: readiness(depts.list, waitingByDept, ready),
      belowPar,
      stockAsOfSalesDay: lastRun ? iso(lastRun.businessDate) : null,
    };
  });
}

/**
 * Products short of par at this branch, with what the system believes is on
 * the shelf and what is already on its way — the three inputs of rule PR1.
 * Anything already asked for is left out: adding it takes it off the panel.
 */
async function belowParFor(
  tx: PrismaClient,
  tenantId: string,
  branchId: string,
  alreadyAsked: Set<string>
): Promise<ParSuggestion[]> {
  const pars = await tx.parLevel.findMany({
    where: { tenantId, branchId, deletedAt: null, product: { deletedAt: null } },
    select: {
      productId: true,
      parQty: true,
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true, isDefaultBuyUnit: true } },
        },
      },
    },
  });
  const candidates = pars.filter((p) => !alreadyAsked.has(p.productId));
  if (candidates.length === 0) return [];
  const ids = candidates.map((p) => p.productId);

  const [balances, open] = await Promise.all([
    tx.stockMovement.groupBy({
      by: ["productId"],
      where: { tenantId, branchId, productId: { in: ids } },
      _sum: { qty: true },
    }),
    tx.purchaseOrderItem.findMany({
      where: {
        tenantId,
        productId: { in: ids },
        purchaseOrder: { tenantId, branchId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_RECEIVED"] } },
      },
      select: { productId: true, qtyOrdered: true, qtyReceived: true, toBaseRatio: true },
    }),
  ]);
  const onHand = new Map(balances.map((b) => [b.productId, Number(b._sum.qty ?? 0)]));
  const onOrder = new Map<string, number>();
  for (const o of open) {
    const owed = Number(o.qtyOrdered.minus(o.qtyReceived).times(o.toBaseRatio));
    if (owed > 0) onOrder.set(o.productId, (onOrder.get(o.productId) ?? 0) + owed);
  }

  const out: ParSuggestion[] = [];
  for (const p of candidates) {
    const units = p.product.productUnits;
    const base = units.find((u) => u.isBase);
    const buy = units.find((u) => u.isDefaultBuyUnit) ?? base;
    if (!buy) continue;
    const parBase = Number(p.parQty);
    const onHandBase = onHand.get(p.productId) ?? 0;
    const onOrderBase = onOrder.get(p.productId) ?? 0;
    const toBase = Number(buy.toBaseRatio);
    const suggestedQty = suggestedOrderQty({ par: parBase, systemOnHand: onHandBase, typedOnHand: null, onOrder: onOrderBase, unitToBase: toBase });
    if (suggestedQty === null) continue;
    out.push({
      product: { id: p.product.id, name: p.product.name, sku: p.product.sku, baseUnitName: base?.unitName ?? null },
      parBase,
      onHandBase,
      onOrderBase,
      suggestedQty,
      unit: { id: buy.id, name: buy.unitName, toBase },
    });
  }
  return out.sort((a, b) => a.product.name.localeCompare(b.product.name, "th"));
}

// ------------------------------------------------------------
// Writes by the kitchen
// ------------------------------------------------------------

export type AddLineInput = {
  branchId: string;
  productId: string;
  qty: number;
  unitId: string;
  /** Omitted = the person's home department (Q3). */
  departmentId?: string | null;
  /** undefined = propose one (Q11); null = "ให้จัดซื้อเลือก". */
  supplierId?: string | null;
  onHandQty?: number | null;
  note?: string | null;
};

export type DuplicateLine = { id: string; qty: number; unitName: string; departmentName: string; status: RequestLineStatus["kind"]; poNumber: string | null; promisedDate: string | null };

export type AddLineResult = { ok: true; lineId: string } | { ok: false; duplicates: DuplicateLine[] };

/**
 * Add a line. When the same product is already asked for, or ordered and not
 * yet here, the first press returns what exists instead of adding (Q3 — the
 * guard against ordering twice); pressing again with `acknowledgeDuplicate`
 * adds it anyway, because two departments may genuinely need it.
 */
export async function addRequestLineLogic(
  tenantId: string,
  viewer: RequestViewer,
  input: AddLineInput,
  opts: { acknowledgeDuplicate?: boolean } = {}
): Promise<AddLineResult> {
  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
    await assertRefBelongsToTenant(tx, tenantId, "product", input.productId);
    const unit = await tx.productUnit.findFirst({ where: { id: input.unitId, productId: input.productId }, select: { id: true } });
    if (!unit) throw new RequestUnitMismatchError(input.unitId);

    const depts = await departmentsOf(tx, tenantId);
    const departmentId =
      (depts.enabled ? input.departmentId : null) ?? (await homeDepartmentId(tx, tenantId, viewer.userId, depts.mainId));
    if (!departmentId) throw new Error(`Tenant "${tenantId}" has no live department`);
    await assertRefBelongsToTenant(tx, tenantId, "department", departmentId);

    const supplierId =
      input.supplierId === undefined ? await proposedSupplierId(tx, tenantId, input.branchId, input.productId) : input.supplierId;
    if (supplierId) await assertRefBelongsToTenant(tx, tenantId, "supplier", supplierId);

    if (!opts.acknowledgeDuplicate) {
      const same = await tx.purchaseRequestLine.findMany({
        where: { tenantId, branchId: input.branchId, productId: input.productId, deletedAt: null },
        select: { id: true, qty: true, rejectedAt: true, rejectReason: true, unit: { select: { unitName: true } }, department: { select: { name: true } } },
      });
      const links = await linksFor(tx, tenantId, same.map((s) => s.id));
      const today = iso(computeBangkokToday());
      const duplicates: DuplicateLine[] = [];
      for (const s of same) {
        const st = requestLineStatus({ rejectedAt: s.rejectedAt?.toISOString() ?? null, rejectReason: s.rejectReason }, links.get(s.id) ?? [], today);
        if (!isOutstanding(st)) continue;
        duplicates.push({
          id: s.id,
          qty: Number(s.qty),
          unitName: s.unit.unitName,
          departmentName: s.department.name,
          status: st.kind,
          poNumber: "link" in st ? st.link.poNumber : null,
          promisedDate: st.kind === "promised" ? st.date : null,
        });
      }
      if (duplicates.length > 0) return { ok: false, duplicates };
    }

    const line = await tx.purchaseRequestLine.create({
      data: {
        tenantId,
        branchId: input.branchId,
        productId: input.productId,
        qty: new Prisma.Decimal(input.qty),
        unitId: input.unitId,
        departmentId,
        supplierId: supplierId ?? null,
        onHandQty: input.onHandQty == null ? null : new Prisma.Decimal(input.onHandQty),
        note: input.note ?? null,
        requestedBy: viewer.userId,
      },
      select: { id: true },
    });
    await unready(tx, tenantId, input.branchId, departmentId);
    return { ok: true, lineId: line.id };
  });
}

export type UpdateLineInput = {
  qty: number;
  unitId: string;
  departmentId?: string | null;
  supplierId: string | null;
  onHandQty: number | null;
  note: string | null;
};

export async function updateRequestLineLogic(tenantId: string, viewer: RequestViewer, lineId: string, input: UpdateLineInput) {
  return withTenantContext(tenantId, async (tx) => {
    const line = await loadLine(tx, tenantId, lineId);
    if (!kitchenCanEdit(await statusOf(tx, tenantId, line))) throw new RequestLineNotEditableError(lineId, "not_waiting");
    if (!(await mayEdit(tx, tenantId, viewer, line))) throw new RequestLineNotEditableError(lineId, "not_yours");

    const unit = await tx.productUnit.findFirst({ where: { id: input.unitId, productId: line.productId }, select: { id: true } });
    if (!unit) throw new RequestUnitMismatchError(input.unitId);
    const depts = await departmentsOf(tx, tenantId);
    const departmentId = depts.enabled && input.departmentId ? input.departmentId : line.departmentId;
    await assertRefBelongsToTenant(tx, tenantId, "department", departmentId);
    if (input.supplierId) await assertRefBelongsToTenant(tx, tenantId, "supplier", input.supplierId);

    await tx.purchaseRequestLine.update({
      where: { id: lineId },
      data: {
        qty: new Prisma.Decimal(input.qty),
        unitId: input.unitId,
        departmentId,
        supplierId: input.supplierId,
        onHandQty: input.onHandQty == null ? null : new Prisma.Decimal(input.onHandQty),
        note: input.note,
      },
    });
    await unready(tx, tenantId, line.branchId, line.departmentId);
    if (departmentId !== line.departmentId) await unready(tx, tenantId, line.branchId, departmentId);
  });
}

/** Withdraw a line the kitchen no longer needs. Only while it is still waiting (R4). */
export async function deleteRequestLineLogic(tenantId: string, viewer: RequestViewer, lineId: string) {
  return withTenantContext(tenantId, async (tx) => {
    const line = await loadLine(tx, tenantId, lineId);
    if (!kitchenCanEdit(await statusOf(tx, tenantId, line))) throw new RequestLineNotEditableError(lineId, "not_waiting");
    if (!(await mayEdit(tx, tenantId, viewer, line))) throw new RequestLineNotEditableError(lineId, "not_yours");
    await tx.purchaseRequestLine.update({ where: { id: lineId }, data: { deletedAt: new Date() } });
    await unready(tx, tenantId, line.branchId, line.departmentId);
  });
}

/**
 * "พร้อมแล้ว" / take it back (Q3). Returns whether the WHOLE branch is ready
 * now and whether this press is what made it so — the moment the purchaser
 * is told (Q9), once per round.
 */
export async function setDepartmentReadyLogic(
  tenantId: string,
  viewer: RequestViewer,
  input: { branchId: string; departmentId: string; ready: boolean }
): Promise<{ allReady: boolean; becameAllReady: boolean; waiting: number }> {
  const before = await getRequestBoardLogic(tenantId, input.branchId, viewer);
  await withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "department", input.departmentId);
    if (!before.departments.some((d) => d.id === input.departmentId)) {
      throw new Error(`Department "${input.departmentId}" does not take part in purchase requests`);
    }
    if (input.ready) {
      await tx.purchaseRequestReady.upsert({
        where: { branchId_departmentId: { branchId: input.branchId, departmentId: input.departmentId } },
        create: { tenantId, branchId: input.branchId, departmentId: input.departmentId, readyBy: viewer.userId },
        update: { readyBy: viewer.userId, readyAt: new Date() },
      });
    } else {
      await unready(tx, tenantId, input.branchId, input.departmentId);
    }
  });
  const after = await getRequestBoardLogic(tenantId, input.branchId, viewer);
  return {
    allReady: after.readiness.allReady,
    becameAllReady: after.readiness.allReady && !before.readiness.allReady,
    waiting: after.lines.filter((l) => l.status.kind === "waiting").length,
  };
}

/** One message on a line's conversation (R2 — append-only). */
export async function postRequestMessageLogic(tenantId: string, viewer: RequestViewer, lineId: string, body: string) {
  return withTenantContext(tenantId, async (tx) => {
    await loadLine(tx, tenantId, lineId);
    await tx.purchaseRequestMessage.create({ data: { tenantId, lineId, authorId: viewer.userId, body } });
  });
}

export async function getRequestMessagesLogic(tenantId: string, lineId: string) {
  return withTenantContext(tenantId, async (tx) => {
    await loadLine(tx, tenantId, lineId);
    const rows = await tx.purchaseRequestMessage.findMany({
      where: { tenantId, lineId },
      orderBy: { createdAt: "asc" },
      select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true, email: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      body: m.body,
      at: m.createdAt.toISOString(),
      author: m.author ? { id: m.author.id, name: m.author.name ?? m.author.email ?? "" } : null,
    }));
  });
}

/** "ไม่สั่ง" with a reason (Q4) — never a silent delete. Purchaser only; waiting lines only. */
export async function rejectRequestLineLogic(tenantId: string, viewer: RequestViewer, lineId: string, reason: string) {
  if (!viewer.canApprove) throw new RequestLineNotEditableError(lineId, "not_yours");
  return withTenantContext(tenantId, async (tx) => {
    const line = await loadLine(tx, tenantId, lineId);
    if (!kitchenCanEdit(await statusOf(tx, tenantId, line))) throw new RequestLineNotEditableError(lineId, "not_waiting");
    await tx.purchaseRequestLine.update({
      where: { id: lineId },
      data: { rejectedAt: new Date(), rejectedBy: viewer.userId, rejectReason: reason },
    });
    await tx.purchaseRequestMessage.create({ data: { tenantId, lineId, authorId: null, body: `จัดซื้อไม่สั่งรายการนี้: ${reason}` } });
  });
}

/** Ask again after a rejection — the SAME line reopens, so the conversation stays in one place (Q4). */
export async function reopenRequestLineLogic(tenantId: string, viewer: RequestViewer, lineId: string, why: string | null) {
  return withTenantContext(tenantId, async (tx) => {
    const line = await loadLine(tx, tenantId, lineId);
    if (!line.rejectedAt) throw new RequestLineNotEditableError(lineId, "not_waiting");
    await tx.purchaseRequestLine.update({ where: { id: lineId }, data: { rejectedAt: null, rejectedBy: null, rejectReason: null } });
    await tx.purchaseRequestMessage.create({
      data: { tenantId, lineId, authorId: viewer.userId, body: why ? `ขอใหม่: ${why}` : "ขอใหม่" },
    });
    await unready(tx, tenantId, line.branchId, line.departmentId);
  });
}

/**
 * "ขอส่วนที่ขาด" (Q10) — after an order was closed short, ask for what never
 * came, as a new line in the ORDERED unit. Never opened automatically: what
 * did arrive may be enough.
 */
export async function requestShortfallLogic(tenantId: string, viewer: RequestViewer, lineId: string): Promise<string> {
  return withTenantContext(tenantId, async (tx) => {
    const line = await loadLine(tx, tenantId, lineId);
    const status = await statusOf(tx, tenantId, line);
    if (status.kind !== "closed_short") throw new RequestLineNotEditableError(lineId, "not_waiting");
    const item = await tx.purchaseOrderItem.findFirst({
      where: { tenantId, purchaseRequestLineId: lineId, purchaseOrderId: status.link.poId },
      select: { qtyOrdered: true, qtyReceived: true, orderUnitId: true, purchaseOrder: { select: { supplierId: true } } },
    });
    if (!item) throw new RequestLineNotFoundError(lineId);
    const short = item.qtyOrdered.minus(item.qtyReceived);
    const created = await tx.purchaseRequestLine.create({
      data: {
        tenantId,
        branchId: line.branchId,
        productId: line.productId,
        qty: short,
        unitId: item.orderUnitId,
        departmentId: line.departmentId,
        supplierId: item.purchaseOrder.supplierId,
        note: `ส่วนที่ขาดจาก ${status.link.poNumber}`,
        requestedBy: viewer.userId,
      },
      select: { id: true },
    });
    await tx.purchaseRequestMessage.create({
      data: { tenantId, lineId, authorId: viewer.userId, body: `ขอส่วนที่ขาด ${short.toString()} ${status.link.unitName} เป็นรายการใหม่` },
    });
    await unready(tx, tenantId, line.branchId, line.departmentId);
    return created.id;
  });
}

// ------------------------------------------------------------
// Cutting a round (Q12, R3)
// ------------------------------------------------------------

export type CutPick = {
  lineId: string;
  supplierId: string;
  qty: number;
  unitId: string;
  unitPrice: number;
  mappingId: string | null;
  /** The purchaser's answer to the kitchen's note, required when moving supplier (Q4). */
  reply: string | null;
};

export type CutResult = { orders: { id: string; poNumber: string; supplierName: string; lines: number }[] };

/**
 * Turn the chosen waiting lines into DRAFT orders, one per supplier — all or
 * nothing (R3). Serialised per branch, so two purchasers pressing at once
 * cannot order the same line twice: the second finds it no longer waiting.
 */
export async function cutRoundLogic(
  tenantId: string,
  viewer: RequestViewer,
  input: { branchId: string; picks: CutPick[] }
): Promise<CutResult> {
  if (!viewer.canApprove) throw new RequestLineNotEditableError(input.picks[0]?.lineId ?? "", "not_yours");
  return withTenantContext(
    tenantId,
    async (tx) => {
      await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
      await acquireCounterLock(tx, `pr_cut:${tenantId}:${input.branchId}`);

      const lines = await tx.purchaseRequestLine.findMany({
        where: { tenantId, id: { in: input.picks.map((p) => p.lineId) }, deletedAt: null },
        select: { ...LINE_SELECT, qty: true, unitId: true, unit: { select: { unitName: true } }, supplier: { select: { nameFull: true } } },
      });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const links = await linksFor(tx, tenantId, lines.map((l) => l.id));
      const today = iso(computeBangkokToday());
      const depts = await departmentsOf(tx, tenantId);

      for (const p of input.picks) {
        const l = byId.get(p.lineId);
        if (!l) throw new RequestLineNotFoundError(p.lineId);
        if (l.branchId !== input.branchId) throw new CutLineNotReadyError(p.lineId, "wrong_branch");
        const st = requestLineStatus({ rejectedAt: l.rejectedAt?.toISOString() ?? null, rejectReason: l.rejectReason }, links.get(l.id) ?? [], today);
        if (st.kind !== "waiting") throw new CutLineNotReadyError(p.lineId, "not_waiting");
        if (!p.supplierId) throw new CutLineNotReadyError(p.lineId, "no_supplier");
        if (l.note && l.supplierId && p.supplierId !== l.supplierId && !p.reply?.trim()) {
          throw new KitchenNoteUnansweredError(p.lineId);
        }
      }

      const suppliers = await tx.supplier.findMany({
        where: { tenantId, id: { in: [...new Set(input.picks.map((p) => p.supplierId))] }, deletedAt: null },
        select: { id: true, nameFull: true, isVatRegistered: true, defaultVatRatePercent: true, pricesIncludeVat: true },
      });
      const supplierById = new Map(suppliers.map((s) => [s.id, s]));
      const units = await tx.productUnit.findMany({
        where: { id: { in: input.picks.map((p) => p.unitId) } },
        select: { id: true, unitName: true },
      });
      const unitName = new Map(units.map((u) => [u.id, u.unitName]));

      const groups = new Map<string, CutPick[]>();
      for (const p of input.picks) groups.set(p.supplierId, [...(groups.get(p.supplierId) ?? []), p]);

      const orders: CutResult["orders"] = [];
      for (const [supplierId, picks] of groups) {
        const s = supplierById.get(supplierId);
        if (!s) throw new CutLineNotReadyError(picks[0].lineId, "no_supplier");
        const vat = s.isVatRegistered ? Number(s.defaultVatRatePercent ?? depts.defaultVatRatePercent) : null;
        // Rule PR3: a supplier that quotes VAT-inclusive gets an order in its own
        // terms; the cut sheet's prices are excluding VAT, so convert them.
        const inclusive = s.pricesIncludeVat && vat !== null && vat > 0;
        const po = await createPurchaseOrderTx(
          tx,
          tenantId,
          {
            branchId: input.branchId,
            supplierId,
            expectedDeliveryDate: null,
            vatRatePercent: vat,
            pricesIncludeVat: inclusive,
            notes: null,
            lines: picks.map((p) => ({
              productId: byId.get(p.lineId)!.productId,
              orderUnitId: p.unitId,
              qtyOrdered: p.qty,
              unitPrice: inclusive
                ? Number(quotedUnitPrice(new Prisma.Decimal(p.unitPrice), vat))
                : p.unitPrice,
              supplierProductMappingId: p.mappingId,
              purchaseRequestLineId: p.lineId,
              notes: null,
            })),
          },
          viewer.userId
        );
        orders.push({ id: po.id, poNumber: po.poNumber, supplierName: s.nameFull, lines: picks.length });

        // What the kitchen sees on its own line (Q4): every change, in words.
        const messages: { lineId: string; authorId: string | null; body: string }[] = [];
        for (const p of picks) {
          const l = byId.get(p.lineId)!;
          if (p.reply?.trim()) messages.push({ lineId: l.id, authorId: viewer.userId, body: p.reply.trim() });
          const changes: string[] = [];
          if (l.supplierId !== supplierId) changes.push(`ผู้ขาย ${l.supplier?.nameFull ?? "ยังไม่เลือก"} → ${s.nameFull}`);
          const qtyChanged = Number(l.qty) !== p.qty || l.unitId !== p.unitId;
          if (qtyChanged) changes.push(`จำนวน ${Number(l.qty)} ${l.unit.unitName} → ${p.qty} ${unitName.get(p.unitId) ?? ""}`);
          messages.push({
            lineId: l.id,
            authorId: null,
            body: `อยู่ในใบสั่งซื้อร่าง ${po.poNumber}${changes.length ? ` · จัดซื้อเปลี่ยน${changes.join(" · ")}` : ""}`,
          });
        }
        await tx.purchaseRequestMessage.createMany({ data: messages.map((m) => ({ tenantId, ...m })) });
      }

      // A new round begins: every department says ready again (Q3).
      await tx.purchaseRequestReady.deleteMany({ where: { tenantId, branchId: input.branchId } });
      return { orders };
    },
    { timeout: 20_000 }
  );
}

// ------------------------------------------------------------
// Reads for the actions layer
// ------------------------------------------------------------

/** The branch a line belongs to — so an action can check reach before anything else (rule A5). */
export async function getRequestLineBranchLogic(tenantId: string, lineId: string): Promise<string> {
  return withTenantContext(tenantId, async (tx) => (await loadLine(tx, tenantId, lineId)).branchId);
}

export type CutSheetLine = {
  id: string;
  product: { id: string; name: string; sku: string };
  units: { id: string; name: string; toBase: number }[];
  qty: number;
  unitId: string;
  department: { id: string; name: string };
  supplierId: string | null;
  note: string | null;
  requestedBy: string;
  onHandQty: number | null;
  /** Latest known price per BASE unit per supplier (rule PR2) — the purchaser's view, with money. */
  prices: SupplierPrice[];
};

export type CutSheet = {
  lines: CutSheetLine[];
  suppliers: { id: string; name: string }[];
  readiness: Readiness;
};

/**
 * Everything the purchaser needs to cut a round: the waiting lines, every
 * supplier's latest price for each (with money — only called behind
 * purchase:approve, which every role that has it pairs with cost:view), and
 * who is ready. Lines with no supplier sort first (Q11).
 */
export async function getCutSheetLogic(tenantId: string, branchId: string, viewer: RequestViewer): Promise<CutSheet> {
  const board = await getRequestBoardLogic(tenantId, branchId, viewer);
  const waiting = board.lines.filter((l) => l.status.kind === "waiting");
  return withTenantContext(tenantId, async (tx) => {
    const productIds = [...new Set(waiting.map((l) => l.product.id))];
    const [units, prices, suppliers] = await Promise.all([
      tx.productUnit.findMany({
        where: { productId: { in: productIds } },
        select: { id: true, productId: true, unitName: true, toBaseRatio: true, isBase: true },
      }),
      supplierPrices(tx, tenantId, branchId, productIds),
      tx.supplier.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: { id: true, nameFull: true },
        orderBy: { nameFull: "asc" },
      }),
    ]);
    const unitsOf = new Map<string, CutSheetLine["units"]>();
    for (const u of units.sort((a, b) => Number(b.isBase) - Number(a.isBase))) {
      unitsOf.set(u.productId, [...(unitsOf.get(u.productId) ?? []), { id: u.id, name: u.unitName, toBase: Number(u.toBaseRatio) }]);
    }
    const lines = waiting
      .map((l) => ({
        id: l.id,
        product: { id: l.product.id, name: l.product.name, sku: l.product.sku },
        units: unitsOf.get(l.product.id) ?? [],
        qty: l.qty,
        unitId: l.unit.id,
        department: l.department,
        supplierId: l.supplier?.id ?? null,
        note: l.note,
        requestedBy: l.requestedBy.name,
        onHandQty: l.onHandQty,
        prices: prices.get(l.product.id) ?? [],
      }))
      .sort((a, b) => Number(a.supplierId !== null) - Number(b.supplierId !== null));
    return { lines, suppliers: suppliers.map((s) => ({ id: s.id, name: s.nameFull })), readiness: board.readiness };
  });
}

// ------------------------------------------------------------
// The purchaser's queue (Q9) — one light read for the dashboard
// ------------------------------------------------------------

export type RequestQueueRow = { branchId: string; branchName: string; waiting: number; readyDepartments: number; departments: number; allReady: boolean };

/**
 * Per branch in reach: how many lines wait to be ordered, and whether every
 * department has said ready. Deliberately NOT the full board — no statuses of
 * finished lines, no prices — because it runs on the page everyone opens first.
 * "Waiting" is the same rule as R1, in the query: no live PO line points at it.
 */
export async function getRequestQueueLogic(
  tenantId: string,
  branches: readonly { id: string; name: string }[]
): Promise<RequestQueueRow[]> {
  if (branches.length === 0) return [];
  return withTenantContext(tenantId, async (tx) => {
    const ids = branches.map((b) => b.id);
    const [waiting, ready, depts] = await Promise.all([
      tx.purchaseRequestLine.groupBy({
        by: ["branchId"],
        where: {
          tenantId,
          branchId: { in: ids },
          deletedAt: null,
          rejectedAt: null,
          orderItems: { none: { purchaseOrder: { deletedAt: null, status: { not: "CANCELLED" } } } },
        },
        _count: { _all: true },
      }),
      tx.purchaseRequestReady.groupBy({ by: ["branchId"], where: { tenantId, branchId: { in: ids } }, _count: { _all: true } }),
      departmentsOf(tx, tenantId),
    ]);
    const w = new Map(waiting.map((r) => [r.branchId, r._count._all]));
    const rd = new Map(ready.map((r) => [r.branchId, r._count._all]));
    return branches
      .map((b) => {
        const n = w.get(b.id) ?? 0;
        const readyDepartments = rd.get(b.id) ?? 0;
        return {
          branchId: b.id,
          branchName: b.name,
          waiting: n,
          readyDepartments,
          departments: depts.list.length,
          allReady: n > 0 && readyDepartments >= depts.list.length,
        };
      })
      .filter((r) => r.waiting > 0);
  });
}

// ============================================================
// Mise — what the products screen shows beside each product (Kong 2026-10-21)
// ============================================================
// The list paints from the catalogue alone (names, units, categories); these
// figures arrive after paint over GET, once per branch (mise-ui-review §5c):
// on hand, usage, par alert, the last receipt, and how many dishes use it.
// Cost per unit is NOT here — it is the branch's price book (/api/menus?what=
// book), the one figure every screen shares, so it can never disagree.
// ============================================================

import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import type { CostAccess } from "@/lib/permissions/cost-access";
import { parAlertOf, parStateOf, suggestOrderQty, type ParAlert, type ParStateKind } from "@/lib/par-alert";
import { coverKey, parCoverInTx, type CoverDoc } from "@/server/par-coverage";
import { ingredientFactsInTx } from "@/server/menu-manager";
import { getLiquidDensityTemplates, getUnitTemplates } from "@/server/product";

export type ProductListFact = {
  onHand: number;
  usedPerDay: number | null;
  daysLeft: number | null;
  par: number | null;
  alert: ParAlert;
  /** Rule PAR-3 — what was done about it; null = nothing to say. */
  state: { kind: ParStateKind; coming: number; lateDays: number; requestLateDays: number; docs: CoverDoc[] } | null;
  /** Rule PAR-4 — what to ask for, in the product's buy unit; null = nothing to suggest. */
  suggest: { qty: number; unitId: string; unitName: string } | null;
};

export type ProductListFacts = {
  facts: Record<string, ProductListFact>;
  /** Last confirmed receipt at this branch; empty without the cost ticket. */
  last: Record<string, { date: string; supplier: string; packUnit: string; price: number }>;
  /** Distinct current recipe LINES (dishes and prepped items) using it. */
  usedIn: Record<string, number>;
  postedThrough: string | null;
  postedDays: number;
  warningDays: number;
  /** B6: last ledger movement at this branch (yyyy-mm-dd); absent = never moved here. */
  lastMoved: Record<string, string>;
  /** The shop's "slow stock" days (tenant.slow_stock_days) — the ไม่เคลื่อนไหว filter. */
  slowDays: number;
};

const LAST_RECEIPT_DAYS = 180;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function getProductListFactsLogic(
  tenantId: string,
  branchId: string,
  cost: CostAccess | null
): Promise<ProductListFacts> {
  const today = computeBangkokToday();
  return withTenantContext(tenantId, async (tx) => {
    const [products, tenant, receipts, usage, moved] = await Promise.all([
      tx.product.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, productUnits: { where: { OR: [{ isBase: true }, { isDefaultBuyUnit: true }] }, select: { id: true, unitName: true, toBaseRatio: true, isBase: true, isDefaultBuyUnit: true } } },
      }),
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { parWarningDays: true, slowStockDays: true } }),
      cost === null
        ? Promise.resolve([])
        : tx.goodsReceiptItem.findMany({
            where: {
              tenantId,
              goodsReceipt: { branchId, status: "CONFIRMED", receivedAt: { gte: addDays(today, -LAST_RECEIPT_DAYS) } },
            },
            select: {
              productId: true,
              receivedUnitName: true,
              // The unit's name TODAY: this is a price label, not the receipt
              // (Kong 2026-10-21 renamed กก. → kg; the receipt keeps what it printed).
              receivedUnit: { select: { unitName: true } },
              unitPriceActual: true,
              goodsReceipt: { select: { receivedAt: true, supplier: { select: { nameShort: true, nameFull: true } } } },
            },
            orderBy: { goodsReceipt: { receivedAt: "desc" } },
          }),
      tx.recipeIngredient.findMany({
        where: {
          tenantId,
          productId: { not: null },
          recipe: { deletedAt: null, supersededAt: null, isDraft: false, effectiveFrom: { lte: today } },
        },
        select: { productId: true, recipe: { select: { lineId: true } } },
      }),
      tx.stockMovement.groupBy({ by: ["productId"], where: { tenantId, branchId }, _max: { occurredAt: true } }),
    ]);
    const [facts0, cover] = await Promise.all([
      ingredientFactsInTx(tx, tenantId, branchId, products.map((p) => p.id)),
      parCoverInTx(tx, tenantId, [branchId]),
    ]);

    const facts: Record<string, ProductListFact> = {};
    for (const [id, f] of Object.entries(facts0.facts)) {
      const c = cover.get(coverKey(id, branchId)) ?? null;
      const s = parStateOf(f, tenant.parWarningDays, c);
      const units = products.find((p) => p.id === id)?.productUnits ?? [];
      const buy = units.find((u) => u.isDefaultBuyUnit) ?? units.find((u) => u.isBase);
      const sug = buy ? suggestOrderQty(f, tenant.parWarningDays, (c?.ordered ?? 0) + (c?.requested ?? 0), Number(buy.toBaseRatio)) : null;
      facts[id] = {
        onHand: f.onHand,
        usedPerDay: f.usedPerDay,
        daysLeft: f.daysLeft,
        par: f.par,
        alert: parAlertOf(f, tenant.parWarningDays),
        state: s && { ...s, lateDays: c?.lateDays ?? 0, requestLateDays: c?.requestLateDays ?? 0, docs: c?.docs ?? [] },
        suggest: sug && buy ? { qty: sug.qty, unitId: buy.id, unitName: buy.unitName } : null,
      };
    }
    const last: ProductListFacts["last"] = {};
    for (const r of receipts) {
      if (last[r.productId]) continue; // newest first
      last[r.productId] = {
        date: isoDate(r.goodsReceipt.receivedAt),
        supplier: r.goodsReceipt.supplier.nameShort ?? r.goodsReceipt.supplier.nameFull,
        packUnit: r.receivedUnit?.unitName ?? r.receivedUnitName,
        price: Number(r.unitPriceActual),
      };
    }
    const lines = new Map<string, Set<string>>();
    for (const u of usage) {
      if (!u.productId) continue;
      const s = lines.get(u.productId) ?? new Set<string>();
      s.add(u.recipe.lineId);
      lines.set(u.productId, s);
    }
    const usedIn = Object.fromEntries([...lines].map(([id, s]) => [id, s.size]));

    const lastMoved: Record<string, string> = {};
    for (const m of moved) if (m._max.occurredAt) lastMoved[m.productId] = isoDate(new Date(m._max.occurredAt.getTime() + 7 * 3_600_000));

    return {
      facts,
      last,
      usedIn,
      postedThrough: facts0.postedThrough,
      postedDays: facts0.postedDays,
      warningDays: tenant.parWarningDays,
      lastMoved,
      slowDays: tenant.slowStockDays,
    };
  });
}

// ------------------------------------------------------------
// The sheet's editable part: units with ids, pars per branch, COGS categories
// ------------------------------------------------------------

export type ProductSheetForm = {
  units: { id: string; unitName: string; toBaseRatio: number; isBase: boolean; isDefaultBuyUnit: boolean }[];
  pars: { id: string; branchId: string; inputQty: number; inputUnitId: string }[];
  /** Cost-of-sales categories only (Kong 2026-10-21: no rent or salaries for a product). */
  categories: { id: string; label: string }[];
  /** Units used in a recipe or document cannot be removed (ProductUnitInUseError); shown with a lock. */
  lockedUnitIds: string[];
};

export async function getProductSheetFormLogic(tenantId: string, productId: string): Promise<ProductSheetForm | null> {
  return withTenantContext(tenantId, async (tx) => {
    const [product, pars, categories] = await Promise.all([
      tx.product.findFirst({
        where: { id: productId, tenantId, deletedAt: null },
        select: { productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true, isDefaultBuyUnit: true, displayOrder: true } } },
      }),
      tx.parLevel.findMany({ where: { tenantId, productId, deletedAt: null }, select: { id: true, branchId: true, inputQty: true, inputUnitId: true } }),
      tx.category.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, account: true, accountingSection: true, groupName: true } }),
    ]);
    if (product === null) return null;
    const unitIds = product.productUnits.filter((u) => !u.isBase).map((u) => u.id);
    const [inRecipe, inCount, inReceipt, inPo, inRequest, inWaste, inAdjust, inTransfer] = unitIds.length
      ? await Promise.all([
          tx.recipeIngredient.findMany({ where: { productUnitId: { in: unitIds }, recipe: { deletedAt: null } }, select: { productUnitId: true }, distinct: ["productUnitId"] }),
          tx.stockCountEntry.findMany({ where: { productUnitId: { in: unitIds } }, select: { productUnitId: true }, distinct: ["productUnitId"] }),
          tx.goodsReceiptItem.findMany({ where: { receivedUnitId: { in: unitIds } }, select: { receivedUnitId: true }, distinct: ["receivedUnitId"] }),
          tx.purchaseOrderItem.findMany({ where: { orderUnitId: { in: unitIds } }, select: { orderUnitId: true }, distinct: ["orderUnitId"] }),
          tx.purchaseRequestLine.findMany({ where: { unitId: { in: unitIds } }, select: { unitId: true }, distinct: ["unitId"] }),
          tx.wasteLog.findMany({ where: { inputUnitId: { in: unitIds } }, select: { inputUnitId: true }, distinct: ["inputUnitId"] }),
          tx.stockAdjustment.findMany({ where: { inputUnitId: { in: unitIds } }, select: { inputUnitId: true }, distinct: ["inputUnitId"] }),
          tx.stockTransferItem.findMany({ where: { inputUnitId: { in: unitIds } }, select: { inputUnitId: true }, distinct: ["inputUnitId"] }),
        ])
      : [[], [], [], [], [], [], [], []];
    const locked = new Set<string>([
      ...inRecipe.map((r) => r.productUnitId),
      ...inCount.map((r) => r.productUnitId),
      ...inReceipt.map((r) => r.receivedUnitId),
      ...inPo.map((r) => r.orderUnitId),
      ...inRequest.map((r) => r.unitId),
      ...inWaste.map((r) => r.inputUnitId),
      ...inAdjust.map((r) => r.inputUnitId),
      ...inTransfer.map((r) => r.inputUnitId),
    ].filter((x): x is string => typeof x === "string"));
    return {
      units: [...product.productUnits]
        .sort((a, b) => Number(b.isBase) - Number(a.isBase) || (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .map((u) => ({ id: u.id, unitName: u.unitName, toBaseRatio: Number(u.toBaseRatio), isBase: u.isBase, isDefaultBuyUnit: u.isDefaultBuyUnit })),
      pars: pars.map((p) => ({ id: p.id, branchId: p.branchId, inputQty: Number(p.inputQty), inputUnitId: p.inputUnitId })),
      categories: categories
        .filter((c) => c.account.includes("COGS"))
        .map((c) => ({ id: c.id, label: `${c.accountingSection} › ${c.groupName}` }))
        .sort((a, b) => a.label.localeCompare(b.label, "th")),
      lockedUnitIds: [...locked],
    };
  });
}

// ------------------------------------------------------------
// The documents behind one product's par state (rule PAR-3 popup)
// ------------------------------------------------------------
// Every sent order still owing it, and the branch's open purchase requests —
// each with ALL its lines, so the popup can highlight this product and, as a
// second, quieter highlight, any other line that is below or near par.

export type ParDocLine = {
  productId: string;
  name: string;
  qty: number;
  unitName: string;
  /** Still owed / asked, in the product's base unit. */
  base: number;
  baseUnitName: string | null;
  onHand: number;
  par: number | null;
  tone: "red" | "yellow" | null;
};
export type ParDoc = {
  kind: "PO" | "PR";
  id: string;
  number: string;
  supplier: string | null;
  /** Sent (PO) or first asked (PR), yyyy-mm-dd. */
  date: string;
  expected: string | null;
  /** Days late; 0 = not late. `assumed` = no promised date, counted from sending. */
  lateDays: number;
  assumed: boolean;
  requestedBy: string | null;
  lines: ParDocLine[];
};

export async function getParDocsLogic(
  tenantId: string,
  query: { productId: string; branchId: string }
): Promise<ParDoc[]> {
  const today = computeBangkokToday();
  return withTenantContext(tenantId, async (tx) => {
    const [tenant, orders, requests] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { parWarningDays: true } }),
      tx.purchaseOrder.findMany({
        where: {
          tenantId,
          branchId: query.branchId,
          status: { in: ["SENT", "PARTIALLY_RECEIVED"] },
          deletedAt: null,
          items: { some: { productId: query.productId } },
        },
        select: {
          id: true,
          poNumber: true,
          sentAt: true,
          expectedDeliveryDate: true,
          supplier: { select: { nameShort: true, nameFull: true } },
          items: { select: { productId: true, qtyOrdered: true, qtyReceived: true, orderUnitName: true, toBaseRatio: true, product: { select: { name: true } } } },
        },
        orderBy: { sentAt: "asc" },
      }),
      tx.purchaseRequestLine.findMany({
        where: {
          tenantId,
          branchId: query.branchId,
          deletedAt: null,
          rejectedAt: null,
          orderItems: { none: { purchaseOrder: { status: { in: ["SENT", "PARTIALLY_RECEIVED", "RECEIVED"] } } } },
        },
        select: {
          productId: true,
          qty: true,
          requestedAt: true,
          unit: { select: { unitName: true, toBaseRatio: true } },
          product: { select: { name: true } },
          requestedByUser: { select: { name: true, email: true } },
          supplier: { select: { nameShort: true, nameFull: true } },
        },
        orderBy: { requestedAt: "asc" },
      }),
    ]);
    const askedHere = requests.some((r) => r.productId === query.productId);
    const ids = [...new Set([...orders.flatMap((o) => o.items.map((i) => i.productId)), ...(askedHere ? requests.map((r) => r.productId) : [])])];
    const { facts } = await ingredientFactsInTx(tx, tenantId, query.branchId, ids);
    const lineOf = (productId: string, name: string, qty: number, unitName: string, base: number): ParDocLine => {
      const f = facts[productId];
      const a = f ? parAlertOf(f, tenant.parWarningDays) : null;
      return {
        productId,
        name,
        qty,
        unitName,
        base,
        baseUnitName: f?.baseUnitName ?? null,
        onHand: f?.onHand ?? 0,
        par: f?.par ?? null,
        tone: a?.level === "LOW" ? "red" : a?.level === "NEAR" ? "yellow" : null,
      };
    };
    const docs: ParDoc[] = orders.map((o) => {
      const due = o.expectedDeliveryDate ?? (o.sentAt ? addDays(o.sentAt, 3) : null);
      const late = due ? Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000)) : 0;
      return {
        kind: "PO",
        id: o.id,
        number: o.poNumber,
        supplier: o.supplier.nameShort ?? o.supplier.nameFull,
        date: o.sentAt ? isoDate(o.sentAt) : "",
        expected: o.expectedDeliveryDate ? isoDate(o.expectedDeliveryDate) : null,
        lateDays: late,
        assumed: o.expectedDeliveryDate === null,
        requestedBy: null,
        lines: o.items
          .map((i) => {
            const owed = Number(i.qtyOrdered) - Number(i.qtyReceived);
            return lineOf(i.productId, i.product.name, owed, i.orderUnitName, owed * Number(i.toBaseRatio));
          })
          .filter((l) => l.qty > 0),
      };
    });
    if (askedHere) {
      const mine = requests.find((r) => r.productId === query.productId)!;
      docs.push({
        kind: "PR",
        id: query.branchId,
        number: "ใบขอซื้อ",
        supplier: mine.supplier ? (mine.supplier.nameShort ?? mine.supplier.nameFull) : null,
        date: isoDate(mine.requestedAt),
        expected: null,
        lateDays: 0,
        assumed: false,
        requestedBy: mine.requestedByUser.name?.trim() || mine.requestedByUser.email?.split("@")[0] || null,
        lines: requests.map((r) => lineOf(r.productId, r.product.name, Number(r.qty), r.unit.unitName, Number(r.qty) * Number(r.unit.toBaseRatio))),
      });
    }
    return docs;
  });
}

// ------------------------------------------------------------
// Rule PAR-4 suggestions for a list of products, each in the unit it will be
// ordered in (the supplier order page, Kong 2026-10-21)
// ------------------------------------------------------------
// "Already on its way" here is SENT orders only: a purchase request is exactly
// what the purchaser on this page is about to fulfil, so it must not cancel
// the suggestion out.

export type OrderSuggestion = {
  level: "LOW" | "NEAR";
  /** In the unit given for the product. */
  qty: number;
  onHand: number;
  par: number;
  baseUnitName: string | null;
  /** Near only, with a usage rate. */
  daysToPar: number | null;
};

export async function getOrderSuggestionsLogic(
  tenantId: string,
  branchId: string,
  items: { productId: string; unitToBase: number }[]
): Promise<Record<string, OrderSuggestion>> {
  if (items.length === 0) return {};
  return withTenantContext(tenantId, async (tx) => {
    const ids = items.map((i) => i.productId);
    const [tenant, factsRes, cover] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { parWarningDays: true } }),
      ingredientFactsInTx(tx, tenantId, branchId, ids),
      parCoverInTx(tx, tenantId, [branchId], ids),
    ]);
    const out: Record<string, OrderSuggestion> = {};
    for (const i of items) {
      const f = factsRes.facts[i.productId];
      if (!f || f.par === null) continue;
      const s = suggestOrderQty(f, tenant.parWarningDays, cover.get(coverKey(i.productId, branchId))?.ordered ?? 0, i.unitToBase);
      if (!s) continue;
      out[i.productId] = {
        level: s.level,
        qty: s.qty,
        onHand: f.onHand,
        par: f.par,
        baseUnitName: f.baseUnitName,
        daysToPar: s.level === "NEAR" && f.usedPerDay ? Math.max(0, Math.floor((f.onHand - f.par) / f.usedPerDay)) : null,
      };
    }
    return out;
  });
}

// ------------------------------------------------------------
// The "+ เพิ่มสินค้า" sheet's choices (Kong 2026-10-22, mockup 9KoNNnZYeQSyA1dVNEfKcr)
// ------------------------------------------------------------
// The same lists the old /products/new page loaded, in one read, plus the code
// a new product will most likely get. `nextSku` is a PREVIEW: the create takes
// the counter lock and may land one higher if two people add at once — the
// sheet shows the real code the moment it saves.

export type NewProductForm = {
  units: { unitName: string; unitDimension: string }[];
  categories: { id: string; label: string }[];
  densities: { id: string; name: string; gPerMl: string }[];
  nextSku: string;
};

export async function getNewProductFormLogic(tenantId: string): Promise<NewProductForm> {
  const [units, densities, tenantSide] = await Promise.all([
    getUnitTemplates(),
    getLiquidDensityTemplates(),
    withTenantContext(tenantId, async (tx) => {
      const [categories, skus] = await Promise.all([
        tx.category.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, account: true, accountingSection: true, groupName: true } }),
        tx.product.findMany({ where: { tenantId, sku: { startsWith: "P-" } }, select: { sku: true } }),
      ]);
      return { categories, skus };
    }),
  ]);
  let max = 0;
  for (const { sku } of tenantSide.skus) {
    const m = /^P-(\d+)$/.exec(sku);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return {
    units,
    categories: tenantSide.categories
      .filter((c) => c.account.includes("COGS"))
      .map((c) => ({ id: c.id, label: `${c.accountingSection} › ${c.groupName}` }))
      .sort((a, b) => a.label.localeCompare(b.label, "th")),
    densities: densities.map((d) => ({ id: d.id, name: d.name, gPerMl: d.gPerMl })),
    nextSku: `P-${String(max + 1).padStart(4, "0")}`,
  };
}

// ------------------------------------------------------------
// B6 (Kong 2026-10-24): the product sheet's "เคลื่อนไหวล่าสุด"
// ------------------------------------------------------------

export type RecentMovement = {
  id: string;
  date: string;
  type: string;
  sourceType: string;
  qty: number;
  by: string | null;
  product: { id: string; name: string; unit: string };
};

/** The last few ledger rows at one branch — of one product, or of all (productId null). Newest first. */
export async function getRecentMovementsLogic(
  tenantId: string,
  productId: string | null,
  branchId: string,
  take = 5,
  sourceType?: "ADJUSTMENT"
): Promise<RecentMovement[]> {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.stockMovement.findMany({
      where: { tenantId, branchId, ...(productId ? { productId } : {}), ...(sourceType ? { sourceType } : {}) },
      orderBy: sourceType ? [{ createdAt: "desc" }] : [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take,
      select: {
        id: true,
        occurredAt: true,
        type: true,
        sourceType: true,
        qty: true,
        createdByUser: { select: { name: true, email: true } },
        product: { select: { id: true, name: true, productUnits: { where: { isBase: true }, select: { unitName: true }, take: 1 } } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      date: isoDate(new Date(m.occurredAt.getTime() + 7 * 3_600_000)),
      type: m.type,
      sourceType: m.sourceType,
      qty: Number(m.qty),
      // A person, not an address: the name, else the part before @ (Kong 2026-10-25).
      by: m.createdByUser?.name ?? m.createdByUser?.email?.split("@")[0] ?? null,
      product: { id: m.product.id, name: m.product.name, unit: m.product.productUnits[0]?.unitName ?? "" },
    }));
  });
}

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
import { parAlertOf, type ParAlert } from "@/lib/par-alert";
import { ingredientFactsInTx } from "@/server/menu-manager";

export type ProductListFact = {
  onHand: number;
  usedPerDay: number | null;
  daysLeft: number | null;
  par: number | null;
  alert: ParAlert;
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
    const [products, tenant, receipts, usage] = await Promise.all([
      tx.product.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } }),
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { parWarningDays: true } }),
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
    ]);
    const facts0 = await ingredientFactsInTx(tx, tenantId, branchId, products.map((p) => p.id));

    const facts: Record<string, ProductListFact> = {};
    for (const [id, f] of Object.entries(facts0.facts)) {
      facts[id] = { onHand: f.onHand, usedPerDay: f.usedPerDay, daysLeft: f.daysLeft, par: f.par, alert: parAlertOf(f, tenant.parWarningDays) };
    }
    const last: ProductListFacts["last"] = {};
    for (const r of receipts) {
      if (last[r.productId]) continue; // newest first
      last[r.productId] = {
        date: isoDate(r.goodsReceipt.receivedAt),
        supplier: r.goodsReceipt.supplier.nameShort ?? r.goodsReceipt.supplier.nameFull,
        packUnit: r.receivedUnitName,
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

    return { facts, last, usedIn, postedThrough: facts0.postedThrough, postedDays: facts0.postedDays, warningDays: tenant.parWarningDays };
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

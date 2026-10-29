// ============================================================
// Mise — what the production screens read (ADR 0040, step 7)
// ============================================================
// Every read here is for a screen. The arithmetic lives elsewhere and is only
// CALLED: FIFO money from the replay (`stock-cost.ts`), what a batch would use
// from `planSystemProductionInTx`, the shelf from `preppedAvailableInTx`. A read
// that worked a number out its own way would be a second opinion the day the two
// disagreed (the shape ADR 0025 Q4 refused).
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { branchScopeWhere, type BranchReach } from "@/lib/permissions/service";
import { costKeyOf, replayPairsInTx } from "@/server/stock-cost";
import { loadRecipeGraph, resolveRecipeIds } from "@/server/recipe-resolve";
import { hasMethod } from "@/server/prepped-first";
import { mainInputsInTx, planSystemProductionInTx } from "@/server/production";

const n = (d: Prisma.Decimal | null | undefined) => (d == null ? 0 : Number(d));

export type UnitOption = { id: string; unitName: string; ratio: number; isBase: boolean };

export type ProductionLineView = {
  productId: string;
  name: string;
  qty: number;
  unitName: string;
};

export type ProductionRowView = {
  id: string;
  pdNumber: string;
  branchId: string;
  branchName: string;
  kind: "PRODUCE" | "TRIM";
  origin: "MANUAL" | "STOCK_COUNT" | "WASTE" | "ADJUSTMENT" | "TRANSFER";
  /** The document that made the system write it — "CK-SC-0031", with a link. */
  originLabel: string | null;
  originHref: string | null;
  /** ISO instant. */
  producedAt: string;
  recordedBy: string;
  inputsUnconfirmed: boolean;
  voided: boolean;
  voidReason: string | null;
  inputs: ProductionLineView[];
  outputs: ProductionLineView[];
};

/** Productions at the branches this reader reaches, newest first. */
export async function getProductionListLogic(
  tenantId: string,
  reach: BranchReach,
  params: { branchId: string | null; from: Date }
): Promise<ProductionRowView[]> {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.production.findMany({
      where: {
        tenantId,
        producedAt: { gte: params.from },
        branch: branchScopeWhere(reach),
        ...(params.branchId ? { branchId: params.branchId } : {}),
      },
      include: {
        branch: { select: { name: true } },
        recordedByUser: { select: { name: true, email: true } },
        items: {
          where: { reversalOfItemId: null },
          include: {
            product: { select: { name: true, productUnits: { where: { isBase: true }, select: { unitName: true } } } },
            inputUnit: { select: { unitName: true } },
          },
        },
      },
      orderBy: [{ producedAt: "desc" }, { createdAt: "desc" }],
      take: 300,
    });

    const byOrigin = (o: string) => rows.filter((r) => r.origin === o && r.originId).map((r) => r.originId!);
    const [counts, transfers] = await Promise.all([
      tx.stockCount.findMany({ where: { tenantId, id: { in: byOrigin("STOCK_COUNT") } }, select: { id: true, scNumber: true } }),
      tx.stockTransfer.findMany({ where: { tenantId, id: { in: byOrigin("TRANSFER") } }, select: { id: true, tfNumber: true } }),
    ]);
    const sc = new Map(counts.map((c) => [c.id, c.scNumber]));
    const tf = new Map(transfers.map((t) => [t.id, t.tfNumber]));

    const line = (i: (typeof rows)[number]["items"][number]): ProductionLineView => ({
      productId: i.productId,
      name: i.product.name,
      qty: i.inputQty !== null ? n(i.inputQty) : n(i.qty),
      unitName: i.inputUnit?.unitName ?? i.product.productUnits[0]?.unitName ?? "",
    });

    return rows.map((r) => {
      const origin = r.origin;
      const originLabel =
        origin === "STOCK_COUNT"
          ? (sc.get(r.originId ?? "") ?? "ใบนับ")
          : origin === "TRANSFER"
            ? (tf.get(r.originId ?? "") ?? "ใบโอน")
            : origin === "WASTE"
              ? "ของเสีย"
              : origin === "ADJUSTMENT"
                ? "ปรับสต๊อก"
                : null;
      const originHref =
        origin === "STOCK_COUNT"
          ? `/stock-counts/${r.originId}`
          : origin === "TRANSFER"
            ? `/transfers/${r.originId}`
            : origin === "WASTE"
              ? "/waste"
              : origin === "ADJUSTMENT"
                ? "/stock/history"
                : null;
      return {
        id: r.id,
        pdNumber: r.pdNumber,
        branchId: r.branchId,
        branchName: r.branch.name,
        kind: r.kind,
        origin,
        originLabel,
        originHref,
        producedAt: r.producedAt.toISOString(),
        recordedBy: origin === "MANUAL" ? (r.recordedByUser.name ?? r.recordedByUser.email ?? "—") : "ระบบ",
        inputsUnconfirmed: r.inputsUnconfirmed,
        voided: r.voidedAt !== null,
        voidReason: r.voidReason,
        inputs: r.items.filter((i) => i.role === "INPUT").map(line),
        outputs: r.items.filter((i) => i.role === "OUTPUT").map(line),
      };
    });
  });
}

/**
 * What each production's outputs cost per unit, from the replay (Q4: stored
 * nowhere). Keyed by production id, then output product id. For cost:view only
 * — the caller decides; this never runs for a reader who may not see money.
 */
export async function getProductionCostsLogic(
  tenantId: string,
  rows: Pick<ProductionRowView, "id" | "branchId" | "outputs" | "voided">[]
): Promise<Record<string, Record<string, number>>> {
  const live = rows.filter((r) => !r.voided);
  if (live.length === 0) return {};
  return withTenantContext(
    tenantId,
    async (tx) => {
      const items = await tx.productionItem.findMany({
        where: { tenantId, productionId: { in: live.map((r) => r.id) }, reversalOfItemId: null, role: "OUTPUT" },
        select: { id: true, productionId: true, productId: true, qty: true },
      });
      const branchIds = [...new Set(live.map((r) => r.branchId))];
      const replayed = await replayPairsInTx(tx, tenantId, [...new Set(items.map((i) => i.productId))], branchIds);
      // The money an output arrived with is its PRODUCTION_IN layer's value;
      // the walk records it as an inflow, so it is read back off the movement.
      const moves = await tx.stockMovement.findMany({
        where: { tenantId, sourceType: "PRODUCTION", sourceId: { in: items.map((i) => i.id) }, type: "PRODUCTION_IN" },
        select: { id: true, sourceId: true, productId: true, branchId: true },
      });
      const out: Record<string, Record<string, number>> = {};
      for (const m of moves) {
        const item = items.find((i) => i.id === m.sourceId);
        if (!item) continue;
        const state = replayed.get(costKeyOf(m.productId, m.branchId));
        const layer = state?.layers.find((l) => l.movementId === m.id);
        // The layer may have been used up since; then the cost it carried is
        // gone from the stack, and the screen shows nothing rather than a guess.
        if (!layer || layer.qty.isZero()) continue;
        (out[item.productionId] ??= {})[item.productId] = Number(layer.value.div(layer.qty));
      }
      return out;
    },
    { timeout: 20_000 }
  );
}

export type ShortfallRowView = { productId: string; name: string; unitName: string; days: number; qty: number };

/**
 * "ระบบตัดแทน" (Q1): prepped products that somebody recorded producing in the
 * last 30 days, and how often since then a sale or a staff meal had to cut the
 * recipe instead. A shop that never records production never sees this card.
 */
export async function getShortfallReportLogic(
  tenantId: string,
  reach: BranchReach,
  params: { branchId: string | null; today: Date }
): Promise<ShortfallRowView[]> {
  const from = addDays(params.today, -29);
  return withTenantContext(tenantId, async (tx) => {
    const branchWhere = { ...branchScopeWhere(reach), ...(params.branchId ? { id: params.branchId } : {}) };
    const recorded = await tx.productionItem.findMany({
      where: {
        tenantId,
        role: "OUTPUT",
        reversalOfItemId: null,
        production: { origin: "MANUAL", voidedAt: null, producedAt: { gte: addDays(from, -1) }, branch: branchWhere },
      },
      select: { productId: true },
      distinct: ["productId"],
    });
    if (recorded.length === 0) return [];
    const rows = await tx.preppedShortfall.findMany({
      where: {
        tenantId,
        productId: { in: recorded.map((r) => r.productId) },
        businessDate: { gte: from },
        branch: branchWhere,
        OR: [{ salesConsumptionRun: { voidedAt: null } }, { staffMeal: { voidedAt: null } }],
      },
      select: {
        productId: true,
        businessDate: true,
        qty: true,
        product: { select: { name: true, productUnits: { where: { isBase: true }, select: { unitName: true } } } },
      },
    });
    const acc = new Map<string, ShortfallRowView & { dayset: Set<number> }>();
    for (const r of rows) {
      const cur =
        acc.get(r.productId) ??
        { productId: r.productId, name: r.product.name, unitName: r.product.productUnits[0]?.unitName ?? "", days: 0, qty: 0, dayset: new Set<number>() };
      cur.qty += n(r.qty);
      cur.dayset.add(r.businessDate.getTime());
      acc.set(r.productId, cur);
    }
    return [...acc.values()]
      .map(({ dayset, ...v }) => ({ ...v, days: dayset.size, qty: Math.round(v.qty * 1000) / 1000 }))
      .sort((a, b) => b.days - a.days || b.qty - a.qty);
  });
}

export type PickableProduct = {
  id: string;
  name: string;
  sku: string;
  section: string | null;
  group: string | null;
  baseUnitName: string;
};

/**
 * What the record sheet offers. To MAKE: prepped products with a production
 * recipe or a parent + yield (a trimmed part is made by trimming). To TRIM:
 * products that are the whole thing of a live trim recipe.
 */
export async function getProductionPickablesLogic(
  tenantId: string
): Promise<{ make: PickableProduct[]; trim: PickableProduct[] }> {
  return withTenantContext(tenantId, async (tx) => {
    const products = await tx.product.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        type: true,
        parentProductId: true,
        category: { select: { accountingSection: true, groupName: true } },
        productUnits: { where: { isBase: true }, select: { unitName: true } },
      },
      orderBy: { name: "asc" },
    });
    const [recipes, trims] = await Promise.all([
      tx.recipe.findMany({
        where: { tenantId, outputProductId: { not: null }, deletedAt: null, supersededAt: null, isDraft: false },
        select: { outputProductId: true },
      }),
      tx.trimRecipe.findMany({ where: { tenantId, deletedAt: null }, select: { parentProductId: true } }),
    ]);
    const withRecipe = new Set(recipes.map((r) => r.outputProductId!));
    const trimParents = new Set(trims.map((t) => t.parentProductId));
    const view = (p: (typeof products)[number]): PickableProduct => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      section: p.category?.accountingSection ?? null,
      group: p.category?.groupName ?? null,
      baseUnitName: p.productUnits[0]?.unitName ?? "",
    });
    return {
      make: products.filter((p) => p.type === "PREPPED" && (withRecipe.has(p.id) || p.parentProductId !== null)).map(view),
      trim: products.filter((p) => trimParents.has(p.id)).map(view),
    };
  });
}

type UnitRow = { id: string; unitName: string; toBaseRatio: Prisma.Decimal; isBase: boolean };
const unitsOf = (us: UnitRow[]): UnitOption[] =>
  [...us]
    .sort((a, b) => Number(b.isBase) - Number(a.isBase))
    .map((u) => ({ id: u.id, unitName: u.unitName, ratio: Number(u.toBaseRatio), isBase: u.isBase }));

export type ProductionForm =
  | {
      kind: "RECIPE";
      product: { id: string; name: string; units: UnitOption[] };
      recipeId: string;
      /** One batch makes this much, in the product's base unit. */
      batchBaseQty: number;
      lines: { productId: string; name: string; qty: number; unitId: string; units: UnitOption[] }[];
      unitCost: Record<string, number> | null;
    }
  | {
      kind: "PARENT";
      product: { id: string; name: string; units: UnitOption[] };
      parent: { id: string; name: string; units: UnitOption[] };
      yieldPct: number;
      unitCost: Record<string, number> | null;
    }
  | { kind: "NONE"; product: { id: string; name: string; units: UnitOption[] } };

/** Everything the record sheet needs to fill a production from its recipe. */
export async function getProductionFormLogic(
  tenantId: string,
  params: { productId: string; branchId: string; today: Date; withCost: boolean }
): Promise<ProductionForm | null> {
  return withTenantContext(tenantId, async (tx) => {
    const product = await tx.product.findFirst({
      where: { tenantId, id: params.productId, deletedAt: null },
      select: {
        id: true,
        name: true,
        parentProductId: true,
        yieldPercent: true,
        productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true } },
      },
    });
    if (!product) return null;
    const head = { id: product.id, name: product.name, units: unitsOf(product.productUnits) };

    const resolved = await resolveRecipeIds(tx, tenantId, [{ kind: "product", id: product.id }], params.branchId, params.today);
    const recipe = resolved.get(`product:${product.id}`);

    const costOf = async (ids: string[]) => {
      if (!params.withCost || ids.length === 0) return null;
      const replayed = await replayPairsInTx(tx, tenantId, ids, [params.branchId]);
      const out: Record<string, number> = {};
      for (const id of ids) {
        const s = replayed.get(costKeyOf(id, params.branchId));
        if (s && s.costSource !== "UNPRICED") out[id] = Number(s.costPerBaseUnit);
      }
      return out;
    };

    if (recipe) {
      const ings = await tx.recipeIngredient.findMany({
        where: { tenantId, recipeId: recipe.id, productId: { not: null } },
        select: {
          productId: true,
          qty: true,
          productUnitId: true,
          product: { select: { name: true, productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true } } } },
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      return {
        kind: "RECIPE" as const,
        product: head,
        recipeId: recipe.id,
        batchBaseQty: Number(recipe.servings),
        lines: ings.map((i) => ({
          productId: i.productId!,
          name: i.product!.name,
          qty: Number(i.qty),
          unitId: i.productUnitId!,
          units: unitsOf(i.product!.productUnits),
        })),
        unitCost: await costOf(ings.map((i) => i.productId!)),
      };
    }
    if (product.parentProductId && product.yieldPercent) {
      const parent = await tx.product.findFirst({
        where: { tenantId, id: product.parentProductId },
        select: { id: true, name: true, productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true } } },
      });
      if (parent) {
        return {
          kind: "PARENT" as const,
          product: head,
          parent: { id: parent.id, name: parent.name, units: unitsOf(parent.productUnits) },
          yieldPct: Number(product.yieldPercent),
          unitCost: await costOf([parent.id]),
        };
      }
    }
    return { kind: "NONE" as const, product: head };
  });
}

export type TrimForm = {
  parent: { id: string; name: string; units: UnitOption[] };
  recipes: {
    id: string;
    name: string;
    parts: {
      productId: string | null;
      name: string;
      weightPct: number;
      valuePct: number;
      locked: boolean;
      units: UnitOption[];
    }[];
  }[];
  /** The whole thing's FIFO cost per base unit here; null without cost:view. */
  unitCost: number | null;
};

/** The trim recipes of one whole thing — for recording a trim, and for editing them. */
export async function getTrimFormLogic(
  tenantId: string,
  params: { parentId: string; branchId: string | null; withCost: boolean }
): Promise<TrimForm | null> {
  return withTenantContext(tenantId, async (tx) => {
    const parent = await tx.product.findFirst({
      where: { tenantId, id: params.parentId, deletedAt: null },
      select: { id: true, name: true, productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true } } },
    });
    if (!parent) return null;
    const recipes = await tx.trimRecipe.findMany({
      where: { tenantId, parentProductId: parent.id, deletedAt: null },
      include: {
        parts: {
          where: { deletedAt: null },
          orderBy: { sortOrder: "asc" },
          include: { product: { select: { name: true, productUnits: { select: { id: true, unitName: true, toBaseRatio: true, isBase: true } } } } },
        },
      },
      orderBy: { name: "asc" },
    });
    let unitCost: number | null = null;
    if (params.withCost && params.branchId) {
      const s = (await replayPairsInTx(tx, tenantId, [parent.id], [params.branchId])).get(costKeyOf(parent.id, params.branchId));
      if (s && s.costSource !== "UNPRICED") unitCost = Number(s.costPerBaseUnit);
    }
    return {
      parent: { id: parent.id, name: parent.name, units: unitsOf(parent.productUnits) },
      recipes: recipes.map((r) => ({
        id: r.id,
        name: r.name,
        parts: r.parts.map((p) => ({
          productId: p.productId,
          name: p.product?.name ?? p.label ?? "ส่วนที่ทิ้ง",
          weightPct: Number(p.weightPct),
          valuePct: Number(p.valuePct),
          locked: p.valueLocked,
          units: p.product ? unitsOf(p.product.productUnits) : [],
        })),
      })),
      unitCost,
    };
  });
}

/** What the product sheet says about how a product is made and cut. */
export type ProductProductionInfo = {
  /** For a prepped product: can it be recorded as made, and how. */
  method: "RECIPE" | "PARENT" | "TRIM_PART" | "NONE" | null;
  /** For a trimmed part: which whole thing it is cut from. */
  partOf: { trimRecipeName: string; parentId: string; parentName: string; weightPct: number; valuePct: number } | null;
  lastProduced: { at: string; qty: number; unitName: string } | null;
  /** How many live trim recipes cut THIS product (as the whole thing). */
  trimRecipeCount: number;
};

export async function getProductProductionInfoLogic(
  tenantId: string,
  params: { productId: string; branchId: string; today: Date }
): Promise<ProductProductionInfo | null> {
  return withTenantContext(tenantId, async (tx) => {
    const p = await tx.product.findFirst({
      where: { tenantId, id: params.productId },
      select: { type: true, parentProductId: true, productUnits: { where: { isBase: true }, select: { unitName: true } } },
    });
    if (!p) return null;
    const [part, recipeCount, last, trimCount] = await Promise.all([
      tx.trimRecipePart.findFirst({
        where: { tenantId, productId: params.productId, deletedAt: null, trimRecipe: { deletedAt: null } },
        select: { weightPct: true, valuePct: true, trimRecipe: { select: { name: true, parentProduct: { select: { id: true, name: true } } } } },
      }),
      p.type === "PREPPED"
        ? resolveRecipeIds(tx, tenantId, [{ kind: "product", id: params.productId }], params.branchId, params.today).then((m) => m.size)
        : Promise.resolve(0),
      tx.productionItem.findFirst({
        where: { tenantId, productId: params.productId, role: "OUTPUT", reversalOfItemId: null, production: { branchId: params.branchId, voidedAt: null } },
        orderBy: { production: { producedAt: "desc" } },
        select: { qty: true, production: { select: { producedAt: true } } },
      }),
      tx.trimRecipe.count({ where: { tenantId, parentProductId: params.productId, deletedAt: null } }),
    ]);
    const method =
      p.type !== "PREPPED" ? null : recipeCount > 0 ? "RECIPE" : p.parentProductId ? "PARENT" : part ? "TRIM_PART" : "NONE";
    return {
      method,
      partOf: part
        ? { trimRecipeName: part.trimRecipe.name, parentId: part.trimRecipe.parentProduct.id, parentName: part.trimRecipe.parentProduct.name, weightPct: n(part.weightPct), valuePct: n(part.valuePct) }
        : null,
      lastProduced: last
        ? { at: last.production.producedAt.toISOString(), qty: n(last.qty), unitName: p.productUnits[0]?.unitName ?? "" }
        : null,
      trimRecipeCount: trimCount,
    };
  });
}

export type PreppedHint = {
  productId: string;
  /** How much more was counted than the ledger holds, in base units. */
  over: number;
  /** False: no recipe to walk — the excess will post as an ordinary gain. */
  canProduce: boolean;
  /** EVERY ingredient the excess would use — the close lowers each line by it. */
  allUsed: { productId: string; qty: number }[];
  inputs: {
    productId: string;
    name: string;
    unitName: string;
    baseUnitId: string;
    /** What the ledger (or this sheet's line) says is here now. */
    systemQty: number;
    /** What making the excess would use. */
    used: number;
    /** systemQty − used: what should be left. */
    left: number;
    /** What this sheet already counted for it, or null. */
    counted: number | null;
  }[];
};

/**
 * Q2's prompt: for every prepped line counted ABOVE the ledger, the main
 * ingredients (≥ 10% of the batch's cost) the excess would have used, and what
 * should therefore be left of each. Writes nothing — the close does that, with
 * the same plan (`planSystemProductionInTx`).
 */
export async function getCountPreppedHintsLogic(
  tenantId: string,
  countId: string
): Promise<PreppedHint[]> {
  return withTenantContext(
    tenantId,
    async (tx: PrismaClient) => {
      const count = await tx.stockCount.findFirst({
        where: { tenantId, id: countId, deletedAt: null },
        select: { branchId: true, status: true, items: { where: { reversalOfItemId: null } } },
      });
      if (!count || count.status !== "DRAFT") return [];
      const ids = count.items.map((i) => i.productId);
      const prepped = await tx.product.findMany({
        where: { tenantId, id: { in: ids }, type: "PREPPED" },
        select: { id: true },
      });
      const preppedIds = new Set(prepped.map((p) => p.id));
      const over = count.items.filter((i) => preppedIds.has(i.productId) && i.qtyCounted.greaterThan(i.qtyExpected));
      if (over.length === 0) return [];

      const now = new Date();
      const graph = await loadRecipeGraph(
        tx,
        tenantId,
        over.map((i) => ({ kind: "product" as const, id: i.productId })),
        count.branchId,
        computeBangkokToday()
      );
      const lineOf = new Map(count.items.map((i) => [i.productId, i]));
      const out: PreppedHint[] = [];
      for (const item of over) {
        const excess = item.qtyCounted.minus(item.qtyExpected);
        if (!hasMethod(graph, item.productId)) {
          out.push({ productId: item.productId, over: Number(excess), canProduce: false, allUsed: [], inputs: [] });
          continue;
        }
        const plan = await planSystemProductionInTx(tx, tenantId, {
          graph,
          branchId: count.branchId,
          productId: item.productId,
          makeQty: excess,
          at: now,
        });
        const main = await mainInputsInTx(tx, tenantId, count.branchId, plan, now);
        const mainPlan = plan.filter((p) => main.has(p.productId));
        const info = await tx.product.findMany({
          where: { tenantId, id: { in: mainPlan.map((p) => p.productId) } },
          select: { id: true, name: true, productUnits: { where: { isBase: true }, select: { id: true, unitName: true } } },
        });
        const balances = await tx.stockMovement.groupBy({
          by: ["productId"],
          where: { tenantId, branchId: count.branchId, productId: { in: mainPlan.map((p) => p.productId) } },
          _sum: { qty: true },
        });
        const balance = new Map(balances.map((b) => [b.productId, n(b._sum.qty)]));
        out.push({
          productId: item.productId,
          over: Number(excess),
          canProduce: true,
          allUsed: plan.map((p) => ({ productId: p.productId, qty: Number(p.qty) })),
          inputs: mainPlan.map((p) => {
            const prod = info.find((x) => x.id === p.productId);
            const line = lineOf.get(p.productId);
            const systemQty = line ? n(line.qtyExpected) : (balance.get(p.productId) ?? 0);
            const used = Number(p.qty);
            return {
              productId: p.productId,
              name: prod?.name ?? "—",
              unitName: prod?.productUnits[0]?.unitName ?? "",
              baseUnitId: prod?.productUnits[0]?.id ?? "",
              systemQty,
              used,
              left: Math.round((systemQty - used) * 1000) / 1000,
              counted: line ? n(line.qtyCounted) : null,
            };
          }),
        });
      }
      return out;
    },
    { timeout: 20_000 }
  );
}

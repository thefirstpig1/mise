// ============================================================
// Mise — consumption: what a day's sales actually ate (Part 22 L3a, ADR 0022)
// ============================================================
// One question, answered for one branch on one business day: which raw products
// left the shelf, and how much of the day's revenue that answer covers.
//
// This file writes NOTHING. It reads sales, resolves the recipe that applied on
// that day, explodes it, and reports what it could not do. L3b turns the result
// into a run, its items and their movements.
//
// ⚠️ It takes a `tx` and opens no context of its own. `getRecipeCostsLogic`
// opens its own `withTenantContext` and must never be called from inside another
// one (recipe-read.ts:351-355) — and we do not want it anyway: posting needs
// QUANTITIES, and the money is the FIFO replay's business at read time (ADR
// 0014). The pair used here, `loadRecipeGraph` + `explodeToRaw`, is the same one
// the guards use inside a write transaction.
// ============================================================

import { Prisma, type CancelledSalePolicy, type PrismaClient } from "@prisma/client";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import type { ConsumptionSkipReason } from "@/lib/validations/consumption";
import {
  GraphNodeMissingError,
  RecipeCycleError,
  RecipeDepthExceededError,
  RecipeMethodMissingError,
  explodeToRaw,
  keyId,
  menuKey,
  reachable,
} from "@/server/recipe-graph";
import { loadRecipeGraph, resolveRecipeIds } from "@/server/recipe-resolve";

/** The ledger stores 3 dp; every quantity that reaches it is rounded here. */
const QTY_SCALE = 3;
const MONEY_SCALE = 2;
const ZERO = new Prisma.Decimal(0);

// ------------------------------------------------------------
// What the answer looks like
// ------------------------------------------------------------

/** One raw product, and the signed change the ledger should record for it. */
export type ConsumptionLine = {
  productId: string;
  /**
   * SIGNED, in the product's base unit, 3 dp — negative when stock leaves, which
   * is the normal case. Positive only when a day's cancellations outweighed its
   * sales under TREAT_AS_NOT_COOKED, which is stock genuinely coming back.
   *
   * Signed here rather than magnitude-plus-a-flag because the value goes
   * straight onto `sales_consumption_item.qty` and then onto the movement, both
   * of which are signed. A magnitude would have to be negated twice on the way,
   * and one of those negations would eventually be forgotten.
   */
  qty: Prisma.Decimal;
};

/** A dish that was sold and could not be turned into stock movements. */
export type ConsumptionSkip = {
  menuId: string;
  menuName: string;
  /** Servings sold, after the cancelled-sale policy has been applied. */
  qty: Prisma.Decimal;
  /** The revenue this dish took, which the posting therefore does not account for. */
  netAmount: Prisma.Decimal;
  reason: ConsumptionSkipReason;
  /**
   * Which thing underneath it was the problem — the component menu with no
   * recipe, or the message the walker refused with. A reason without a subject
   * sends the reader hunting through a set menu's whole tree.
   */
  detail: string | null;
};

/**
 * One menu's own share of the day's product demand, kept UNaggregated.
 *
 * Part 32 (ADR 0032 Q1). `lines` below sums this across menus, and that sum is
 * what posts — the menu is genuinely gone from `sales_consumption_item` by
 * design (ADR 0022). Reporting needs the step before the sum, because
 * `menu.primary_department_id` is the only thing that says whose cost it was.
 *
 * Computed here rather than in a reporting module on purpose: `explodeToRaw`
 * has already run at this point, and a second explosion elsewhere would be a
 * second opinion about what a dish consumes — the shape ADR 0025 Q4 refused
 * for cost and rule N2 refused for the recipe walk.
 */
export type MenuProductDemand = {
  menuId: string;
  lines: ConsumptionLine[];
};

export type ConsumptionDemand = {
  branchId: string;
  businessDate: Date;
  lines: ConsumptionLine[];
  /** The same demand as `lines`, before it was summed across menus (Part 32). */
  byMenu: MenuProductDemand[];
  /** Revenue of the dishes that DID post (rule N3 — coverage is money, not dishes). */
  coveredNetAmount: Prisma.Decimal;
  /** The day's whole revenue, from the same live rows /cost sums. */
  totalNetAmount: Prisma.Decimal;
  menusPosted: number;
  menusSkipped: number;
  skipped: ConsumptionSkip[];
  /** The policy this answer was computed under, so the caller can freeze it. */
  cancelledSalePolicy: CancelledSalePolicy;
};

// ------------------------------------------------------------
// The window
// ------------------------------------------------------------

/**
 * The ledger's own backdate window, applied by the caller because
 * `createStockMovementLogic` explicitly does not (stock-movement.ts:823).
 *
 * Rule N9: an older day is a coverage REASON, never a refusal. The sales stay
 * imported and readable; only the stock movements cannot be written, because
 * every other document in the system respects this window and Part 22 is not
 * going to be the one writer that slips underneath it.
 */
export function isWithinBackdateWindow(businessDate: Date): boolean {
  const today = computeBangkokToday();
  return (
    businessDate.getTime() >=
      addDays(today, -MAX_BACKDATE_DAYS).getTime() &&
    businessDate.getTime() < addDays(today, 1).getTime()
  );
}

// ------------------------------------------------------------
// The day's sales, as the policy sees them
// ------------------------------------------------------------

type MenuSales = {
  menuId: string;
  /** Servings, after the policy. */
  qty: Prisma.Decimal;
  /** Revenue — ALWAYS net of cancellations, whatever the policy says about stock. */
  netAmount: Prisma.Decimal;
};

/**
 * What was sold, per menu, with the cancelled-sale policy already applied.
 *
 * The two figures deliberately part company under TREAT_AS_COOKED: the shop has
 * said a cancelled bill still cost it its ingredients, so the QUANTITY ignores
 * the negative rows — but the MONEY never does. Revenue is what the till kept,
 * and a cancelled bill kept nothing. Reading revenue any other way would make
 * `/cost`'s coverage disagree with `/cost`'s revenue on the same page.
 */
async function menuSalesForDay(
  tx: PrismaClient,
  tenantId: string,
  branchId: string,
  businessDate: Date,
  policy: CancelledSalePolicy
): Promise<MenuSales[]> {
  const live = {
    tenantId,
    branchId,
    businessDate,
    supersededAt: null,
  } as const;

  const all = await tx.salesLine.groupBy({
    by: ["menuId"],
    where: live,
    _sum: { qty: true, netAmount: true },
  });

  // Under TREAT_AS_COOKED the negatives are ignored for quantity, so the sum has
  // to be taken again over the positive rows alone. Two grouped queries rather
  // than pulling the day's rows into memory: a per-bill export puts thousands of
  // lines in a single day.
  const cookedOnly =
    policy === "TREAT_AS_COOKED"
      ? await tx.salesLine.groupBy({
          by: ["menuId"],
          where: { ...live, qty: { gt: 0 } },
          _sum: { qty: true },
        })
      : null;

  const positiveQty = new Map(
    (cookedOnly ?? []).map((r) => [r.menuId, r._sum.qty ?? ZERO])
  );

  return all.map((r) => ({
    menuId: r.menuId,
    qty:
      policy === "TREAT_AS_COOKED"
        ? positiveQty.get(r.menuId) ?? ZERO
        : r._sum.qty ?? ZERO,
    netAmount: r._sum.netAmount ?? ZERO,
  }));
}

// ------------------------------------------------------------
// The explosion
// ------------------------------------------------------------

/**
 * What one branch's sales on one business day took off the shelf.
 *
 * The recipe is resolved **as of that day** (ADR 0021 Q4): a periodic import
 * posts thirty past days at once, and posting all thirty against today's recipe
 * would overstate pork by 20 g a plate for a fortnight with nothing on screen
 * looking wrong.
 *
 * A menu posts WHOLE OR NOT AT ALL (rule N2). Three things stop one, and the
 * third is the dangerous one — a set menu whose component has no recipe explodes
 * to less than it should and nothing looks wrong — so it is detected before the
 * walk rather than inferred from a short answer afterwards.
 */
export async function computeConsumptionForDayLogic(
  tx: PrismaClient,
  tenantId: string,
  params: {
    branchId: string;
    businessDate: Date;
    cancelledSalePolicy: CancelledSalePolicy;
  }
): Promise<ConsumptionDemand> {
  const { branchId, businessDate, cancelledSalePolicy } = params;

  const sales = await menuSalesForDay(
    tx,
    tenantId,
    branchId,
    businessDate,
    cancelledSalePolicy
  );

  const totalNetAmount = sales
    .reduce((acc, s) => acc.plus(s.netAmount), ZERO)
    .toDecimalPlaces(MONEY_SCALE);

  const empty = (skipped: ConsumptionSkip[]): ConsumptionDemand => ({
    branchId,
    businessDate,
    lines: [],
    byMenu: [],
    coveredNetAmount: ZERO,
    totalNetAmount,
    menusPosted: 0,
    menusSkipped: skipped.length,
    skipped,
    cancelledSalePolicy,
  });

  if (sales.length === 0) return empty([]);

  const names = await menuNames(
    tx,
    tenantId,
    sales.map((s) => s.menuId)
  );
  const nameOf = (id: string) => names.get(id) ?? id;

  // The window is a property of the DAY, so it is answered before a single
  // recipe is resolved — there is no point walking a graph for a day that cannot
  // post. Every dish is reported, so the count and the coverage still add up.
  if (!isWithinBackdateWindow(businessDate)) {
    return empty(
      sales.map((s) => ({
        menuId: s.menuId,
        menuName: nameOf(s.menuId),
        qty: s.qty,
        netAmount: s.netAmount,
        reason: "OUTSIDE_BACKDATE_WINDOW" as const,
        detail: null,
      }))
    );
  }

  // A dish that nets to nothing consumed nothing. It is neither posted nor
  // skipped: there is no movement to write and no gap to report, and calling it
  // a skip would put "0 จาน — ยังไม่มีสูตร" in a report about what went wrong.
  const sold = sales.filter((s) => !s.qty.isZero());
  if (sold.length === 0) return empty([]);

  const resolved = await resolveRecipeIds(
    tx,
    tenantId,
    sold.map((s) => ({ kind: "menu" as const, id: s.menuId })),
    branchId,
    businessDate
  );

  const skipped: ConsumptionSkip[] = [];
  const withRecipe: MenuSales[] = [];
  for (const s of sold) {
    if (resolved.has(`menu:${s.menuId}`)) {
      withRecipe.push(s);
      continue;
    }
    skipped.push({
      menuId: s.menuId,
      menuName: nameOf(s.menuId),
      qty: s.qty,
      netAmount: s.netAmount,
      reason: "NO_RECIPE",
      detail: null,
    });
  }

  if (withRecipe.length === 0) {
    return { ...empty(skipped), totalNetAmount };
  }

  // ONE graph for every dish sold that day — the whole reason `loadRecipeGraph`
  // takes a list of roots. Loading per menu would be four queries per level per
  // dish, on a page a fifty-menu shop presses every morning.
  const graph = await loadRecipeGraph(
    tx,
    tenantId,
    withRecipe.map((s) => ({ kind: "menu" as const, id: s.menuId })),
    branchId,
    businessDate
  );

  const totals = new Map<string, Prisma.Decimal>();
  const byMenu: MenuProductDemand[] = [];
  let coveredNetAmount = ZERO;
  let menusPosted = 0;

  for (const s of withRecipe) {
    const root = menuKey(s.menuId);

    // Rule N2/R16, and the only one of the three that is invisible from the
    // result: `explodeToRaw` returns silently for a component menu with no
    // recipe, so the dish would post a SHORT quantity rather than fail. Found by
    // scanning the subtree, the same way recipe-cost.ts finds it for confidence.
    const orphan = recipelessComponent(graph, root, s.menuId);
    if (orphan !== null) {
      skipped.push({
        menuId: s.menuId,
        menuName: nameOf(s.menuId),
        qty: s.qty,
        netAmount: s.netAmount,
        reason: "COMPONENT_MENU_NO_RECIPE",
        detail: names.get(orphan) ?? orphan,
      });
      continue;
    }

    let leaves;
    try {
      leaves = explodeToRaw(graph, root, s.qty);
    } catch (e) {
      // Per dish, not per day. One recipe with a cycle must not stop a shop
      // posting the other forty-nine — the same argument Q2 makes about not
      // letting a recipe problem sink a good import.
      if (
        e instanceof RecipeMethodMissingError ||
        e instanceof RecipeCycleError ||
        e instanceof RecipeDepthExceededError ||
        e instanceof GraphNodeMissingError
      ) {
        skipped.push({
          menuId: s.menuId,
          menuName: nameOf(s.menuId),
          qty: s.qty,
          netAmount: s.netAmount,
          reason: "RECIPE_UNRESOLVABLE",
          detail: e.message,
        });
        continue;
      }
      throw e;
    }

    // A PREPPED product with NEITHER a parent+yield nor a production recipe is
    // emitted as a LEAF rather than thrown on (recipe-graph.ts:387). For cost
    // that is the right answer — it comes back UNPRICED and the recipe goes LOW,
    // which is honest. For STOCK it is not: nothing can raise a prepped balance
    // (ADR 0021 Q11), so posting against one drives it negative for ever and
    // /cost reports negative stock on a product nobody can restock. The dish is
    // held back instead, under the reason whose hint already describes this
    // exact setup.
    const prepped = leaves.find(
      (l) => graph.products.get(l.productId)?.type === "PREPPED"
    );
    if (prepped !== undefined) {
      skipped.push({
        menuId: s.menuId,
        menuName: nameOf(s.menuId),
        qty: s.qty,
        netAmount: s.netAmount,
        reason: "RECIPE_UNRESOLVABLE",
        // The id for now — `nameUnresolved` turns it into the product's name.
        // The graph carries a product's SHAPE, not its label (GraphProduct has
        // no name), so the lookup happens once at the end rather than per dish.
        detail: prepped.productId,
      });
      continue;
    }

    const own = new Map<string, Prisma.Decimal>();
    for (const leaf of leaves) {
      totals.set(
        leaf.productId,
        (totals.get(leaf.productId) ?? ZERO).plus(leaf.qty)
      );
      own.set(leaf.productId, (own.get(leaf.productId) ?? ZERO).plus(leaf.qty));
    }
    // Negated and rounded exactly as `lines` is below, so the two agree line for
    // line. They are the same demand at two grains, and a report that summed
    // this one to a different total than the ledger holds would break rule F2
    // in the one place nothing else checks.
    byMenu.push({
      menuId: s.menuId,
      lines: [...own.entries()]
        .map(([productId, qty]) => ({
          productId,
          qty: qty.negated().toDecimalPlaces(QTY_SCALE),
        }))
        .filter((l) => !l.qty.isZero())
        .sort((a, b) => (a.productId < b.productId ? -1 : 1)),
    });
    coveredNetAmount = coveredNetAmount.plus(s.netAmount);
    menusPosted += 1;
  }

  // Negated on the way out: what the recipe says was CONSUMED becomes what the
  // ledger records as LEAVING. Rounded after summing, not per dish, so a hundred
  // plates do not accumulate a hundred roundings.
  // A component menu that was not itself SOLD is not in `names`, so its skip
  // still carries a raw id. One more lookup, only when there is something to
  // look up: a reason that names a uuid sends the reader hunting the tree by
  // hand, which is the failure the detail exists to prevent.
  await nameUnresolved(tx, tenantId, names, skipped);

  const lines: ConsumptionLine[] = [...totals.entries()]
    .map(([productId, qty]) => ({
      productId,
      qty: qty.negated().toDecimalPlaces(QTY_SCALE),
    }))
    // A product that nets to nothing across the day has no movement to write —
    // and `sales_consumption_item_qty_check` would refuse the row anyway.
    .filter((l) => !l.qty.isZero())
    .sort((a, b) => (a.productId < b.productId ? -1 : 1));

  return {
    branchId,
    businessDate,
    lines,
    byMenu,
    coveredNetAmount: coveredNetAmount.toDecimalPlaces(MONEY_SCALE),
    totalNetAmount,
    menusPosted,
    menusSkipped: skipped.length,
    skipped,
    cancelledSalePolicy,
  };
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * The first menu reachable from `root` that has no recipe of its own, or null.
 *
 * Exported since Part 26: a staff meal explodes ONE menu and needs the same
 * check for the same reason. A second copy of this walk would be a second
 * opinion about what "the recipe is complete" means, and the day the two
 * disagreed a staff meal would deduct less than it should with nothing on
 * screen looking wrong (the shape ADR 0025 Q4 refused for cost).
 *
 * The root itself is excluded: it is in `withRecipe` precisely because it has
 * one, and the graph loads one level past the depth cap, so a node that is
 * present-but-recipe-less deeper down is a real gap rather than an artefact of
 * where the loader stopped.
 */
export function recipelessComponent(
  graph: Parameters<typeof reachable>[0],
  root: string,
  rootMenuId: string
): string | null {
  for (const key of reachable(graph, root)) {
    if (!key.startsWith("m:")) continue;
    const id = keyId(key);
    if (id === rootMenuId) continue;
    if (graph.menus.get(id)?.recipe == null) return id;
  }
  return null;
}

/**
 * Turn every `detail` that is still a bare id into a name a person can read.
 *
 * Two reasons carry one: `COMPONENT_MENU_NO_RECIPE` names a MENU that was not
 * itself sold (so it is not in the day's name map), and the prepped-leaf case of
 * `RECIPE_UNRESOLVABLE` names a PRODUCT. Done once at the end, and only when
 * there is something to look up — a reason that names a uuid sends the reader
 * hunting the tree by hand, which is what the detail exists to prevent.
 */
async function nameUnresolved(
  tx: PrismaClient,
  tenantId: string,
  knownMenus: Map<string, string>,
  skipped: ConsumptionSkip[]
): Promise<void> {
  const menuIds = skipped
    .filter((s) => s.reason === "COMPONENT_MENU_NO_RECIPE" && s.detail !== null)
    .map((s) => s.detail as string)
    .filter((id) => !knownMenus.has(id));
  const productIds = skipped
    .filter((s) => s.reason === "RECIPE_UNRESOLVABLE" && isUuid(s.detail))
    .map((s) => s.detail as string);
  if (menuIds.length === 0 && productIds.length === 0) return;

  const [menus, products] = await Promise.all([
    menuNames(tx, tenantId, menuIds),
    productNames(tx, tenantId, productIds),
  ]);
  for (const s of skipped) {
    if (s.detail === null) continue;
    s.detail = menus.get(s.detail) ?? products.get(s.detail) ?? s.detail;
  }
}

/**
 * A `RECIPE_UNRESOLVABLE` detail is either a product id or the walker's own
 * message; only the first is worth a lookup.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null): boolean => v !== null && UUID_RE.test(v);

async function productNames(
  tx: PrismaClient,
  tenantId: string,
  productIds: string[]
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const rows = await tx.product.findMany({
    where: { tenantId, id: { in: [...new Set(productIds)] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function menuNames(
  tx: PrismaClient,
  tenantId: string,
  menuIds: string[]
): Promise<Map<string, string>> {
  if (menuIds.length === 0) return new Map();
  const rows = await tx.menu.findMany({
    where: { tenantId, id: { in: [...new Set(menuIds)] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

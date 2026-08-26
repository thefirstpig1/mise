// ============================================================
// Mise — Menu Lab view serializers (Sprint 5 Part 24 L4, ADR 0025)
// ============================================================
// The lab's three shapes on their way to a Client Component: a draft, a
// what-if, and the coverage list. Same two rules as every other *-view.ts —
// `Prisma.Decimal` never crosses the boundary (Pitfall #20) and dates leave as
// ISO plus a Bangkok label rendered HERE.
//
// **The cost is serialized by `toRecipeCostView`, imported from `/recipes`.**
// That cross-route import is deliberate and is ADR 0025 Q4 arriving at the
// display layer: L3d refused to give the lab a second cost ENGINE, and a second
// cost SERIALIZER would undo half of that. It is the same walk, the same
// confidence vocabulary, and the same rounding to the satang (rule R15) — so a
// figure on the lab screen and the same figure on the recipe page cannot round
// two ways or drop the caveat in one place and keep it in the other.
//
// And one rule this file adds, which is Q2 wearing a serializer:
//
//   **ราคาที่ตั้งใจ IS NEVER SERIALIZED AS `price`.** The field is
//   `plannedPrice` end to end, and every screen renders it through
//   `PLANNED_PRICE_LABEL_TH`. A dish that sells has a real price, read from the
//   sales file; this number is what somebody hoped for, and the day the two are
//   confusable is the day a shop reads a guess as a fact.
// ============================================================

import type { Prisma } from "@prisma/client";
import {
  toRecipeCostView,
  toRecipeView,
  type RecipeCostView,
  type RecipeView,
} from "@/app/recipes/_components/recipe-view";
import type { RecipeWithIngredients } from "@/server/recipe";
import type {
  CoverageRow,
  DraftRow,
  DuplicateHint,
  LabWhatIf,
  RecipeCoverage,
} from "@/server/menu-lab-read";

/** Baht, at the satang — as everywhere else money is shown (rule R15). */
const baht = (d: Prisma.Decimal): string => d.toFixed(2);

/** A percentage, at one decimal: 33.333…% is 33.3%, and 20% is "20.0". */
const percent = (d: Prisma.Decimal): string => d.toFixed(1);

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// ------------------------------------------------------------
// A draft
// ------------------------------------------------------------

/**
 * A draft is a `recipe` row, so it serializes as one — plus the two columns L1
 * added.
 *
 * `isDraft` travels even though every consumer of this view knows it already:
 * the flag is what keeps the row out of the resolver (L3b), and a view that
 * quietly dropped it would let a screen render a draft in a list of live
 * recipes with nothing on the object to say which it is.
 */
export type DraftView = RecipeView & {
  isDraft: boolean;
  /** Q2 — `null` until somebody types one. Never 0, never a sold price. */
  plannedPrice: string | null;
};

export function toDraftView(r: RecipeWithIngredients): DraftView {
  return {
    ...toRecipeView(r),
    isDraft: r.isDraft,
    plannedPrice: r.plannedPrice === null ? null : baht(r.plannedPrice),
  };
}

// ------------------------------------------------------------
// A draft on a list
// ------------------------------------------------------------

export type DraftRowView = {
  recipeId: string;
  menuId: string;
  menuName: string;
  menuIsMise: boolean;
  plannedPrice: string | null;
  servings: string;
  ingredientCount: number;
  updatedAtLabel: string;
  /**
   * Publishing this takes over a recipe that is already live. Carried as an ID
   * rather than a boolean so the row can LINK to it: "this replaces that" is a
   * sentence somebody should be able to follow before they press anything.
   */
  liveRecipeId: string | null;
  /** Q2: the dish sells, so the sold price is the price. */
  hasSales: boolean;
};

export function toDraftRowView(d: DraftRow): DraftRowView {
  return {
    recipeId: d.recipeId,
    menuId: d.menuId,
    menuName: d.menuName,
    menuIsMise: d.menuIsMise,
    plannedPrice: d.plannedPrice === null ? null : baht(d.plannedPrice),
    servings: d.servings.toString(),
    ingredientCount: d.ingredientCount,
    updatedAtLabel: BANGKOK_DATE.format(d.updatedAt),
    liveRecipeId: d.liveRecipeId,
    hasSales: d.hasSales,
  };
}

// ------------------------------------------------------------
// The live calculator
// ------------------------------------------------------------

export type LabWhatIfView = {
  cost: RecipeCostView;
  branchId: string;
  /**
   * Q6: the branch's NAME, beside the number. Cost needs a branch (ADR 0014
   * Q9), so the figure is always ABOUT one — and a shop with two branches
   * buying pork at two prices has two right answers. Which one this is cannot
   * live in a setting nobody has open.
   */
  branchName: string;
  branchWasDefaulted: boolean;
  /** Rendered here, not in the browser: page 1 in Node and page 2 in the
   * browser is how a list hydrates two ways. */
  asOfLabel: string;
  plannedPrice: string | null;
  /**
   * `null`, never "0.0", when there is no planned price: a 0% food cost is the
   * most flattering possible answer to a question nobody asked.
   *
   * Whatever renders this MUST also render `cost.confidenceLabel`. A 22% food
   * cost over ingredients half of which are UNPRICED is not a 22% food cost,
   * and the two fields are in one object so that no screen can fetch the number
   * without having the caveat in its hand.
   */
  foodCostPercent: string | null;
  grossProfitPerServing: string | null;
};

export function toLabWhatIfView(w: LabWhatIf): LabWhatIfView {
  return {
    cost: toRecipeCostView(w.cost),
    branchId: w.branchId,
    branchName: w.branchName,
    branchWasDefaulted: w.branchWasDefaulted,
    asOfLabel: BANGKOK_DATE.format(w.cost.asOf),
    plannedPrice: w.plannedPrice === null ? null : baht(w.plannedPrice),
    foodCostPercent:
      w.foodCostPercent === null ? null : percent(w.foodCostPercent),
    grossProfitPerServing:
      w.grossProfitPerServing === null ? null : baht(w.grossProfitPerServing),
  };
}

// ------------------------------------------------------------
// Recipe coverage
// ------------------------------------------------------------

export type DuplicateHintView = {
  menuId: string;
  name: string;
  /** `similarity()` as a percentage, shown so the reader can weigh it. */
  scorePercent: string;
  hasRecipe: boolean;
};

export type CoverageRowView = {
  menuId: string;
  name: string;
  revenue: string;
  qty: string;
  shareOfRevenue: string;
  hasDraft: boolean;
  isDeleted: boolean;
  /**
   * `null` means one of two different things, and the screen has to tell them
   * apart using `hintsWereCapped` on the parent: below the cap it means no
   * similar name was found; at or beyond it, nobody looked. An absent hint is
   * never evidence that a dish has no twin.
   */
  duplicateHint: DuplicateHintView | null;
};

export type RecipeCoverageView = {
  branchId: string | null;
  from: string;
  to: string;
  periodLabel: string;
  totalRevenue: string;
  coveredRevenue: string;
  uncoveredRevenue: string;
  /**
   * `null` when the period earned nothing — "there is nothing to cover yet" is
   * a different sentence from "nothing is covered", and 0% says the wrong one
   * (the same refusal Part 22 makes about gross profit with no coverage).
   */
  coveragePercent: string | null;
  rows: CoverageRowView[];
  uncoveredMenuCount: number;
  /** True when the list is longer than the number of rows that were hinted. */
  hintsWereCapped: boolean;
  hintedRowCount: number;
};

function toDuplicateHintView(h: DuplicateHint): DuplicateHintView {
  return {
    menuId: h.menuId,
    name: h.name,
    scorePercent: (h.score * 100).toFixed(0),
    hasRecipe: h.hasRecipe,
  };
}

function toCoverageRowView(r: CoverageRow): CoverageRowView {
  return {
    menuId: r.menuId,
    name: r.name,
    revenue: baht(r.revenue),
    qty: r.qty.toString(),
    shareOfRevenue: percent(r.shareOfRevenue),
    hasDraft: r.hasDraft,
    isDeleted: r.isDeleted,
    duplicateHint:
      r.duplicateHint === null ? null : toDuplicateHintView(r.duplicateHint),
  };
}

export function toRecipeCoverageView(c: RecipeCoverage): RecipeCoverageView {
  return {
    branchId: c.branchId,
    from: c.from.toISOString(),
    to: c.to.toISOString(),
    periodLabel: `${BANGKOK_DATE.format(c.from)} – ${BANGKOK_DATE.format(c.to)}`,
    totalRevenue: baht(c.totalRevenue),
    coveredRevenue: baht(c.coveredRevenue),
    uncoveredRevenue: baht(c.uncoveredRevenue),
    coveragePercent:
      c.coveragePercent === null ? null : percent(c.coveragePercent),
    rows: c.rows.map(toCoverageRowView),
    uncoveredMenuCount: c.uncoveredMenuCount,
    hintsWereCapped: c.rows.length > c.hintedRowCount,
    hintedRowCount: c.hintedRowCount,
  };
}

// ============================================================
// Mise — recipe view serializers (Sprint 5 Part 21 L4)
// ============================================================
// Where recipe rows and cost figures become plain JSON for Client Components.
// The same two rules every *-view.ts in this project follows:
//
//   - Prisma.Decimal CANNOT cross to a Client Component (Pitfall #20) — every
//     quantity and every baht figure leaves here as a STRING, never a number.
//   - Dates leave as ISO strings, plus a Bangkok-rendered label computed HERE,
//     so a list appended client-side cannot format page 1 in Node and page 2 in
//     the browser and hydrate differently on both.
//
// And one rule this Part adds, which is really ADR 0021 Q6 wearing a serializer:
//
//   **A COST NEVER LEAVES HERE WITHOUT ITS CONFIDENCE.** The figure and the
//   reason to doubt it travel in the same object, because a screen that has to
//   fetch the caveat separately is a screen that will one day render the number
//   without it. Six ingredients resolving and one silently free is the failure
//   this whole Part is arranged against.
// ============================================================

import type { Prisma } from "@prisma/client";
import {
  PREPPED_METHOD_LABELS_TH,
  RECIPE_CONFIDENCE_HINTS_TH,
  RECIPE_CONFIDENCE_LABELS_TH,
  RECIPE_PROBLEM_LABELS_TH,
  UNPRICED_REASON_LABELS_TH,
  type PreppedMethod,
  type RecipeConfidence,
} from "@/lib/validations/recipe";
import type { RecipeCost } from "@/server/recipe-cost";
import type { RecipeWithIngredients } from "@/server/recipe";
import type {
  RecipeBranchComparison,
  RecipeListRow,
  RecipeUsageRow,
  RecipeVersionRow,
  SubstitutionPlan,
  UnitRecipeUsageRow,
} from "@/server/recipe-read";

const str = (d: Prisma.Decimal): string => d.toString();

/** Baht, at the satang — the one place a recipe cost is rounded (rule R15). */
const baht = (d: Prisma.Decimal): string => d.toFixed(2);

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// ------------------------------------------------------------
// Cost
// ------------------------------------------------------------

export type UnpricedComponentView = {
  kind: "product" | "menu";
  id: string;
  name: string;
  reason: "NEVER_PURCHASED" | "NO_RECIPE";
  reasonLabel: string;
};

export type RecipeCostLineView = {
  ingredientId: string;
  productId: string | null;
  componentMenuId: string | null;
  label: string;
  /** As typed, in `unitName`. */
  qty: string;
  unitName: string | null;
  sortOrder: number;
  /** Baht for one whole writing of the recipe. */
  cost: string;
  confidence: RecipeConfidence;
  confidenceLabel: string;
};

export type RecipeCostView = {
  recipeId: string;
  branchId: string;
  asOf: string;
  servings: string;
  costPerServing: string;
  costPerBatch: string;
  confidence: RecipeConfidence;
  confidenceLabel: string;
  confidenceHint: string;
  lines: RecipeCostLineView[];
  unpriced: UnpricedComponentView[];
  /** "83.3" or null — Q16, computed at read and never invented. */
  yieldPercentComputed: string | null;
  /** Non-null when the graph is broken; the page names the recipe, not "error". */
  problem: "CYCLE" | "TOO_DEEP" | null;
  problemLabel: string | null;
};

export function toRecipeCostView(c: RecipeCost): RecipeCostView {
  return {
    recipeId: c.recipeId,
    branchId: c.branchId,
    asOf: c.asOf.toISOString(),
    servings: str(c.servings),
    costPerServing: baht(c.costPerServing),
    costPerBatch: baht(c.costPerBatch),
    confidence: c.confidence,
    confidenceLabel: RECIPE_CONFIDENCE_LABELS_TH[c.confidence],
    confidenceHint: RECIPE_CONFIDENCE_HINTS_TH[c.confidence],
    lines: c.lines.map((l) => ({
      ingredientId: l.ingredientId,
      productId: l.productId,
      componentMenuId: l.componentMenuId,
      label: l.label,
      qty: str(l.qty),
      unitName: l.unitName,
      sortOrder: l.sortOrder,
      cost: baht(l.cost),
      confidence: l.confidence,
      confidenceLabel: RECIPE_CONFIDENCE_LABELS_TH[l.confidence],
    })),
    unpriced: c.unpriced.map((u) => ({
      kind: u.kind,
      id: u.id,
      name: u.name,
      reason: u.reason,
      reasonLabel: UNPRICED_REASON_LABELS_TH[u.reason],
    })),
    yieldPercentComputed:
      c.yieldPercentComputed === null ? null : c.yieldPercentComputed.toFixed(1),
    problem: c.problem,
    problemLabel: c.problem === null ? null : RECIPE_PROBLEM_LABELS_TH[c.problem],
  };
}

// ------------------------------------------------------------
// The recipe itself
// ------------------------------------------------------------

export type RecipeIngredientView = {
  id: string;
  productId: string | null;
  componentMenuId: string | null;
  qty: string;
  productUnitId: string | null;
  sortOrder: number;
  notes: string | null;
};

export type RecipeView = {
  id: string;
  lineId: string;
  menuId: string | null;
  outputProductId: string | null;
  servings: string;
  /**
   * The date this version starts applying.
   *
   * Q4/rule R8: the SCREEN shows this only where it changes an answer — the
   * history view, and a cost figure whose period straddles a change. Never on a
   * current recipe page, where "มีผลตั้งแต่ 15 พ.ย. 2569" still sitting there in
   * 2575 tells a reader nothing they can act on. It is serialized regardless,
   * because the history view is a consumer and a serializer that omits a field
   * to enforce a display rule enforces it in the wrong layer.
   */
  effectiveFrom: string;
  effectiveFromLabel: string;
  notes: string | null;
  ingredients: RecipeIngredientView[];
};

export function toRecipeView(r: RecipeWithIngredients): RecipeView {
  return {
    id: r.id,
    lineId: r.lineId,
    menuId: r.menuId,
    outputProductId: r.outputProductId,
    servings: str(r.servings),
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveFromLabel: BANGKOK_DATE.format(r.effectiveFrom),
    notes: r.notes,
    ingredients: [...r.ingredients]
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))
      .map((i) => ({
        id: i.id,
        productId: i.productId,
        componentMenuId: i.componentMenuId,
        qty: str(i.qty),
        productUnitId: i.productUnitId,
        sortOrder: i.sortOrder,
        notes: i.notes,
      })),
  };
}

// ------------------------------------------------------------
// "What would this change touch?" (Q13/Q14/Q17)
// ------------------------------------------------------------

export type RecipeUsageView = {
  recipeId: string;
  lineId: string;
  label: string;
  isCentral: boolean;
  /** Empty on a central line. Q8: a branch here has DECIDED, not merely copied. */
  branchNames: string[];
  effectiveFrom: string;
  ingredientId: string;
  qty: string;
  unitId: string | null;
  unitName: string | null;
};

export function toRecipeUsageView(u: RecipeUsageRow): RecipeUsageView {
  return {
    recipeId: u.recipeId,
    lineId: u.lineId,
    label: u.label,
    isCentral: u.isCentral,
    branchNames: u.branchNames,
    effectiveFrom: u.effectiveFrom.toISOString(),
    ingredientId: u.ingredientId,
    qty: str(u.qty),
    unitId: u.unitId,
    unitName: u.unitName,
  };
}

export type SubstitutionPlanRowView = RecipeUsageView & {
  /**
   * The quantity the form may PREFILL, or null when it must be re-entered.
   *
   * Q15, and the null is load-bearing: the form must render an EMPTY box, not a
   * zero and not the old number. A wrong default is a value somebody clicks
   * past, and every plate is wrong from that day with nothing on screen looking
   * wrong.
   */
  carryQty: string | null;
  carryUnitId: string | null;
};

export type SubstitutionPlanView = {
  fromProductId: string;
  fromLabel: string;
  toLabel: string;
  central: SubstitutionPlanRowView[];
  /** Grouped apart on purpose — a bulk edit must not undo Q8 by accident. */
  branch: SubstitutionPlanRowView[];
  totalCount: number;
  branchCount: number;
};

export function toSubstitutionPlanView(p: SubstitutionPlan): SubstitutionPlanView {
  const row = (r: SubstitutionPlan["central"][number]): SubstitutionPlanRowView => ({
    ...toRecipeUsageView(r),
    carryQty: r.carryQty === null ? null : str(r.carryQty),
    carryUnitId: r.carryUnitId,
  });
  return {
    fromProductId: p.fromProductId,
    fromLabel: p.fromLabel,
    toLabel: p.toLabel,
    central: p.central.map(row),
    branch: p.branch.map(row),
    totalCount: p.central.length + p.branch.length,
    branchCount: p.branch.length,
  };
}

export type UnitRecipeUsageView = {
  recipeId: string;
  label: string;
  isCentral: boolean;
  qty: string;
  productName: string;
};

/** Q17: what a `toBaseRatio` correction would move, stated before it moves it. */
export function toUnitRecipeUsageView(u: UnitRecipeUsageRow): UnitRecipeUsageView {
  return {
    recipeId: u.recipeId,
    label: u.label,
    isCentral: u.isCentral,
    qty: str(u.qty),
    productName: u.productName,
  };
}

// ------------------------------------------------------------
// The list, the branch comparison, the history (L5a)
// ------------------------------------------------------------

export type RecipeListRowView = {
  kind: "menu" | "product";
  targetId: string;
  name: string;
  categoryName: string | null;
  isPosStub: boolean;
  preppedMethod: PreppedMethod;
  preppedMethodLabel: string;
  recipeId: string | null;
  lineId: string | null;
  isBranchOwn: boolean;
  servings: string | null;
  /** Null together with `confidence`, never on its own. */
  costPerServing: string | null;
  confidence: RecipeConfidence | null;
  confidenceLabel: string | null;
  problem: "CYCLE" | "TOO_DEEP" | null;
  problemLabel: string | null;
};

export function toRecipeListRowView(r: RecipeListRow): RecipeListRowView {
  return {
    kind: r.kind,
    targetId: r.targetId,
    name: r.name,
    categoryName: r.categoryName,
    isPosStub: r.isPosStub,
    preppedMethod: r.preppedMethod,
    preppedMethodLabel: PREPPED_METHOD_LABELS_TH[r.preppedMethod],
    recipeId: r.recipeId,
    lineId: r.lineId,
    isBranchOwn: r.isBranchOwn,
    servings: r.servings === null ? null : str(r.servings),
    costPerServing: r.costPerServing === null ? null : baht(r.costPerServing),
    confidence: r.confidence,
    confidenceLabel:
      r.confidence === null ? null : RECIPE_CONFIDENCE_LABELS_TH[r.confidence],
    problem: r.problem,
    problemLabel: r.problem === null ? null : RECIPE_PROBLEM_LABELS_TH[r.problem],
  };
}

export type RecipeBranchGroupView = {
  recipeId: string;
  lineId: string;
  isCentral: boolean;
  branchNames: string[];
  branchCount: number;
  /** Shown here on purpose: a history-shaped view, where the date is the content. */
  effectiveFrom: string;
  effectiveFromLabel: string;
  ingredientCount: number;
  servings: string;
  costPerServing: string | null;
  confidence: RecipeConfidence | null;
  confidenceLabel: string | null;
  problem: "CYCLE" | "TOO_DEEP" | null;
  problemLabel: string | null;
  /**
   * The branch the figure beside it was priced at. The screen MUST print it —
   * two groups priced at two branches differ by their prices as well as by their
   * ingredients, and without the name the reader attributes all of it to the
   * recipe (rule R4).
   */
  pricedAtBranchName: string | null;
};

export type RecipeBranchComparisonView = {
  label: string;
  branchesWithNoRecipe: string[];
  groups: RecipeBranchGroupView[];
  /**
   * True when every `costPerServing` below is null because the reader lacks
   * `cost:view`, not because the recipe cannot be priced. The screen must say
   * which — the two look the same in the data (rule A8).
   */
  costHidden: boolean;
};

export function toBranchComparisonView(
  c: RecipeBranchComparison
): RecipeBranchComparisonView {
  return {
    label: c.label,
    branchesWithNoRecipe: c.branchesWithNoRecipe,
    costHidden: c.costHidden,
    groups: c.groups.map((g) => ({
      recipeId: g.recipeId,
      lineId: g.lineId,
      isCentral: g.isCentral,
      branchNames: g.branchNames,
      branchCount: g.branchCount,
      effectiveFrom: g.effectiveFrom.toISOString(),
      effectiveFromLabel: BANGKOK_DATE.format(g.effectiveFrom),
      ingredientCount: g.ingredientCount,
      servings: str(g.servings),
      costPerServing: g.costPerServing === null ? null : baht(g.costPerServing),
      confidence: g.confidence,
      confidenceLabel:
        g.confidence === null ? null : RECIPE_CONFIDENCE_LABELS_TH[g.confidence],
      problem: g.problem,
      problemLabel:
        g.problem === null ? null : RECIPE_PROBLEM_LABELS_TH[g.problem],
      pricedAtBranchName: g.pricedAtBranchName,
    })),
  };
}

export type RecipeVersionView = {
  recipeId: string;
  effectiveFrom: string;
  effectiveFromLabel: string;
  createdAtLabel: string;
  ingredientCount: number;
  servings: string;
  notes: string | null;
  isSuperseded: boolean;
  isCurrent: boolean;
};

/** Rule R8's one screen: here the date IS the content. */
export function toRecipeVersionView(v: RecipeVersionRow): RecipeVersionView {
  return {
    recipeId: v.recipeId,
    effectiveFrom: v.effectiveFrom.toISOString(),
    effectiveFromLabel: BANGKOK_DATE.format(v.effectiveFrom),
    createdAtLabel: BANGKOK_DATE.format(v.createdAt),
    ingredientCount: v.ingredientCount,
    servings: str(v.servings),
    notes: v.notes,
    isSuperseded: v.isSuperseded,
    isCurrent: v.isCurrent,
  };
}

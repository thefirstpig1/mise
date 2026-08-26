// ============================================================
// Mise — Menu Lab zod schemas (Sprint 5 Part 24 L2, ADR 0025)
// ============================================================
// Menu Lab is the one screen where nothing has happened yet. Every other number
// Mise shows comes from something recorded — cost from the ledger, selling price
// from the sales file — and "should I price this at ฿89 or ฿99?" is a question
// about a dish nobody has cooked. So this file carries two shapes the recipe
// schemas deliberately do not have: a price a person may TYPE, and a recipe that
// is true on no day.
//
// Four shapes:
//   saveDraft      create or edit a draft — on an existing menu, or on a menu
//                  Mise creates for it (Q3). Editing binds the recipe id as an
//                  argument, exactly as Part 21's update action does.
//   publishDraft   the draft stops being a what-if
//   discardDraft   it never was one
//   labWhatIf      the LIVE calculator — nothing saved yet, so no recipe id
//   recipeCoverage which dishes have no recipe, ranked by revenue (Q5)
//
// What is NOT here, deliberately:
//   - `effectiveFrom`. A draft is true on NO day; publishing stamps today. The
//     form never asks, and a draft carrying a date would be a recipe that merely
//     forgot to be resolved.
//   - `outputProductId`. Menu Lab designs DISHES. A production recipe for a
//     PREPPED product is entered on the recipe screen, where ADR 0021 Q1's
//     method exclusivity is already enforced.
//   - Anything needing a DB read: whether the menu is this tenant's, whether it
//     already has a central recipe, which branch has the freshest cost data.
//     All of it is L3, and this file cannot see the database.
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import {
  MAX_INGREDIENTS,
  MAX_RECIPE_NOTE_LENGTH,
  recipeIngredientInputSchema,
} from "@/lib/validations/recipe";
import { MAX_MENU_NAME_LENGTH } from "@/lib/validations/sales-import";

/** Blank → null. Same helper as every other validations file. */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/** Blank → undefined, for optional-and-absent rather than optional-and-null. */
const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/** A checkbox arrives as "on" with no JS, and as `true` from a typed caller. */
const flagPreprocess = (v: unknown) => v === "true" || v === true || v === "on";

/** `servings` is Decimal(15,3), like every quantity in the recipe tables. */
const hasAtMostThreeDecimals = (n: number) => Number(n.toFixed(3)) === n;

// ------------------------------------------------------------
// The typed price
// ------------------------------------------------------------

/**
 * Matches `recipe.planned_price` — Decimal(15,2), the same ceiling money has
 * everywhere else in the schema (`MONEY_MAX` in expense.ts).
 */
export const PLANNED_PRICE_MAX = 9_999_999_999_999.99;

/**
 * `toFixed` round-trip, never `n * 100` (Pitfall #30). `1.005 * 100` is
 * 100.49999999999999 in binary float, which would reject prices a browser with
 * `step="0.01"` will happily submit.
 */
const hasAtMostTwoDecimals = (n: number) => Number(n.toFixed(2)) === n;

/**
 * **ราคาที่ตั้งใจ, never ราคา** (Q2). The number means "the price I was
 * considering while designing this recipe" — a fact about a design session, not
 * a claim about today. That is what lets it live on a row without going stale,
 * and why it never competes with the price read from sales.
 *
 * Nullable, because a draft written to answer "what does this cost?" has no
 * price in it yet, and forcing a number makes people type a placeholder that
 * later reads as a decision.
 *
 * Zero is refused. A giveaway is a real thing in sales — rule P21 exists for it
 * — but ฿0 typed into a pricing calculator is an empty box that got submitted,
 * and the food-cost ratio it produces is a division by zero dressed as a
 * finding.
 */
export const plannedPriceSchema = z.preprocess(
  blankToNull,
  z.coerce
    .number({ invalid_type_error: "ราคาที่ตั้งใจไม่ถูกต้อง" })
    .positive("ราคาที่ตั้งใจต้องมากกว่า 0")
    .max(PLANNED_PRICE_MAX, "ราคาที่ตั้งใจเกินค่าที่ระบบรองรับ")
    .refine(hasAtMostTwoDecimals, "ราคาที่ตั้งใจมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง")
    .nullable()
);

/**
 * The label, exported so no screen writes ราคา by hand. Wherever the planned
 * price appears beside a price read from sales, the sold price is THE price and
 * this one sits beside it as a comparison, never in place of it (Q2).
 */
export const PLANNED_PRICE_LABEL_TH = "ราคาที่ตั้งใจ";
export const PLANNED_PRICE_HINT_TH = "ราคาที่คิดไว้ตอนออกแบบเมนู ไม่ใช่ราคาขาย";
export const PLANNED_PRICE_VS_SOLD_HINT_TH =
  "เมนูนี้มียอดขายแล้ว ราคาที่ใช้จริงคือราคาที่ขายได้ ตัวเลขนี้ไว้เทียบว่าตั้งใจไว้เท่าไร";

// ------------------------------------------------------------
// Saving a draft
// ------------------------------------------------------------

/**
 * A draft hangs off a menu, and there are exactly two ways to get one (Q3):
 *
 *   `menuId`       an existing dish — the "what if I changed this recipe" half
 *                  of the lab, including a dish that already sells.
 *   `newMenuName`  a dish that does not exist. Saving creates a `menu` row with
 *                  `source: MISE` and hangs the draft on it, which leaves
 *                  `recipe_target_check` untouched. The alternative — both
 *                  target columns null while a recipe is a draft — weakens an
 *                  invariant guarding the whole table for one screen's
 *                  transient state.
 *
 * `menuCategoryId` belongs to the new-menu half only. For a dish that already
 * exists the category is the menu's own, and letting a draft edit it would put
 * a second, quieter door onto the menu screen's field.
 *
 * At least one ingredient, exactly as an ordinary recipe: a saved recipe with no
 * lines costs ฿0, and a ฿0 food cost shown with any confidence at all is the
 * "a zero would be a lie" failure the cost views are organised against. The LIVE
 * calculator below is the one allowed to hold nothing, because nothing there is
 * saved.
 *
 * IDEMPOTENT by `submitKey`, used as the row's id — Part 13.5's pattern, the
 * same as `recipeInputSchema`.
 */
export const draftRecipeInputSchema = z
  .object({
    submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
    menuId: z.preprocess(
      blankToNull,
      z.string().uuid("เมนูไม่ถูกต้อง").nullable()
    ),
    newMenuName: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .min(1, "ต้องระบุชื่อเมนู")
        .max(MAX_MENU_NAME_LENGTH, "ชื่อเมนูต้องไม่เกิน 200 ตัวอักษร")
        .nullable()
    ),
    menuCategoryId: z.preprocess(
      blankToNull,
      z.string().uuid("หมวดไม่ถูกต้อง").nullable()
    ),
    /**
     * How many portions one writing of this makes — ADR 0021 Q16, unchanged
     * here: a curry designed by the pot says 20 and the system divides, instead
     * of the person rounding 350 ÷ 20 by hand into a form.
     */
    servings: z.coerce
      .number({ invalid_type_error: "จำนวนที่ต่อสูตรไม่ถูกต้อง" })
      .positive("จำนวนที่ต่อสูตรต้องมากกว่า 0")
      .refine(hasAtMostThreeDecimals, "จำนวนที่ต่อสูตรมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง")
      .default(1),
    plannedPrice: plannedPriceSchema,
    ingredients: z
      .array(recipeIngredientInputSchema)
      .min(1, "ต้องมีวัตถุดิบอย่างน้อย 1 รายการ")
      .max(MAX_INGREDIENTS, `วัตถุดิบต้องไม่เกิน ${MAX_INGREDIENTS} รายการ`),
    notes: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(MAX_RECIPE_NOTE_LENGTH, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร")
        .nullable()
    ),
  })
  .superRefine((val, ctx) => {
    const hasMenu = val.menuId !== null;
    const hasNewName = val.newMenuName !== null;

    if (hasMenu === hasNewName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: hasMenu
          ? "เลือกได้อย่างเดียว: เมนูที่มีอยู่ หรือ ตั้งชื่อเมนูใหม่"
          : "ต้องเลือกเมนูที่มีอยู่ หรือตั้งชื่อเมนูใหม่",
        path: ["menuId"],
      });
      return;
    }

    if (hasMenu && val.menuCategoryId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "หมวดของเมนูที่มีอยู่แล้ว แก้ได้ที่หน้าเมนู",
        path: ["menuCategoryId"],
      });
    }

    // The shallowest cycle there is, and the only one visible without the
    // database: a set menu listing itself. Deeper ones (A→B→A) and the depth cap
    // need stored rows, so they stay with the guard every recipe goes through.
    if (hasMenu) {
      val.ingredients.forEach((ing, i) => {
        if (ing.componentMenuId === val.menuId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "เมนูใส่ตัวเองเป็นส่วนประกอบไม่ได้",
            path: ["ingredients", i, "componentMenuId"],
          });
        }
      });
    }

    // The same thing twice in one recipe is a mistake every time, and silently
    // summing them would make the cost right while the recipe on screen reads
    // wrong.
    const seen = new Set<string>();
    val.ingredients.forEach((ing, i) => {
      const key = ing.productId
        ? `p:${ing.productId}`
        : `m:${ing.componentMenuId}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "รายการนี้ซ้ำกับที่ใส่ไว้แล้ว",
          path: [
            "ingredients",
            i,
            ing.productId ? "productId" : "componentMenuId",
          ],
        });
      }
      seen.add(key);
    });
  });

export type DraftRecipeInput = z.infer<typeof draftRecipeInputSchema>;

// ------------------------------------------------------------
// Publishing / discarding
// ------------------------------------------------------------

/**
 * The draft stops being a what-if: `isDraft` clears and `effectiveFrom` becomes
 * today, so from this moment the resolver can see it and the ledger consumes
 * against it.
 *
 * `acknowledgeReplace` is the shape Part 19's import preview and Part 21's
 * branch copy already use — the screen names what is about to be touched and the
 * second pass carries proof the person saw it. It matters here because
 * publishing a draft of a dish that ALREADY sells changes what every plate from
 * today consumes, while the recipe that was true yesterday stays true for
 * yesterday — which is exactly why nothing on screen would look different
 * tomorrow.
 *
 * No `submitKey`: publishing is idempotent by what it does rather than by a key,
 * since a recipe that is already published has nothing left to change. Same
 * reasoning as `deleteRecipeInputSchema`.
 */
export const publishDraftInputSchema = z.object({
  recipeId: z.string().uuid("สูตรไม่ถูกต้อง"),
  acknowledgeReplace: z.preprocess(flagPreprocess, z.boolean()).default(false),
});

export type PublishDraftInput = z.infer<typeof publishDraftInputSchema>;

/**
 * It never was a recipe. Soft-deletes the draft row.
 *
 * The MISE menu a "new dish" draft created is deliberately left behind: it may
 * carry other drafts, and a menu that once existed is what Part 25's merging
 * reconciles if the dish later appears in the POS. Nothing is at risk — a MISE
 * menu with no sales cannot affect revenue, coverage or consumption (ADR 0025
 * Consequence 3).
 */
export const discardDraftInputSchema = z.object({
  recipeId: z.string().uuid("สูตรไม่ถูกต้อง"),
});

export type DiscardDraftInput = z.infer<typeof discardDraftInputSchema>;

// ------------------------------------------------------------
// The live calculator
// ------------------------------------------------------------

/**
 * "฿89 or ฿99?" asked of lines that are not saved and may never be. There is no
 * recipe id here on purpose — nothing before Save is persisted (Q3) — so the
 * cost walk is handed the ingredients themselves.
 *
 * `ingredients` may be EMPTY, which the saved draft refuses: an empty calculator
 * is a screen somebody just opened, not a dish claiming to cost nothing.
 *
 * `branchId` is optional and absent means "the branch with the freshest cost
 * data" (Q6). Cost needs a branch — ADR 0014 Q9 — and a two-branch shop buying
 * pork at two prices gets two answers; the default picks the highest confidence
 * available, and L5 puts that branch's NAME beside the number rather than hiding
 * it in a setting.
 *
 * `plannedPrice` rides along so the food-cost ratio is computed where the cost
 * is — on the server. A Prisma `Decimal` cannot cross into a Client Component
 * (Pitfall #20), and a ratio recomputed in the browser from a rounded string is
 * a second answer waiting to disagree with the first.
 */
export const labWhatIfQuerySchema = z.object({
  branchId: z.preprocess(
    blankToUndefined,
    z.string().uuid("สาขาไม่ถูกต้อง").optional()
  ),
  servings: z.coerce
    .number({ invalid_type_error: "จำนวนที่ต่อสูตรไม่ถูกต้อง" })
    .positive("จำนวนที่ต่อสูตรต้องมากกว่า 0")
    .refine(hasAtMostThreeDecimals, "จำนวนที่ต่อสูตรมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง")
    .default(1),
  plannedPrice: plannedPriceSchema,
  ingredients: z
    .array(recipeIngredientInputSchema)
    .max(MAX_INGREDIENTS, `วัตถุดิบต้องไม่เกิน ${MAX_INGREDIENTS} รายการ`),
});

export type LabWhatIfQuery = z.infer<typeof labWhatIfQuerySchema>;

// ------------------------------------------------------------
// Recipe coverage
// ------------------------------------------------------------

/**
 * The list answers one question — **how much of my gross profit is currently
 * guessed?** — so it ranks the menus with no recipe BY REVENUE (Q5). That is the
 * only ordering matching why anybody would sit down and enter a recipe.
 *
 * `from` / `to` bound the revenue window. L3c supplies the default period rather
 * than this file inventing one, because the page asking knows what period it is
 * showing.
 *
 * There is no "group similar names" flag and there will not be one until Part
 * 25. Each row carries a per-row duplicate hint from the `pg_trgm` search that
 * already exists, and ADR 0019's rule stands: a similarity score SUGGESTS, a
 * person decides.
 */
export const MAX_COVERAGE_ROWS = 200;
export const DEFAULT_COVERAGE_ROWS = 50;

export const recipeCoverageQuerySchema = z.object({
  branchId: z.preprocess(
    blankToUndefined,
    z.string().uuid("สาขาไม่ถูกต้อง").optional()
  ),
  from: z.preprocess(
    blankToUndefined,
    z.coerce.date({ invalid_type_error: "วันที่ไม่ถูกต้อง" }).optional()
  ),
  to: z.preprocess(
    blankToUndefined,
    z.coerce.date({ invalid_type_error: "วันที่ไม่ถูกต้อง" }).optional()
  ),
  limit: z.coerce
    .number()
    .int("จำนวนรายการต้องเป็นจำนวนเต็ม")
    .min(1)
    .max(MAX_COVERAGE_ROWS, `แสดงได้ไม่เกิน ${MAX_COVERAGE_ROWS} รายการ`)
    .default(DEFAULT_COVERAGE_ROWS),
  /**
   * A menu somebody is already drafting a recipe for is still uncovered — the
   * ledger cannot see a draft — but it is somebody's work in progress, so the
   * screen may set those rows aside. Off by default: hiding work that has not
   * landed is how a list quietly stops matching the gross profit it explains.
   */
  hideWithDrafts: z.preprocess(flagPreprocess, z.boolean()).default(false),
});

export type RecipeCoverageQuery = z.infer<typeof recipeCoverageQuerySchema>;

// ------------------------------------------------------------
// Thai field labels — for the action layer's error mapping
// ------------------------------------------------------------

export const MENU_LAB_FIELD_LABELS_TH: Record<string, string> = {
  menuId: "เมนู",
  newMenuName: "ชื่อเมนูใหม่",
  menuCategoryId: "หมวด",
  servings: "ทำได้กี่ที่",
  plannedPrice: PLANNED_PRICE_LABEL_TH,
  ingredients: "วัตถุดิบ",
  productId: "วัตถุดิบ",
  componentMenuId: "เมนูที่เป็นส่วนประกอบ",
  qty: "จำนวน",
  productUnitId: "หน่วย",
  notes: "หมายเหตุ",
  branchId: "สาขา",
  acknowledgeReplace: "ยืนยันการแทนที่สูตรเดิม",
};

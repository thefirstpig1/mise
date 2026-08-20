// ============================================================
// Mise — recipe zod schemas (Sprint 5 Part 21 L2, ADR 0021)
// ============================================================
// Four write shapes and two queries: create/edit a recipe, copy one to branches,
// substitute an ingredient across several recipes, and read.
//
// What is NOT here, deliberately:
//   - Anything that needs a DB read. Whether a product belongs to the tenant,
//     whether a unit belongs to that product, whether a chain is cyclic or too
//     deep, whether a branch is already served by another line for the same menu
//     — all of it is L3. This file cannot see the database and must not pretend.
//   - The base-unit quantity. A recipe stores what the person typed and the unit
//     they typed it in; the base value is computed at read (Q17), because a
//     recipe is a standing instruction ("use one bag"), not a record of a past
//     transaction. This is the deliberate opposite of a purchase order line.
//   - `tenantId` / `createdBy` — from requireTenant + session, server-side.
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";

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

// ------------------------------------------------------------
// Numeric limits
// ------------------------------------------------------------

/** `qty` and `servings` are both Decimal(15,3), like every ledger quantity. */
export const QTY_MAX = 999_999_999_999.999;
const QTY_DECIMAL_PLACES = 3;

/**
 * `toFixed` round-trip, never `n * 1000` (Pitfall #30). `1.005 * 1000` is
 * 1004.9999999999999 in binary float, which rejects 1.2% of otherwise valid
 * three-decimal values — including ones a browser with `step="0.001"` will
 * happily submit, leaving the user unable to satisfy the error message.
 */
const hasAtMostThreeDecimals = (n: number) =>
  Number(n.toFixed(QTY_DECIMAL_PLACES)) === n;

/**
 * Decision #58, and ADR 0007 chose the product graph's cap to line up with this
 * one EXACTLY so there is no off-by-one between them. Counted in NODES, and
 * spent by one budget across BOTH kinds of hop (Q3): a set menu descending into
 * a dish descending into a prepped product descending into its raw parent has
 * spent four.
 *
 * ⚠️ `src/server/product.ts` still hard-codes the same 5 in `assertParentValid`.
 * L3a wires it to this constant when it adds the type-change guard; until then
 * the two literals must be changed together.
 */
export const MAX_RECIPE_DEPTH = 5;

export const MAX_RECIPE_NOTE_LENGTH = 500;
const MAX_INGREDIENT_NOTE_LENGTH = 200;

/**
 * A recipe with no ingredients costs nothing, which would read on screen as a
 * dish with no food cost — the "a zero would be a lie" failure the cost views
 * are organised against. A recipe being written is a draft in the form, not a
 * saved row.
 */
const MIN_INGREDIENTS = 1;
export const MAX_INGREDIENTS = 100;

// ------------------------------------------------------------
// One ingredient line
// ------------------------------------------------------------

/**
 * Points at a **thing**, never at a recipe version (Q3). Exactly one of
 * `productId` / `componentMenuId`, matched by `recipe_ingredient_target_check`
 * in the database.
 *
 * `productUnitId` is bound to `productId`: a product line carries a unit ("120 g
 * of minced pork"), a menu line does not ("1 steak"). Bound rather than merely
 * optional, so a set-menu line can never carry a unit belonging to some other
 * product and a product line can never lose the unit its number is meaningless
 * without (`recipe_ingredient_unit_check` says the same).
 */
export const recipeIngredientInputSchema = z
  .object({
    productId: z.preprocess(
      blankToNull,
      z.string().uuid("วัตถุดิบไม่ถูกต้อง").nullable()
    ),
    componentMenuId: z.preprocess(
      blankToNull,
      z.string().uuid("เมนูที่เลือกไม่ถูกต้อง").nullable()
    ),
    /**
     * Strictly positive, and this schema is ALLOWED to say so. `sales_line` is
     * not: a voided bill is negative and a giveaway is zero, which is why rule
     * P21 forbids leaning on `.positive()` there. Here a recipe that uses none
     * of something simply has no line, so 0 is not a legal answer.
     */
    qty: z.coerce
      .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
      .positive("จำนวนต้องมากกว่า 0")
      .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
      .refine(hasAtMostThreeDecimals, "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
    productUnitId: z.preprocess(
      blankToNull,
      z.string().uuid("หน่วยไม่ถูกต้อง").nullable()
    ),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
    notes: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(MAX_INGREDIENT_NOTE_LENGTH, "หมายเหตุต้องไม่เกิน 200 ตัวอักษร")
        .nullable()
    ),
  })
  .superRefine((val, ctx) => {
    const hasProduct = val.productId !== null;
    const hasMenu = val.componentMenuId !== null;

    if (hasProduct === hasMenu) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: hasProduct
          ? "เลือกได้อย่างเดียว: วัตถุดิบ หรือ เมนู"
          : "ต้องเลือกวัตถุดิบหรือเมนู",
        path: ["productId"],
      });
      return;
    }

    if (hasProduct && val.productUnitId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ต้องระบุหน่วยของวัตถุดิบ",
        path: ["productUnitId"],
      });
    }
    if (hasMenu && val.productUnitId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "เมนูที่เป็นส่วนประกอบไม่ต้องระบุหน่วย",
        path: ["productUnitId"],
      });
    }
  });

export type RecipeIngredientInput = z.infer<typeof recipeIngredientInputSchema>;

// ------------------------------------------------------------
// Creating / editing a recipe
// ------------------------------------------------------------

/**
 * One recipe makes exactly ONE thing (Q1/Q2) — a menu that is sold, or a PREPPED
 * product that is produced. `recipe_target_check` in the database says the same.
 *
 * **`effectiveFrom` is the quiet part.** The form does not ask for it: saving
 * stamps today, and only the "แก้ย้อนหลัง" path reveals the field (Q4). Storing
 * it is not optional though — Part 19 imports periodically, so Part 22 posts
 * consumption for thirty past days at once, and a system that cannot say what
 * the recipe was on the 5th posts all thirty against today's.
 *
 * It obeys the LEDGER's backdate window rather than being unbounded, and the
 * reason is Part 22's: correcting a recipe back past a day whose consumption has
 * already posted requires appending compensating movements AT that date, and the
 * ledger will not accept one outside its window (ADR 0011 Q5). A limit that is
 * needed and absent is worse than one that occasionally annoys.
 *
 * **`submitKey` is the recipe row's id**, the pattern Part 13.5 established: a
 * double POST — no-JS progressive enhancement, back-then-resubmit, a network
 * retry — resolves to the same row instead of writing a second version of a
 * recipe nobody changed twice.
 */
export const recipeInputSchema = z
  .object({
    submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
    menuId: z.preprocess(
      blankToNull,
      z.string().uuid("เมนูไม่ถูกต้อง").nullable()
    ),
    outputProductId: z.preprocess(
      blankToNull,
      z.string().uuid("ของแปรรูปไม่ถูกต้อง").nullable()
    ),
    /**
     * How many portions one writing of this recipe makes (Q16). Defaults to 1,
     * so a dish cooked to order needs no thought; a curry cooked by the pot says
     * 20 and the system does the division instead of the user rounding 350 ÷ 20
     * by hand into a form.
     */
    servings: z.coerce
      .number({ invalid_type_error: "จำนวนที่ต่อสูตรไม่ถูกต้อง" })
      .positive("จำนวนที่ต่อสูตรต้องมากกว่า 0")
      .max(QTY_MAX, "จำนวนที่ต่อสูตรเกินค่าที่ระบบรองรับ")
      .refine(hasAtMostThreeDecimals, "จำนวนที่ต่อสูตรมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง")
      .default(1),
    effectiveFrom: z.coerce
      .date({
        required_error: "ต้องระบุวันที่มีผล",
        invalid_type_error: "วันที่มีผลไม่ถูกต้อง",
      })
      .refine((d) => d.getTime() < addDays(computeBangkokToday(), 1).getTime(), {
        // Future-dating a recipe change is a real thing to want and is NOT
        // built: nothing reads it, nobody asked, and it would need a rule about
        // what a scheduled version does when the date arrives while a branch has
        // diverged. Refused rather than half-supported.
        message: "วันที่มีผลต้องไม่เป็นอนาคต",
      })
      .refine(
        (d) =>
          d.getTime() >=
          addDays(computeBangkokToday(), -MAX_BACKDATE_DAYS).getTime(),
        { message: `ย้อนหลังได้ไม่เกิน ${MAX_BACKDATE_DAYS} วัน` }
      ),
    ingredients: z
      .array(recipeIngredientInputSchema)
      .min(MIN_INGREDIENTS, "ต้องมีวัตถุดิบอย่างน้อย 1 รายการ")
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
    const hasProduct = val.outputProductId !== null;

    if (hasMenu === hasProduct) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: hasMenu
          ? "สูตรหนึ่งใบทำได้อย่างเดียว: เมนู หรือ ของแปรรูป"
          : "ต้องเลือกว่าสูตรนี้ทำเมนูหรือของแปรรูป",
        path: ["menuId"],
      });
    }

    // The shallowest cycle there is, and the only one visible without the
    // database: a set menu listing itself. Deeper cycles (A→B→A) and the
    // depth-5 cap need to walk stored rows, so they are L3's.
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
    if (hasProduct) {
      val.ingredients.forEach((ing, i) => {
        if (ing.productId === val.outputProductId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "ของแปรรูปใส่ตัวเองเป็นวัตถุดิบไม่ได้",
            path: ["ingredients", i, "productId"],
          });
        }
      });
    }

    // The same thing twice in one recipe is a mistake every time — either a
    // double-click or two people editing the same form — and silently summing
    // them would make the cost right while the recipe on screen reads wrong.
    const seen = new Map<string, number>();
    val.ingredients.forEach((ing, i) => {
      const key = ing.productId
        ? `p:${ing.productId}`
        : `m:${ing.componentMenuId}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, i);
        return;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "รายการนี้ซ้ำกับที่ใส่ไว้แล้ว",
        path: [
          "ingredients",
          i,
          ing.productId ? "productId" : "componentMenuId",
        ],
      });
    });
  });

export type RecipeInput = z.infer<typeof recipeInputSchema>;

// ------------------------------------------------------------
// Copying a recipe to branches
// ------------------------------------------------------------

/**
 * Q8's copy button, and the moment a branch stops following the central recipe.
 *
 * `acknowledgeOverwrite` is the same shape as Part 19's import preview: the
 * screen lists what will be touched and the second pass carries proof the person
 * saw it. Without it, copying onto a branch that already keeps its own recipe
 * would silently discard a decision that branch had made — the exact failure Q8
 * is built to prevent, arriving through the door Q8 opened.
 */
export const copyRecipeToBranchesInputSchema = z.object({
  submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
  /** The line being copied FROM — central, or another branch's variant. */
  sourceRecipeId: z.string().uuid("สูตรต้นทางไม่ถูกต้อง"),
  branchIds: z
    .array(z.string().uuid("สาขาไม่ถูกต้อง"))
    .min(1, "ต้องเลือกอย่างน้อย 1 สาขา")
    .max(500, "เลือกสาขาได้ไม่เกิน 500 สาขาต่อครั้ง"),
  acknowledgeOverwrite: z.boolean().default(false),
});

export type CopyRecipeToBranchesInput = z.infer<
  typeof copyRecipeToBranchesInputSchema
>;

// ------------------------------------------------------------
// Substituting an ingredient across recipes
// ------------------------------------------------------------

/**
 * One line of Q14's screen: this recipe is ticked, and here is what replaces the
 * ingredient in it.
 *
 * **`qty` is not optional and is not defaulted from the old line** (Q15). Where
 * the substitution crosses product type or unit — พริกสด → พริกผัดน้ำมัน — the
 * old number is not merely stale, it is wrong: the fried product has absorbed
 * oil and lost water, so 20 g of it holds nowhere near 20 g of chilli. Carrying
 * it over produces a wrong default that somebody clicks past, and every plate is
 * wrong from that day with nothing on screen looking wrong. The screen decides
 * when to prefill; the schema simply refuses to invent a number.
 */
export const substitutionTargetSchema = z.object({
  recipeId: z.string().uuid("สูตรไม่ถูกต้อง"),
  qty: z.coerce
    .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
    .positive("จำนวนต้องมากกว่า 0")
    .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
    .refine(hasAtMostThreeDecimals, "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
  productUnitId: z.preprocess(
    blankToNull,
    z.string().uuid("หน่วยไม่ถูกต้อง").nullable()
  ),
});

/**
 * Q14. Both of the owner's cases are the same screen with different boxes
 * ticked: replacing an ingredient everywhere is every box, replacing it in three
 * dishes while the signature one keeps the old is three boxes.
 */
export const substituteIngredientInputSchema = z
  .object({
    submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
    fromProductId: z.string().uuid("วัตถุดิบเดิมไม่ถูกต้อง"),
    toProductId: z.preprocess(
      blankToNull,
      z.string().uuid("วัตถุดิบใหม่ไม่ถูกต้อง").nullable()
    ),
    toComponentMenuId: z.preprocess(
      blankToNull,
      z.string().uuid("เมนูที่เลือกไม่ถูกต้อง").nullable()
    ),
    targets: z
      .array(substitutionTargetSchema)
      .min(1, "ต้องเลือกอย่างน้อย 1 สูตร")
      .max(MAX_INGREDIENTS, "เลือกสูตรได้ไม่เกิน 100 สูตรต่อครั้ง"),
    effectiveFrom: z.coerce
      .date({
        required_error: "ต้องระบุวันที่มีผล",
        invalid_type_error: "วันที่มีผลไม่ถูกต้อง",
      })
      .refine((d) => d.getTime() < addDays(computeBangkokToday(), 1).getTime(), {
        message: "วันที่มีผลต้องไม่เป็นอนาคต",
      })
      .refine(
        (d) =>
          d.getTime() >=
          addDays(computeBangkokToday(), -MAX_BACKDATE_DAYS).getTime(),
        { message: `ย้อนหลังได้ไม่เกิน ${MAX_BACKDATE_DAYS} วัน` }
      ),
    /**
     * Q8's autonomy and Q14's bulk edit genuinely pull against each other: a
     * shop that has stopped buying an ingredient DOES need every branch to
     * change, because a kitchen cannot cook with what nobody buys. The screen
     * groups central and branch recipes separately and lets each be unticked;
     * this flag records that the person saw which branch recipes were included.
     */
    acknowledgeBranchRecipes: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    const hasProduct = val.toProductId !== null;
    const hasMenu = val.toComponentMenuId !== null;

    if (hasProduct === hasMenu) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: hasProduct
          ? "เลือกได้อย่างเดียว: วัตถุดิบใหม่ หรือ เมนู"
          : "ต้องเลือกวัตถุดิบใหม่หรือเมนู",
        path: ["toProductId"],
      });
      return;
    }

    if (hasProduct && val.toProductId === val.fromProductId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "วัตถุดิบใหม่ซ้ำกับตัวเดิม",
        path: ["toProductId"],
      });
    }

    val.targets.forEach((t, i) => {
      if (hasProduct && t.productUnitId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ต้องระบุหน่วยของวัตถุดิบใหม่",
          path: ["targets", i, "productUnitId"],
        });
      }
      if (hasMenu && t.productUnitId !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "เมนูที่เป็นส่วนประกอบไม่ต้องระบุหน่วย",
          path: ["targets", i, "productUnitId"],
        });
      }
    });

    const seen = new Set<string>();
    val.targets.forEach((t, i) => {
      if (seen.has(t.recipeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "สูตรนี้ถูกเลือกซ้ำ",
          path: ["targets", i, "recipeId"],
        });
      }
      seen.add(t.recipeId);
    });
  });

export type SubstituteIngredientInput = z.infer<
  typeof substituteIngredientInputSchema
>;

// ------------------------------------------------------------
// Deleting
// ------------------------------------------------------------

/**
 * Soft-deletes the whole LINE, not one version. Deleting a version would leave
 * the days it covered pointing at nothing, and "this dish has no recipe any
 * more" is a different statement from "this version was wrong" (which is a
 * supersede — see the `Recipe` model comment).
 */
export const deleteRecipeInputSchema = z.object({
  recipeId: z.string().uuid("สูตรไม่ถูกต้อง"),
});

export type DeleteRecipeInput = z.infer<typeof deleteRecipeInputSchema>;

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

/**
 * A recipe cost is as many numbers as there are branches (Q5, rule R4), so a
 * branch is not optional at the read layer — it is filled in by the UI, which a
 * single-branch tenant never sees. `asOf` answers "what did this cost on that
 * day", and picks the recipe version that was true then, not today's.
 */
export const recipeCostQuerySchema = z.object({
  recipeId: z.string().uuid("สูตรไม่ถูกต้อง"),
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  asOf: z.preprocess(
    blankToUndefined,
    z.coerce.date({ invalid_type_error: "วันที่ไม่ถูกต้อง" }).optional()
  ),
});

export type RecipeCostQuery = z.infer<typeof recipeCostQuerySchema>;

export const recipeListQuerySchema = z.object({
  branchId: z.preprocess(
    blankToUndefined,
    z.string().uuid("สาขาไม่ถูกต้อง").optional()
  ),
  search: z.preprocess(
    blankToUndefined,
    z.string().trim().max(200).optional()
  ),
  /** Menus that have no recipe at all — the list a shop works down. */
  missingOnly: z.preprocess(
    (v) => v === "true" || v === true || v === "on",
    z.boolean()
  ),
});

export type RecipeListQuery = z.infer<typeof recipeListQuerySchema>;

/** Q14's reverse lookup, and Q13's delete guard reads the same thing. */
export const recipeUsageQuerySchema = z.object({
  productId: z.preprocess(
    blankToUndefined,
    z.string().uuid("วัตถุดิบไม่ถูกต้อง").optional()
  ),
  menuId: z.preprocess(
    blankToUndefined,
    z.string().uuid("เมนูไม่ถูกต้อง").optional()
  ),
});

export type RecipeUsageQuery = z.infer<typeof recipeUsageQuerySchema>;

// ------------------------------------------------------------
// Thai field labels
// ------------------------------------------------------------

export const RECIPE_FIELD_LABELS_TH: Record<string, string> = {
  menuId: "เมนู",
  outputProductId: "ของแปรรูป",
  servings: "ทำได้กี่ที่",
  effectiveFrom: "มีผลตั้งแต่วันที่",
  ingredients: "วัตถุดิบ",
  productId: "วัตถุดิบ",
  componentMenuId: "เมนูที่เป็นส่วนประกอบ",
  qty: "จำนวน",
  productUnitId: "หน่วย",
  notes: "หมายเหตุ",
  branchIds: "สาขา",
  fromProductId: "วัตถุดิบเดิม",
  toProductId: "วัตถุดิบใหม่",
  targets: "สูตรที่เลือก",
};

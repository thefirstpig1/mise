// ============================================================
// Mise — staff meal zod schemas (Sprint 5 Part 26 L2, ADR 0028)
// ============================================================
// A roster of people who eat, and the document that records what they ate.
//
// The one cross-field rule worth reading before anything else: **a dish rung
// from the menu must name an eater; a pot the kitchen cooked for everybody must
// not pretend to** (Q4, line 3). Both shapes live in one schema rather than two,
// because the form is one form and a discriminated union would push the choice
// into the URL. The rule is a superRefine, and the DB deliberately carries no
// CHECK for it — the empty case is one of the two shapes, not an error.
//
// What is NOT here, deliberately:
//   - The base-unit qty and its sign. A pot line is typed as a POSITIVE
//     magnitude in a unit of the user's choosing; L3 multiplies by the unit's
//     `toBaseRatio` (a DB read) and negates it. A menu line has no typed qty at
//     all — the recipe says what left the shelf.
//   - The frozen selling price. It is DERIVED from live sales (rule S2), so it
//     is L3's answer and never the client's: a price arriving from the browser
//     is a price the browser could choose, and this one gates a quota.
//   - Any cost. Stock leaving is valued by the FIFO replay of the layers it
//     draws down (ADR 0014, rule S1), and nothing on this screen may say
//     otherwise.
//   - `tenantId` / `recordedBy` — from requireTenant + session server-side.
//   - Whether the product/branch/menu/unit belong to the tenant, whether the
//     unit belongs to the product, and whether the menu has a resolvable recipe
//     — all DB lookups, so they live in L3.
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import type { StaffMealPriceSource } from "@prisma/client";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";

/** Blank → null. Same helper as every other validations file. */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/**
 * Checkbox/query-string → boolean. Only "true" / true / "on" are truthy:
 * `z.coerce.boolean` treats the non-empty string "false" as `true`, so a link
 * carrying `?includeVoided=false` would do the opposite of what it says.
 */
const flagPreprocess = (v: unknown) => v === "true" || v === true || v === "on";

// ------------------------------------------------------------
// Enum — local const array (the Sprint 1 pattern), NOT z.nativeEnum
// ------------------------------------------------------------

/**
 * Where a frozen selling price came from (Q7, rule S3). Three values that
 * deserve three different amounts of trust, which is the whole reason the
 * document stores this beside the number.
 */
export const STAFF_MEAL_PRICE_SOURCE_VALUES = [
  "SOLD",
  "PLANNED",
  "NONE",
] as const;

// Compile-time drift guard — the shape stock-movement.ts uses, and ACTUALLY
// asserted: a type alias resolving to `never` is not an error until something is
// assigned into it (the hole that let Part 13's enum drift stay green).
type _AssertPriceSource =
  StaffMealPriceSource extends (typeof STAFF_MEAL_PRICE_SOURCE_VALUES)[number]
    ? (typeof STAFF_MEAL_PRICE_SOURCE_VALUES)[number] extends StaffMealPriceSource
      ? true
      : never
    : never;
const _driftGuard: _AssertPriceSource = true;
void _driftGuard;

/**
 * Thai gloss per price source. `PLANNED` says **ราคาที่ตั้งใจ** and not ราคา,
 * because ADR 0025 Q2 settled that once a dish sells the sold price IS the
 * price — and a dish that has never sold has not earned the shorter word.
 */
export const STAFF_MEAL_PRICE_SOURCE_LABELS_TH: Record<
  (typeof STAFF_MEAL_PRICE_SOURCE_VALUES)[number],
  string
> = {
  SOLD: "ราคาขายจริง",
  PLANNED: "ราคาที่ตั้งใจ",
  NONE: "ยังไม่มีราคา",
};

// ------------------------------------------------------------
// Shared limits
// ------------------------------------------------------------

/** `qty` / `input_qty` / `servings` are Decimal(15,3), like every ledger quantity. */
export const QTY_MAX = 999_999_999_999.999;
const QTY_DECIMAL_PLACES = 3;

/** Decimal(15,2), like every baht column. */
export const AMOUNT_MAX = 9_999_999_999_999.99;
const AMOUNT_DECIMAL_PLACES = 2;

/** `toFixed` round-trip, never `n * 1000` (Pitfall #30). */
const hasAtMostThreeDecimals = (n: number) =>
  Number(n.toFixed(QTY_DECIMAL_PLACES)) === n;

const hasAtMostTwoDecimals = (n: number) =>
  Number(n.toFixed(AMOUNT_DECIMAL_PLACES)) === n;

export const MAX_STAFF_MEAL_NOTE_LENGTH = 500;
export const MAX_STAFF_NAME_LENGTH = 100;
const MAX_RECORDED_BY_NAME_LENGTH = 100;

/**
 * A pot with more than this many different raw products is a data-entry
 * accident, not a meal. The cap is here rather than in L3 because every item
 * becomes a stock movement inside one transaction, and the moment to refuse an
 * unbounded list is before it reaches the database.
 */
export const MAX_STAFF_MEAL_ITEMS = 50;

// ------------------------------------------------------------
// 1. The roster
// ------------------------------------------------------------

/**
 * A person who eats. NOT a login and NOT an HR record (Q4, line 2) — the fields
 * this schema refuses to accept are as much a part of the decision as the three
 * it takes.
 *
 * `dailyQuotaAmount` is nullable and null means **follow the tenant default**,
 * never "no quota": a shop that has set a business-wide figure has not
 * exempted anybody by leaving this blank.
 */
export const createStaffMemberInputSchema = z.object({
  name: z
    .string({ required_error: "ต้องระบุชื่อพนักงาน" })
    .trim()
    .min(1, "ต้องระบุชื่อพนักงาน")
    .max(MAX_STAFF_NAME_LENGTH, "ชื่อต้องไม่เกิน 100 ตัวอักษร"),
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  dailyQuotaAmount: z.preprocess(
    blankToNull,
    z.coerce
      .number({ invalid_type_error: "โควตาไม่ถูกต้อง" })
      .positive("โควตาต้องมากกว่า 0")
      .max(AMOUNT_MAX, "โควตาเกินค่าที่ระบบรองรับ")
      .refine(hasAtMostTwoDecimals, "โควตาต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง")
      .nullable()
  ),
});

export type CreateStaffMemberInput = z.infer<typeof createStaffMemberInputSchema>;

/**
 * `isActive` is a claim about the FUTURE and nothing else (rule S7). Switching
 * it off does not remove the person from any past month — that is ADR 0027's L1
 * read one table across, and the read layer is where it is enforced.
 */
export const updateStaffMemberInputSchema = createStaffMemberInputSchema.extend({
  id: z.string().uuid("พนักงานไม่ถูกต้อง"),
  isActive: z.preprocess(flagPreprocess, z.boolean()),
});

export type UpdateStaffMemberInput = z.infer<typeof updateStaffMemberInputSchema>;

// ------------------------------------------------------------
// 2. Recording a meal
// ------------------------------------------------------------

/** One hand-typed line of a pot: a raw product, a magnitude, and the unit typed. */
export const staffMealItemInputSchema = z.object({
  productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
  /**
   * A positive magnitude. Zero is refused because taking nothing off the shelf
   * is not an event, and a negative would be a second, contradictory way of
   * saying a direction the row already carries. The DB says the same
   * (`staff_meal_item_qty_check`).
   */
  inputQty: z.coerce
    .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
    .positive("จำนวนต้องมากกว่า 0")
    .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
    .refine(hasAtMostThreeDecimals, "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
  inputUnitId: z.string().uuid("หน่วยไม่ถูกต้อง"),
});

export type StaffMealItemInput = z.infer<typeof staffMealItemInputSchema>;

/**
 * One staff meal, posted immediately — no draft, like waste and unlike a count.
 *
 * **`submitKey` is the document's id** (Part 13.5's pattern). The client mints
 * one uuid per submission and the server uses it AS `staff_meal.id`. Unlike
 * waste, that key does not by itself reach `UNIQUE(source_type, source_id)` —
 * the ledger's sources are the ITEMS, whose ids this key does not fix — so L3
 * derives them from it rather than minting fresh ones. Without that, a
 * double POST writes a second document with a second set of item ids and
 * deducts the food twice, and every row in the ledger looks ordinary.
 *
 * `businessDate` obeys the LEDGER's backdate window, imported from
 * stock-movement.ts rather than re-declared: it is the same rule about the same
 * column (ADR 0011 Q5), and two copies of "90" would drift.
 */
export const createStaffMealInputSchema = z
  .object({
    submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
    branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
    businessDate: z.coerce
      .date({
        required_error: "ต้องระบุวันที่",
        invalid_type_error: "วันที่ไม่ถูกต้อง",
      })
      .refine((d) => d.getTime() < addDays(computeBangkokToday(), 1).getTime(), {
        message: "วันที่ต้องไม่เป็นอนาคต",
      })
      .refine(
        (d) =>
          d.getTime() >=
          addDays(computeBangkokToday(), -MAX_BACKDATE_DAYS).getTime(),
        { message: `ย้อนหลังได้ไม่เกิน ${MAX_BACKDATE_DAYS} วัน` }
      ),
    /** Null for a pot. Required alongside `menuId` — see the superRefine below. */
    staffMemberId: z.preprocess(
      blankToNull,
      z.string().uuid("พนักงานไม่ถูกต้อง").nullable()
    ),
    /** Null when the kitchen cooked from raw stock rather than ringing a dish. */
    menuId: z.preprocess(
      blankToNull,
      z.string().uuid("เมนูไม่ถูกต้อง").nullable()
    ),
    servings: z.coerce
      .number({ invalid_type_error: "จำนวนที่ไม่ถูกต้อง" })
      .positive("จำนวนที่ต้องมากกว่า 0")
      .max(QTY_MAX, "จำนวนที่เกินค่าที่ระบบรองรับ")
      .refine(hasAtMostThreeDecimals, "จำนวนที่ต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง")
      .default(1),
    /** Empty for a menu dish — the recipe says what left the shelf. */
    items: z
      .array(staffMealItemInputSchema)
      .max(MAX_STAFF_MEAL_ITEMS, `บันทึกได้ไม่เกิน ${MAX_STAFF_MEAL_ITEMS} รายการต่อครั้ง`)
      .default([]),
    /**
     * Who served it, when that is not the account holder — the `waste_log`
     * pattern. Distinct from `staffMemberId`, which is who ATE.
     */
    recordedByName: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(MAX_RECORDED_BY_NAME_LENGTH, "ชื่อผู้บันทึกต้องไม่เกิน 100 ตัวอักษร")
        .nullable()
    ),
    notes: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(MAX_STAFF_MEAL_NOTE_LENGTH, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร")
        .nullable()
    ),
    /**
     * The user has read the "this day already has zero-price sales" warning and
     * still wants to record (Q6). A warning, never a block: the tag that would
     * let us block honestly is free text nobody has mapped, and refusing on a
     * guess is worse than deducting on a person's say-so.
     */
    acknowledgeDuplicateRisk: z.preprocess(flagPreprocess, z.boolean()).default(false),
  })
  .superRefine((v, ctx) => {
    if (v.menuId !== null) {
      // A dish rung from the menu HAS an eater, and the quota that Q3 bought the
      // roster for cannot be checked without one.
      if (v.staffMemberId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["staffMemberId"],
          message: "เมนูที่พนักงานสั่ง ต้องระบุว่าใครเป็นคนกิน",
        });
      }
      // The recipe says what left the shelf. Typed lines beside a menu would be
      // a second, disagreeing answer to a question the recipe already answers.
      if (v.items.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items"],
          message: "เลือกเมนูแล้วไม่ต้องกรอกวัตถุดิบ — ระบบตัดตามสูตรของวันนั้น",
        });
      }
      return;
    }

    // A pot: no menu, so nothing can explode, so the ingredients must be typed.
    if (v.items.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "ต้องเลือกเมนู หรือกรอกวัตถุดิบอย่างน้อย 1 รายการ",
      });
    }
    // One product, one line. Two lines for the same product means somebody
    // typed it twice, and `staff_meal_item_product_unique` would refuse it in
    // the middle of the commit with a message nobody can act on.
    const seen = new Set<string>();
    v.items.forEach((item, i) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", i, "productId"],
          message: "วัตถุดิบซ้ำกับรายการก่อนหน้า",
        });
      }
      seen.add(item.productId);
    });
  });

export type CreateStaffMealInput = z.infer<typeof createStaffMealInputSchema>;

// ------------------------------------------------------------
// 3. Voiding
// ------------------------------------------------------------

/**
 * Correcting a staff meal is a VOID: reversal items are appended to the SAME
 * document and post the compensating `CONSUMPTION_REVERSAL`. Never an edit —
 * the ledger is append-only (ADR 0011 Q7), and the compensating movements need
 * `source_id`s of their own to satisfy UNIQUE(source_type, source_id).
 *
 * No quantity: a void reverses the WHOLE document. Having eaten less than was
 * recorded is a wrong entry, not a partial void.
 *
 * No `submitKey` either, unlike creating. Idempotency here comes from
 * `staff_meal_item_reversal_unique` (one reversal per item), which is strictly
 * stronger than a client key: it holds even when the second void comes from a
 * different browser.
 */
export const voidStaffMealInputSchema = z.object({
  id: z.string().uuid("รายการมื้อพนักงานไม่ถูกต้อง"),
  voidReason: z
    .string({ required_error: "ต้องระบุเหตุผลที่ยกเลิก" })
    .trim()
    .min(1, "ต้องระบุเหตุผลที่ยกเลิก")
    .max(MAX_STAFF_MEAL_NOTE_LENGTH, "เหตุผลต้องไม่เกิน 500 ตัวอักษร"),
});

export type VoidStaffMealInput = z.infer<typeof voidStaffMealInputSchema>;

// ------------------------------------------------------------
// 4. Read queries
// ------------------------------------------------------------

export const getStaffMealQuerySchema = z.object({
  branchId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  staffMemberId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  from: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  to: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  includeVoided: z.preprocess(flagPreprocess, z.boolean()).default(false),
});

export type GetStaffMealQuery = z.infer<typeof getStaffMealQuerySchema>;

/**
 * `includeInactive` is REQUIRED, not defaulted — the pattern Part 27 proved on
 * `GetMenusQuery.includeRetired`. Every picker of a staff list has to have an
 * opinion about whether someone who left belongs in it, and a default would let
 * the seventh caller silently inherit the wrong one.
 */
export const getStaffMembersQuerySchema = z.object({
  branchId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  includeInactive: z.boolean(),
});

export type GetStaffMembersQuery = z.infer<typeof getStaffMembersQuerySchema>;

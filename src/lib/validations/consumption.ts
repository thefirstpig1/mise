// ============================================================
// Mise — consumption zod schemas (Sprint 5 Part 22 L2, ADR 0022)
// ============================================================
// One write shape (post a set of days), one read query, and the two vocabularies
// the screens need: why a dish could not be posted, and what a cancelled bill
// does to stock.
//
// What is NOT here, deliberately:
//   - Any quantity. Nobody types one. The qty of every consumption item is the
//     recipe explosion of what the POS says was sold, computed in L3 — there is
//     no form field it could come from and no user judgement it could carry.
//   - The 90-day window as a REFUSAL. Rule N9 makes an out-of-window day a
//     coverage reason, not an error: a shop importing a year of history must be
//     able to press the button and be told which days could not post, rather
//     than have the whole batch refused for the sake of its oldest day. The
//     window is applied per day in L3 and reported. Only the FUTURE is refused
//     here — a business date that has not happened is a broken file, not a
//     coverage gap.
//   - `tenantId` / `postedBy` — from requireTenant + session server-side.
//   - Whether the branch belongs to the tenant, whether a day has sales at all,
//     and whether it already has a live run — DB reads, so they live in L3.
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import type { CancelledSalePolicy, ConsumptionVoidReason } from "@prisma/client";
import { addDays, computeBangkokToday, isDayValue } from "@/lib/bangkok-date";

const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/**
 * Checkbox/query-string → boolean. Only "true" / true / "on" are truthy:
 * `z.coerce.boolean` treats the non-empty string "false" as `true`, so a link
 * carrying `?x=false` would do the opposite of what it says. Same helper, and
 * the same reason, as waste.ts and supplier-product-mapping.ts.
 */
const flagPreprocess = (v: unknown) => v === "true" || v === true || v === "on";

// ------------------------------------------------------------
// How many days one press may cover
// ------------------------------------------------------------

/**
 * A month at a time.
 *
 * Not a database limit and not in the ADR — a bound on how much work one button
 * may start. Each day is its own run in its own transaction (they are
 * independent, and the live-run partial unique makes each one idempotent on its
 * own), so this does not exist to protect a transaction. It exists so that a
 * first-time shop backfilling a year of history gets three presses with three
 * reports rather than one press that appears to hang.
 */
export const MAX_DAYS_PER_POST = 31;

// ------------------------------------------------------------
// Enums — local const arrays (the Sprint 1 pattern), NOT z.nativeEnum
// ------------------------------------------------------------

/** What a cancelled bill does to stock (ADR 0022 Q3, rule N4). */
export const CANCELLED_SALE_POLICY_VALUES = [
  "TREAT_AS_COOKED",
  "TREAT_AS_NOT_COOKED",
] as const;

/** Why a posted day was taken back (Q5, Q2b). Machine-set, never typed. */
export const CONSUMPTION_VOID_REASON_VALUES = ["RE_IMPORT", "REPOST"] as const;

/**
 * Why a dish sold on a day could not be turned into stock movements (rule N2).
 *
 * A menu posts **whole or not at all**, so every one of these takes the entire
 * dish out of the day's consumption rather than shrinking it. The third is the
 * one worth having a name for: a set menu whose component has no recipe of its
 * own explodes to *less* than it should, silently, and rule R16 says an unknown
 * component is UNKNOWN and not free.
 */
export const CONSUMPTION_SKIP_REASON_VALUES = [
  "NO_RECIPE",
  "RECIPE_UNRESOLVABLE",
  "COMPONENT_MENU_NO_RECIPE",
  "OUTSIDE_BACKDATE_WINDOW",
] as const;

export type CancelledSalePolicyValue =
  (typeof CANCELLED_SALE_POLICY_VALUES)[number];
export type ConsumptionVoidReasonValue =
  (typeof CONSUMPTION_VOID_REASON_VALUES)[number];
export type ConsumptionSkipReason =
  (typeof CONSUMPTION_SKIP_REASON_VALUES)[number];

// Compile-time drift guards: each local union must cover the Prisma enum
// exactly. A type alias resolving to `never` is not an error on its own — the
// assignment below is what makes drift fail the build. See the same pattern, and
// the Part 13 near-miss that motivated it, in validations/stock-movement.ts.
type _AssertPolicy = CancelledSalePolicy extends CancelledSalePolicyValue
  ? CancelledSalePolicyValue extends CancelledSalePolicy
    ? true
    : never
  : never;
type _AssertVoidReason =
  ConsumptionVoidReason extends ConsumptionVoidReasonValue
    ? ConsumptionVoidReasonValue extends ConsumptionVoidReason
      ? true
      : never
    : never;
export type _ConsumptionEnumDriftGuards = [_AssertPolicy, _AssertVoidReason];
const _driftGuards: _ConsumptionEnumDriftGuards = [true, true];
void _driftGuards;

// ------------------------------------------------------------
// Thai vocabulary — here rather than in a component, so the server can name a
// reason and a Client Component can render it without importing from server/
// ------------------------------------------------------------

export const CANCELLED_SALE_POLICY_LABELS_TH: Record<
  CancelledSalePolicyValue,
  string
> = {
  TREAT_AS_COOKED: "ทำไปแล้ว — ตัดสต๊อกเต็มยอดขาย",
  TREAT_AS_NOT_COOKED: "ยังไม่ได้ทำ — หักบิลที่ยกเลิกออก",
};

/**
 * The consequence, not the definition (rule N12). The settings screen shows
 * these beside the labels, because a shop cannot choose between two rules it has
 * only been told the names of.
 */
export const CANCELLED_SALE_POLICY_HINTS_TH: Record<
  CancelledSalePolicyValue,
  string
> = {
  TREAT_AS_COOKED:
    "ขาย 12 ยกเลิก 1 → ตัดวัตถุดิบ 12 จาน · เวลานับสต๊อกจะเจอ “ของเกิน” ซึ่งคือหลักฐานว่ามีการยกเลิกบิล ตามกลับไปหาสาเหตุได้",
  TREAT_AS_NOT_COOKED:
    "ขาย 12 ยกเลิก 1 → ตัดวัตถุดิบ 11 จาน · ถูกถ้าแคชเชียร์ยกเลิกก่อนลงมือทำ แต่ถ้าทำไปแล้วจะเจอ “ของขาด” ซึ่งหน้าตาเหมือนของหาย",
};

export const CONSUMPTION_VOID_REASON_LABELS_TH: Record<
  ConsumptionVoidReasonValue,
  string
> = {
  RE_IMPORT: "มีไฟล์ยอดขายใหม่มาทับวันนี้",
  REPOST: "ตัดสต๊อกวันนี้ใหม่",
};

export const CONSUMPTION_SKIP_REASON_LABELS_TH: Record<
  ConsumptionSkipReason,
  string
> = {
  NO_RECIPE: "ยังไม่มีสูตร",
  RECIPE_UNRESOLVABLE: "สูตรมีปัญหา คำนวณต่อไม่ได้",
  COMPONENT_MENU_NO_RECIPE: "มีเมนูที่เป็นส่วนประกอบยังไม่มีสูตร",
  OUTSIDE_BACKDATE_WINDOW: "เกินหน้าต่างย้อนหลัง",
};

/** What to do about it — a reason with no next step is a dead end on screen. */
export const CONSUMPTION_SKIP_REASON_HINTS_TH: Record<
  ConsumptionSkipReason,
  string
> = {
  NO_RECIPE: "เขียนสูตรให้เมนูนี้ แล้วกดตัดสต๊อกวันนี้ใหม่",
  RECIPE_UNRESOLVABLE:
    "เปิดสูตรของเมนูนี้ดู — ของแปรรูปที่ยังไม่ได้ใส่เปอร์เซ็นต์ผลผลิต หรือสูตรที่วนกลับมาหาตัวเอง",
  COMPONENT_MENU_NO_RECIPE:
    "เซ็ทเมนูนี้มีเมนูย่อยที่ยังไม่มีสูตร — ถ้าตัดเฉพาะส่วนที่รู้ ตัวเลขจะน้อยกว่าความจริงโดยไม่มีอะไรดูผิด",
  OUTSIDE_BACKDATE_WINDOW:
    "ยอดขายวันนี้เก่าเกินกว่าที่บัญชีสต๊อกจะย้อนไปแก้ได้ — เก็บไว้ดูยอดขายได้ แต่ตัดสต๊อกไม่ได้",
};

// ------------------------------------------------------------
// Write — post a set of days
// ------------------------------------------------------------

/**
 * Posting reads sales, not a form: the only things a person chooses are WHICH
 * branch, WHICH days, and whether they meant to replace a day that was already
 * posted.
 *
 * `businessDates` is a LIST rather than a from/to range because an import covers
 * the days its file happened to contain, which need not be contiguous — a shop
 * closed on Mondays would otherwise be asked to post days that do not exist.
 */
export const postConsumptionInputSchema = z.object({
  submitKey: z
    .string({ required_error: "ไม่พบรหัสอ้างอิงของการบันทึก" })
    .uuid("รหัสอ้างอิงของการบันทึกไม่ถูกต้อง"),
  branchId: z
    .string({ required_error: "ต้องเลือกสาขา" })
    .uuid("สาขาไม่ถูกต้อง"),
  businessDates: z
    .array(
      z.coerce.date({
        required_error: "ต้องระบุวันขาย",
        invalid_type_error: "วันขายไม่ถูกต้อง",
      })
    )
    .min(1, "ต้องเลือกวันขายอย่างน้อย 1 วัน")
    .max(
      MAX_DAYS_PER_POST,
      `ตัดสต๊อกได้ครั้งละไม่เกิน ${MAX_DAYS_PER_POST} วัน`
    )
    .refine(
      (days) =>
        days.every(
          (d) => d.getTime() < addDays(computeBangkokToday(), 1).getTime()
        ),
      { message: "วันขายต้องไม่เป็นอนาคต" }
    )
    .refine((days) => days.every(isDayValue), {
      // business_date is a DATE column: a value carrying a time would be
      // truncated on the way in, silently becoming a different day than the one
      // the caller named. Rule P15's instinct — no timezone may enter a day.
      message: "วันขายต้องเป็นวันที่ ไม่ใช่เวลา",
    })
    .refine(
      (days) =>
        new Set(days.map((d) => d.toISOString().slice(0, 10))).size ===
        days.length,
      {
        // Two runs for one day would each post a full set of movements and the
        // day would be consumed twice. The live-run partial unique catches it at
        // the database, but a duplicate in one submission is a bug in the caller,
        // not a race, and it should not need the database to say so.
        message: "มีวันขายซ้ำกันในรายการ",
      }
    ),
  /**
   * Set only after the screen has shown WHICH days already carry a posting and
   * that pressing again takes them back first (Q2b). Never defaulted true: a
   * re-post voids real ledger rows, and rule R13's lesson is that the wrong
   * default is the value people click past.
   */
  acknowledgeRepost: z.preprocess(flagPreprocess, z.boolean()).default(false),
});

export type PostConsumptionInput = z.infer<typeof postConsumptionInputSchema>;

// ------------------------------------------------------------
// Read
// ------------------------------------------------------------

/**
 * What was posted, and how much of each day it covered. Drives the coverage
 * screen and the label `/cost` puts on gross profit by สูตรอาหาร (rule N10).
 */
export const consumptionCoverageQuerySchema = z.object({
  branchId: z.preprocess(
    blankToUndefined,
    z.string().uuid("สาขาไม่ถูกต้อง").optional()
  ),
  from: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  to: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  /** Voided runs are history, not noise — but they are not the default view. */
  includeVoided: z.preprocess(flagPreprocess, z.boolean()).default(false),
});

export type ConsumptionCoverageQuery = z.infer<
  typeof consumptionCoverageQuerySchema
>;

// ------------------------------------------------------------
// Field labels — Thai, for the action layer's error mapping
// ------------------------------------------------------------

export const CONSUMPTION_FIELD_LABELS_TH: Record<string, string> = {
  branchId: "สาขา",
  businessDates: "วันขาย",
  submitKey: "รหัสอ้างอิง",
};

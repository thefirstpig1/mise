// ============================================================
// Mise — menu merging, the wire shapes (Sprint 5 Part 25 L2, ADR 0026)
// ============================================================
// Three shapes: merge, revoke, and the search that finds candidates.
//
// What is NOT here, and why:
//
//   * **No "which recipe survives".** ADR 0026 Q2: resolution gains a third
//     fallback level (สาขา → กลาง → เมนูที่ถูกรวมเข้าไป), so a losing menu that
//     already has a recipe keeps using it, for every past day it was posted
//     against and for every future one. Merging can only ADD costing where
//     there was none. There is nothing to choose, so nothing to validate.
//
//   * **No "move the sales" flag.** A merge writes one row and moves nothing
//     (Q1). `sales_line` takes no write after INSERT, and the losing menu keeps
//     its POS code and goes on collecting sales for ever.
//
//   * **No chain check.** A winner may not be somebody's loser and a loser may
//     not be anybody's winner (Q4) — but that spans rows in the database, which
//     zod cannot see any more than a CHECK can. It is L3's guard. What zod DOES
//     refuse is the one case visible without a query: a menu merged into itself.
// ============================================================

import { z } from "zod";
import { computeBangkokToday } from "@/lib/bangkok-date";

/** Blank → undefined, for optional-and-absent rather than optional-and-null. */
const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/** A checkbox arrives as "on" with no JS, and as `true` from a typed caller. */
const flagPreprocess = (v: unknown) => v === "true" || v === true || v === "on";

/** Midnight Bangkok for the day a `Date` falls on, so two dates compare as days. */
const dayOf = (d: Date): number =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

// ------------------------------------------------------------
// Merging
// ------------------------------------------------------------

/**
 * Declare that one menu is another's spelling of the same dish.
 *
 * **`effectiveFrom` is the whole of Q5 in one field.** Reporting ignores it and
 * folds retroactively — it stores nothing and reverses instantly, and "these are
 * the same dish" is a fact about the dish rather than an event that happened on
 * a Tuesday. The LEDGER folds only from this date, because writing movements
 * into a past day changes what happened.
 *
 * It DEFAULTS TO TODAY, which is the safe answer and also the useful one: the
 * duplicate disappears from every report at once and not one gram of stock
 * moves. A date in the past is allowed — the reason to merge is often that six
 * months of a dish were split in two — but the screen must first say how many
 * already-posted days it would change, and the second submit carries
 * `acknowledgeBackdate`. Same two-step as publishing a draft over a live recipe
 * (ADR 0025) and copying a recipe over branch recipes (ADR 0021 Q8).
 *
 * **A FUTURE date is refused.** "Same dish from next Tuesday" describes nothing
 * that happens to a dish; whoever typed it meant something else, and a merge
 * that quietly does nothing for a week is worse than a message.
 *
 * IDEMPOTENT by `submitKey`, used as the row's id — Part 13.5's pattern.
 */
export const mergeMenusInputSchema = z
  .object({
    submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
    /** The spelling. Stays alive, keeps its code, keeps collecting sales. */
    losingMenuId: z.string().uuid("เมนูไม่ถูกต้อง"),
    /** The dish. What reports, recipes and stock deduction speak of. */
    winningMenuId: z.string().uuid("เมนูไม่ถูกต้อง"),
    effectiveFrom: z.preprocess(
      (v) => (v === undefined || v === null || v === "" ? computeBangkokToday() : v),
      z.coerce.date({ invalid_type_error: "วันที่ไม่ถูกต้อง" })
    ),
    /**
     * Carried only on the second submit, after the server has refused once and
     * the screen has named the posted days at stake. A flag present from the
     * start is a flag people tick without reading.
     */
    acknowledgeBackdate: z.preprocess(flagPreprocess, z.boolean()).default(false),
  })
  .superRefine((val, ctx) => {
    // The one case visible without a query. The database says the same
    // (`menu_merge_not_self_check`); this is here so the person gets a sentence
    // rather than a constraint violation.
    if (val.losingMenuId === val.winningMenuId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "เลือกเมนูคนละรายการ — เมนูรวมกับตัวเองไม่ได้",
        path: ["winningMenuId"],
      });
    }

    if (dayOf(val.effectiveFrom) > dayOf(computeBangkokToday())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "วันที่มีผลต้องไม่เป็นอนาคต",
        path: ["effectiveFrom"],
      });
    }
  });

export type MergeMenusInput = z.infer<typeof mergeMenusInputSchema>;

// ------------------------------------------------------------
// Un-merging
// ------------------------------------------------------------

/**
 * Stop treating one menu as another's spelling. Sets `revokedAt`/`revokedBy`;
 * the row is never deleted, as nothing in this system is, so what the reports
 * said last month stays explainable.
 *
 * **Revoking does not undo movements posted while merged** (ADR 0026
 * Consequence 4). The ledger is append-only: stock deducted through the winner's
 * recipe stays deducted until the day is voided and posted afresh through Part
 * 22's existing machinery. `acknowledgePosted` is how the screen proves it said
 * so — required only when posted days actually exist, which is L3's question to
 * the database, not zod's.
 *
 * No `submitKey`: revoking is idempotent by what it does, since a merge already
 * revoked has nothing left to change. Same reasoning as `discardDraftInput`.
 */
export const revokeMergeInputSchema = z.object({
  mergeId: z.string().uuid("รายการรวมเมนูไม่ถูกต้อง"),
  acknowledgePosted: z.preprocess(flagPreprocess, z.boolean()).default(false),
});

export type RevokeMergeInput = z.infer<typeof revokeMergeInputSchema>;

// ------------------------------------------------------------
// Finding candidates
// ------------------------------------------------------------

export const MAX_MERGE_CANDIDATES = 20;
export const DEFAULT_MERGE_CANDIDATES = 8;

/**
 * "What else might this dish be?" — the `pg_trgm` search Part 19 built, pointed
 * at one menu.
 *
 * ADR 0019 Q7's rule is unchanged and is the reason this is a separate step from
 * the merge itself: a similarity score SUGGESTS, a person decides. *ผัดกะเพราหมู*
 * and *ผัดกะเพราไก่* score high and are different dishes, so nothing here may
 * ever feed a merge automatically.
 *
 * `includeMerged` is off by default: a menu already folded into something is not
 * a candidate, and offering it would invite the chain Q4 forbids.
 */
export const mergeCandidatesQuerySchema = z.object({
  menuId: z.string().uuid("เมนูไม่ถูกต้อง"),
  limit: z.coerce
    .number()
    .int("จำนวนรายการต้องเป็นจำนวนเต็ม")
    .min(1)
    .max(MAX_MERGE_CANDIDATES, `แสดงได้ไม่เกิน ${MAX_MERGE_CANDIDATES} รายการ`)
    .default(DEFAULT_MERGE_CANDIDATES),
  includeMerged: z.preprocess(flagPreprocess, z.boolean()).default(false),
});

export type MergeCandidatesQuery = z.infer<typeof mergeCandidatesQuerySchema>;

/**
 * The merges themselves, for the menu screen that nests losers under winners
 * (Q6) and for the screen that undoes one.
 *
 * `winningMenuId` narrows to one dish's spellings. `includeRevoked` shows the
 * history — which is the reason revoked rows are kept at all.
 */
export const menuMergeListQuerySchema = z.object({
  winningMenuId: z.preprocess(
    blankToUndefined,
    z.string().uuid("เมนูไม่ถูกต้อง").optional()
  ),
  includeRevoked: z.preprocess(flagPreprocess, z.boolean()).default(false),
});

export type MenuMergeListQuery = z.infer<typeof menuMergeListQuerySchema>;

// ------------------------------------------------------------
// Thai field labels — for the action layer's error mapping
// ------------------------------------------------------------

export const MENU_MERGE_FIELD_LABELS_TH: Record<string, string> = {
  losingMenuId: "เมนูที่จะถูกรวม",
  winningMenuId: "เมนูหลัก",
  effectiveFrom: "มีผลตั้งแต่",
  acknowledgeBackdate: "ยืนยันการมีผลย้อนหลัง",
  acknowledgePosted: "ยืนยันว่าเข้าใจเรื่องยอดที่ตัดสต๊อกไปแล้ว",
};

/**
 * Sentences the screens share, so no two of them describe the merge
 * differently. The words matter as much as the rules: a shop that reads "รวม
 * เมนู" as "ยุบเหลือรายการเดียว" will look for the row that vanished.
 */
export const MERGE_KEEPS_LOSER_HINT_TH =
  "เมนูที่ถูกรวมจะยังอยู่ในระบบและยังรับยอดขายใหม่ต่อไป เพราะเครื่อง POS ยังส่งรหัสเดิมมาทุกวัน — แต่ทุกหน้าจะนับรวมเป็นเมนูเดียว";
export const MERGE_REPORT_VS_STOCK_HINT_TH =
  "รายงานจะรวมย้อนหลังทั้งหมดทันที ส่วนการตัดสต๊อกจะรวมตั้งแต่วันที่มีผลเป็นต้นไปเท่านั้น";
export const MERGE_NOT_SAME_DISH_WARNING_TH =
  "รวมเฉพาะจานเดียวกันที่สะกดคนละแบบเท่านั้น — ผัดกะเพราหมูกับผัดกะเพราไก่คนละจาน แม้ชื่อจะคล้ายกันมาก";
export const MERGE_DIFFERENT_RECIPE_HINT_TH =
  "เมนูที่มีสูตรของตัวเองอยู่แล้วจะใช้สูตรเดิมต่อไป การรวมไม่ทับสูตรของใคร";
export const REVOKE_KEEPS_MOVEMENTS_HINT_TH =
  "ยกเลิกการรวมแล้ว ยอดที่ตัดสต๊อกไปแล้วจะไม่ย้อนกลับเอง ถ้าต้องการให้ตรง ต้องยกเลิกการตัดสต๊อกของวันนั้นแล้วโพสต์ใหม่";

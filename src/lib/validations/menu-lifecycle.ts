// ============================================================
// Mise — a menu's lifecycle, the wire shapes (Sprint 5 Part 27 L2, ADR 0027)
// ============================================================
// Three shapes: retire/unretire, delete, restore. All three are one id and a
// flag, so this file is short — and what is NOT in it is the whole of the Part.
//
//   * **No `deactivatedAt` anywhere.** ADR 0027 Q3 refused the column: "which
//     menus sold after being retired" is answered by the LAST SALE DATE, which
//     is a fact the data already holds, rather than by a timestamp bought to
//     support an inference.
//
//   * **No "delete the recipe too" flag distinct from the acknowledgement.**
//     There is one flag and it means one thing (Q4): the person has now been
//     shown the recipe's name. Offering "delete without the recipe" would leave
//     a recipe attached to a menu no screen will show (Context 8).
//
//   * **No cascade options, no "force".** Four of the five blockers are hard
//     refusals with no way past them (Q4/Q8), because เลิกขาย is the answer to
//     every one of them and a flag that skipped a blocker would be a flag that
//     breaks the next import.
//
//   * **No restore-onto-a-different-name.** ADR 0010's product restore carries
//     `newSku` because a live product may already hold that sku; `menu` has no
//     unique on name at all (Context 4), so the conflict this would resolve
//     cannot happen.
// ============================================================

import { z } from "zod";

/** A checkbox arrives as "on" with no JS, and as `true` from a typed caller. */
const flagPreprocess = (v: unknown) => v === "true" || v === true || v === "on";

// ------------------------------------------------------------
// เลิกขาย / กลับมาขาย
// ------------------------------------------------------------

/**
 * Stop (or resume) selling a dish — ADR 0027 Q1/Q2.
 *
 * Available for EVERY menu, POS or MISE, with sales or without. It is the
 * answer for almost every real case, and the only safe one for a menu carrying
 * a POS code.
 *
 * **It is a claim about the future and nothing else.** Nothing here reaches
 * matching (a retired code must go on matching or the next file dies in
 * `createStubMenusLogic`'s bare create), the ledger (the sale is real; the food
 * left the kitchen) or any past figure.
 *
 * No `submitKey`: setting a boolean to the value it already holds changes
 * nothing, so the write is idempotent by what it does — the same reasoning as
 * `revokeMergeInputSchema` and `discardDraftInput`.
 */
export const setMenuActiveInputSchema = z.object({
  menuId: z.string().uuid("เมนูไม่ถูกต้อง"),
  /** The state being ASKED FOR, not a toggle — so a double-click is harmless. */
  isActive: z.preprocess(flagPreprocess, z.boolean()),
});

export type SetMenuActiveInput = z.infer<typeof setMenuActiveInputSchema>;

// ------------------------------------------------------------
// ลบ
// ------------------------------------------------------------

/**
 * Delete a menu — ADR 0027 Q4, and only ever a menu whose deletion breaks
 * nothing.
 *
 * Five conditions are checked by L3 against the database, because every one of
 * them spans a table zod cannot see: a POS code, any sale ever, use as an
 * ingredient elsewhere, a live merge, a confirmed POS spelling.
 *
 * `acknowledgeRecipe` is the sixth and only soft one. The first attempt on a
 * menu that carries its own recipe is refused NAMING it; this flag is how the
 * second attempt proves the name was on screen. A flag present from the start
 * is a flag people tick without reading, which is why it defaults to false and
 * why no screen may send it unprompted.
 *
 * No `submitKey`: a menu already deleted has nothing left to delete.
 */
export const deleteMenuInputSchema = z.object({
  menuId: z.string().uuid("เมนูไม่ถูกต้อง"),
  acknowledgeRecipe: z.preprocess(flagPreprocess, z.boolean()).default(false),
});

export type DeleteMenuInput = z.infer<typeof deleteMenuInputSchema>;

// ------------------------------------------------------------
// กู้คืน
// ------------------------------------------------------------

/**
 * Bring a deleted menu back, with whatever died alongside it — ADR 0027 Q6/Q7.
 *
 * Reached from ONE door: typing a name in Menu Lab that matches a soft-deleted
 * menu. The import never offers it — Part 19's rule is that money lands in full
 * immediately and a file never stops to ask a question.
 */
export const restoreMenuInputSchema = z.object({
  menuId: z.string().uuid("เมนูไม่ถูกต้อง"),
});

export type RestoreMenuInput = z.infer<typeof restoreMenuInputSchema>;

// ------------------------------------------------------------
// The sentences every screen shares
// ------------------------------------------------------------
//
// Written once here so the confirm dialog, the list badge and the import
// warning cannot drift into saying three different things about one flag —
// which is how a rule stops being a rule.

/** L1 — what เลิกขาย does, said in the place someone is about to press it. */
export const RETIRE_MEANS_TH =
  "เลิกขายมีผลกับอนาคตเท่านั้น — ยอดขายเก่า ต้นทุนเก่า และรายงานย้อนหลังไม่เปลี่ยน";

/** L1 — the half people get wrong: retiring in Mise is not retiring in the POS. */
export const RETIRE_NOT_IN_POS_TH =
  "ถ้า POS ยังส่งเมนูนี้มา ยอดขายจะยังเข้าและยังตัดสต๊อกตามปกติ — ต้องเลิกขายใน POS ด้วย";

/** L2 — the import preview's warning, above the list of dishes it found. */
export const RETIRED_STILL_SELLING_TH =
  "ไฟล์นี้มียอดขายของเมนูที่ทำเครื่องหมายเลิกขายไว้";

/** L4 — why the delete button is not offered, and what to press instead. */
export const DELETE_BLOCKED_USE_RETIRE_TH =
  "เมนูนี้ลบไม่ได้ ใช้ “เลิกขาย” แทน";

/** L5 — the interruption, before the recipe goes with the menu. */
export const DELETE_TAKES_RECIPE_TH =
  "การลบเมนูนี้จะลบสูตรของมันไปด้วย กดอีกครั้งเพื่อยืนยัน";

/** L6 — the offer at the Lab door. */
export const RESTORE_OFFER_TH =
  "เคยมีเมนูชื่อนี้และถูกลบไปแล้ว — กู้คืนพร้อมสูตรเดิมแทนการสร้างใหม่ได้";

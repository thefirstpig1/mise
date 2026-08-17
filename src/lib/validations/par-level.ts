// ============================================================
// Mise — par level zod schemas (Sprint 3 Part 17 L2, ADR 0017)
// ============================================================
// A par level is "how much of this should be on the shelf at this branch" (Q5).
// Two write shapes and one read query.
//
// What is NOT here, deliberately:
//   - `parQty`, the base-unit figure. It is `inputQty × toBaseRatio`, and the
//     ratio is a DB read, so the conversion belongs to L3 — the rule every
//     quantity in this system has followed since Part 10.
//   - Anything about suppliers, lead times or reorder amounts. A par SUGGESTS
//     NOTHING and ORDERS NOTHING (Q5); ADR 0012 Q1 already dropped the purchase
//     request layer for want of an approver, and re-inventing it through this
//     side door would be the same mistake.
//   - On-order quantities. The alert compares par with what is IN THE BUILDING
//     (Q6) — subtracting stock on order would silence the list exactly when an
//     order was placed and never chased, which is the failure this is for.
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";

const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/**
 * Checkbox/query-string → boolean. Only "true" / true / "on" are truthy:
 * `z.coerce.boolean` treats the non-empty string "false" as `true`.
 */
const flagPreprocess = (v: unknown) => v === "true" || v === true || v === "on";

/** `par_qty` / `input_qty` are Decimal(15,3), like every ledger quantity. */
export const QTY_MAX = 999_999_999_999.999;
const QTY_DECIMAL_PLACES = 3;

/** `toFixed` round-trip, never `n * 1000` (Pitfall #30). */
const hasAtMostThreeDecimals = (n: number) =>
  Number(n.toFixed(QTY_DECIMAL_PLACES)) === n;

// ------------------------------------------------------------
// 1. Setting a par
// ------------------------------------------------------------

/**
 * Scoped to **product × branch** (Q5): a branch that is out of pork is out of
 * pork whatever the business holds elsewhere, and the whole premise of Mise is
 * that a business is not a branch (ADR 0014 Q9b).
 *
 * Entered in ANY unit the user picks, stored in the base unit — the rule every
 * quantity has followed since Part 10.
 *
 * There is no `id`: setting a par is an upsert on (product, branch), which is
 * what the partial unique in prisma/manual/waste_and_par_unique.sql enforces.
 * A par is a current setting, not a document with a history.
 *
 * **Zero is refused.** "No par" is the ABSENCE of a row: a stored 0 would put
 * the product on the below-par list forever, since on-hand can never be less
 * than it. Removing a par deletes the row (`deleteParLevelInputSchema`), and the
 * DB says the same thing (`par_level_qty_check`).
 */
export const setParLevelInputSchema = z.object({
  productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  inputQty: z.coerce
    .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
    .positive("จำนวนขั้นต่ำต้องมากกว่า 0")
    .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
    .refine(hasAtMostThreeDecimals, "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
  inputUnitId: z.string().uuid("หน่วยไม่ถูกต้อง"),
});

export type SetParLevelInput = z.infer<typeof setParLevelInputSchema>;

// ------------------------------------------------------------
// 2. Removing a par
// ------------------------------------------------------------

/** Soft-deletes the row. The product then simply has no par, which is not a state. */
export const deleteParLevelInputSchema = z.object({
  id: z.string().uuid("การตั้งค่าขั้นต่ำไม่ถูกต้อง"),
});

export type DeleteParLevelInput = z.infer<typeof deleteParLevelInputSchema>;

// ------------------------------------------------------------
// 3. Read query
// ------------------------------------------------------------

export const getParLevelsQuerySchema = z.object({
  branchId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  search: z.preprocess(
    blankToUndefined,
    z.string().trim().max(100).optional()
  ),
  /**
   * A missing flag is FALSE — `flagPreprocess` already yields that, so there is
   * no `.default()` here to imply a second, unreachable rule. The product page
   * lists every par that has been set; the alert list asks for `belowOnly`
   * explicitly, so neither surface has to guess what the other meant.
   */
  belowOnly: z.preprocess(flagPreprocess, z.boolean()),
});

export type GetParLevelsQuery = z.infer<typeof getParLevelsQuerySchema>;

/** Thai display labels per field (keyed by zod `issue.path[0]`). */
export const PAR_LEVEL_FIELD_LABELS_TH: Record<string, string> = {
  productId: "วัตถุดิบ",
  branchId: "สาขา",
  inputQty: "จำนวนขั้นต่ำ",
  inputUnitId: "หน่วย",
  id: "การตั้งค่าขั้นต่ำ",
};

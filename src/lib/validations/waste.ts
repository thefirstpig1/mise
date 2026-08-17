// ============================================================
// Mise — waste zod schemas (Sprint 3 Part 17 L2, ADR 0017)
// ============================================================
// One write shape, one void, one read query. A waste entry is a single dated
// event posted immediately (Q2) — there is no draft to build up line by line, so
// unlike a stock count there is no "save one line" schema here.
//
// What is NOT here, deliberately:
//   - The base-unit qty and its sign. The user types a POSITIVE magnitude in a
//     unit of their choosing; the *Logic layer multiplies by the unit's
//     `toBaseRatio` (a DB read) and negates it for the ADJUST_LOSS. Direction is
//     never typed — a void is a separate row, not a minus sign (Q2).
//   - A cost. Waste is stock going OUT, and an outflow is valued by the FIFO
//     replay from the layers it draws down (ADR 0014). A declared cost only ever
//     applies to an ADJUST_GAIN.
//   - `tenantId` / `wastedBy` — from requireTenant + session server-side.
//   - Whether the product/branch/unit belong to the tenant, and whether the unit
//     belongs to the product — DB lookups, so they live in L3.
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import type { WasteReason } from "@prisma/client";
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
 * carrying `?includeVoided=false` would do the opposite of what it says. Same
 * helper, and the same reason, as supplier-product-mapping.ts.
 */
const flagPreprocess = (v: unknown) => v === "true" || v === true || v === "on";

// ------------------------------------------------------------
// Enum — local const array (the Sprint 1 pattern), NOT z.nativeEnum
// ------------------------------------------------------------

/**
 * Why something was thrown away (Q3). **This list is the yield boundary made
 * concrete**: everything here happened to stock that already existed, on a date,
 * and each value names a different person to talk to. Conversion loss — what the
 * knife and the heat take — is `yield_percent` and is not in this list.
 */
export const WASTE_REASON_VALUES = [
  "SPOILED",
  "DAMAGED",
  "COOKING_ERROR",
  "CUSTOMER_RETURN",
  "OTHER",
] as const;

// Compile-time drift guard — the same shape stock-movement.ts uses, and ACTUALLY
// asserted: a type alias resolving to `never` is not an error until something is
// assigned into it (the hole that let Part 13's enum drift stay green).
type _AssertWasteReason = WasteReason extends (typeof WASTE_REASON_VALUES)[number]
  ? (typeof WASTE_REASON_VALUES)[number] extends WasteReason
    ? true
    : never
  : never;
const _driftGuard: _AssertWasteReason = true;
void _driftGuard;

export const WASTE_REASON_LABELS_TH: Record<
  (typeof WASTE_REASON_VALUES)[number],
  string
> = {
  SPOILED: "เน่าเสีย/หมดอายุ",
  DAMAGED: "ชำรุด/ตกแตก",
  COOKING_ERROR: "ทำเสีย/ไหม้",
  CUSTOMER_RETURN: "ลูกค้าตีกลับ",
  OTHER: "อื่น ๆ",
};

/** `input_qty` is Decimal(15,3), like every ledger quantity. */
export const QTY_MAX = 999_999_999_999.999;
const QTY_DECIMAL_PLACES = 3;

/** `toFixed` round-trip, never `n * 1000` (Pitfall #30). */
const hasAtMostThreeDecimals = (n: number) =>
  Number(n.toFixed(QTY_DECIMAL_PLACES)) === n;

export const MAX_WASTE_NOTE_LENGTH = 500;
const MAX_WASTED_BY_NAME_LENGTH = 100;

// ------------------------------------------------------------
// 1. Recording waste
// ------------------------------------------------------------

/**
 * One row = ONE thing thrown away, posted immediately (Q2).
 *
 * `occurredAt` obeys the LEDGER's backdate window — imported from
 * stock-movement.ts rather than re-declared, because it is the same rule about
 * the same column (ADR 0011 Q5) and two copies of "90" would drift. Note the
 * contrast with a stock count's `countDate`, which is unbounded: that is a
 * document's human name, this is business time on a movement.
 *
 * **`submitKey` is the waste row's id** (Part 13.5's pattern, mirroring
 * `createStockAdjustmentInputSchema`). The client mints one uuid per submission
 * and the server uses it AS `waste_log.id`, which makes the ledger's
 * `UNIQUE(source_type, source_id)` reachable from this producer: a double POST —
 * no-JS progressive enhancement, back-then-resubmit, a network retry — resolves
 * to the same entry instead of writing off the stock twice. The form ROTATES the
 * key after each success, because the kitchen logs several things in a row.
 */
export const createWasteInputSchema = z.object({
  submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
  productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  reason: z.enum(WASTE_REASON_VALUES, {
    errorMap: () => ({ message: "กรุณาเลือกสาเหตุที่ทิ้ง" }),
  }),
  /**
   * A positive magnitude. Zero is refused because throwing away nothing is not
   * an event, and a negative would be a second, contradictory way of saying the
   * direction the row already carries. The DB says the same
   * (`waste_log_input_qty_check`).
   */
  inputQty: z.coerce
    .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
    .positive("จำนวนต้องมากกว่า 0")
    .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
    .refine(hasAtMostThreeDecimals, "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
  inputUnitId: z.string().uuid("หน่วยไม่ถูกต้อง"),
  occurredAt: z.coerce
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
  /**
   * Who actually threw it away, when that is not the account holder (Q7, ADR
   * 0015 Q2). Optional: in a one-person shop the FK already says it.
   */
  wastedByName: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(MAX_WASTED_BY_NAME_LENGTH, "ชื่อผู้ทิ้งต้องไม่เกิน 100 ตัวอักษร")
      .nullable()
  ),
  notes: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(MAX_WASTE_NOTE_LENGTH, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร")
      .nullable()
  ),
});

export type CreateWasteInput = z.infer<typeof createWasteInputSchema>;

// ------------------------------------------------------------
// 2. Voiding
// ------------------------------------------------------------

/**
 * Correcting a waste entry is a VOID (Q2): a second row is appended against this
 * one and posts the compensating `ADJUST_GAIN`. The original is left standing,
 * because the ledger is append-only (ADR 0011 Q7) and because "this was keyed
 * wrong" is itself worth being able to see.
 *
 * No quantity: a void reverses the WHOLE row. Having thrown away less than was
 * recorded is a wrong entry, not a partial void — it is voided and re-entered,
 * so there is never a half-reversed row to reason about.
 *
 * No `submitKey` either, unlike creating. Idempotency here comes from
 * `waste_log_reversal_unique` (one reversal per row), which is strictly stronger
 * than a client key: it holds even when the second void comes from a different
 * browser.
 *
 * A reason is REQUIRED, as it is for voiding a count (ADR 0015 Q6) and unlike
 * cancelling a PO. The void credits stock back, and "why did this not happen
 * after all" is asked exactly once — at the only moment anyone still knows.
 */
export const voidWasteInputSchema = z.object({
  id: z.string().uuid("รายการของเสียไม่ถูกต้อง"),
  voidReason: z
    .string({ required_error: "ต้องระบุเหตุผลที่ยกเลิก" })
    .trim()
    .min(1, "ต้องระบุเหตุผลที่ยกเลิก")
    .max(MAX_WASTE_NOTE_LENGTH, "เหตุผลต้องไม่เกิน 500 ตัวอักษร"),
});

export type VoidWasteInput = z.infer<typeof voidWasteInputSchema>;

// ------------------------------------------------------------
// 3. Read query
// ------------------------------------------------------------

export const getWasteQuerySchema = z.object({
  branchId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  productId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  reason: z.preprocess(
    blankToUndefined,
    z.enum(WASTE_REASON_VALUES).optional()
  ),
  from: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  to: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  /**
   * A missing flag is FALSE — `flagPreprocess` already yields that, so there is
   * no `.default()` here to imply a second, unreachable rule. The list answers
   * "what was thrown away", and a voided entry was not; reviewing corrections is
   * a deliberate act.
   */
  includeVoided: z.preprocess(flagPreprocess, z.boolean()),
});

export type GetWasteQuery = z.infer<typeof getWasteQuerySchema>;

/** Thai display labels per field (keyed by zod `issue.path[0]`). */
export const WASTE_FIELD_LABELS_TH: Record<string, string> = {
  submitKey: "คีย์การบันทึก",
  productId: "วัตถุดิบ",
  branchId: "สาขา",
  reason: "สาเหตุ",
  inputQty: "จำนวน",
  inputUnitId: "หน่วย",
  occurredAt: "วันที่",
  wastedByName: "ผู้ทิ้ง",
  notes: "หมายเหตุ",
  voidReason: "เหตุผลที่ยกเลิก",
};

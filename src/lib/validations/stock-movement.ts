// ============================================================
// Mise — Stock ledger validation (Sprint 2 Part 10 L2)
// ============================================================
// Zod schemas for the ADR 0011 append-only ledger: one write schema (a manual
// stock adjustment, the only Part 10 producer of movement rows) and two read
// query schemas (balance, history).
//
// What is NOT here, by design:
//   - `tenantId` / `createdBy` — from requireTenant + session server-side
//     (mirrors product.ts / supplier-product-mapping.ts).
//   - The signed base-unit `qty`. The user enters a POSITIVE magnitude in a unit
//     of their choosing (`inputQty` + `inputUnitId`); the action layer applies
//     the sign from `type` and multiplies by `ProductUnit.toBaseRatio` (Q1/Q2).
//     Sign is then guarded at the DB by stock_movement_sign_check.
//   - Ownership checks (product/branch/unit belong to the tenant, and the unit
//     belongs to the product) — DB lookups, so they live in the *Logic layer (L3).
//   - Any balance rule. A negative post-balance NEVER blocks the write (Q9);
//     the L5 form owns the warn-and-confirm.
//
// Error messages are Thai (shown to user); code is English.
// ============================================================

import { z } from "zod";
import type { AdjustmentReason, MovementType, SourceType } from "@prisma/client";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { costDeclarationBodySchema } from "@/lib/validations/stock-cost";

// ------------------------------------------------------------
// Enums — local const arrays (the Sprint 1 pattern), NOT z.nativeEnum
// ------------------------------------------------------------
// product.ts established local consts as the single source for the zod enum AND
// the form <select>, with a Thai label map. Kept here for a second reason: the
// Prisma enum objects are runtime VALUES from @prisma/client, so z.nativeEnum
// would pull the Prisma client into any Client Component that imports this file.
//
// The `satisfies`-style assertions below are type-only (erased at build) and
// fail `pnpm tsc` if schema.prisma ever adds/renames a member — drift is caught
// at compile time without a runtime import.

/** Only these two are valid on a manual adjustment (Q10) — PO_RECEIVE is GR-only. */
export const ADJUSTMENT_TYPE_VALUES = ["ADJUST_GAIN", "ADJUST_LOSS"] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPE_VALUES)[number];

/** Every ledger movement type — a read filter may reference any of them. */
export const MOVEMENT_TYPE_VALUES = [
  "PO_RECEIVE",
  // Part 13 (ADR 0013 Q6): the compensating movement a GR void posts. Read-only
  // here, like PO_RECEIVE — nothing but the receipt lifecycle writes either.
  "PO_RECEIVE_REVERSAL",
  "ADJUST_GAIN",
  "ADJUST_LOSS",
] as const;

/** Polymorphic source discriminator (Q3). */
export const SOURCE_TYPE_VALUES = [
  "GR_LINE",
  "ADJUSTMENT",
  "STOCK_COUNT",
  // Part 17 (ADR 0017 Q1): waste_log. The movement type is still ADJUST_LOSS —
  // this value is what lets /cost mean ของเสีย when it says ของเสีย.
  "WASTE_LOG",
  "SYSTEM_INITIAL",
] as const;

/**
 * Every reason the DB can hold. SPOILAGE and DAMAGE are still here, and still
 * valid: Part 17 did not migrate the past, so history must keep reading (ADR
 * 0017 Q4). What changed is that nothing OFFERS them any more — see
 * `ADJUSTMENT_REASON_FORM_VALUES`.
 */
export const ADJUSTMENT_REASON_VALUES = [
  "RECOUNT",
  "SPOILAGE",
  "DAMAGE",
  "OTHER",
] as const;

/**
 * What the adjustment form offers — **one door per kind of loss** (ADR 0017 Q4).
 *
 * Throwing food away now has its own document at `/waste`, so an adjustment is
 * what it always should have been: a CORRECTION, not an event. Leaving spoilage
 * on this form would give the same fact two doors, and `/cost`'s ของเสีย column
 * could then never mean anything precise — which is exactly how it came to be
 * mislabelled between Part 14 and Part 17.
 *
 * The zod schema deliberately still ACCEPTS the retired values: a tab opened
 * before this deploy should not fail on submit, and what it writes is an
 * adjustment, which is true and lands in the variance column by the same rule as
 * every other undocumented outflow.
 */
export const ADJUSTMENT_REASON_FORM_VALUES = ["RECOUNT", "OTHER"] as const;

// Compile-time drift guards: each local union must cover the Prisma enum exactly.
type _AssertMovementType = MovementType extends (typeof MOVEMENT_TYPE_VALUES)[number]
  ? (typeof MOVEMENT_TYPE_VALUES)[number] extends MovementType
    ? true
    : never
  : never;
type _AssertSourceType = SourceType extends (typeof SOURCE_TYPE_VALUES)[number]
  ? (typeof SOURCE_TYPE_VALUES)[number] extends SourceType
    ? true
    : never
  : never;
type _AssertReason = AdjustmentReason extends (typeof ADJUSTMENT_REASON_VALUES)[number]
  ? (typeof ADJUSTMENT_REASON_VALUES)[number] extends AdjustmentReason
    ? true
    : never
  : never;
// Referenced so `noUnusedLocals` stays quiet; the assertion is the type itself.
export type _StockEnumDriftGuards = [
  _AssertMovementType,
  _AssertSourceType,
  _AssertReason,
];

// ...and ACTUALLY asserted. A type alias that resolves to `never` is not an
// error on its own, so the guards above were silent: Part 13 added
// PO_RECEIVE_REVERSAL to the Prisma enum and `pnpm tsc` stayed green with the
// array out of date. Assigning `true` into a `never` slot is what makes the
// drift fail the build, which is what the comment above always claimed.
const _driftGuards: _StockEnumDriftGuards = [true, true, true];
void _driftGuards;

/** Thai gloss per adjustment type — used by the form <select> options. */
export const ADJUSTMENT_TYPE_LABELS_TH: Record<AdjustmentType, string> = {
  ADJUST_GAIN: "ปรับเพิ่ม",
  ADJUST_LOSS: "ปรับลด",
};

/**
 * Thai gloss per ledger movement type — the L5c history badges. Covers all
 * three types, unlike ADJUSTMENT_TYPE_LABELS_TH which is the write-form subset.
 */
export const MOVEMENT_TYPE_LABELS_TH: Record<
  (typeof MOVEMENT_TYPE_VALUES)[number],
  string
> = {
  PO_RECEIVE: "รับของเข้า",
  PO_RECEIVE_REVERSAL: "กลับรายการรับของ",
  ADJUST_GAIN: "ปรับเพิ่ม",
  ADJUST_LOSS: "ปรับลด",
};

/** Thai gloss per source — answers "รายการนี้มาจากไหน" in the history view. */
export const SOURCE_TYPE_LABELS_TH: Record<
  (typeof SOURCE_TYPE_VALUES)[number],
  string
> = {
  GR_LINE: "ใบรับของ",
  ADJUSTMENT: "ปรับสต๊อก",
  STOCK_COUNT: "นับสต๊อก",
  WASTE_LOG: "ของเสีย",
  SYSTEM_INITIAL: "ยอดยกมา",
};

/** Thai gloss per reason — used by the form <select> options. */
export const ADJUSTMENT_REASON_LABELS_TH: Record<
  (typeof ADJUSTMENT_REASON_VALUES)[number],
  string
> = {
  RECOUNT: "นับสต๊อกใหม่",
  SPOILAGE: "ของเสีย/หมดอายุ",
  DAMAGE: "ของชำรุด",
  OTHER: "อื่น ๆ",
};

// ------------------------------------------------------------
// Shared field pieces (inline per-file, matching the Sprint 1 convention —
// there is no shared preprocess module and this slice does not introduce one)
// ------------------------------------------------------------

/** A missing/blank field means "not provided" → null. Same helper as product.ts. */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/** Blank → undefined, for `.optional()` filters. Same helper as product-restore.ts. */
const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/** MVP backdate window (Q5): today − 90 days. Per-tenant configurable in Sprint 3+. */
export const MAX_BACKDATE_DAYS = 90;

/**
 * `input_qty` / `qty` are Decimal(15,3) — 12 integer digits, 3 decimal places.
 * Exceeding either silently truncates (scale) or errors at the driver (precision),
 * so both are rejected here with a Thai message instead.
 */
export const QTY_MAX = 999_999_999_999.999;
const QTY_DECIMAL_PLACES = 3;

/**
 * Round-trip through `toFixed`, NOT `Number.isInteger(n * 1000)`.
 *
 * The multiply trick rejects legitimate 3-decimal values: `1.005 * 1000` is
 * `1004.9999999999999` in binary floating point, so 1.005 — and ~1.2% of every
 * other 3-decimal value — failed with a message the user cannot act on
 * ("มีทศนิยมไม่เกิน 3 ตำแหน่ง" on a number that has exactly 3). The form's
 * `step="0.001"` accepts them, so the browser and the server disagreed.
 *
 * `toFixed(3)` formats the DECIMAL expansion and rounds it, so a value that is
 * exactly representable at 3 places round-trips to itself while a 4th place
 * changes the number. Same guard as `supplier.ts` rate fields (2 dp) — that one
 * was written correctly in Sprint 1; this file regressed to the multiply.
 */
const hasAtMostThreeDecimals = (n: number) =>
  Number(n.toFixed(QTY_DECIMAL_PLACES)) === n;

// ------------------------------------------------------------
// 1. createStockAdjustmentInputSchema — the write path
// ------------------------------------------------------------

/**
 * A manual stock adjustment (Q10). `inputQty` is an unsigned magnitude in
 * `inputUnitId`; direction comes from `type` alone, so a user never types a
 * minus sign and a "-5 ADJUST_LOSS" double-negative is unrepresentable.
 *
 * `occurredAt` is business time and may be backdated within [today−90d, today]
 * in BANGKOK (Q5). Both bounds are computed per-parse from computeBangkokToday(),
 * so a long-lived process does not pin a stale "today".
 *
 * **`submitKey` is the adjustment's id** (Part 13.5, mirroring `goodsReceiptInputSchema`).
 * The client mints one uuid per submission and the server uses it AS
 * `stock_adjustment.id`, which is what finally makes ADR 0011 Q4's
 * `(source_type, source_id)` idempotency reachable from this producer: a double
 * POST — progressive enhancement without JS, back-then-resubmit, a network retry
 * — resolves to the same adjustment instead of doubling the stock. The form
 * ROTATES the key after each success, because it stays open for the next item.
 */
export const createStockAdjustmentInputSchema = z.object({
  submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
  productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  type: z.enum(ADJUSTMENT_TYPE_VALUES, {
    errorMap: () => ({ message: "กรุณาเลือกประเภทการปรับ (เพิ่ม/ลด)" }),
  }),
  reason: z.enum(ADJUSTMENT_REASON_VALUES, {
    errorMap: () => ({ message: "กรุณาเลือกเหตุผลการปรับสต๊อก" }),
  }),
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
  notes: z.preprocess(
    blankToNull,
    z.string().trim().max(500, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร").nullable()
  ),
  /**
   * OPTIONAL cost for the stock this adjustment brings IN (Part 14, ADR 0014 Q6)
   * — entry point one of two for a cost declaration. `null` is the normal case:
   * the person counting stock usually does not know what it cost, and the server
   * falls back to the last purchase price (Q5).
   *
   * Only meaningful on a GAIN. A LOSS removes stock that already has a cost from
   * the layer it is drawn from, so a cost typed against one would be silently
   * ignored — and a field that is silently ignored is a field that lies.
   */
  costDeclaration: costDeclarationBodySchema.nullish().transform((v) => v ?? null),
}).superRefine((input, ctx) => {
  if (input.costDeclaration && input.type !== "ADJUST_GAIN") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["costDeclaration"],
      message: "ระบุต้นทุนได้เฉพาะรายการที่เพิ่มสต๊อกเท่านั้น",
    });
  }
});

export type CreateStockAdjustmentInput = z.infer<
  typeof createStockAdjustmentInputSchema
>;

/** Thai display labels per field (keyed by zod issue.path[0]). */
export const STOCK_ADJUSTMENT_FIELD_LABELS_TH: Record<
  keyof CreateStockAdjustmentInput,
  string
> = {
  submitKey: "คีย์การบันทึก",
  costDeclaration: "ต้นทุน",
  productId: "วัตถุดิบ",
  branchId: "สาขา",
  type: "ประเภทการปรับ",
  reason: "เหตุผล",
  inputQty: "จำนวน",
  inputUnitId: "หน่วย",
  occurredAt: "วันที่",
  notes: "หมายเหตุ",
};

// ------------------------------------------------------------
// 2. getStockBalanceQuerySchema — the balance read
// ------------------------------------------------------------

/**
 * Balance is SUM(qty) over one (product, branch) — both required, since a
 * balance without a location is meaningless and branch_id is NOT NULL (Q6).
 *
 * `asOf` is the Q8 time-travel bound (`occurredAt <= asOf`). Deliberately NOT
 * subject to the 90-day backdate guard: that guard exists to stop bad WRITES,
 * whereas reading the balance at any historical point is the feature. A future
 * `asOf` is harmless — it simply includes everything.
 */
export const getStockBalanceQuerySchema = z.object({
  productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  asOf: z.preprocess(
    blankToUndefined,
    z.coerce.date({ invalid_type_error: "วันที่ไม่ถูกต้อง" }).optional()
  ),
});

export type GetStockBalanceQuery = z.infer<typeof getStockBalanceQuerySchema>;

// ------------------------------------------------------------
// 3. getStockMovementHistoryQuerySchema — the history read
// ------------------------------------------------------------

/** Page size for the history list. */
export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 100;

/**
 * The ledger history feed. Every filter is optional — the unfiltered call is the
 * branch-wide audit view backed by stock_movement_branch_audit_idx.
 *
 * `cursor` is the id of the last row of the previous page, fed straight to
 * Prisma's `cursor: { id }` + `skip: 1`. A uuid (not an encoded composite) is
 * enough because id is unique and the L3 read pins a stable
 * ORDER BY (occurredAt, createdAt, id).
 *
 * `dateFrom`/`dateTo` filter on occurredAt and are INCLUSIVE, so an equal pair
 * means "that one day". This is why the refine allows `==`, unlike the strict
 * `effectiveTo > effectiveFrom` in supplier-product-mapping.ts — that one guards
 * a price validity window, this one is a display filter.
 */
export const getStockMovementHistoryQuerySchema = z
  .object({
    productId: z.preprocess(
      blankToUndefined,
      z.string().uuid("วัตถุดิบไม่ถูกต้อง").optional()
    ),
    branchId: z.preprocess(
      blankToUndefined,
      z.string().uuid("สาขาไม่ถูกต้อง").optional()
    ),
    type: z.preprocess(
      blankToUndefined,
      z
        .enum(MOVEMENT_TYPE_VALUES, {
          errorMap: () => ({ message: "ประเภทการเคลื่อนไหวไม่ถูกต้อง" }),
        })
        .optional()
    ),
    sourceType: z.preprocess(
      blankToUndefined,
      z
        .enum(SOURCE_TYPE_VALUES, {
          errorMap: () => ({ message: "ประเภทแหล่งที่มาไม่ถูกต้อง" }),
        })
        .optional()
    ),
    dateFrom: z.preprocess(
      blankToUndefined,
      z.coerce.date({ invalid_type_error: "วันที่เริ่มต้นไม่ถูกต้อง" }).optional()
    ),
    dateTo: z.preprocess(
      blankToUndefined,
      z.coerce.date({ invalid_type_error: "วันที่สิ้นสุดไม่ถูกต้อง" }).optional()
    ),
    limit: z.coerce
      .number({ invalid_type_error: "จำนวนรายการไม่ถูกต้อง" })
      .int("จำนวนรายการต้องเป็นจำนวนเต็ม")
      .positive("จำนวนรายการต้องมากกว่า 0")
      .max(HISTORY_MAX_LIMIT, `ดูได้ครั้งละไม่เกิน ${HISTORY_MAX_LIMIT} รายการ`)
      .default(HISTORY_DEFAULT_LIMIT),
    cursor: z.preprocess(
      blankToUndefined,
      z.string().uuid("ตำแหน่งหน้าถัดไปไม่ถูกต้อง").optional()
    ),
  })
  .superRefine((val, ctx) => {
    if (val.dateFrom && val.dateTo && val.dateTo < val.dateFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "วันที่สิ้นสุดต้องไม่มาก่อนวันที่เริ่มต้น",
        path: ["dateTo"],
      });
    }
  });

export type GetStockMovementHistoryQuery = z.infer<
  typeof getStockMovementHistoryQuerySchema
>;

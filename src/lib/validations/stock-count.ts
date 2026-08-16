// ============================================================
// Mise — stock count zod schemas (Sprint 3 Part 15 L2, ADR 0015)
// ============================================================
// Four write shapes and one read query. The document is built up line by line
// rather than submitted whole — a stock take is typed over hours, not filled in
// like a form — so "save one line" is its own schema, and it is the one that
// carries the `counted_at` instant the ledger will later use (Q8).
//
// What is NOT here, deliberately:
//   - `qty_expected`. It is the LEDGER's answer, snapshotted server-side when the
//     line is saved (Q3). Accepting it from the client would mean trusting the
//     browser to tell the server what the server already knows — the same reason
//     ADR 0013 kept the over-receipt rule out of zod.
//   - the base-unit total. It is the sum of the entries × their ratios, and the
//     ratios are a DB read (`toBaseQty`), so it belongs to the *Logic layer.
//   - any money. The count stores none (Q4).
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import type { StockCountStatus } from "@prisma/client";

/** Blank → null. Same helper as every other validations file. */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

export const STOCK_COUNT_STATUS_VALUES = ["DRAFT", "CLOSED", "VOIDED"] as const;

// Compile-time drift guard — the same shape stock-movement.ts uses, and for the
// same reason: Part 13 added an enum member and tsc stayed green because a type
// alias resolving to `never` is not an error until something is assigned into it.
type _AssertStatus = StockCountStatus extends (typeof STOCK_COUNT_STATUS_VALUES)[number]
  ? (typeof STOCK_COUNT_STATUS_VALUES)[number] extends StockCountStatus
    ? true
    : never
  : never;
const _driftGuard: _AssertStatus = true;
void _driftGuard;

export const STOCK_COUNT_STATUS_LABELS_TH: Record<
  (typeof STOCK_COUNT_STATUS_VALUES)[number],
  string
> = {
  DRAFT: "กำลังนับ",
  CLOSED: "ปิดแล้ว",
  VOIDED: "ยกเลิกแล้ว",
};

/** `qty_counted` / `qty_in_unit` are Decimal(15,3), like every ledger quantity. */
export const QTY_MAX = 999_999_999_999.999;
const QTY_DECIMAL_PLACES = 3;

/** `toFixed` round-trip, never `n * 1000` (Pitfall #30). */
const hasAtMostThreeDecimals = (n: number) =>
  Number(n.toFixed(QTY_DECIMAL_PLACES)) === n;

/** How many products one sheet may hold — a guard on a runaway client, not a rule. */
export const MAX_COUNT_LINES = 500;

// ------------------------------------------------------------
// 1. Opening a count
// ------------------------------------------------------------

/**
 * `countDate` is the document's human name, not an accounting date (Q8) — the
 * variance occurs at each line's own `countedAt`. It is therefore NOT bounded by
 * the ledger's 90-day backdate window: naming a sheet is not writing history.
 *
 * `showExpected` is the blind-count switch (Q7), chosen when the sheet is opened
 * because that is when a manager decides how this count will be run. It changes
 * nothing that is stored — `qty_expected` is captured either way.
 */
export const openStockCountInputSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  countDate: z.coerce.date({
    required_error: "ต้องระบุวันที่นับ",
    invalid_type_error: "วันที่ไม่ถูกต้อง",
  }),
  showExpected: z.coerce.boolean().default(true),
  notes: z.preprocess(
    blankToNull,
    z.string().trim().max(500, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร").nullable()
  ),
});

export type OpenStockCountInput = z.infer<typeof openStockCountInputSchema>;

// ------------------------------------------------------------
// 2. Saving one counted line
// ------------------------------------------------------------

/** One unit box on the count sheet: "2 กระสอบ" is one of these. */
export const stockCountEntryInputSchema = z.object({
  productUnitId: z.string().uuid("หน่วยไม่ถูกต้อง"),
  qtyInUnit: z.coerce
    .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
    .min(0, "จำนวนต้องไม่ติดลบ")
    .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
    .refine(hasAtMostThreeDecimals, "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
});

/**
 * Saving a line IS the count of that product (Q7): its presence means the
 * product was counted, and a total of **0** is a real observation — "I looked,
 * there is none" — which posts a loss down to zero. There is no way to express
 * "not counted" here, and deliberately so: that is the absence of a line.
 *
 * At least one entry is required. A line with no boxes is not a count of zero,
 * it is a row someone opened and abandoned, and letting it save would turn an
 * unfinished sheet into a stock write-off.
 */
export const saveStockCountLineInputSchema = z
  .object({
    stockCountId: z.string().uuid("ใบนับสต๊อกไม่ถูกต้อง"),
    productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
    entries: z
      .array(stockCountEntryInputSchema)
      .min(1, "ต้องระบุจำนวนอย่างน้อย 1 หน่วย")
      .max(20, "ระบุได้ไม่เกิน 20 หน่วยต่อรายการ"),
    /**
     * Who actually walked and counted, when that is not the account holder (Q2).
     * Optional: in a one-person shop the FK already says it.
     */
    countedByName: z.preprocess(
      blankToNull,
      z.string().trim().max(100, "ชื่อผู้นับต้องไม่เกิน 100 ตัวอักษร").nullable()
    ),
    notes: z.preprocess(
      blankToNull,
      z.string().trim().max(500, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร").nullable()
    ),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const e of input.entries) {
      if (seen.has(e.productUnitId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries"],
          // Two boxes for the same unit is almost always a mis-tap, and silently
          // summing them would hide it inside a number nobody can audit.
          message: "ระบุหน่วยเดียวกันซ้ำไม่ได้ — รวมจำนวนไว้ในช่องเดียว",
        });
        return;
      }
      seen.add(e.productUnitId);
    }
  });

export type SaveStockCountLineInput = z.infer<typeof saveStockCountLineInputSchema>;

// ------------------------------------------------------------
// 3. Closing and voiding
// ------------------------------------------------------------

/**
 * Closing posts every line's variance to the ledger. No confirmation flag lives
 * here: the UI owns the "42 products hold stock and were not counted" warning
 * (Q7), and a server that refused the close would be inventing a rule the grill
 * explicitly declined to make — a partial count is the normal case.
 */
export const closeStockCountInputSchema = z.object({
  id: z.string().uuid("ใบนับสต๊อกไม่ถูกต้อง"),
});

export type CloseStockCountInput = z.infer<typeof closeStockCountInputSchema>;

/**
 * A reason is REQUIRED to void, unlike the PO's optional cancel reason. Voiding a
 * count reverses stock that was already adjusted on the strength of someone
 * physically counting it; "why did the count not count" is exactly the question
 * a reader will have, and the moment it is asked is the only moment anyone knows.
 */
export const voidStockCountInputSchema = z.object({
  id: z.string().uuid("ใบนับสต๊อกไม่ถูกต้อง"),
  voidReason: z
    .string({ required_error: "ต้องระบุเหตุผลที่ยกเลิก" })
    .trim()
    .min(1, "ต้องระบุเหตุผลที่ยกเลิก")
    .max(500, "เหตุผลต้องไม่เกิน 500 ตัวอักษร"),
});

export type VoidStockCountInput = z.infer<typeof voidStockCountInputSchema>;

// ------------------------------------------------------------
// 4. Read query
// ------------------------------------------------------------

export const getStockCountsQuerySchema = z.object({
  branchId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  status: z.preprocess(
    blankToUndefined,
    z.enum(STOCK_COUNT_STATUS_VALUES).optional()
  ),
});

export type GetStockCountsQuery = z.infer<typeof getStockCountsQuerySchema>;

/** Thai display labels per field (keyed by zod `issue.path[0]`). */
export const STOCK_COUNT_FIELD_LABELS_TH: Record<string, string> = {
  branchId: "สาขา",
  countDate: "วันที่นับ",
  notes: "หมายเหตุ",
  stockCountId: "ใบนับสต๊อก",
  productId: "วัตถุดิบ",
  entries: "จำนวนที่นับได้",
  countedByName: "ผู้นับ",
  voidReason: "เหตุผลที่ยกเลิก",
};

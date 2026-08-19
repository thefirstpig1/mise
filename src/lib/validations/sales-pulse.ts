// ============================================================
// Mise — daily pulse zod schemas (Sprint 4 Part 20a L2, ADR 0020)
// ============================================================
// One write shape and one threshold. The whole Part is one number, so this file
// is mostly about making sure that number means what it says.
//
// What is NOT here:
//   - **The comparison against the day's detail.** That is a database question
//     (sum this day's live lines) and it is computed at READ, never stored —
//     a stored difference goes stale the moment a day is re-imported.
//   - **Whether the day is already locked.** A pulse freezes once a detail file
//     lands (Q2/rule P28), and only the database knows whether one has.
//   - `tenantId` / the recorder's id — from requireTenant + session.
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import type { SalesPulseSource as PrismaSalesPulseSource } from "@prisma/client";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";

// ------------------------------------------------------------
// Vocabulary
// ------------------------------------------------------------

export const SALES_PULSE_SOURCE_VALUES = ["MANUAL"] as const;
export type SalesPulseSourceValue = (typeof SALES_PULSE_SOURCE_VALUES)[number];

type _AssertPulseSource = PrismaSalesPulseSource extends SalesPulseSourceValue
  ? SalesPulseSourceValue extends PrismaSalesPulseSource
    ? true
    : never
  : never;
const _pulseSourceDriftGuard: _AssertPulseSource = true;
void _pulseSourceDriftGuard;

export const SALES_PULSE_SOURCE_LABELS_TH: Record<SalesPulseSourceValue, string> = {
  MANUAL: "คีย์เอง",
};

// ------------------------------------------------------------
// The mismatch threshold (Q3, rule P29)
// ------------------------------------------------------------

/** Percent of the day's takings. ★ A guess — see `pulseMismatchThreshold`. */
export const PULSE_MISMATCH_PERCENT = 1;
/** Floor in baht, so a small day does not cry wolf. ★ Also a guess. */
export const PULSE_MISMATCH_MIN_BAHT = 100;

/**
 * How far apart the pulse and the detail may be before it is worth saying so.
 *
 * ★ **These numbers were reasoned about, not measured.** A ฿40,000 day warns
 * above ฿400 and a ฿3,000 day above ฿100, which sounds right and may not be. Like
 * Section C's confidence thresholds, this is written down as a starting value to
 * validate against real shops before Beta — the honest thing being to say so
 * rather than to let a plausible constant harden into a rule nobody questions.
 *
 * Too tight and it fires every day, which teaches people to ignore it — and an
 * ignored warning is worse than none, because it also covers the one that
 * mattered. Too loose and a whole missing evening slips through.
 */
export function pulseMismatchThreshold(expectedAmount: number): number {
  const proportional = (Math.abs(expectedAmount) * PULSE_MISMATCH_PERCENT) / 100;
  return Math.max(proportional, PULSE_MISMATCH_MIN_BAHT);
}

/** Is this gap worth a warning? */
export function isPulseMismatch(pulseAmount: number, detailAmount: number): boolean {
  return Math.abs(pulseAmount - detailAmount) > pulseMismatchThreshold(detailAmount);
}

// ------------------------------------------------------------
// Recording a pulse
// ------------------------------------------------------------

export const MAX_PULSE_NOTE_LENGTH = 200;
/** A day's takings above this are a typo, not a record day. */
export const MAX_PULSE_AMOUNT = 100_000_000;

const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/**
 * A pulse that must be TYPED, never defaulted.
 *
 * Zero is legal — a shop can open and sell nothing — so there is no `.positive()`
 * to reject a coerced blank, which is the same trap Part 18 fell into at L2/T14
 * and Part 19 designed its whole parser around. The blank is caught before the
 * coercion instead of after it.
 */
const blankToUndefinedNumber = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const trimmed = v.trim().replace(/,/g, "");
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    // Leave unparseable text alone so z.number reports it as the wrong TYPE
    // rather than as a missing value — "abc" is a different mistake from "".
    return Number.isNaN(n) ? v : n;
  }
  return v;
};

const hasAtMostTwoDecimals = (n: number) => Number(n.toFixed(2)) === n;

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง")
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "วันที่ไม่ถูกต้อง");

export const recordSalesPulseInputSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  businessDate: dayString
    .refine((d) => d.getTime() <= computeBangkokToday().getTime(), {
      message: "บันทึกยอดของวันที่ยังมาไม่ถึงไม่ได้",
    })
    .refine(
      (d) => d.getTime() >= addDays(computeBangkokToday(), -MAX_BACKDATE_DAYS).getTime(),
      { message: `ย้อนหลังได้ไม่เกิน ${MAX_BACKDATE_DAYS} วัน` }
    ),
  /**
   * **What the customer paid** — after discount, INCLUDING VAT and service
   * charge (Q1, rule P27). This is deliberately not the revenue figure the rest
   * of the system uses, and every screen that shows both must say so.
   */
  amount: z.preprocess(
    blankToUndefinedNumber,
    z
      .number({
        required_error: "ต้องระบุยอดขายของวันนี้",
        invalid_type_error: "ยอดขายไม่ถูกต้อง",
      })
      .min(0, "ยอดขายติดลบไม่ได้")
      .max(MAX_PULSE_AMOUNT, "ยอดเกินค่าที่ระบบรองรับ")
      .refine(hasAtMostTwoDecimals, "ยอดขายต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง")
  ),
  note: z.preprocess(
    blankToNull,
    z.string().trim().max(MAX_PULSE_NOTE_LENGTH, "หมายเหตุต้องไม่เกิน 200 ตัวอักษร").nullable()
  ),
});

export type RecordSalesPulseInput = z.infer<typeof recordSalesPulseInputSchema>;

export const getPulseDashboardQuerySchema = z.object({
  branchId: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.string().uuid().optional()
  ),
});

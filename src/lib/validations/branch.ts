// ============================================================
// Mise — branch input validation (Part 35 L1)
// ============================================================
// Until Part 35 a tenant had exactly the branch `createTenant` made, because no
// screen could add another — found while seeding a two-branch demo shop, where
// the second branch had to be written straight into the database. Every
// multi-branch feature Mise has (transfers, branch reach, per-branch cost) was
// unreachable for a real shop.
//
// Error messages are Thai (shown to the user); code is English.
// ============================================================

import { z } from "zod";

const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v;

/**
 * The branch's sales-day cut-off as "HH:MM" (Kong 2026-10-20, rule P24 ★):
 * sales stamped before this time belong to the PREVIOUS day. 05:00 is the
 * default — a shop open 17:00–02:00 keeps its whole night on one day.
 * Limited to 00:00–12:00: a cut-off in the afternoon would move a lunch
 * service onto yesterday, which is never what a shop means.
 */
export const DEFAULT_SALES_DAY_CUTOFF_MINUTES = 300;
export const salesDayCutoffSchema = z.preprocess(
  (v) => (v === undefined || v === null || v === "" ? undefined : v),
  z
    .string()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "เวลาตัดวันต้องเป็นรูปแบบ ชม.:นาที เช่น 05:00")
    .transform((s) => {
      const [h, m] = s.split(":").map(Number);
      return h * 60 + m;
    })
    .refine((min) => min <= 12 * 60, "เวลาตัดวันต้องอยู่ระหว่าง 00:00 ถึง 12:00")
    .optional()
);

/** "05:00" from 300 — for the form's default value. */
export const cutoffToHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const branchInputSchema = z.object({
  name: z
    .string({ required_error: "ต้องระบุชื่อสาขา" })
    .trim()
    .min(1, "ต้องระบุชื่อสาขา")
    .max(100, "ชื่อสาขาต้องไม่เกิน 100 ตัวอักษร"),
  /**
   * Short and upper-case because it prints inside every document number
   * ({CODE}-PO-0001, {CODE}-GR-0001). Latin letters and digits only, since a
   * Thai code inside a running number is unreadable on a thermal printer.
   */
  code: z
    .string({ required_error: "ต้องระบุรหัสสาขา" })
    .trim()
    .toUpperCase()
    .min(2, "รหัสสาขาต้องมี 2–10 ตัว")
    .max(10, "รหัสสาขาต้องมี 2–10 ตัว")
    .regex(/^[A-Z0-9]+$/, "รหัสสาขาใช้ได้เฉพาะตัวอักษรภาษาอังกฤษและตัวเลข"),
  address: z.preprocess(
    blankToNull,
    z.string().trim().max(500, "ที่อยู่ต้องไม่เกิน 500 ตัวอักษร").nullable()
  ),
  /** Minutes after midnight; absent = keep (update) or the default (create). */
  salesDayCutoffMinutes: salesDayCutoffSchema,
});
export type BranchInput = z.infer<typeof branchInputSchema>;

/**
 * The code is NOT editable. Document numbers are found by scanning for the
 * branch's `{CODE}-PO-` prefix (purchase-order.ts, generatePoNumber), so a
 * renamed code would restart a branch's numbering at 0001 under a new prefix
 * while its old documents kept the old one — one branch, two number series,
 * and nothing on screen to say they are the same place.
 */
export const updateBranchInputSchema = branchInputSchema.omit({ code: true }).extend({
  id: z.string().uuid("สาขาไม่ถูกต้อง"),
});
export type UpdateBranchInput = z.infer<typeof updateBranchInputSchema>;

export const BRANCH_FIELD_LABELS_TH: Record<string, string> = {
  name: "ชื่อสาขา",
  code: "รหัสสาขา",
  address: "ที่อยู่",
  salesDayCutoffMinutes: "เวลาตัดวัน",
};

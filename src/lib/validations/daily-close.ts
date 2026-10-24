// ============================================================
// Mise — ปิดร้านประจำวัน input shapes (ADR 0042)
// ============================================================
// One required figure — the till total — and only while no POS file has
// locked it (ADR 0020 Q2). Everything else is optional, and a blank is NULL,
// never zero: "nobody counted the drawer" and "the drawer held ฿0" are
// different facts (Q2).
// ============================================================

import { z } from "zod";

export const DAILY_ISSUE_CATEGORY_VALUES = ["OUT_OF_STOCK", "EQUIPMENT", "COMPLAINT", "STAFF", "OTHER"] as const;
export type DailyIssueCategoryValue = (typeof DAILY_ISSUE_CATEGORY_VALUES)[number];
export const DAILY_ISSUE_CATEGORY_LABELS_TH: Record<DailyIssueCategoryValue, string> = {
  OUT_OF_STOCK: "ของหมด",
  EQUIPMENT: "อุปกรณ์เสีย",
  COMPLAINT: "ลูกค้าร้องเรียน",
  STAFF: "พนักงานขาด/สาย",
  OTHER: "อื่น ๆ",
};

/** "If 10 customers came, how many were this type" (Q3). */
export const MIX_PARTS = 10;
export const MAX_BAHT = 100_000_000;
export const MAX_GUESTS = 100_000;
export const MAX_NOTE = 200;
export const MAX_ISSUE = 500;
export const MAX_COMMENT = 1000;
export const MAX_CUSTOMER_TYPES = 12;

const blankToNull = (v: unknown) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v);
const money = (label: string) =>
  z.preprocess(
    (v) => {
      const b = blankToNull(v);
      return typeof b === "string" ? Number(b.replace(/,/g, "")) : b;
    },
    z.number({ invalid_type_error: `${label}ต้องเป็นตัวเลข` }).min(0, `${label}ติดลบไม่ได้`).max(MAX_BAHT, `${label}มากเกินไป`).nullable()
  );

export const saveDailyCloseInputSchema = z
  .object({
    branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
    businessDate: z.coerce.date({ invalid_type_error: "วันที่ไม่ถูกต้อง" }),
    /** Required unless a POS file already locked it — the logic decides which. */
    pulseAmount: money("ยอดรวมจาก POS"),
    guestCount: z.preprocess(
      (v) => {
        const b = blankToNull(v);
        return typeof b === "string" ? Number(b) : b;
      },
      z.number({ invalid_type_error: "จำนวนลูกค้าต้องเป็นตัวเลข" }).int("จำนวนลูกค้าต้องเป็นจำนวนเต็ม").min(0).max(MAX_GUESTS).nullable()
    ),
    cashFloat: money("เงินทอนตั้งต้น"),
    cashSales: money("เงินสดจากการขาย"),
    cashCounted: money("ยอดที่นับได้"),
    cashNote: z.preprocess(blankToNull, z.string().trim().max(MAX_NOTE, "หมายเหตุยาวเกินไป").nullable()),
    mix: z
      .array(z.object({ customerTypeId: z.string().uuid(), parts: z.number().int().min(0).max(MIX_PARTS) }))
      .max(MAX_CUSTOMER_TYPES)
      .default([]),
    issues: z
      .array(
        z.object({
          id: z.string().uuid().nullable().default(null),
          category: z.enum(DAILY_ISSUE_CATEGORY_VALUES),
          body: z.string().trim().min(1, "พิมพ์รายละเอียดปัญหา").max(MAX_ISSUE, "รายละเอียดยาวเกินไป"),
          followUp: z.boolean().default(false),
        })
      )
      .max(30)
      .default([]),
  })
  .refine((v) => v.mix.reduce((t, m) => t + m.parts, 0) <= MIX_PARTS, { message: `แบ่งได้รวมไม่เกิน ${MIX_PARTS} ส่วน`, path: ["mix"] });

export type SaveDailyCloseInput = z.infer<typeof saveDailyCloseInputSchema>;

export const addDailyCommentInputSchema = z.object({
  dailyCloseId: z.string().uuid(),
  body: z.string().trim().min(1, "พิมพ์ความเห็นก่อน").max(MAX_COMMENT, "ความเห็นยาวเกินไป"),
});

export const customerTypeNameSchema = z.string().trim().min(1, "ตั้งชื่อประเภทลูกค้า").max(40, "ชื่อยาวเกินไป");

/** Cash short/over — only when all three figures exist (Q2). Positive = over. */
export function cashDifference(c: { cashFloat: number | null; cashSales: number | null; cashCounted: number | null }): number | null {
  if (c.cashFloat === null || c.cashSales === null || c.cashCounted === null) return null;
  return Math.round((c.cashCounted - c.cashFloat - c.cashSales) * 100) / 100;
}

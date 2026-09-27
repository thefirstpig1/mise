// ============================================================
// Mise — department input validation (Part 35 L1)
// ============================================================
// Before Part 35 a shop could switch departments ON in /settings and then had
// exactly one — "Main", created by createTenant — with no screen to add
// ครัว or บาร์. Every department feature (per-department cost and revenue,
// Part 32) was unreachable for a real shop.
// ============================================================

import { z } from "zod";

const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v;

const name = z
  .string({ required_error: "ต้องระบุชื่อแผนก" })
  .trim()
  .min(1, "ต้องระบุชื่อแผนก")
  .max(100, "ชื่อแผนกต้องไม่เกิน 100 ตัวอักษร");

const description = z.preprocess(
  blankToNull,
  z.string().trim().max(300, "คำอธิบายต้องไม่เกิน 300 ตัวอักษร").nullable()
);

export const departmentInputSchema = z.object({
  name,
  code: z
    .string({ required_error: "ต้องระบุรหัสแผนก" })
    .trim()
    .toUpperCase()
    .min(2, "รหัสแผนกต้องมี 2–10 ตัว")
    .max(10, "รหัสแผนกต้องมี 2–10 ตัว")
    .regex(/^[A-Z0-9]+$/, "รหัสแผนกใช้ได้เฉพาะตัวอักษรภาษาอังกฤษและตัวเลข"),
  description,
});
export type DepartmentInput = z.infer<typeof departmentInputSchema>;

/**
 * The code is fixed once created, for one department in particular: receipts
 * and orders fall back to the department whose code is `MAIN`
 * (goods-receipt.ts / purchase-order.ts, resolveDefaultDepartmentId). Letting
 * that code change would silently move the fallback to whichever department
 * happens to be oldest.
 */
export const updateDepartmentInputSchema = z.object({
  id: z.string().uuid("แผนกไม่ถูกต้อง"),
  name,
  description,
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentInputSchema>;

export const setDepartmentActiveInputSchema = z.object({
  id: z.string().uuid("แผนกไม่ถูกต้อง"),
  isActive: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
});
export type SetDepartmentActiveInput = z.infer<typeof setDepartmentActiveInputSchema>;

export const DEPARTMENT_FIELD_LABELS_TH: Record<string, string> = {
  name: "ชื่อแผนก",
  code: "รหัสแผนก",
  description: "คำอธิบาย",
};

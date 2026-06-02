// ============================================================
// Mise — SupplierProductMapping input validation (Sprint 1 Part 8 L2)
// ============================================================
// Single zod schema for create + update of a supplier-product price mapping.
// Field ranges per grill Q8; the one cross-field rule is effectiveTo >
// effectiveFrom (Q4). `tenantId` is NOT here — it comes from requireTenant
// server-side (mirrors product.ts). `effectiveFrom` is REQUIRED here (Q1; the
// "default today" is a UI pre-fill, not a zod default). The orderUnit-belongs-
// to-product guard is a DB lookup → enforced in the *Logic layer (L3), not here.
// Error messages are Thai (shown to user); code is English.
// ============================================================

import { z } from "zod";

/**
 * A missing/blank field means "not provided" → null. Covers undefined, null,
 * and ""/whitespace — same helper as src/lib/validations/product.ts, so a
 * missing optional becomes null instead of failing a `.nullable()` field.
 */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/**
 * Checkbox/string → boolean. Only "true" / true / "on" are truthy: `z.coerce
 * .boolean` treats the non-empty string "false" as `true`, so it cannot be
 * used for a tri-source ("true"/"false"/"on") flag.
 */
const isPreferredPreprocess = (v: unknown) =>
  v === "true" || v === true || v === "on";

export const supplierProductMappingInputSchema = z
  .object({
    supplierId: z.string().uuid("ซัพพลายเออร์ไม่ถูกต้อง"),
    productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
    branchId: z.preprocess(
      blankToNull,
      z.string().uuid("สาขาไม่ถูกต้อง").nullable()
    ),
    supplierItemCode: z.preprocess(
      blankToNull,
      z.string().max(64, "รหัสซัพยาวเกิน 64 ตัวอักษร").nullable()
    ),
    supplierItemName: z.preprocess(
      blankToNull,
      z.string().max(200, "ชื่อซัพยาวเกิน 200 ตัวอักษร").nullable()
    ),
    orderUnitId: z.preprocess(
      blankToNull,
      z.string().uuid("หน่วยสั่งซื้อไม่ถูกต้อง").nullable()
    ),
    currentUnitPrice: z.preprocess(
      blankToNull,
      z.coerce.number().nonnegative("ราคาต้องไม่ติดลบ").nullable()
    ),
    minOrderQty: z.preprocess(
      blankToNull,
      z.coerce.number().positive("ปริมาณขั้นต่ำต้องมากกว่า 0").nullable()
    ),
    leadTimeDays: z.preprocess(
      blankToNull,
      z.coerce
        .number()
        .int("Lead time ต้องเป็นจำนวนเต็ม")
        .nonnegative("Lead time ต้องไม่ติดลบ")
        .max(365, "Lead time ต้องไม่เกิน 365 วัน")
        .nullable()
    ),
    isPreferred: z.preprocess(isPreferredPreprocess, z.boolean()).default(false),
    effectiveFrom: z.coerce.date({
      required_error: "ต้องระบุวันที่เริ่มมีผล",
      invalid_type_error: "วันที่เริ่มมีผลไม่ถูกต้อง",
    }),
    effectiveTo: z.preprocess(blankToNull, z.coerce.date().nullable()),
  })
  .superRefine((val, ctx) => {
    // Q4: a closed price window must end strictly after it begins.
    if (val.effectiveTo !== null && val.effectiveTo !== undefined) {
      if (val.effectiveTo <= val.effectiveFrom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "วันที่สิ้นสุดต้องมาหลังวันที่เริ่มมีผล",
          path: ["effectiveTo"],
        });
      }
    }
  });

export type SupplierProductMappingInput = z.infer<
  typeof supplierProductMappingInputSchema
>;

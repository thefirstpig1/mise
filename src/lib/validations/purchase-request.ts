// ============================================================
// Mise — purchase request validation (Part 38, ADR 0036)
// ============================================================
// What the kitchen and the purchaser may send. Ownership (branch, product,
// unit, department, supplier belong to the tenant; the unit to the product)
// and status (only a waiting line changes) are checked in L3.
// Error messages are Thai (shown to the user); code is English.
// ============================================================

import { z } from "zod";

const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v;

const withinDecimals = (places: number) => (n: number) => Number(n.toFixed(places)) === n;
const QTY_MAX = 999_999_999_999.999;

const qty = z.coerce
  .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
  .positive("จำนวนต้องมากกว่า 0")
  .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
  .refine(withinDecimals(3), "จำนวนมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง");

const optionalQty = z.preprocess(
  blankToNull,
  z.coerce
    .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
    .min(0, "จำนวนต้องไม่ติดลบ")
    .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
    .refine(withinDecimals(3), "จำนวนมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง")
    .nullable()
);

const note = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `ข้อความต้องไม่เกิน ${max} ตัวอักษร`).nullable());

export const addRequestLineInputSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  productId: z.string().uuid("กรุณาเลือกวัตถุดิบ"),
  qty,
  unitId: z.string().uuid("กรุณาเลือกหน่วย"),
  departmentId: z.preprocess(blankToNull, z.string().uuid("แผนกไม่ถูกต้อง").nullable()).optional(),
  /** "auto" = let the system propose (Q11); "" = ให้จัดซื้อเลือก. */
  supplierId: z.union([z.literal("auto"), z.preprocess(blankToNull, z.string().uuid("ผู้ขายไม่ถูกต้อง").nullable())]),
  onHandQty: optionalQty,
  note: note(300),
  acknowledgeDuplicate: z.boolean().default(false),
});
export type AddRequestLineInput = z.infer<typeof addRequestLineInputSchema>;

export const updateRequestLineInputSchema = z.object({
  lineId: z.string().uuid(),
  qty,
  unitId: z.string().uuid("กรุณาเลือกหน่วย"),
  departmentId: z.preprocess(blankToNull, z.string().uuid("แผนกไม่ถูกต้อง").nullable()).optional(),
  supplierId: z.preprocess(blankToNull, z.string().uuid("ผู้ขายไม่ถูกต้อง").nullable()),
  onHandQty: optionalQty,
  note: note(300),
});

export const lineIdSchema = z.object({ lineId: z.string().uuid() });

export const readyInputSchema = z.object({
  branchId: z.string().uuid(),
  departmentId: z.string().uuid(),
  ready: z.boolean(),
});

export const messageInputSchema = z.object({
  lineId: z.string().uuid(),
  body: z.string().trim().min(1, "พิมพ์ข้อความก่อนส่ง").max(500, "ข้อความต้องไม่เกิน 500 ตัวอักษร"),
});

export const rejectInputSchema = z.object({
  lineId: z.string().uuid(),
  reason: z.string().trim().min(1, "กรุณาบอกเหตุผลที่ไม่สั่ง").max(300, "เหตุผลต้องไม่เกิน 300 ตัวอักษร"),
});

export const reopenInputSchema = z.object({ lineId: z.string().uuid(), why: note(300) });

export const cutRoundInputSchema = z.object({
  branchId: z.string().uuid(),
  picks: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        supplierId: z.string().uuid("กรุณาเลือกผู้ขาย"),
        qty,
        unitId: z.string().uuid(),
        unitPrice: z.coerce
          .number({ invalid_type_error: "ราคาไม่ถูกต้อง" })
          .min(0, "ราคาต้องไม่ติดลบ")
          .max(99_999_999_999.9999)
          .refine(withinDecimals(4), "ราคามีทศนิยมได้ไม่เกิน 4 ตำแหน่ง"),
        reply: note(500),
      })
    )
    .min(1, "เลือกอย่างน้อย 1 รายการ")
    .max(200, "ตัดรอบได้ครั้งละไม่เกิน 200 รายการ"),
});

export const deliveryPromiseInputSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  promisedDate: z.coerce.date({ invalid_type_error: "วันที่ไม่ถูกต้อง" }),
  note: note(300),
});

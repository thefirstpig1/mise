// ============================================================
// คิดครัว — what a self-purchase looks like on the wire (ADR 0037 Q5–Q6)
// ============================================================

import { z } from "zod";

const money = z.coerce
  .number({ invalid_type_error: "ยอดเงินไม่ถูกต้อง" })
  .positive("ยอดเงินต้องมากกว่า 0")
  .max(10_000_000, "ยอดเงินเกินค่าที่ระบบรองรับ")
  .refine((n) => Number(n.toFixed(2)) === n, "ยอดเงินมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง");

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** Something that goes on the shelf — becomes a goods-receipt line. */
export const selfPurchaseStockLineSchema = z.object({
  productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
  unitId: z.string().uuid("หน่วยไม่ถูกต้อง"),
  qty: z.coerce
    .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
    .positive("จำนวนต้องมากกว่า 0")
    .max(1_000_000, "จำนวนเกินค่าที่ระบบรองรับ")
    .refine((n) => Number(n.toFixed(3)) === n, "จำนวนมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง"),
  /** What the bill says for this line — the unit price is derived from it. */
  lineTotal: money,
  purchaseRequestLineId: z.preprocess(blank, z.string().uuid().nullable()).default(null),
});

/** Something that does not — ice, gas, bags: a category on the bill. */
export const selfPurchaseOtherLineSchema = z.object({
  categoryId: z.string().uuid("หมวดไม่ถูกต้อง"),
  description: z.string().trim().min(1, "ต้องระบุว่าซื้ออะไร").max(200, "ไม่เกิน 200 ตัวอักษร"),
  lineTotal: money,
});

export const selfPurchaseInputSchema = z
  .object({
    /** One uuid per form, kept across retries: replaying it returns what was saved. */
    submitKey: z.string().uuid(),
    branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
    /** YYYY-MM-DD, Bangkok. */
    billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ไม่ถูกต้อง"),
    supplierId: z.preprocess(blank, z.string().uuid().nullable()).default(null),
    vendorName: z.preprocess(blank, z.string().trim().max(120, "ชื่อร้านไม่เกิน 120 ตัวอักษร").nullable()).default(null),
    billNo: z.preprocess(blank, z.string().trim().max(64).nullable()).default(null),
    stockLines: z.array(selfPurchaseStockLineSchema).max(60).default([]),
    otherLines: z.array(selfPurchaseOtherLineSchema).max(60).default([]),
    payer: z.enum(["STAFF", "SHOP"]),
    method: z.enum(["TRANSFER", "CASH", "CARD", "OTHER"]),
    noSlipReason: z.preprocess(blank, z.string().trim().max(300).nullable()).default(null),
    billFileIds: z.array(z.string().uuid()).max(6).default([]),
    slipFileIds: z.array(z.string().uuid()).max(3).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.stockLines.length + v.otherLines.length === 0) {
      ctx.addIssue({ code: "custom", path: ["stockLines"], message: "ต้องมีอย่างน้อย 1 รายการ" });
    }
    if (!v.supplierId && !v.vendorName) {
      ctx.addIssue({ code: "custom", path: ["vendorName"], message: "ต้องระบุว่าซื้อที่ไหน" });
    }
  });

export type SelfPurchaseInput = z.infer<typeof selfPurchaseInputSchema>;

export const METHOD_TH = { TRANSFER: "โอน", CASH: "เงินสด", CARD: "บัตร", OTHER: "อื่น ๆ" } as const;

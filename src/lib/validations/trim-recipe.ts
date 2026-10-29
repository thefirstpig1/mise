// ============================================================
// Mise — trim recipe input schemas (ADR 0040 Q7)
// ============================================================
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import { trimPartsProblem } from "@/lib/trim-recipe";

const blankToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

export const trimPartInputSchema = z.object({
  productId: z.preprocess(blankToNull, z.string().uuid("สินค้าไม่ถูกต้อง").nullable()),
  /** Name of a thrown-away part (scales, guts). A kept part reads its product's. */
  label: z.preprocess(blankToNull, z.string().trim().max(100, "ชื่อยาวเกินไป").nullable()),
  weightPct: z.coerce.number({ invalid_type_error: "เปอร์เซ็นต์ไม่ถูกต้อง" }).gt(0, "ต้องมากกว่า 0%").max(100, "ไม่เกิน 100%"),
  valuePct: z.coerce.number({ invalid_type_error: "เปอร์เซ็นต์ไม่ถูกต้อง" }).min(0, "ไม่ต่ำกว่า 0%").max(100, "ไม่เกิน 100%"),
  locked: z.coerce.boolean().default(false),
});

export type TrimPartInput = z.infer<typeof trimPartInputSchema>;

/**
 * Save a trim recipe. `id` is the form's submit key on create and the recipe's
 * id on edit — an edit replaces every part, because a part list is one
 * decision and saving half of it would be a recipe nobody wrote.
 */
export const saveTrimRecipeInputSchema = z
  .object({
    id: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
    parentProductId: z.string().uuid("กรุณาเลือกของที่ซื้อมาทั้งชิ้น"),
    name: z.string().trim().min(1, "กรุณาตั้งชื่อสูตรตัดแต่ง").max(100, "ชื่อยาวเกินไป"),
    notes: z.preprocess(blankToNull, z.string().max(500, "หมายเหตุยาวเกินไป").nullable().optional()),
    parts: z.array(trimPartInputSchema).min(1, "ต้องมีอย่างน้อย 1 ส่วน").max(30, "ได้ไม่เกิน 30 ส่วน"),
  })
  .superRefine((v, ctx) => {
    const problem = trimPartsProblem(v.parts);
    if (problem) ctx.addIssue({ code: "custom", path: ["parts"], message: problem });
    if (v.parts.some((p) => p.productId === null && !p.label)) {
      ctx.addIssue({ code: "custom", path: ["parts"], message: "ส่วนที่ทิ้งต้องมีชื่อ เช่น เกล็ด เครื่องใน" });
    }
    if (v.parts.some((p) => p.productId === v.parentProductId)) {
      ctx.addIssue({ code: "custom", path: ["parts"], message: "ส่วนที่ได้ต้องไม่ใช่ของทั้งชิ้นเอง" });
    }
  });

export type SaveTrimRecipeInput = z.infer<typeof saveTrimRecipeInputSchema>;

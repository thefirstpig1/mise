// ============================================================
// Mise — production input schemas (ADR 0040)
// ============================================================
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";

/**
 * Q5: a production may be recorded up to 7 days late. Shops forget, and a
 * window this short keeps the re-post a backdate triggers to at most a week of
 * sales days. Deliberately NOT the ledger's 90 days (`MAX_BACKDATE_DAYS`): that
 * is how late a RECEIPT may arrive, and a receipt re-posts nothing.
 */
export const PRODUCTION_BACKDATE_DAYS = 7;

const QTY_MAX = 1_000_000;
const hasAtMostThreeDecimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

const blankToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

/** One input used or one output made, in the unit the person chose. */
export const productionLineSchema = z.object({
  productId: z.string().uuid("สินค้าไม่ถูกต้อง"),
  inputQty: z.coerce
    .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
    .positive("จำนวนต้องมากกว่า 0")
    .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
    .refine(hasAtMostThreeDecimals, "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
  inputUnitId: z.string().uuid("หน่วยไม่ถูกต้อง"),
});

export type ProductionLineInput = z.infer<typeof productionLineSchema>;

/**
 * Record one production (Q3) or one trim (Q7).
 *
 * `submitKey` IS the production's id (Part 13.5): a double-tap resolves to the
 * same document instead of making the soup twice.
 *
 * `producedOn` is a Bangkok business DAY. Today means "now"; an earlier day
 * means the start of that day, so what was made that morning is on the shelf
 * for the same day's sales (the server decides which — see the logic).
 */
export const createProductionInputSchema = z
  .object({
    submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
    branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
    kind: z.enum(["PRODUCE", "TRIM"], {
      errorMap: () => ({ message: "ชนิดการผลิตไม่ถูกต้อง" }),
    }),
    producedOn: z.coerce
      .date({ required_error: "ต้องระบุวันที่", invalid_type_error: "วันที่ไม่ถูกต้อง" })
      .refine((d) => d.getTime() < addDays(computeBangkokToday(), 1).getTime(), {
        message: "วันที่ต้องไม่เป็นอนาคต",
      })
      .refine(
        (d) =>
          d.getTime() >= addDays(computeBangkokToday(), -PRODUCTION_BACKDATE_DAYS).getTime(),
        { message: `บันทึกย้อนหลังได้ไม่เกิน ${PRODUCTION_BACKDATE_DAYS} วัน` }
      ),
    recipeId: z.preprocess(blankToNull, z.string().uuid("สูตรไม่ถูกต้อง").nullable().optional()),
    trimRecipeId: z.preprocess(
      blankToNull,
      z.string().uuid("สูตรตัดแต่งไม่ถูกต้อง").nullable().optional()
    ),
    inputs: z.array(productionLineSchema).min(1, "ต้องมีวัตถุดิบอย่างน้อย 1 รายการ").max(50),
    outputs: z.array(productionLineSchema).min(1, "ต้องมีของที่ได้อย่างน้อย 1 รายการ").max(30),
    notes: z.preprocess(blankToNull, z.string().max(500, "หมายเหตุยาวเกินไป").nullable().optional()),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "PRODUCE" && v.outputs.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["outputs"], message: "การผลิตได้ของหนึ่งอย่าง" });
    }
    if (v.kind === "TRIM") {
      if (v.inputs.length !== 1) {
        ctx.addIssue({ code: "custom", path: ["inputs"], message: "การตัดแต่งใช้ของหนึ่งอย่าง" });
      }
      if (!v.trimRecipeId) {
        ctx.addIssue({ code: "custom", path: ["trimRecipeId"], message: "กรุณาเลือกสูตรตัดแต่ง" });
      }
    }
    if (v.kind === "PRODUCE" && v.trimRecipeId) {
      ctx.addIssue({ code: "custom", path: ["trimRecipeId"], message: "สูตรตัดแต่งใช้กับการตัดแต่งเท่านั้น" });
    }
    if (v.kind === "TRIM" && v.recipeId) {
      ctx.addIssue({ code: "custom", path: ["recipeId"], message: "สูตรผลิตใช้กับการผลิตเท่านั้น" });
    }
    const dup = (lines: ProductionLineInput[]) =>
      new Set(lines.map((l) => l.productId)).size !== lines.length;
    if (dup(v.inputs)) {
      ctx.addIssue({ code: "custom", path: ["inputs"], message: "มีวัตถุดิบซ้ำกัน" });
    }
    if (dup(v.outputs)) {
      ctx.addIssue({ code: "custom", path: ["outputs"], message: "มีของที่ได้ซ้ำกัน" });
    }
    const ins = new Set(v.inputs.map((l) => l.productId));
    if (v.outputs.some((o) => ins.has(o.productId))) {
      ctx.addIssue({
        code: "custom",
        path: ["outputs"],
        message: "ของที่ได้ต้องไม่ใช่ของที่ใช้ทำ",
      });
    }
  });

export type CreateProductionInput = z.infer<typeof createProductionInputSchema>;

export const voidProductionInputSchema = z.object({
  id: z.string().uuid("เอกสารไม่ถูกต้อง"),
  reason: z.preprocess(blankToNull, z.string().max(300, "เหตุผลยาวเกินไป").nullable().optional()),
});

export type VoidProductionInput = z.infer<typeof voidProductionInputSchema>;

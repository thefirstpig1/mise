"use server";

// คิดครัว — save the reviewed recipes as DRAFTS (คิวงานข้อ 5d). Nothing moves
// stock or cost until the shop presses "ใช้สูตร" in ทดลองเมนู. A shop-made
// component's recipe (น้ำซุป) is written live as a production recipe (Kong
// 2026-10-30). The screen judged the list with src/lib/recipe-import.ts; the
// server checks every reference.

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { MAX_RECIPE_ROWS } from "@/lib/recipe-import";
import { RecipeImportRefError, importRecipesLogic } from "@/server/recipe-import";
import { UnitNeedsRatioError } from "@/server/product";
import { RecipeAlreadyExistsError } from "@/server/recipe";
import { ProductTypeChangeBlockedError, RecipeMethodConflictError, RecipeOutputNotPreppedError } from "@/server/recipe-guards";
import { RecipeCycleError, RecipeDepthExceededError } from "@/server/recipe-graph";

const ref = z.string().min(1).max(300);
const target = z.union([z.object({ id: z.string().uuid() }), z.object({ ref })]);
const lines = z
  .array(
    z.object({
      product: target,
      unitName: z.string().trim().min(1).max(40),
      ratio: z.number().positive().max(1_000_000).nullable(),
      qty: z.number().positive().max(1_000_000),
      note: z.string().max(300).nullable(),
    })
  )
  .min(1)
  .max(200);
const saveSchema = z
  .object({
    newMenus: z.array(z.object({ ref, name: z.string().trim().min(1).max(200) })).max(MAX_RECIPE_ROWS),
    newProducts: z
      .array(z.object({ ref, name: z.string().trim().min(1).max(200), baseUnitName: z.string().trim().min(1).max(40), prepped: z.boolean() }))
      .max(MAX_RECIPE_ROWS),
    convert: z.array(z.string().uuid()).max(MAX_RECIPE_ROWS),
    recipes: z.array(z.object({ menu: target, servings: z.number().positive().max(100_000), lines })).max(MAX_RECIPE_ROWS),
    // In the output's base unit: 20 litres of stock counted in ml is 20,000.
    made: z.array(z.object({ output: target, servings: z.number().positive().max(100_000_000), lines })).max(MAX_RECIPE_ROWS),
  })
  .refine((s) => s.recipes.length + s.made.length > 0);

export type ImportRecipesState =
  | { ok: true; drafts: number; made: number; madeFrom: string; menusCreated: number; productsCreated: number; productsConverted: number; unitsAdded: number }
  | { ok: false; formError: string };

export async function importRecipesAction(save: unknown): Promise<ImportRecipesState> {
  const { tenantId, user, can, canEditShared } = await requireTenant("recipe:draft");
  const parsed = saveSchema.safeParse(save);
  if (!parsed.success) return { ok: false, formError: "ข้อมูลบางบรรทัดไม่ครบ — ตรวจแถวที่มีสีแดงแล้วลองอีกครั้ง" };
  if ((parsed.data.newProducts.length > 0 || parsed.data.convert.length > 0) && !can("master:write")) {
    return { ok: false, formError: "บัญชีนี้สร้างหรือแก้วัตถุดิบไม่ได้ — เลือกวัตถุดิบที่มีอยู่ หรือให้เจ้าของร้านนำเข้าวัตถุดิบก่อน" };
  }
  // A production recipe is live and shared by every branch — the gate
  // createRecipeAction holds, not the draft one this page opens with.
  if (parsed.data.made.length > 0 && !(can("recipe:write") && canEditShared)) {
    return { ok: false, formError: "บัญชีนี้บันทึกสูตรของที่ร้านทำเองไม่ได้ — ให้เจ้าของร้านหรือผู้ดูแลทุกสาขานำเข้า หรือกดข้ามสูตรเหล่านั้น" };
  }
  try {
    const out = await importRecipesLogic(tenantId, parsed.data, user.id!);
    revalidatePath("/menus");
    revalidatePath("/menus/lab");
    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { ok: true, ...out };
  } catch (e) {
    if (e instanceof UnitNeedsRatioError) return { ok: false, formError: `หน่วย “${e.unitName}” ต้องบอกขนาดก่อน (1 ${e.unitName} = กี่หน่วยนับ)` };
    if (e instanceof RecipeImportRefError) return { ok: false, formError: "ข้อมูลร้านเปลี่ยนไประหว่างนี้ — รีเฟรชหน้าแล้วอัปโหลดใหม่" };
    // A shop-made recipe meets the recipe form's own rules; name which thing.
    if (e instanceof RecipeMethodConflictError) return { ok: false, formError: `“${e.productName}” ทำด้วยวิธีอื่นอยู่แล้ว (ตัดแต่งจากของอื่น) — ข้ามสูตรนี้ แล้วแก้ที่หน้าสินค้า` };
    if (e instanceof RecipeOutputNotPreppedError) return { ok: false, formError: `“${e.productName}” ยังไม่ได้เป็นของที่ร้านทำเอง — รีเฟรชหน้าแล้วอัปโหลดใหม่` };
    if (e instanceof RecipeAlreadyExistsError) return { ok: false, formError: "มีคนเพิ่มสูตรผลิตของบางอย่างในไฟล์นี้ระหว่างนี้ — รีเฟรชหน้าแล้วอัปโหลดใหม่" };
    if (e instanceof ProductTypeChangeBlockedError) return { ok: false, formError: "ข้อมูลร้านเปลี่ยนไประหว่างนี้ — รีเฟรชหน้าแล้วอัปโหลดใหม่" };
    if (e instanceof RecipeCycleError) return { ok: false, formError: "บันทึกไม่ได้ — สูตรของที่ร้านทำเองวนกลับมาหาตัวเอง (ของหนึ่งกลายเป็นวัตถุดิบของตัวเอง)" };
    if (e instanceof RecipeDepthExceededError) return { ok: false, formError: "บันทึกไม่ได้ — สูตรซ้อนกันเกิน 5 ชั้น" };
    if (e instanceof ZodError) return { ok: false, formError: "สูตรของที่ร้านทำเองบางสูตรบันทึกไม่ได้ — ตรวจปริมาณที่เล็กมาก ๆ หรือวัตถุดิบเกิน 100 บรรทัด" };
    console.error("[menus/import] save failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ ยังไม่มีอะไรถูกบันทึก — กรุณาลองใหม่" };
  }
}

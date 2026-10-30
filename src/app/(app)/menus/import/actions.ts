"use server";

// คิดครัว — save the reviewed recipes as DRAFTS (คิวงานข้อ 5d). Nothing moves
// stock or cost until the shop presses "ใช้สูตร" in ทดลองเมนู. The screen judged
// the list with src/lib/recipe-import.ts; the server checks every reference.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { MAX_RECIPE_ROWS } from "@/lib/recipe-import";
import { RecipeImportRefError, importRecipesLogic } from "@/server/recipe-import";
import { UnitNeedsRatioError } from "@/server/product";

const ref = z.string().min(1).max(300);
const target = z.union([z.object({ id: z.string().uuid() }), z.object({ ref })]);
const saveSchema = z.object({
  newMenus: z.array(z.object({ ref, name: z.string().trim().min(1).max(200) })).max(MAX_RECIPE_ROWS),
  newProducts: z.array(z.object({ ref, name: z.string().trim().min(1).max(200), baseUnitName: z.string().trim().min(1).max(40) })).max(MAX_RECIPE_ROWS),
  recipes: z
    .array(
      z.object({
        menu: target,
        servings: z.number().positive().max(100_000),
        lines: z
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
          .max(200),
      })
    )
    .min(1)
    .max(MAX_RECIPE_ROWS),
});

export type ImportRecipesState =
  | { ok: true; drafts: number; menusCreated: number; productsCreated: number; unitsAdded: number }
  | { ok: false; formError: string };

export async function importRecipesAction(save: unknown): Promise<ImportRecipesState> {
  const { tenantId, user, can } = await requireTenant("recipe:draft");
  const parsed = saveSchema.safeParse(save);
  if (!parsed.success) return { ok: false, formError: "ข้อมูลบางบรรทัดไม่ครบ — ตรวจแถวที่มีสีแดงแล้วลองอีกครั้ง" };
  if (parsed.data.newProducts.length > 0 && !can("master:write")) {
    return { ok: false, formError: "บัญชีนี้สร้างวัตถุดิบใหม่ไม่ได้ — เลือกวัตถุดิบที่มีอยู่ หรือให้เจ้าของร้านนำเข้าวัตถุดิบก่อน" };
  }
  try {
    const out = await importRecipesLogic(tenantId, parsed.data, user.id!);
    revalidatePath("/menus");
    revalidatePath("/menus/lab");
    revalidatePath("/dashboard");
    return { ok: true, ...out };
  } catch (e) {
    if (e instanceof UnitNeedsRatioError) return { ok: false, formError: `หน่วย “${e.unitName}” ต้องบอกขนาดก่อน (1 ${e.unitName} = กี่หน่วยนับ)` };
    if (e instanceof RecipeImportRefError) return { ok: false, formError: "ข้อมูลร้านเปลี่ยนไประหว่างนี้ — รีเฟรชหน้าแล้วอัปโหลดใหม่" };
    console.error("[menus/import] save failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ ยังไม่มีอะไรถูกบันทึก — กรุณาลองใหม่" };
  }
}

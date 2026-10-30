"use server";

// คิดครัว — save the reviewed import (คิวงานข้อ 5). The list was judged on the
// review screen with src/lib/product-import.ts; importProductsLogic judges it
// again, because the screen is a convenience and the server is the rule.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { MAX_IMPORT_ROWS } from "@/lib/product-import";
import { ImportCategoryError, ImportUnitError, importProductsLogic } from "@/server/product-import";

const rowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  baseUnitName: z.string().trim().min(1).max(40),
  categoryId: z.string().uuid().nullable(),
  extraUnit: z
    .object({
      unitName: z.string().trim().min(1).max(40),
      toBaseRatio: z.number().positive().max(1_000_000),
    })
    .nullable(),
  prepped: z.boolean().default(false),
});
const inputSchema = z.array(rowSchema).min(1).max(MAX_IMPORT_ROWS);

export type ImportProductsState =
  | { ok: true; created: number; skipped: string[] }
  | { ok: false; formError: string };

export async function importProductsAction(rows: unknown): Promise<ImportProductsState> {
  const { tenantId } = await requireTenant("master:write");
  const parsed = inputSchema.safeParse(rows);
  if (!parsed.success) return { ok: false, formError: "ข้อมูลบางแถวไม่ครบ — ตรวจแถวที่มีสีแดงแล้วลองอีกครั้ง" };
  try {
    const out = await importProductsLogic(tenantId, parsed.data);
    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { ok: true, created: out.created.length, skipped: out.skipped };
  } catch (e) {
    if (e instanceof ImportUnitError) return { ok: false, formError: `หน่วย “${e.unitName}” ใช้เป็นหน่วยนับสต๊อกไม่ได้ — เลือกจากรายการ` };
    if (e instanceof ImportCategoryError) return { ok: false, formError: "หมวดที่เลือกบางรายการถูกลบไปแล้ว — รีเฟรชหน้าแล้วลองใหม่" };
    console.error("[products/import] save failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ ยังไม่มีรายการไหนถูกบันทึก — กรุณาลองใหม่" };
  }
}

// ============================================================
// คิดครัว — recipes from a file (คิวงานข้อ 5d)
// ============================================================
// POST multipart: file (.xlsx / .csv) OR text (a table pasted from the AI)
//      → the recipe rows + what to match them against. WRITES NOTHING.
// The file is the SAME one the ingredient import reads (sheet "สูตร"). The
// save is the Server Action in menus/import/actions.ts.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { RECIPE_TABLE_ERROR_TH } from "@/lib/recipe-import";
import { MAX_IMPORT_FILE_BYTES } from "@/server/product-import";
import { getRecipeContextLogic, readRecipeFile, readRecipeText } from "@/server/recipe-import";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const refuse = (formError: string, status = 400) => json({ ok: false, formError }, status);

export async function POST(req: Request) {
  const { tenantId, can } = await requireTenant("recipe:draft");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refuse("อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่");
  }
  const file = form.get("file");
  const text = form.get("text");
  let table;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMPORT_FILE_BYTES) return refuse(`ไฟล์ใหญ่เกิน ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB — แบ่งเป็นหลายไฟล์`);
    table = await readRecipeFile(new Uint8Array(await file.arrayBuffer()), file.name || "");
    if ("error" in table) {
      return refuse(
        table.error === "UNSUPPORTED"
          ? "รองรับไฟล์ Excel (.xlsx) และ CSV — ถ้าได้ผลลัพธ์เป็นตาราง ให้กด “วางตารางแทน”"
          : "เปิดไฟล์นี้ไม่ได้ — ลองบันทึกเป็น .xlsx ใหม่ หรือคัดลอกตารางมาวางแทน"
      );
    }
  } else if (typeof text === "string" && text.trim() !== "") {
    if (text.length > MAX_IMPORT_FILE_BYTES) return refuse("ข้อความยาวเกินไป — แบ่งวางทีละส่วน");
    table = readRecipeText(text);
  } else {
    return refuse("ยังไม่ได้เลือกไฟล์หรือวางตาราง");
  }

  if (!table.ok) return refuse(RECIPE_TABLE_ERROR_TH[table.reason]);
  try {
    return json({ ok: true, rows: table.rows, context: await getRecipeContextLogic(tenantId, can("master:write")) });
  } catch (e) {
    console.error("[menus/import] context failed", e);
    return refuse("อ่านข้อมูลร้านไม่สำเร็จ กรุณาลองใหม่", 500);
  }
}

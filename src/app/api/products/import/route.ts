// ============================================================
// คิดครัว — products from a file (คิวงานข้อ 5)
// ============================================================
// GET  ?what=template   the blank .xlsx for a shop that fills it by hand
// POST multipart: file (.xlsx / .csv) OR text (a table pasted from the AI)
//      → the rows read + what to match them against. WRITES NOTHING.
//
// A route, not a Server Action: an action's body is capped at 1 MB, and a read
// made after paint goes through a route (mise-ui-review §5c). The save is the
// Server Action in products/import/actions.ts.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead } from "@/lib/read-api";
import { TABLE_ERROR_TH } from "@/lib/product-import";
import {
  MAX_IMPORT_FILE_BYTES,
  buildImportTemplate,
  getImportContextLogic,
  readImportFile,
  readPastedText,
} from "@/server/product-import";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const refuse = (formError: string, status = 400) => json({ ok: false, formError }, status);

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    if (url.searchParams.get("what") !== "template") return refuse("คำขอไม่ถูกต้อง");
    await requireTenant("master:write");
    const bytes = await buildImportTemplate();
    return new Response(new Blob([bytes as BlobPart]), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="kitkrua-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent("แม่แบบนำเข้า-คิดครัว.xlsx")}`,
        "Cache-Control": "no-store",
      },
    });
  });
}

export async function POST(req: Request) {
  const { tenantId } = await requireTenant("master:write");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refuse("อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่");
  }

  const file = form.get("file");
  const text = form.get("text");
  let read;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMPORT_FILE_BYTES) return refuse(`ไฟล์ใหญ่เกิน ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB — แบ่งเป็นหลายไฟล์`);
    read = await readImportFile(new Uint8Array(await file.arrayBuffer()), file.name || "");
    if ("error" in read) {
      return refuse(
        read.error === "UNSUPPORTED"
          ? "รองรับไฟล์ Excel (.xlsx) และ CSV — ถ้าได้ผลลัพธ์เป็นตาราง ให้กด “วางตารางแทน”"
          : "เปิดไฟล์นี้ไม่ได้ — ลองบันทึกเป็น .xlsx ใหม่ หรือคัดลอกตารางมาวางแทน"
      );
    }
  } else if (typeof text === "string" && text.trim() !== "") {
    if (text.length > MAX_IMPORT_FILE_BYTES) return refuse("ข้อความยาวเกินไป — แบ่งวางทีละส่วน");
    read = readPastedText(text);
  } else {
    return refuse("ยังไม่ได้เลือกไฟล์หรือวางตาราง");
  }

  if (!read.table.ok) return refuse(TABLE_ERROR_TH[read.table.reason]);
  try {
    const context = await getImportContextLogic(tenantId);
    return json({ ok: true, rows: read.table.rows, recipeMenus: read.recipeMenus, context });
  } catch (e) {
    console.error("[products/import] context failed", e);
    return refuse("อ่านข้อมูลร้านไม่สำเร็จ กรุณาลองใหม่", 500);
  }
}

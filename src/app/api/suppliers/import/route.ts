// ============================================================
// คิดครัว — past purchase bills (คิวงานข้อ 5c)
// ============================================================
// GET  ?what=template   the blank .xlsx
// POST multipart: file (.xlsx / .csv) OR text (a table pasted from the AI)
//      → the rows read + what to match them against. WRITES NOTHING.
// The save is the Server Action in suppliers/import/actions.ts.
// ============================================================

import ExcelJS from "exceljs";
import { requireTenant } from "@/lib/require-tenant";
import { guardRead } from "@/lib/read-api";
import { BILL_COLUMNS, BILL_SHEET, BILL_TABLE_ERROR_TH } from "@/lib/bill-import";
import { getBillContextLogic, readBillFile, readBillText } from "@/server/bill-import";
import { MAX_IMPORT_FILE_BYTES } from "@/server/product-import";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const refuse = (formError: string, status = 400) => json({ ok: false, formError }, status);

export function GET(req: Request) {
  return guardRead(async () => {
    if (new URL(req.url).searchParams.get("what") !== "template") return refuse("คำขอไม่ถูกต้อง");
    await requireTenant("master:write");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(BILL_SHEET);
    ws.addRow(Object.values(BILL_COLUMNS));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 16));
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    return new Response(new Blob([bytes as BlobPart]), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="kitkrua-bills-template.xlsx"; filename*=UTF-8''${encodeURIComponent("แม่แบบบิลซื้อ-คิดครัว.xlsx")}`,
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
  let table;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMPORT_FILE_BYTES) return refuse(`ไฟล์ใหญ่เกิน ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB — แบ่งเป็นหลายไฟล์`);
    table = await readBillFile(new Uint8Array(await file.arrayBuffer()), file.name || "");
    if ("error" in table) {
      return refuse(
        table.error === "UNSUPPORTED"
          ? "รองรับไฟล์ Excel (.xlsx) และ CSV — ถ้าได้ผลลัพธ์เป็นตาราง ให้กด “วางตารางแทน”"
          : "เปิดไฟล์นี้ไม่ได้ — ลองบันทึกเป็น .xlsx ใหม่ หรือคัดลอกตารางมาวางแทน"
      );
    }
  } else if (typeof text === "string" && text.trim() !== "") {
    if (text.length > MAX_IMPORT_FILE_BYTES) return refuse("ข้อความยาวเกินไป — แบ่งวางทีละส่วน");
    table = readBillText(text);
  } else {
    return refuse("ยังไม่ได้เลือกไฟล์หรือวางตาราง");
  }

  if (!table.ok) return refuse(BILL_TABLE_ERROR_TH[table.reason]);
  try {
    return json({ ok: true, rows: table.rows, context: await getBillContextLogic(tenantId) });
  } catch (e) {
    console.error("[suppliers/import] context failed", e);
    return refuse("อ่านข้อมูลร้านไม่สำเร็จ กรุณาลองใหม่", 500);
  }
}

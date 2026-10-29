// ============================================================
// คิดครัว — writes the month-end file (Kong 2026-10-29)
// ============================================================
// The cells come from src/lib/accounting-formats.ts — the same functions the
// export dialog previews — so this file only decides how they are WRITTEN:
// numbers stay numbers (an accountant sums them), money shows two decimals,
// and a CSV carries a BOM so Excel opens Thai as UTF-8.
// ============================================================

import ExcelJS from "exceljs";
import type { AccountingProgram } from "@/lib/validations/accounting-export";
import { programOf, sheetsFor, toCsv, type FileContext, type Sheet } from "@/lib/accounting-formats";

export type MonthEndFile = { body: ArrayBuffer; contentType: string };

function addSheet(wb: ExcelJS.Workbook, sheet: Sheet) {
  const ws = wb.addWorksheet(sheet.name);
  ws.columns = sheet.columns.map((c) => ({ header: c.header, width: c.width ?? 14 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of sheet.rows) ws.addRow(row.map((c) => (c === null ? null : c)));
  sheet.columns.forEach((c, i) => {
    if (c.money) ws.getColumn(i + 1).numFmt = "#,##0.00";
    else if (c.qty) ws.getColumn(i + 1).numFmt = "#,##0.###";
  });
}

export async function writeMonthEndFile(
  program: AccountingProgram,
  ctx: FileContext,
  generatedAt: Date = new Date()
): Promise<MonthEndFile> {
  const sheets = sheetsFor(program, ctx, generatedAt);
  if (programOf(program).ext === "csv") {
    const bytes = new TextEncoder().encode(toCsv(sheets[0]));
    return { body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, contentType: "text/csv; charset=utf-8" };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "คิดครัว";
  wb.created = generatedAt;
  for (const s of sheets) addSheet(wb, s);
  // In Node this is a Buffer — a view that may sit inside a larger pooled
  // ArrayBuffer — so copy it into one that is exactly the file.
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  return {
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

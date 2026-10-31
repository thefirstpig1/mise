// ============================================================
// Mise — a sales file as a table: CSV or Excel (Kong 2026-11-01)
// ============================================================
// Kong approved reading .xlsx for sales ("เอาตามที่แนะนำ", mockup
// 225p68BDqKAZTpd9MqDeph): several Thai POS back offices export Excel, and
// a shop should not need a spreadsheet program to turn it into CSV first.
// ExcelJS is already here for the products import — no new dependency.
//
// Everything after this point reads a `string[][]` and does not know which
// kind of file it came from, so the header fingerprint (rule P11), the
// blank-cell rules and the date rules apply to both unchanged.
//
// The kind is told by the file's first bytes, not its name: an .xlsx is a zip
// ("PK\x03\x04"), and a renamed file is read as what it is.
// ============================================================

import ExcelJS from "exceljs";
import { decodeSalesFile, parseCsv, type FileEncodingValue } from "@/lib/sales-file";

export function isXlsxBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A date cell as text the date parser reads: "yyyy-MM-dd", with " HH:mm" when
 * it holds a time. ExcelJS hands a date cell back as the serial read in UTC,
 * so the UTC parts ARE the wall-clock the POS wrote.
 */
function dateCellText(d: Date): string {
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
  return hasTime ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : day;
}

/**
 * The first sheet that holds anything, as text cells. A number cell is its
 * plain value (never the display format — "1,234.00" would be a second thing
 * to parse); a formula cell is its result; anything else is the cell's text.
 * Returns null when the bytes are not a workbook ExcelJS can open.
 */
export async function readXlsxSalesTable(bytes: Uint8Array): Promise<string[][] | null> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    return null;
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) return [];
  const width = ws.columnCount;
  const table: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      const v = cell.value;
      const value = v !== null && typeof v === "object" && "result" in v ? v.result : v;
      if (value instanceof Date) cells.push(dateCellText(value));
      else if (typeof value === "number") cells.push(String(value));
      else cells.push(cell.text ?? "");
    }
    table.push(cells);
  }
  // Rows past the data that Excel kept for their formatting only.
  while (table.length > 0 && table[table.length - 1].every((c) => c.trim() === "")) table.pop();
  return table;
}

export type SalesTableRead = { ok: true; table: string[][]; excel: boolean } | { ok: false; reason: "UNREADABLE_XLSX" };

/** CSV by the stated encoding, or Excel when the bytes are a workbook. */
export async function readSalesTable(bytes: Uint8Array, encoding: FileEncodingValue): Promise<SalesTableRead> {
  if (!isXlsxBytes(bytes)) return { ok: true, table: parseCsv(decodeSalesFile(bytes, encoding)), excel: false };
  const table = await readXlsxSalesTable(bytes);
  return table === null ? { ok: false, reason: "UNREADABLE_XLSX" } : { ok: true, table, excel: true };
}

export const UNREADABLE_XLSX_MESSAGE = "เปิดไฟล์ Excel นี้ไม่ได้ — ลองบันทึกจาก Excel ใหม่เป็น .xlsx หรือ .csv แล้วอัปอีกครั้ง";

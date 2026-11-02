// ============================================================
// คิดครัว — the shop's own AI maps a POS sales file, once (Kong 2026-11-02, คิวข้อ 11 ก.)
// ============================================================
// Kong: "promptการอัพโหลดไฟล์ยอดขายจากPOS นอกจากจัดformatแล้ว ให้AIมันMAPไว้ให้
// เลยว่า ข้อมูลอะไรอยู่คอลัมน์ไหน ... ให้ระบบจำไว้ตั้งแต่ตอนอัพโหลดครั้งแรก".
// Remembering was already there (sales_import_profile + the header signature);
// this is the other half: the first-import wizard can ask the shop's AI which
// column is which, and the answer comes back as a code the person pastes in.
//
// What keeps it honest — the same stance as every other AI import:
//   - the AI never sends a number. It only POINTS at columns, and page 5 of the
//     wizard reads the file with the real parser and shows each day's total
//     before anything is saved;
//   - every column is named twice, by position AND by header text, and both
//     must agree with the file that was uploaded. A position that disagrees
//     with its name, or a name the file does not have, is refused and shown;
//   - the AI is told to answer null rather than guess, and to say why;
//   - nothing it says is a default: each answer arrives labelled
//     "AI เลือกให้ · ตรวจอีกครั้ง" and the person can change it.
//
// The prompt carries the header and a spread of rows, so the shop does not have
// to attach the file — the AI sees exactly what this screen read.
//
// Pure — no Prisma, no node:. Imported by the wizard and by the inspect action.
// ============================================================

import { normalizeMenuName, type SalesDateFormat } from "@/lib/sales-file";
import type { ColumnMapField } from "@/lib/validations/sales-import";

export const SALES_MAP_TAG = "sales-map-1";

/** What the AI points at. "date" covers businessDate and soldAt: the wizard tells them apart by the values (P14). */
export type MapField = "date" | Exclude<ColumnMapField, "businessDate" | "soldAt">;

/** Priority order: when two answers claim one column, the earlier keeps it. */
export const MAP_FIELDS: readonly MapField[] = [
  "date",
  "menuName",
  "qty",
  "netAmount",
  "menuCode",
  "billId",
  "discountAmount",
  "grossAmount",
  "categoryName",
  "channel",
  "vatAmount",
  "serviceChargeAmount",
];

export const MAP_FIELD_TH: Record<MapField, string> = {
  date: "วันที่ขาย",
  menuName: "ชื่อเมนู",
  qty: "จำนวน",
  netAmount: "ยอดเงิน",
  menuCode: "รหัสเมนู",
  billId: "เลขบิล",
  discountAmount: "ส่วนลด",
  grossAmount: "ยอดก่อนส่วนลด",
  categoryName: "หมวดเมนู",
  channel: "ช่องทางขาย",
  vatAmount: "VAT",
  serviceChargeAmount: "Service charge",
};

const FIELD_ASK: Record<MapField, string> = {
  date: "วันที่ขาย หรือวันและเวลาที่ขาย",
  menuName: "ชื่อเมนูที่ขาย",
  qty: "จำนวนที่ขาย",
  netAmount: "ยอดเงินของแถวนั้นหลังหักส่วนลด (ไม่ใช่ราคาต่อหน่วย)",
  menuCode: "รหัสเมนู",
  billId: "เลขบิลหรือเลขใบเสร็จ",
  discountAmount: "ส่วนลดของแถว",
  grossAmount: "ยอดของแถวก่อนหักส่วนลด",
  categoryName: "หมวดของเมนู",
  channel: "ช่องทางขาย เช่น ทานที่ร้าน กลับบ้าน เดลิเวอรี",
  vatAmount: "จำนวนเงิน VAT ของแถว",
  serviceChargeAmount: "จำนวนเงิน service charge ของแถว",
};

// ------------------------------------------------------------
// 1. Which rows the AI sees
// ------------------------------------------------------------

export const PROMPT_ROWS = 30;
const PROMPT_CELL_CHARS = 60;

/**
 * Up to `max` non-blank rows: the first dozen as they come, then an even
 * spread to the end — a date like 13/10 that settles day-first is often far
 * down a file. Order is kept.
 */
export function pickPromptRows(body: readonly string[][], max = PROMPT_ROWS): { rowNumber: number; cells: string[] }[] {
  const rows = body.flatMap((cells, i) => (cells.some((c) => c.trim() !== "") ? [{ rowNumber: i + 2, cells }] : []));
  if (rows.length <= max) return rows;
  const head = Math.min(12, max);
  const out = rows.slice(0, head);
  const rest = rows.slice(head);
  const want = max - head;
  for (let k = 0; k < want; k++) out.push(rest[Math.floor(((k + 1) * rest.length) / want) - 1]);
  return out;
}

const cellText = (s: string) => {
  const t = s.replace(/[\r\n\t]+/g, " ").replace(/\|/g, "¦").trim();
  return t.length > PROMPT_CELL_CHARS ? `${t.slice(0, PROMPT_CELL_CHARS)}…` : t;
};

// ------------------------------------------------------------
// 2. The prompt
// ------------------------------------------------------------

export function buildSalesMapPrompt(input: {
  posLabel: string;
  header: readonly string[];
  rows: readonly { rowNumber: number; cells: readonly string[] }[];
  rowCount: number;
}): string {
  const { header, rows } = input;
  const columns = header.map((h, i) => `${i + 1}. ${h.trim() === "" ? "(หัวว่าง)" : cellText(h)}`).join("\n");
  const sample = rows.map((r) => `แถว ${r.rowNumber}: ${header.map((_, i) => cellText(r.cells[i] ?? "")).join(" | ")}`).join("\n");
  const asks = MAP_FIELDS.map((f) => `${f} = ${FIELD_ASK[f]}`).join("\n");
  const template = JSON.stringify({
    kitkrua: SALES_MAP_TAG,
    columns: Object.fromEntries(MAP_FIELDS.map((f) => [f, null])),
    dateOrder: null,
    yearEra: null,
    amountsIncludeVat: null,
    amountsIncludeServiceCharge: null,
    why: { vat: "", serviceCharge: "" },
    unsure: {},
  });

  return `ช่วยดูตัวอย่างไฟล์ยอดขายจากเครื่อง POS ของร้านอาหารด้านล่าง แล้วบอกว่าข้อมูลแต่ละอย่างอยู่คอลัมน์ไหน คำตอบนี้ใช้ตั้งค่าการนำเข้ายอดขายในโปรแกรมคิดครัว
ไม่ต้องแปลงไฟล์ ไม่ต้องรวมยอด ตอบเป็นรหัส JSON ตามแบบท้ายข้อความเท่านั้น

POS: ${input.posLabel}
หัวตาราง ${header.length} คอลัมน์ (ตัวเลขข้างหน้าคือลำดับคอลัมน์):
${columns}

ตัวอย่างข้อมูล ${rows.length} แถว จากทั้งหมด ${input.rowCount.toLocaleString("en-US")} แถว (แต่ละช่องคั่นด้วย |):
${sample}

หาคอลัมน์ของข้อมูลเหล่านี้:
${asks}

แล้วตอบอีก 4 ข้อ:
dateOrder = วันที่เขียนเรียงแบบไหน "DMY" (วัน เดือน ปี) "MDY" (เดือน วัน ปี) หรือ "YMD" (ปี เดือน วัน)
yearEra = ปีในไฟล์เป็น "BE" (พ.ศ. เช่น 2569) หรือ "CE" (ค.ศ. เช่น 2026)
amountsIncludeVat = ตัวเลขใน netAmount รวม VAT แล้ว (true) หรือยังไม่รวม (false)
amountsIncludeServiceCharge = ตัวเลขใน netAmount รวม service charge แล้ว (true) หรือยังไม่รวม (false)

กฎ ตอบถูกสำคัญกว่าตอบครบ เพราะคอลัมน์ที่ผิดทำให้ยอดขายผิดทุกแถว:
1. ห้ามเดา ข้อไหนไม่แน่ใจให้ใส่ null แล้วเขียนเหตุผลสั้น ๆ เป็นภาษาไทยใน "unsure" โดยใช้ชื่อข้อเป็นคีย์ ข้อมูลที่ไฟล์ไม่มีเลย ใส่ null โดยไม่ต้องเขียนเหตุผล
2. ระบุคอลัมน์เป็น [ลำดับคอลัมน์, "หัวคอลัมน์ตามตัวอักษรในรายการด้านบน"] ทั้งสองค่าต้องตรงกัน
3. หนึ่งคอลัมน์ใช้ตอบได้ข้อเดียว
4. คอลัมน์ราคาต่อหน่วย (เช่น "@" "ราคา" "Price") ไม่ใช่ netAmount · ถ้ามีทั้งยอดก่อนและหลังหักส่วนลด netAmount คือยอดหลังหัก
5. ตอบเรื่อง VAT และ service charge จากตัวเลขในตัวอย่างเท่านั้น เช่น ยอดเงิน = ยอดก่อน VAT + VAT ถ้าตัวเลขบอกไม่ได้ ให้ใส่ null · ไฟล์ที่ไม่มี service charge และตัวเลขไม่มีร่องรอยว่าถูกบวกไว้ ให้ใส่ false
6. "why" เขียนสั้น ๆ ว่าดูจากตัวเลขไหน จึงตอบข้อ VAT และ service charge แบบนั้น
7. ห้ามแก้หัวคอลัมน์ ห้ามแปล ห้ามอ้างคอลัมน์ที่ไม่มีในรายการ
8. ตอบเป็นรหัส JSON ในกล่องโค้ดกล่องเดียว ไม่ต้องอธิบายนอกกล่อง

แบบของคำตอบ (ใส่คำตอบแทน null ตามที่หาได้):
${template}`;
}

// ------------------------------------------------------------
// 3. Reading the answer back
// ------------------------------------------------------------

export type DateOrder = "DMY" | "MDY" | "YMD";

export type SalesMapAnswer = {
  /** 0-based column per field, only where the file agrees with the AI. */
  columns: Partial<Record<MapField, number>>;
  dateOrder: DateOrder | null;
  buddhistYear: boolean | null;
  includesVat: boolean | null;
  includesServiceCharge: boolean | null;
  why: { vat: string | null; serviceCharge: string | null };
  /** The AI's own reasons for leaving something open, in its words, under the key it used ("netAmount", "amountsIncludeVat"). */
  unsure: { key: string; note: string }[];
  /** Columns the AI named that this file does not have ("missing"), or that another answer already holds ("clash"). */
  refused: { field: MapField; said: string; kind: "missing" | "clash" }[];
};

export type SalesMapReading = { ok: true; answer: SalesMapAnswer } | { ok: false; reason: "NO_CODE" | "NOT_OURS" | "OTHER_FILE" };

export const SALES_MAP_ERROR_TH: Record<Exclude<SalesMapReading, { ok: true }>["reason"], string> = {
  NO_CODE: "ไม่พบรหัสในข้อความที่วาง · คัดลอกคำตอบของ AI ทั้งกล่อง แล้ววางอีกครั้ง",
  NOT_OURS: "ข้อความนี้ไม่ใช่คำตอบของคำสั่งจากคิดครัว · คัดลอกคำสั่งจากหน้านี้ไปให้ AI ใหม่",
  OTHER_FILE: "คอลัมน์ในคำตอบไม่ตรงกับไฟล์ที่อัปไว้ อาจเป็นคำตอบของไฟล์อื่น · คัดลอกคำสั่งจากหน้านี้ไปให้ AI ใหม่",
};

const NOTE_CHARS = 160;
const note = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (t === "") return null;
  return t.length > NOTE_CHARS ? `${t.slice(0, NOTE_CHARS)}…` : t;
};

/** The JSON object inside whatever was pasted: a code fence, prose around it, curly quotes from a rendered view. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  const body = text.slice(start, end + 1);
  for (const candidate of [body, body.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")]) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next spelling */
    }
  }
  return undefined;
}

const headerKey = (s: string) => normalizeMenuName(s).toLowerCase();

type Located = { ok: true; index: number } | { ok: false; said: string };

/**
 * `[3, "ชื่อสินค้า"]` → column index 2, but only if column 3 IS "ชื่อสินค้า".
 * A miscount is forgiven when the name occurs exactly once in the header; a
 * name the header does not have is refused — never resolved to the nearest.
 */
function locate(v: unknown, header: readonly string[], keys: readonly string[]): Located | null {
  if (v === null || v === undefined || v === "") return null;
  let n: number | undefined;
  let name: string | undefined;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    const p = v[0];
    if (typeof p === "number" && Number.isInteger(p)) n = p;
    else if (typeof p === "string" && /^\s*\d+\s*$/.test(p)) n = Number(p);
    if (typeof v[1] === "string") name = v[1];
  } else if (typeof v === "string") {
    name = v;
  } else if (typeof v === "number" && Number.isInteger(v)) {
    n = v;
  } else {
    return { ok: false, said: JSON.stringify(v).slice(0, 40) };
  }

  if (name !== undefined) {
    const k = headerKey(name);
    if (n !== undefined && n >= 1 && n <= header.length && keys[n - 1] === k) return { ok: true, index: n - 1 };
    const hits = k === "" ? [] : keys.flatMap((h, i) => (h === k ? [i] : []));
    if (hits.length === 1) return { ok: true, index: hits[0] };
    return { ok: false, said: n !== undefined ? `คอลัมน์ ${n} “${name}”` : `“${name}”` };
  }
  // A bare position cannot be checked against anything.
  return { ok: false, said: n !== undefined ? `คอลัมน์ ${n} (ไม่มีชื่อหัวคอลัมน์)` : "—" };
}

const bool = (v: unknown): boolean | null => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);

export function readSalesMapAnswer(text: string, header: readonly string[]): SalesMapReading {
  const raw = extractJson(text);
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "NO_CODE" };
  const o = raw as Record<string, unknown>;
  if (o.kitkrua !== SALES_MAP_TAG) return { ok: false, reason: "NOT_OURS" };

  const keys = header.map(headerKey);
  const given = o.columns !== null && typeof o.columns === "object" ? (o.columns as Record<string, unknown>) : {};
  const columns: Partial<Record<MapField, number>> = {};
  const refused: SalesMapAnswer["refused"] = [];
  const owner = new Map<number, MapField>();
  let named = 0;
  let mismatched = 0;
  for (const field of MAP_FIELDS) {
    const at = locate(given[field], header, keys);
    if (at === null) continue;
    named++;
    if (!at.ok) {
      mismatched++;
      refused.push({ field, said: at.said, kind: "missing" });
      continue;
    }
    const clash = owner.get(at.index);
    if (clash !== undefined) {
      refused.push({ field, said: `คอลัมน์ ${at.index + 1} ซึ่งใช้ตอบ “${MAP_FIELD_TH[clash]}” แล้ว`, kind: "clash" });
      continue;
    }
    owner.set(at.index, field);
    columns[field] = at.index;
  }
  // Mostly names this file does not have: an answer about another file.
  if (mismatched >= 2 && mismatched * 2 > named) return { ok: false, reason: "OTHER_FILE" };

  const order = typeof o.dateOrder === "string" ? o.dateOrder.toUpperCase().trim() : "";
  const era = typeof o.yearEra === "string" ? o.yearEra.trim() : "";
  const why = o.why !== null && typeof o.why === "object" ? (o.why as Record<string, unknown>) : {};
  const unsureIn = o.unsure !== null && typeof o.unsure === "object" && !Array.isArray(o.unsure) ? (o.unsure as Record<string, unknown>) : {};
  const unsure = Object.entries(unsureIn)
    .slice(0, 12)
    .flatMap(([k, v]) => {
      const t = note(v);
      return t === null ? [] : [{ key: k.slice(0, 40), note: t }];
    });

  return {
    ok: true,
    answer: {
      columns,
      dateOrder: order === "DMY" || order === "MDY" || order === "YMD" ? order : null,
      buddhistYear: era === "BE" || era === "พ.ศ." ? true : era === "CE" || era === "ค.ศ." ? false : null,
      includesVat: bool(o.amountsIncludeVat),
      includesServiceCharge: bool(o.amountsIncludeServiceCharge),
      why: { vat: note(why.vat), serviceCharge: note(why.serviceCharge) },
      unsure,
      refused,
    },
  };
}

// ------------------------------------------------------------
// 4. The date answer against the readings the file allows
// ------------------------------------------------------------

export function dateOrderOf(format: SalesDateFormat): DateOrder {
  if (format.startsWith("y")) return "YMD";
  if (format.startsWith("MM")) return "MDY";
  return "DMY";
}

/**
 * The one reading the AI's answer names, or null. The AI never overrules the
 * file: an order no reading supports picks nothing, and the person answers.
 */
export function readingFor(
  candidates: readonly { format: SalesDateFormat; isBuddhistYear: boolean }[],
  order: DateOrder | null,
  buddhistYear: boolean | null
): number | null {
  if (order === null) return null;
  const hits = candidates.flatMap((c, i) => (dateOrderOf(c.format) === order && (buddhistYear === null || c.isBuddhistYear === buddhistYear) ? [i] : []));
  return hits.length === 1 ? hits[0] : null;
}

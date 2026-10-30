// ============================================================
// คิดครัว — past purchase bills → suppliers and prices (คิวงานข้อ 5c)
// ============================================================
// Kong 2026-10-30, mockup https://claude.ai/artifact/YFU35adTUBXVQ6PPppFcHP
// (round 2). The shop's AI reads photos of old bills into our template; this
// import keeps exactly three things from them: the suppliers, who sells what,
// and the price on each date. It writes NO stock and NO expense — the goods on
// an old bill are already used, and putting them in stock would show up at the
// opening count as a pile of missing goods.
//
// Matching a bill's wording to the shop's ingredient ("MP SWEET SYRUP 750ML"
// is the shop's "น้ำเชื่อม") happens in three layers, strongest first:
//   1. remembered — this supplier's own name for the product, saved by an
//      earlier import (supplier_product_mapping.supplier_item_name);
//   2. the same name, or the AI's pick from the shop's own list (the prompt
//      carries the list; a pick that is not on it is ignored — the AI cannot
//      name a product into existence);
//   3. a close name (trigram, ADR 0010's 0.4), or a bill wording that CONTAINS
//      a product's name ("น้ำปลาทิพรส 700cc" holds "น้ำปลา") — a brand and a
//      size pull a trigram score under the line, containment does not.
// Nothing matched is SKIPPED by default, never guessed.
//
// The figures are checked against each other, not trusted: quantity × unit
// price must come to the line total, or the AI misread one of the three.
//
// Pure — the review screen and the server's save use the same functions.
// ============================================================

import { parseFileNumber } from "@/lib/sales-file";
import { SIMILAR_AT, nameIndex, nameKey, normalizeUnit } from "@/lib/product-import";

// ------------------------------------------------------------
// 1. The template
// ------------------------------------------------------------

export const BILL_COLUMNS = {
  date: "วันที่",
  supplier: "ผู้ขาย",
  billNo: "เลขที่บิล",
  item: "รายการ",
  shopItem: "วัตถุดิบของร้าน",
  qty: "จำนวน",
  unit: "หน่วย",
  unitPrice: "ราคาต่อหน่วย",
  total: "ยอดรวม",
  original: "ข้อความเดิม",
  unsure: "ไม่แน่ใจ",
} as const;
export type BillColumn = keyof typeof BILL_COLUMNS;
export const BILL_SHEET = "บิลซื้อ";
export const MAX_BILL_ROWS = 3000;

const HEADER_OF: Record<string, BillColumn> = Object.fromEntries(
  Object.entries(BILL_COLUMNS).map(([k, v]) => [v.replace(/\s+/g, ""), k as BillColumn])
);
const cleanHeader = (s: string) => s.replace(/[*"“”'`]/g, "").trim().replace(/\s+/g, "");

export function buildBillImportPrompt(productNames: string[]): string {
  const list =
    productNames.length > 0
      ? productNames.join(" · ")
      : "(ร้านยังไม่มีรายการวัตถุดิบ — เว้นคอลัมน์ “วัตถุดิบของร้าน” ว่างทุกแถว)";
  return `ช่วยอ่านบิลและใบเสร็จซื้อของของร้านที่แนบมา แล้วทำเป็นไฟล์ Excel สำหรับนำเข้าโปรแกรมคิดครัว

ส่งกลับเป็นไฟล์ .xlsx ไฟล์เดียว ถ้าสร้างไฟล์ไม่ได้ ให้ตอบเป็นตาราง ไม่ต้องอธิบายเพิ่ม

แผ่น "${BILL_SHEET}" หนึ่งแถวต่อหนึ่งบรรทัดในบิล หัวคอลัมน์ตามนี้ทุกตัวอักษร:
${Object.values(BILL_COLUMNS).join(" | ")}

ตัวอย่าง (ไม่ต้องใส่ในไฟล์):
12/10/2569 | ร้านข้าวเจ๊ใหญ่ | 0457 | ข้าวหอมมะลิ 15กก | ข้าวหอมมะลิ | 2 | กระสอบ | 650 | 1300 | ข้าวหอมมะลิ 15กก 2 กส 650 1,300 |

รายการวัตถุดิบของร้าน (ใช้กับคอลัมน์ "${BILL_COLUMNS.shopItem}" เท่านั้น):
${list}

กฎ ข้อมูลถูกสำคัญกว่าข้อมูลครบ:
1. อ่านตามที่บิลเขียนเท่านั้น ห้ามเดา ห้ามคำนวณ ช่องที่บิลไม่มีให้เว้นว่าง (บิลมีแต่ยอดรวม ไม่มีราคาต่อหน่วย ก็เว้นราคาต่อหน่วยไว้)
2. อ่านไม่ออกหรือไม่แน่ใจ ให้เว้นช่องนั้น แล้วเขียนเหตุผลสั้น ๆ ในคอลัมน์ "${BILL_COLUMNS.unsure}"
3. "${BILL_COLUMNS.date}" เขียนตามที่บิลเขียน วัน/เดือน/ปี ปี พ.ศ. ก็คงไว้ตามบิล
4. "${BILL_COLUMNS.supplier}" คือชื่อร้านหรือบริษัทที่หัวบิล ทุกบรรทัดของบิลเดียวกันใช้ชื่อเดียวกันและเลขที่บิลเดียวกัน บิลไม่มีเลขที่ให้เว้นว่าง
5. "${BILL_COLUMNS.item}" และ "${BILL_COLUMNS.unit}" เขียนตามบิล ห้ามแก้คำสะกด ห้ามย่อ ห้ามแปลงหน่วย
6. "${BILL_COLUMNS.shopItem}" เลือกชื่อจากรายการวัตถุดิบของร้านข้างบนที่เป็นของชิ้นเดียวกับบรรทัดนั้น (เช่น บิลเขียน Sweet Syrup ร้านเรียก น้ำเชื่อม) เขียนให้ตรงตัวอักษร ถ้าไม่แน่ใจหรือไม่มีในรายการ ให้เว้นว่าง ห้ามตั้งชื่อใหม่
7. ช่องตัวเลขใส่ตัวเลขล้วน ไม่มีจุลภาค ไม่มีคำว่าบาท
8. บรรทัดส่วนลด VAT ค่าส่ง ให้ใส่เป็นแถวด้วย เขียนคำนั้นในช่อง "${BILL_COLUMNS.item}" ตามบิล ไม่ต้องใส่บรรทัดยอดรวมทั้งบิล
9. "${BILL_COLUMNS.original}" คัดลอกบรรทัดนั้นจากบิลตามตัวอักษร
10. ห้ามรวมแถว ห้ามข้ามแถว ห้ามย่อ ห้ามใช้ "..." ถ้าส่งไม่หมดในครั้งเดียว ให้บอกว่าหยุดที่บิลไหน แล้วรอให้พิมพ์ "ต่อ"`;
}

// ------------------------------------------------------------
// 2. Grid → rows
// ------------------------------------------------------------

export type RawBillRow = { line: number } & Record<BillColumn, string>;

export type BillTableResult = { ok: true; rows: RawBillRow[] } | { ok: false; reason: "NO_HEADER" | "EMPTY" | "TOO_MANY" };

export const BILL_TABLE_ERROR_TH: Record<Exclude<BillTableResult, { ok: true }>["reason"], string> = {
  NO_HEADER: `ไม่พบคอลัมน์ “${BILL_COLUMNS.item}” และ “${BILL_COLUMNS.supplier}” — ไฟล์นี้อาจไม่ได้ทำตามคำสั่งของคิดครัว ลองคัดลอกคำสั่งไปให้ AI ทำใหม่`,
  EMPTY: "ไม่พบบรรทัดในบิล",
  TOO_MANY: `มีมากกว่า ${MAX_BILL_ROWS.toLocaleString("th-TH")} บรรทัด — แบ่งเป็นหลายไฟล์แล้วนำเข้าทีละไฟล์`,
};

/** The header row is the first with both "รายการ" and "ผู้ขาย" — an AI often writes a title above it. */
export function readBillTable(grid: string[][]): BillTableResult {
  let at = -1;
  const col: Partial<Record<BillColumn, number>> = {};
  for (let r = 0; r < grid.length; r++) {
    const cells = grid[r].map((c) => cleanHeader(String(c ?? "")));
    if (!cells.includes(BILL_COLUMNS.item) || !cells.includes(BILL_COLUMNS.supplier)) continue;
    at = r;
    cells.forEach((c, i) => {
      const k = HEADER_OF[c];
      if (k !== undefined && col[k] === undefined) col[k] = i;
    });
    break;
  }
  if (at === -1) return { ok: false, reason: "NO_HEADER" };
  const rows: RawBillRow[] = [];
  for (let r = at + 1; r < grid.length; r++) {
    const cells = grid[r].map((c) => String(c ?? ""));
    if (cells.every((c) => c.trim() === "")) continue;
    if (cells.length === 1) continue; // a title line between tables
    const row = { line: r + 1 } as RawBillRow;
    for (const k of Object.keys(BILL_COLUMNS) as BillColumn[]) {
      const i = col[k];
      row[k] = i === undefined ? "" : String(cells[i] ?? "").trim();
    }
    if (row.item === "" && row.supplier === "" && row.total === "") continue;
    rows.push(row);
  }
  if (rows.length === 0) return { ok: false, reason: "EMPTY" };
  if (rows.length > MAX_BILL_ROWS) return { ok: false, reason: "TOO_MANY" };
  return { ok: true, rows };
}

// ------------------------------------------------------------
// 3. Dates, line kinds, numbers
// ------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * A Thai bill's date: d/m/y in either era. A four-digit year above 2400 is
 * Buddhist (2569 → 2026). A two-digit year is read as Buddhist from 60 up
 * (69 → 2569) and Gregorian below (26 → 2026) — and flagged, because that is
 * a reading, not a fact; the date is shown on the bill's header to confirm.
 */
export function parseBillDate(raw: string): { day: string | null; guessedYear: boolean } {
  const s = raw.trim();
  if (s === "") return { day: null, guessedYear: false };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) {
    let y = Number(m[1]);
    if (y > 2400) y -= 543;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return { day: valid(y, mo, d) ? iso(y, mo, d) : null, guessedYear: false };
  }
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
  if (!m) return { day: null, guessedYear: false };
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  let guessedYear = false;
  if (m[3].length === 2) {
    guessedYear = true;
    y = y >= 60 ? 2500 + y - 543 : 2000 + y;
  } else if (y > 2400) {
    y -= 543;
  }
  return { day: valid(y, mo, d) ? iso(y, mo, d) : null, guessedYear };
}

export type LineKind = "ITEM" | "VAT" | "DISCOUNT" | "SHIPPING" | "TOTAL";

/** What a bill line IS, by its wording. Anything not an item is set aside, never priced. */
export function lineKind(item: string): LineKind {
  const s = item.toLowerCase();
  if (/vat|ภาษีมูลค่าเพิ่ม|ภาษี/.test(s)) return "VAT";
  if (/ส่วนลด|discount|ลดราคา/.test(s)) return "DISCOUNT";
  if (/ค่าส่ง|ค่าขนส่ง|ค่าจัดส่ง|delivery|shipping/.test(s)) return "SHIPPING";
  // The WHOLE line is the word — "รวมมิตรทะเล" is an ingredient, not a total.
  if (/^(รวม|ยอดรวม|รวมทั้งสิ้น|รวมเงิน|ยอดสุทธิ|total|sub ?total|grand total)\s*[:：]?\s*[\d.,]*$/.test(s.trim())) return "TOTAL";
  return "ITEM";
}

const num = (raw: string): number | null => {
  const r = parseFileNumber(raw);
  return r.ok ? r.value : null;
};

/** Quantity × unit price vs the line total — within a baht, or 1 %. */
export function figuresAgree(qty: number, unitPrice: number, total: number): boolean {
  return Math.abs(qty * unitPrice - total) <= Math.max(1, Math.abs(total) * 0.01);
}

// ------------------------------------------------------------
// 4. What the review screen matches against
// ------------------------------------------------------------

export type BillProductUnit = { id: string; unitName: string; toBaseRatio: number; isBase: boolean };
export type BillProduct = { id: string; name: string; sku: string; dimension: string; units: BillProductUnit[] };
export type BillSupplier = { id: string; name: string };
/** A supplier's own wording for a product, remembered from an earlier import. */
export type RememberedName = { supplierId: string; productId: string; itemName: string };
export type BillTemplate = { unitName: string; unitDimension: string; toSiRatio: number | null };
export type BillContext = {
  products: BillProduct[];
  suppliers: BillSupplier[];
  remembered: RememberedName[];
  templates: BillTemplate[];
  /** The shop's first closed count; a bill dated after it should have been a goods receipt. */
  openingDate: string | null;
  /** Bangkok today, YYYY-MM-DD — a bill cannot be dated after it. */
  today: string;
};

// ------------------------------------------------------------
// 5. Drafts — what the person reviews and edits
// ------------------------------------------------------------

export type MatchHow = "REMEMBERED" | "EXACT" | "AI_AND_SIMILAR" | "AI" | "SIMILAR";

export type LineChoice = { kind: "PRODUCT"; id: string } | { kind: "NEW"; name: string; baseUnit: string | null } | { kind: "SKIP" };

export type LineDraft = {
  line: number;
  item: string;
  original: string;
  unsure: string;
  kind: LineKind;
  qty: number | null;
  /** Normalised (กก. → kg). Null when the bill wrote none. */
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
  /** What the system proposed, for the label beside the choice. */
  proposal: { productId: string; how: MatchHow } | null;
  /** The AI named a product the shop does not have — shown, ignored. */
  aiUnknown: string;
  choice: LineChoice;
  /** 1 bill unit = ratio product base units, for a unit the product does not have. */
  ratio: number | null;
  /** Which figure to believe when quantity × price ≠ total. */
  trust: "UNIT" | "TOTAL";
  /** A price the person typed instead. */
  priceEdit: number | null;
};

export type SupplierChoice = { kind: "EXISTING"; id: string } | { kind: "NEW"; name: string };

export type BillDraft = {
  key: string;
  dateRaw: string;
  date: string | null;
  guessedYear: boolean;
  supplierText: string;
  billNo: string;
  supplier: SupplierChoice;
  supplierHow: "EXACT" | "SIMILAR" | "NEW";
  hasVat: boolean;
  lines: LineDraft[];
};

/** Group the rows into bills and propose a supplier and a product for each line. */
export function draftBills(rows: RawBillRow[], ctx: BillContext): BillDraft[] {
  const productByKey = new Map(ctx.products.map((p) => [nameKey(p.name), p]));
  const similarProduct = nameIndex(ctx.products);
  const supplierByKey = new Map(ctx.suppliers.map((s) => [nameKey(s.name), s]));
  const similarSupplier = nameIndex(ctx.suppliers);
  const remembered = new Map(ctx.remembered.map((r) => [`${r.supplierId}|${nameKey(r.itemName)}`, r.productId]));
  // Longest name first, so "พริกแห้ง" wins over "พริก" inside "พริกแห้งเม็ดใหญ่".
  const byLength = ctx.products.map((p) => ({ p, k: nameKey(p.name) })).filter((x) => [...x.k].length >= 3).sort((a, b) => b.k.length - a.k.length);
  const containedIn = (item: string) => byLength.find((x) => nameKey(item).includes(x.k))?.p;

  const bills = new Map<string, BillDraft>();
  for (const r of rows) {
    const key = `${r.date}|${nameKey(r.supplier)}|${r.billNo}`;
    let bill = bills.get(key);
    if (!bill) {
      const exact = supplierByKey.get(nameKey(r.supplier));
      const close = exact ? null : r.supplier.trim() === "" ? null : similarSupplier(r.supplier);
      const { day, guessedYear } = parseBillDate(r.date);
      bill = {
        key,
        dateRaw: r.date,
        date: day,
        guessedYear,
        supplierText: r.supplier.trim(),
        billNo: r.billNo,
        supplier: exact ? { kind: "EXISTING", id: exact.id } : close ? { kind: "EXISTING", id: close.item.id } : { kind: "NEW", name: r.supplier.trim() },
        supplierHow: exact ? "EXACT" : close ? "SIMILAR" : "NEW",
        hasVat: false,
        lines: [],
      };
      bills.set(key, bill);
    }
    const kind = lineKind(r.item);
    if (kind === "VAT") bill.hasVat = true;

    const supplierId = bill.supplier.kind === "EXISTING" ? bill.supplier.id : null;
    const rememberedId = supplierId ? remembered.get(`${supplierId}|${nameKey(r.item)}`) : undefined;
    const exact = productByKey.get(nameKey(r.item));
    const ai = r.shopItem.trim() === "" ? undefined : productByKey.get(nameKey(r.shopItem));
    const close = similarProduct(r.item) ?? (() => {
      const hit = containedIn(r.item);
      return hit ? { item: hit, score: SIMILAR_AT } : null;
    })();
    let proposal: LineDraft["proposal"] = null;
    if (kind === "ITEM") {
      if (rememberedId) proposal = { productId: rememberedId, how: "REMEMBERED" };
      else if (exact) proposal = { productId: exact.id, how: "EXACT" };
      else if (ai) proposal = { productId: ai.id, how: close?.item.id === ai.id ? "AI_AND_SIMILAR" : "AI" };
      else if (close && close.score >= SIMILAR_AT) proposal = { productId: close.item.id, how: "SIMILAR" };
    }

    bill.lines.push({
      line: r.line,
      item: r.item.trim(),
      original: r.original,
      unsure: r.unsure,
      kind,
      qty: num(r.qty),
      unit: normalizeUnit(r.unit),
      unitPrice: num(r.unitPrice),
      total: num(r.total),
      proposal,
      aiUnknown: r.shopItem.trim() !== "" && !ai ? r.shopItem.trim() : "",
      choice: proposal ? { kind: "PRODUCT", id: proposal.productId } : { kind: "SKIP" },
      ratio: null,
      trust: "UNIT",
      priceEdit: null,
    });
  }
  return [...bills.values()];
}

// ------------------------------------------------------------
// 6. Judging a line
// ------------------------------------------------------------

export type LineFlag =
  | "YEAR_GUESSED"
  | "NO_UNIT"
  | "UNIT_CONVERTED"
  | "PRICE_FROM_TOTAL"
  | "FIGURES_DISAGREE"
  | "AI_UNSURE"
  | "MATCH_TO_CHECK"
  | "NEW_PRODUCT";

export type LineNeed = "DATE" | "FUTURE_DATE" | "SUPPLIER" | "NAME" | "BASE_UNIT" | "RATIO" | "PRICE";

export type LineVerdict =
  | { kind: "SKIP"; why: "NOT_ITEM" | "PRESSED" | "NO_MATCH" }
  | { kind: "NEED"; why: LineNeed }
  | {
      kind: "PRICE";
      flags: LineFlag[];
      /** Price per ONE bill unit. */
      unitPrice: number;
      /** The unit the price is written against, and whether the product already has it. */
      unitName: string;
      unitIsNew: boolean;
      /** 1 unitName = ratio base units, when unitIsNew. */
      ratio: number | null;
    };

/** The price a line stands for, before any choice of unit. Null when the bill gives none. */
export function linePrice(l: LineDraft): { price: number | null; fromTotal: boolean; disagree: boolean } {
  if (l.priceEdit !== null && l.priceEdit > 0) return { price: l.priceEdit, fromTotal: false, disagree: false };
  const derived = l.total !== null && l.qty !== null && l.qty > 0 ? l.total / l.qty : null;
  const disagree = l.unitPrice !== null && l.qty !== null && l.total !== null && !figuresAgree(l.qty, l.unitPrice, l.total);
  if (disagree && l.trust === "TOTAL") return { price: derived, fromTotal: true, disagree };
  if (l.unitPrice !== null && l.unitPrice > 0) return { price: l.unitPrice, fromTotal: false, disagree };
  if (derived !== null && derived > 0) return { price: derived, fromTotal: true, disagree: false };
  return { price: null, fromTotal: false, disagree: false };
}

export function judgeLine(b: BillDraft, l: LineDraft, ctx: BillContext): LineVerdict {
  if (l.kind !== "ITEM") return { kind: "SKIP", why: "NOT_ITEM" };
  if (l.choice.kind === "SKIP") return { kind: "SKIP", why: l.proposal === null ? "NO_MATCH" : "PRESSED" };
  if (b.date === null) return { kind: "NEED", why: "DATE" };
  if (b.date > ctx.today) return { kind: "NEED", why: "FUTURE_DATE" };
  if (b.supplier.kind === "NEW" && b.supplier.name.trim() === "") return { kind: "NEED", why: "SUPPLIER" };

  const flags: LineFlag[] = [];
  if (b.guessedYear) flags.push("YEAR_GUESSED");
  if (l.unsure.trim() !== "") flags.push("AI_UNSURE");

  // The product the price belongs to, and its units.
  let units: { unitName: string; toBaseRatio: number; isBase: boolean }[];
  let dimension: string;
  const choice = l.choice;
  if (choice.kind === "NEW") {
    if (choice.name.trim() === "") return { kind: "NEED", why: "NAME" };
    const base = ctx.templates.find((t) => t.unitName === choice.baseUnit);
    if (!base) return { kind: "NEED", why: "BASE_UNIT" };
    units = [{ unitName: base.unitName, toBaseRatio: 1, isBase: true }];
    dimension = base.unitDimension;
    flags.push("NEW_PRODUCT");
  } else {
    const id = choice.id;
    const p = ctx.products.find((x) => x.id === id);
    if (!p) return { kind: "NEED", why: "NAME" };
    units = p.units;
    dimension = p.dimension;
    const how = l.proposal?.productId === p.id ? l.proposal.how : null;
    if (how !== "REMEMBERED" && how !== "EXACT") flags.push("MATCH_TO_CHECK");
  }
  const base = units.find((u) => u.isBase)!;

  // The unit the bill priced it in.
  let unitName = base.unitName;
  let unitIsNew = false;
  let ratio: number | null = null;
  if (l.unit === null) {
    flags.push("NO_UNIT");
  } else {
    const have = units.find((u) => normalizeUnit(u.unitName) === l.unit);
    unitName = have ? have.unitName : l.unit;
    if (!have) {
      unitIsNew = true;
      const t = ctx.templates.find((x) => x.unitName === l.unit);
      const bt = ctx.templates.find((x) => x.unitName === base.unitName);
      if (t && bt && t.unitDimension === dimension && bt.unitDimension === dimension && t.toSiRatio && bt.toSiRatio) {
        ratio = t.toSiRatio / bt.toSiRatio;
        flags.push("UNIT_CONVERTED");
      } else if (l.ratio !== null && l.ratio > 0) {
        ratio = l.ratio;
      } else {
        return { kind: "NEED", why: "RATIO" };
      }
    }
  }

  const p = linePrice(l);
  if (p.price === null) return { kind: "NEED", why: "PRICE" };
  if (p.fromTotal) flags.push("PRICE_FROM_TOTAL");
  if (p.disagree) flags.push("FIGURES_DISAGREE");
  return { kind: "PRICE", flags, unitPrice: Math.round(p.price * 10_000) / 10_000, unitName, unitIsNew, ratio };
}

/** A line is green only when it was remembered or matched exactly and nothing else needs a look. */
export const isClean = (v: LineVerdict) => v.kind === "PRICE" && v.flags.filter((f) => f !== "UNIT_CONVERTED").length === 0;

// ------------------------------------------------------------
// 7. The save
// ------------------------------------------------------------

export type BillSave = {
  suppliers: { ref: string; id: string | null; name: string; vat: boolean }[];
  newProducts: { ref: string; name: string; baseUnitName: string }[];
  prices: {
    supplierRef: string;
    product: { id: string } | { ref: string };
    unitName: string;
    /** For a unit the product does not have yet. */
    ratio: number | null;
    unitPrice: number;
    date: string;
    /** The supplier's own wording — remembered for the next bill. */
    itemName: string;
  }[];
};

export function toBillSave(bills: BillDraft[], ctx: BillContext): BillSave {
  const suppliers = new Map<string, BillSave["suppliers"][number]>();
  const newProducts = new Map<string, BillSave["newProducts"][number]>();
  const prices: BillSave["prices"] = [];
  for (const b of bills) {
    const priced = b.lines.map((l) => ({ l, v: judgeLine(b, l, ctx) })).filter((x) => x.v.kind === "PRICE");
    if (priced.length === 0) continue;
    const supplierRef = b.supplier.kind === "EXISTING" ? `id:${b.supplier.id}` : `new:${nameKey(b.supplier.name)}`;
    const prev = suppliers.get(supplierRef);
    suppliers.set(supplierRef, {
      ref: supplierRef,
      id: b.supplier.kind === "EXISTING" ? b.supplier.id : null,
      name: b.supplier.kind === "EXISTING" ? "" : b.supplier.name.trim(),
      vat: (prev?.vat ?? false) || b.hasVat,
    });
    for (const { l, v } of priced) {
      if (v.kind !== "PRICE") continue;
      let product: { id: string } | { ref: string };
      if (l.choice.kind === "NEW") {
        const ref = `new:${nameKey(l.choice.name)}`;
        if (!newProducts.has(ref)) newProducts.set(ref, { ref, name: l.choice.name.trim(), baseUnitName: l.choice.baseUnit! });
        product = { ref };
      } else if (l.choice.kind === "PRODUCT") {
        product = { id: l.choice.id };
      } else continue;
      prices.push({ supplierRef, product, unitName: v.unitName, ratio: v.unitIsNew ? v.ratio : null, unitPrice: v.unitPrice, date: b.date!, itemName: l.item });
    }
  }
  return { suppliers: [...suppliers.values()], newProducts: [...newProducts.values()], prices };
}

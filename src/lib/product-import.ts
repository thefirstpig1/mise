// ============================================================
// คิดครัว — import products from a file the shop's own AI prepared (คิวงานข้อ 5)
// ============================================================
// Kong 2026-10-30, mockup https://claude.ai/artifact/R3vZEuvaWr2gWQosAgYfkA
// (round 3). The shop's AI turns whatever the shop keeps — Excel, Word, a photo
// of a notebook — into OUR template; everything that needs judgement (matching
// a name, resolving a unit) happens here, on a review screen, before anything
// is written.
//
// Three choices carry the design:
//   - the AI is never asked for a number it would have to invent, and it gets a
//     column ("ไม่แน่ใจ") to say so instead of guessing;
//   - NO price and NO supplier: prices arrive by receiving goods (Kong), and a
//     price is the one column whose misreading costs the shop money;
//   - a name that already exists is skipped; a name that is merely CLOSE is a
//     question for the person, never a silent merge (the rule /menus has kept
//     since Part 19: a trigram score suggests, a person decides).
//
// Pure — no Prisma, no node:. The page judges a fix the person makes with the
// same functions the server judges the save with.
// ============================================================

import { parseCsv, parseFileNumber } from "@/lib/sales-file";

// ------------------------------------------------------------
// 1. The template
// ------------------------------------------------------------

export const PRODUCT_COLUMNS = {
  name: "ชื่อ",
  category: "หมวด",
  buyUnit: "ซื้อเป็น",
  packQty: "บรรจุ",
  packUnit: "หน่วยในบรรจุ",
  original: "ข้อความเดิม",
  unsure: "ไม่แน่ใจ",
} as const;
export type ProductColumn = keyof typeof PRODUCT_COLUMNS;

export const RECIPE_COLUMNS = ["ชื่อเมนู", "ได้", "หน่วยที่ได้", "วัตถุดิบ", "ปริมาณ", "หน่วย", "ข้อความเดิม", "ไม่แน่ใจ"] as const;

export const PRODUCT_SHEET = "วัตถุดิบ";
export const RECIPE_SHEET = "สูตร";

/** A few spellings an AI (or a person filling the template) may use for a header. */
const HEADER_ALIASES: Record<string, ProductColumn> = {
  ชื่อ: "name",
  ชื่อวัตถุดิบ: "name",
  ชื่อสินค้า: "name",
  หมวด: "category",
  หมวดหมู่: "category",
  ซื้อเป็น: "buyUnit",
  หน่วยที่ซื้อ: "buyUnit",
  บรรจุ: "packQty",
  หน่วยในบรรจุ: "packUnit",
  ข้อความเดิม: "original",
  ไม่แน่ใจ: "unsure",
};

const cleanHeader = (s: string) => s.replace(/[*"“”'`]/g, "").trim().replace(/\s+/g, "");

/** The marker the AI is told to write when an ingredient was found only in the method text. */
export const FROM_METHOD_MARK = "พบในวิธีทำ";

export const MAX_IMPORT_ROWS = 2000;

/**
 * The prompt the shop copies into its AI. The category list is the shop's own,
 * so the AI can only choose a category that exists.
 */
export function buildProductImportPrompt(categoryGroups: string[]): string {
  const cats = categoryGroups.length > 0 ? categoryGroups.join(" · ") : "(ร้านยังไม่มีหมวด ให้เว้นว่าง)";
  return `ช่วยแปลงข้อมูลวัตถุดิบและสูตรอาหารของร้านที่แนบมา (ไฟล์ รูปถ่าย หรือข้อความ) เป็นไฟล์ Excel สำหรับนำเข้าโปรแกรมคิดครัว

ส่งกลับเป็นไฟล์ .xlsx ไฟล์เดียว ถ้าสร้างไฟล์ไม่ได้ ให้ตอบเป็นตาราง แผ่นละหนึ่งตาราง ไม่ต้องอธิบายเพิ่ม

แผ่น "${PRODUCT_SHEET}" หนึ่งแถวต่อวัตถุดิบหนึ่งอย่าง หัวคอลัมน์ตามนี้ทุกตัวอักษร:
${Object.values(PRODUCT_COLUMNS).join(" | ")}

แผ่น "${RECIPE_SHEET}" หนึ่งแถวต่อวัตถุดิบหนึ่งอย่างในหนึ่งเมนู:
${RECIPE_COLUMNS.join(" | ")}

ตัวอย่าง (ไม่ต้องใส่ในไฟล์):
ข้าวหอมมะลิ | ของแห้งและเครื่องปรุง | กระสอบ | 15 | กก. | ข้าวหอมมะลิ กระสอบ 15 กก. 650 |
ข้าวผัดหมู | 1 | จาน | หมูสับ | 1 | ขีด | หมูสับ 1 ขีด |

กฎ ข้อมูลถูกสำคัญกว่าข้อมูลครบ:
1. ห้ามเดา ห้ามคำนวณ ห้ามเติมสิ่งที่ร้านไม่ได้เขียน ไม่รู้ให้เว้นว่าง ห้ามใส่ 0 แทน
2. อ่านไม่ออกหรือไม่แน่ใจ ให้เว้นช่องนั้น แล้วเขียนเหตุผลสั้น ๆ ในคอลัมน์ "ไม่แน่ใจ"
3. "ข้อความเดิม" คัดลอกข้อความต้นฉบับที่แถวนั้นมาจาก ตามตัวอักษร ทุกแถว
4. ชื่อและหน่วยเขียนตามที่ร้านเขียน ห้ามแก้คำสะกด ห้ามแปล ห้ามแปลงหน่วย (ขีด ทัพพี ช้อน กำ ใช้ตามนั้น)
5. ช่องตัวเลขใส่ตัวเลขล้วน ไม่มีหน่วย ไม่มีจุลภาค เศษส่วนเขียนเป็นทศนิยม (½ = 0.5) ตัวเลขที่เป็นช่วง เช่น 2-3 ให้เว้นว่างและจดไว้ใน "ไม่แน่ใจ"
6. ไม่ต้องใส่ราคาและชื่อผู้ขาย แม้ข้อมูลของร้านจะมี
7. สูตรที่มีวิธีทำปนมา ไม่ต้องคัดลอกวิธีทำ แต่ต้องอ่านวิธีทำทุกบรรทัด วัตถุดิบที่เขียนไว้เฉพาะในวิธีทำ (ไม่อยู่ในรายการวัตถุดิบของเมนูนั้น) ให้เพิ่มเป็นแถวด้วย ใส่ปริมาณถ้าเขียนไว้ และเขียนในคอลัมน์ "ไม่แน่ใจ" ว่า "${FROM_METHOD_MARK}" วัตถุดิบที่อยู่ในรายการแล้วไม่ต้องเพิ่มซ้ำ ถ้าวิธีทำบอกให้ใส่เพิ่มอีก ให้จดไว้ใน "ไม่แน่ใจ"
8. ห้ามรวมแถว ห้ามข้ามแถว ห้ามเพิ่มของที่ไม่มีในข้อมูลของร้าน ชื่อซ้ำก็คงไว้ทุกแถว
9. วัตถุดิบที่อยู่ในสูตร (รวมที่พบในวิธีทำ) แต่ไม่อยู่ในรายการวัตถุดิบ ให้เพิ่มในแผ่น "${PRODUCT_SHEET}" ด้วย ช่องที่ไม่รู้เว้นว่าง
10. ของที่ร้านทำเอง เช่น น้ำซุป ซอสผัด ใส่เป็นวัตถุดิบหนึ่งแถวในเมนูที่ใช้ ถ้ามีสูตรของมันด้วย ให้เขียนเป็นเมนูของมันเอง
11. "หมวด" เลือกจากรายการนี้เท่านั้น ไม่แน่ใจให้เว้นว่าง: ${cats}
12. ห้ามย่อ ห้ามใช้ "..." แทนแถวที่เหลือ ถ้าส่งไม่หมดในครั้งเดียว ให้บอกว่าหยุดที่แถวไหน แล้วรอให้พิมพ์ "ต่อ"
13. ไม่มีข้อมูลสูตร ให้ส่งเฉพาะแผ่น "${PRODUCT_SHEET}"`;
}

// ------------------------------------------------------------
// 2. Text → rows
// ------------------------------------------------------------

const SEPARATOR_CELL = /^:?-{2,}:?$/;

/**
 * What a person pastes. Copying a table an AI rendered gives TAB-separated
 * text in every browser; copying the raw answer gives a markdown table
 * (`| a | b |`) or the prompt's own `a | b | c`; anything else is read as CSV.
 */
export function splitPastedTable(text: string): string[][] {
  const t = text.replace(/\r\n?/g, "\n");
  const lines = t.split("\n");
  if (lines.some((l) => l.includes("\t"))) return lines.map((l) => l.split("\t"));
  if (lines.filter((l) => l.includes("|")).length >= 2) {
    return lines
      .map((l) => {
        let s = l.trim();
        if (!s.includes("|")) return [s];
        if (s.startsWith("|")) s = s.slice(1);
        if (s.endsWith("|")) s = s.slice(0, -1);
        return s.split("|").map((c) => c.trim());
      })
      .filter((r) => !(r.length > 1 && r.every((c) => SEPARATOR_CELL.test(c.trim()) || c.trim() === "")));
  }
  return parseCsv(t);
}

export type RawProductRow = {
  /** 1-based row number in what the person gave us, for "แถว 12". */
  line: number;
  name: string;
  category: string;
  buyUnit: string;
  packQty: string;
  packUnit: string;
  original: string;
  unsure: string;
};

export type TableResult =
  | { ok: true; rows: RawProductRow[] }
  | { ok: false; reason: "NO_HEADER" | "ONLY_RECIPES" | "TOO_MANY" | "EMPTY" };

/**
 * Find the products table in a grid of cells and read it. The header row is
 * the first row with a "ชื่อ" cell — an AI often writes a title line above the
 * table — and the table ends where the recipes table ("ชื่อเมนู") begins.
 */
export function readProductTable(grid: string[][]): TableResult {
  let headerAt = -1;
  const col: Partial<Record<ProductColumn, number>> = {};
  let sawRecipeHeader = false;
  for (let r = 0; r < grid.length; r++) {
    const cells = grid[r].map((c) => cleanHeader(String(c ?? "")));
    if (cells.includes(RECIPE_COLUMNS[0])) sawRecipeHeader = true;
    const nameAt = cells.findIndex((c) => HEADER_ALIASES[c] === "name");
    if (nameAt === -1) continue;
    headerAt = r;
    cells.forEach((c, i) => {
      const key = HEADER_ALIASES[c];
      if (key !== undefined && col[key] === undefined) col[key] = i;
    });
    break;
  }
  if (headerAt === -1) return { ok: false, reason: sawRecipeHeader ? "ONLY_RECIPES" : "NO_HEADER" };

  const width = grid[headerAt].length;
  const cell = (cells: string[], key: ProductColumn) => {
    const i = col[key];
    return i === undefined ? "" : String(cells[i] ?? "").trim();
  };
  const rows: RawProductRow[] = [];
  for (let r = headerAt + 1; r < grid.length; r++) {
    const cells = grid[r].map((c) => String(c ?? ""));
    if (cells.some((c) => cleanHeader(c) === RECIPE_COLUMNS[0])) break;
    if (cells.every((c) => c.trim() === "")) continue;
    // A title line between two tables ("แผ่น “สูตร”") is one cell wide.
    if (width > 1 && cells.filter((c) => c.trim() !== "").length === 1 && cells.length === 1) continue;
    rows.push({
      line: r + 1,
      name: cell(cells, "name"),
      category: cell(cells, "category"),
      buyUnit: cell(cells, "buyUnit"),
      packQty: cell(cells, "packQty"),
      packUnit: cell(cells, "packUnit"),
      original: cell(cells, "original"),
      unsure: cell(cells, "unsure"),
    });
  }
  if (rows.length === 0) return { ok: false, reason: "EMPTY" };
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, reason: "TOO_MANY" };
  return { ok: true, rows };
}

/** How many menus a recipes table names — shown, not imported, until the recipe import exists. */
export function countRecipeMenus(grid: string[][]): number {
  let at = -1;
  for (let r = 0; r < grid.length; r++) {
    const i = grid[r].map((c) => cleanHeader(String(c ?? ""))).indexOf(RECIPE_COLUMNS[0]);
    if (i !== -1) {
      at = i;
      const names = new Set<string>();
      for (let k = r + 1; k < grid.length; k++) {
        const v = String(grid[k][at] ?? "").trim();
        if (v !== "") names.add(nameKey(v));
      }
      return names.size;
    }
  }
  return 0;
}

export const TABLE_ERROR_TH: Record<Exclude<TableResult, { ok: true }>["reason"], string> = {
  NO_HEADER: `ไม่พบคอลัมน์ “${PRODUCT_COLUMNS.name}” — ไฟล์นี้อาจไม่ได้ทำตามคำสั่งของคิดครัว ลองคัดลอกคำสั่งไปให้ AI ทำใหม่ หรือใช้แม่แบบ`,
  ONLY_RECIPES: `ไฟล์นี้มีแต่แผ่น “${RECIPE_SHEET}” ยังไม่มีแผ่น “${PRODUCT_SHEET}” — ตอนนี้นำเข้าได้เฉพาะวัตถุดิบ`,
  TOO_MANY: `มีมากกว่า ${MAX_IMPORT_ROWS.toLocaleString("th-TH")} แถว — แบ่งเป็นหลายไฟล์แล้วนำเข้าทีละไฟล์`,
  EMPTY: "ไม่พบรายการวัตถุดิบในตาราง",
};

// ------------------------------------------------------------
// 3. Units
// ------------------------------------------------------------

/**
 * The shop writes units as it speaks; the system knows each size under ONE
 * name (Kong 2026-10-21: g · kg · ml · l, everything else Thai). Only
 * spellings of the SAME size are folded here — nothing converts a ทัพพี.
 */
const UNIT_ALIASES: Record<string, string> = {
  "กก.": "kg", กก: "kg", กิโล: "kg", กิโลกรัม: "kg", โล: "kg", kg: "kg", kgs: "kg", "kg.": "kg",
  กรัม: "g", "ก.": "g", g: "g", gr: "g", gram: "g", "g.": "g",
  ลิตร: "l", "ล.": "l", l: "l", liter: "l", litre: "l",
  "มล.": "ml", มล: "ml", มิลลิลิตร: "ml", ml: "ml", cc: "ml", ซีซี: "ml", "ซี.ซี.": "ml",
  แพค: "แพ็ค", แพ็ก: "แพ็ค", แพก: "แพ็ค", pack: "แพ็ค",
  "ช.ต.": "ช้อนโต๊ะ", "ชต.": "ช้อนโต๊ะ", "ช.ช.": "ช้อนชา", "ชช.": "ช้อนชา",
};

export function normalizeUnit(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (s === "") return null;
  return UNIT_ALIASES[s.toLowerCase()] ?? s;
}

export type UnitTemplate = { unitName: string; unitDimension: string };

// ------------------------------------------------------------
// 4. Names
// ------------------------------------------------------------

/** The form two names are compared in: spacing, zero-width marks and case do not make a new product. */
export function nameKey(s: string): string {
  return s.normalize("NFC").replace(/[​-‍﻿]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function trigrams(s: string): Set<string> {
  const t = `  ${nameKey(s)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

function jaccard(A: Set<string>, B: Set<string>): number {
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** pg_trgm's similarity, over characters (Thai has no spaces to split words on). */
export function nameSimilarity(a: string, b: string): number {
  return jaccard(trigrams(a), trigrams(b));
}

/** ADR 0010's threshold for "probably the same thing" — reused, not re-tuned. */
export const SIMILAR_AT = 0.4;

/**
 * The closest name in a list, with its trigrams computed once — for a screen
 * that matches hundreds of lines against hundreds of names.
 */
export function nameIndex<T extends { name: string }>(items: T[]) {
  const grams = items.map((p) => trigrams(p.name));
  return (name: string, min = SIMILAR_AT): { item: T; score: number } | null => {
    const mine = trigrams(name);
    let best: T | null = null;
    let score = 0;
    for (let i = 0; i < items.length; i++) {
      const s = jaccard(mine, grams[i]);
      if (s > score) {
        score = s;
        best = items[i];
      }
    }
    return best !== null && score >= min ? { item: best, score } : null;
  };
}

export type ExistingProduct = { id: string; name: string; sku: string };

// ------------------------------------------------------------
// 5. A row, decided
// ------------------------------------------------------------

export type CategoryOption = { id: string; label: string };

/** What the review screen holds for one row; the person edits these fields. */
export type ImportDraft = {
  line: number;
  name: string;
  original: string;
  unsure: string;
  fromMethod: boolean;
  /** As the AI wrote it, normalised; shown in "ซื้อเป็น". */
  buyUnit: string | null;
  /** The unit stock is counted in. Must be a template unit. */
  baseUnit: string | null;
  /** The buy unit, kept as a second unit when it differs from the base. */
  extraUnit: string | null;
  /** 1 extraUnit = extraRatio baseUnit; null when nobody wrote it. */
  extraRatio: number | null;
  categoryId: string | null;
  /** Something the AI put in the category column that matched none of the shop's. */
  categoryText: string;
  packUnreadable: boolean;
  /** The person pressed "ข้าม". */
  skip: boolean;
  /** For a close name: true = it IS the existing product (skip), false = create a new one. */
  sameAsSimilar: boolean;
};

/** Read one raw row into the draft the review screen starts from. */
export function draftFromRaw(raw: RawProductRow, ctx: { templates: UnitTemplate[]; categories: CategoryOption[] }): ImportDraft {
  const isTemplate = (u: string | null) => u !== null && ctx.templates.some((t) => t.unitName === u);
  const buy = normalizeUnit(raw.buyUnit);
  const packUnit = normalizeUnit(raw.packUnit);
  const pack = parseFileNumber(raw.packQty);
  const packQty = pack.ok && pack.value > 0 ? pack.value : null;
  const packUnreadable = raw.packQty.trim() !== "" && packQty === null;

  let baseUnit: string | null = null;
  let extraUnit: string | null = null;
  let extraRatio: number | null = null;
  if (packQty !== null && isTemplate(packUnit)) {
    // "กระสอบ 15 กก." — count in kg, buy by the sack.
    baseUnit = packUnit;
    if (buy !== null && buy !== packUnit) {
      extraUnit = buy;
      extraRatio = packQty;
    }
  } else if (isTemplate(buy)) {
    baseUnit = buy;
  } else if (buy !== null) {
    // "กำ" — not a size the system knows; the person picks what to count in.
    extraUnit = buy;
  }

  const catKey = nameKey(raw.category);
  const category = catKey === "" ? undefined : ctx.categories.find((c) => nameKey(c.label) === catKey);

  return {
    line: raw.line,
    name: raw.name.trim(),
    original: raw.original,
    unsure: raw.unsure,
    fromMethod: raw.unsure.includes(FROM_METHOD_MARK),
    buyUnit: buy,
    baseUnit,
    extraUnit,
    extraRatio,
    categoryId: category?.id ?? null,
    categoryText: category === undefined ? raw.category.trim() : "",
    packUnreadable,
    skip: false,
    sameAsSimilar: true,
  };
}

export type DraftMatch =
  | { kind: "EXISTS"; product: ExistingProduct }
  | { kind: "SIMILAR"; product: ExistingProduct; score: number }
  | { kind: "DUPLICATE"; line: number }
  | null;

export type DraftStatus =
  /** Nothing will be written for this row. */
  | { kind: "SKIP"; why: "PRESSED" | "EXISTS" | "SAME_AS_SIMILAR" | "DUPLICATE" }
  /** Must be fixed (or skipped) before saving. */
  | { kind: "NEED"; why: "NAME" | "UNIT" | "RATIO" }
  /** Will be created. `review` = worth a look (AI unsure, close name kept apart, …). */
  | { kind: "CREATE"; review: boolean };

/** Match every draft against the shop's products and against the rows above it. */
export function matchDrafts(drafts: ImportDraft[], existing: ExistingProduct[]): DraftMatch[] {
  const byKey = new Map(existing.map((p) => [nameKey(p.name), p]));
  const grams = existing.map((p) => trigrams(p.name));
  const firstLine = new Map<string, number>();
  return drafts.map((d) => {
    const key = nameKey(d.name);
    if (key === "") return null;
    const hit = byKey.get(key);
    if (hit) return { kind: "EXISTS", product: hit };
    if (!d.skip) {
      const first = firstLine.get(key);
      if (first !== undefined) return { kind: "DUPLICATE", line: first };
      firstLine.set(key, d.line);
    }
    const mine = trigrams(d.name);
    let best: ExistingProduct | null = null;
    let score = 0;
    for (let i = 0; i < existing.length; i++) {
      const s = jaccard(mine, grams[i]);
      if (s > score) {
        score = s;
        best = existing[i];
      }
    }
    return best !== null && score >= SIMILAR_AT ? { kind: "SIMILAR", product: best, score } : null;
  });
}

export function draftStatus(d: ImportDraft, m: DraftMatch, templates: UnitTemplate[]): DraftStatus {
  if (d.skip) return { kind: "SKIP", why: "PRESSED" };
  if (m?.kind === "EXISTS") return { kind: "SKIP", why: "EXISTS" };
  if (m?.kind === "DUPLICATE") return { kind: "SKIP", why: "DUPLICATE" };
  if (m?.kind === "SIMILAR" && d.sameAsSimilar) return { kind: "SKIP", why: "SAME_AS_SIMILAR" };
  if (d.name.trim() === "") return { kind: "NEED", why: "NAME" };
  if (d.baseUnit === null || !templates.some((t) => t.unitName === d.baseUnit)) return { kind: "NEED", why: "UNIT" };
  if (d.extraRatio !== null && !(d.extraRatio > 0)) return { kind: "NEED", why: "RATIO" };
  const review = d.unsure.trim() !== "" || d.packUnreadable || m?.kind === "SIMILAR" || d.categoryText !== "";
  return { kind: "CREATE", review };
}

/** What the server is asked to create — the same shape it validates. */
export type ImportCreate = {
  name: string;
  baseUnitName: string;
  categoryId: string | null;
  extraUnit: { unitName: string; toBaseRatio: number } | null;
};

export function toCreate(d: ImportDraft): ImportCreate {
  const keepExtra = d.extraUnit !== null && d.extraRatio !== null && d.extraRatio > 0 && d.extraUnit !== d.baseUnit;
  return {
    name: d.name.trim(),
    baseUnitName: d.baseUnit ?? "",
    categoryId: d.categoryId,
    extraUnit: keepExtra ? { unitName: d.extraUnit!, toBaseRatio: d.extraRatio! } : null,
  };
}

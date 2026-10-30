// ============================================================
// คิดครัว — recipes from the file the shop's own AI prepared (คิวงานข้อ 5d)
// ============================================================
// Kong 2026-10-30 ("ต่อเรื่องนำเข้าสูตรเลย"); the recipes tab of mockup
// R3vZEuvaWr2gWQosAgYfkA round 3. The SAME file as the ingredient import —
// its sheet "สูตร", one row per ingredient per dish.
//
// Every recipe lands as a DRAFT (Part 24, ADR 0025): a draft resolves on no
// day, so nothing here moves stock or cost until the shop presses "ใช้สูตร"
// for that dish in ทดลองเมนู. The import's job is to make each draft right:
//   - the dish is matched to a menu by name (POS menus come in with the sales
//     file); a close name is a question, no match must be decided;
//   - an ingredient is matched to a product; no match must be decided — a
//     recipe missing an ingredient is wrong in silence, so it is never skipped
//     by default;
//   - a quantity the AI left blank must be typed or the line skipped;
//   - a size the system knows (ขีด → kg) is converted by itself; a kitchen
//     measure (ทัพพี, กำ) is asked ONCE and becomes a unit of that product,
//     for every recipe after it.
// A shop-made component (น้ำซุป with a recipe of its own) is a PREPPED
// product with a production recipe in this system, not a dish. The review
// guesses which recipes are that — another recipe uses it as an ingredient, or
// it yields kilos or litres and no menu has its name — and lets the person
// switch each one (Kong 2026-10-30, "เอาตามที่แนะนำ"). Those are written LIVE,
// not as drafts: nothing moves stock until a production or a dish that uses it
// is recorded, and Menu Lab has no draft of a production recipe to publish.
//
// Pure — the review screen and the server's save use the same functions.
// ============================================================

import { parseFileNumber } from "@/lib/sales-file";
import { FROM_METHOD_MARK, RECIPE_COLUMNS, nameIndex, nameKey, normalizeUnit, SIMILAR_AT } from "@/lib/product-import";

// ------------------------------------------------------------
// 1. Grid → rows
// ------------------------------------------------------------

export type RawRecipeRow = {
  line: number;
  menu: string;
  yieldQty: string;
  yieldUnit: string;
  ingredient: string;
  qty: string;
  unit: string;
  original: string;
  unsure: string;
};

const KEYS = ["menu", "yieldQty", "yieldUnit", "ingredient", "qty", "unit", "original", "unsure"] as const;
const cleanHeader = (s: string) => s.replace(/[*"“”'`]/g, "").trim().replace(/\s+/g, "");

export type RecipeTableResult = { ok: true; rows: RawRecipeRow[] } | { ok: false; reason: "NO_HEADER" | "EMPTY" | "TOO_MANY" };
export const MAX_RECIPE_ROWS = 5000;

export const RECIPE_TABLE_ERROR_TH: Record<Exclude<RecipeTableResult, { ok: true }>["reason"], string> = {
  NO_HEADER: `ไม่พบแผ่น “สูตร” (คอลัมน์ “${RECIPE_COLUMNS[0]}” และ “${RECIPE_COLUMNS[3]}”) — ใช้ไฟล์เดียวกับที่ทำตามคำสั่งของคิดครัว`,
  EMPTY: "ไม่พบบรรทัดสูตรในตาราง",
  TOO_MANY: `มีมากกว่า ${MAX_RECIPE_ROWS.toLocaleString("th-TH")} บรรทัด — แบ่งเป็นหลายไฟล์`,
};

/** The recipes table: its header row has "ชื่อเมนู" and "วัตถุดิบ". */
export function readRecipeTable(grid: string[][]): RecipeTableResult {
  let at = -1;
  const col: Partial<Record<(typeof KEYS)[number], number>> = {};
  for (let r = 0; r < grid.length; r++) {
    const cells = grid[r].map((c) => cleanHeader(String(c ?? "")));
    if (!cells.includes(RECIPE_COLUMNS[0]) || !cells.includes(RECIPE_COLUMNS[3])) continue;
    at = r;
    RECIPE_COLUMNS.forEach((h, k) => {
      const i = cells.indexOf(h.replace(/\s+/g, ""));
      if (i !== -1) col[KEYS[k]] = i;
    });
    break;
  }
  if (at === -1) return { ok: false, reason: "NO_HEADER" };
  const rows: RawRecipeRow[] = [];
  let menu = "";
  for (let r = at + 1; r < grid.length; r++) {
    const cells = grid[r].map((c) => String(c ?? ""));
    if (cells.every((c) => c.trim() === "")) continue;
    if (cells.length === 1) continue;
    const get = (k: (typeof KEYS)[number]) => (col[k] === undefined ? "" : String(cells[col[k]!] ?? "").trim());
    // A dish's name is often written once, on its first line.
    if (get("menu") !== "") menu = get("menu");
    if (get("ingredient") === "") continue;
    rows.push({ line: r + 1, menu, yieldQty: get("yieldQty"), yieldUnit: get("yieldUnit"), ingredient: get("ingredient"), qty: get("qty"), unit: get("unit"), original: get("original"), unsure: get("unsure") });
  }
  if (rows.length === 0) return { ok: false, reason: "EMPTY" };
  if (rows.length > MAX_RECIPE_ROWS) return { ok: false, reason: "TOO_MANY" };
  return { ok: true, rows };
}

// ------------------------------------------------------------
// 2. What the review matches against
// ------------------------------------------------------------

export type RecipeProduct = {
  id: string;
  name: string;
  sku: string;
  dimension: string;
  type: "RAW" | "PREPPED";
  /** How the shop already makes it: a production recipe, or cut from another product. */
  made: "RECIPE" | "TRIM" | null;
  units: { id: string; unitName: string; toBaseRatio: number; isBase: boolean }[];
};
export type RecipeMenu = { id: string; name: string; code: string | null; hasRecipe: boolean; drafts: number };
export type RecipeTemplate = { unitName: string; unitDimension: string; toSiRatio: number | null };
export type RecipeContext = {
  menus: RecipeMenu[];
  products: RecipeProduct[];
  templates: RecipeTemplate[];
  canCreateProducts: boolean;
  /** ISO day the shop-made recipes start: the first sales day, within the ledger's window. */
  madeFrom: string;
};

// ------------------------------------------------------------
// 3. Drafts
// ------------------------------------------------------------

export type IngChoice =
  | { kind: "PRODUCT"; id: string }
  | { kind: "NEW"; name: string; baseUnit: string | null }
  /** What another recipe in this file makes (น้ำซุป) — whichever product that turns out to be. */
  | { kind: "MADE"; key: string }
  | { kind: "SKIP" }
  | { kind: "UNSET" };

export type IngDraft = {
  line: number;
  ingredient: string;
  original: string;
  unsure: string;
  fromMethod: boolean;
  qty: number | null;
  qtyText: string;
  unit: string | null;
  proposal: { productId: string; how: "EXACT" | "SIMILAR" } | null;
  choice: IngChoice;
  /** 1 unit = ratio product base units, for a measure the product does not have. */
  ratio: number | null;
};

export type MenuChoice = { kind: "EXISTING"; id: string } | { kind: "NEW"; name: string } | { kind: "SKIP" } | { kind: "UNSET" };
/** The product a shop-made recipe makes. */
export type OutputChoice = { kind: "EXISTING"; id: string } | { kind: "NEW"; name: string; baseUnit: string | null } | { kind: "SKIP" } | { kind: "UNSET" };

export type RecipeDraftRow = {
  key: string;
  menuText: string;
  servings: number | null;
  yieldUnit: string;
  /** A dish that is sold, or something the shop makes for its dishes (น้ำซุป). */
  kind: "MENU" | "MADE";
  /** Why the import took it for shop-made: another recipe uses it, or it yields a batch. */
  madeGuess: "USED" | "BATCH" | null;
  menuHow: "EXACT" | "SIMILAR" | "NONE";
  menu: MenuChoice;
  outputHow: "EXACT" | "SIMILAR" | "NONE";
  output: OutputChoice;
  /** 1 yieldUnit = yieldRatio output base units, for a size the system does not know (หม้อ). */
  yieldRatio: number | null;
  lines: IngDraft[];
};

/** Yields measured by weight or volume are a batch, not a plate. */
const BATCH_UNITS = new Set(["kg", "g", "l", "ml", "ขีด", "หม้อ", "ถัง", "กะละมัง"]);
export const newProductRef = (name: string) => `new:${nameKey(name)}`;

export function draftRecipes(rows: RawRecipeRow[], ctx: RecipeContext): RecipeDraftRow[] {
  const menuByKey = new Map<string, RecipeMenu>();
  for (const m of ctx.menus) if (!menuByKey.has(nameKey(m.name))) menuByKey.set(nameKey(m.name), m);
  const similarMenu = nameIndex(ctx.menus);
  // "กะเพราหมู" in the file, "ข้าวกะเพราหมู" from the POS — either name inside the other.
  const menusByLength = ctx.menus.map((m) => ({ m, k: nameKey(m.name) })).filter((x) => [...x.k].length >= 3).sort((a, b) => b.k.length - a.k.length);
  const menuContaining = (s: string) => {
    const k = nameKey(s);
    return [...k].length < 3 ? undefined : menusByLength.find((x) => x.k.includes(k) || k.includes(x.k))?.m;
  };
  const productByKey = new Map(ctx.products.map((p) => [nameKey(p.name), p]));
  const similarProduct = nameIndex(ctx.products);
  const byLength = ctx.products.map((p) => ({ p, k: nameKey(p.name) })).filter((x) => [...x.k].length >= 3).sort((a, b) => b.k.length - a.k.length);
  const containedIn = (s: string) => byLength.find((x) => nameKey(s).includes(x.k))?.p;
  const isTemplate = (u: string) => ctx.templates.some((t) => t.unitName === u);

  const groups = new Map<string, RawRecipeRow[]>();
  for (const r of rows) {
    const k = nameKey(r.menu);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  // A dish name another dish uses as an ingredient is a component (น้ำซุป).
  const usedAsIngredient = new Set(rows.map((r) => nameKey(r.ingredient)));

  return [...groups.entries()].map(([key, rs]) => {
    const first = rs[0];
    const yieldUnit = normalizeUnit(first.yieldUnit) ?? "";
    const servingsParsed = parseFileNumber(first.yieldQty);
    const exact = menuByKey.get(key);
    const close = exact ? null : similarMenu(first.menu) ?? (() => {
      const hit = menuContaining(first.menu);
      return hit ? { item: hit, score: SIMILAR_AT } : null;
    })();
    // A pot of curry named like a dish on the POS is that dish, cooked by the pot.
    const madeGuess = usedAsIngredient.has(key) ? "USED" : BATCH_UNITS.has(yieldUnit) && !exact && !close ? "BATCH" : null;
    const outExact = productByKey.get(key);
    const outClose = outExact ? null : similarProduct(first.menu)?.item ?? containedIn(first.menu) ?? null;
    return {
      key,
      menuText: first.menu.trim(),
      servings: servingsParsed.ok && servingsParsed.value > 0 ? servingsParsed.value : null,
      yieldUnit,
      kind: madeGuess ? "MADE" : "MENU",
      madeGuess,
      menuHow: exact ? "EXACT" : close ? "SIMILAR" : "NONE",
      menu: exact ? { kind: "EXISTING", id: exact.id } : close ? { kind: "EXISTING", id: close.item.id } : { kind: "UNSET" },
      outputHow: outExact ? "EXACT" : outClose ? "SIMILAR" : "NONE",
      output: outExact
        ? { kind: "EXISTING", id: outExact.id }
        : outClose
          ? { kind: "EXISTING", id: outClose.id }
          : { kind: "NEW", name: first.menu.trim(), baseUnit: isTemplate(yieldUnit) ? yieldUnit : null },
      yieldRatio: null,
      lines: rs.map((r): IngDraft => {
        const ex = productByKey.get(nameKey(r.ingredient));
        const cl = ex ? null : similarProduct(r.ingredient) ?? (() => {
          const hit = containedIn(r.ingredient);
          return hit ? { item: hit, score: SIMILAR_AT } : null;
        })();
        const q = parseFileNumber(r.qty);
        const proposal = ex ? { productId: ex.id, how: "EXACT" as const } : cl ? { productId: cl.item.id, how: "SIMILAR" as const } : null;
        // Another recipe in this file makes it: point at THAT, so switching its
        // product (or creating it) carries every dish that uses it along.
        const madeKey = nameKey(r.ingredient);
        const madeHere = madeKey !== key && groups.has(madeKey);
        return {
          line: r.line,
          ingredient: r.ingredient.trim(),
          original: r.original,
          unsure: r.unsure,
          fromMethod: r.unsure.includes(FROM_METHOD_MARK),
          qty: q.ok && q.value > 0 ? q.value : null,
          qtyText: r.qty,
          unit: normalizeUnit(r.unit),
          proposal,
          choice: madeHere ? { kind: "MADE", key: madeKey } : proposal ? { kind: "PRODUCT", id: proposal.productId } : { kind: "UNSET" },
          ratio: null,
        };
      }),
    };
  });
}

/** What each shop-made recipe in the file makes, by its key — the product its users point at. */
export type MadeOut = {
  product: { id: string } | { ref: string };
  name: string;
  units: { unitName: string; isBase: boolean; toBaseRatio: number }[];
  dimension: string;
  isNew: boolean;
  baseUnitName: string;
};

export function madeOutputs(drafts: RecipeDraftRow[], ctx: RecipeContext): Map<string, MadeOut> {
  const out = new Map<string, MadeOut>();
  for (const r of drafts) {
    if (r.kind !== "MADE") continue;
    const o = r.output;
    if (o.kind === "EXISTING") {
      const p = ctx.products.find((x) => x.id === o.id);
      if (p) out.set(r.key, { product: { id: p.id }, name: p.name, units: p.units, dimension: p.dimension, isNew: false, baseUnitName: p.units.find((u) => u.isBase)!.unitName });
    } else if (o.kind === "NEW" && o.name.trim() !== "") {
      const t = ctx.templates.find((x) => x.unitName === o.baseUnit);
      if (t) out.set(r.key, { product: { ref: newProductRef(o.name) }, name: o.name.trim(), units: [{ unitName: t.unitName, isBase: true, toBaseRatio: 1 }], dimension: t.unitDimension, isNew: true, baseUnitName: t.unitName });
    }
  }
  return out;
}

// ------------------------------------------------------------
// 4. Judging
// ------------------------------------------------------------

export type IngFlag = "UNIT_CONVERTED" | "NO_UNIT" | "MATCH_TO_CHECK" | "AI_UNSURE" | "FROM_METHOD" | "NEW_PRODUCT" | "MADE_HERE";
export type IngNeed = "PRODUCT" | "NAME" | "BASE_UNIT" | "QTY" | "RATIO";

export type IngVerdict =
  | { kind: "SKIP" }
  | { kind: "NEED"; why: IngNeed }
  | { kind: "OK"; flags: IngFlag[]; qty: number; unitName: string; unitIsNew: boolean; ratio: number | null };

export function judgeIngredient(l: IngDraft, ctx: RecipeContext, made: Map<string, MadeOut> = new Map()): IngVerdict {
  const choice = l.choice;
  if (choice.kind === "SKIP") return { kind: "SKIP" };
  if (choice.kind === "UNSET") return { kind: "NEED", why: "PRODUCT" };
  const flags: IngFlag[] = [];
  if (l.fromMethod) flags.push("FROM_METHOD");
  if (l.unsure.replace(FROM_METHOD_MARK, "").trim() !== "") flags.push("AI_UNSURE");

  let units: { unitName: string; isBase: boolean }[];
  let dimension: string;
  if (choice.kind === "MADE") {
    // Its recipe was switched back to a dish, skipped, or has no product yet.
    const m = made.get(choice.key);
    if (!m) return { kind: "NEED", why: "PRODUCT" };
    units = m.units;
    dimension = m.dimension;
    flags.push("MADE_HERE");
  } else if (choice.kind === "NEW") {
    if (choice.name.trim() === "") return { kind: "NEED", why: "NAME" };
    const base = ctx.templates.find((t) => t.unitName === choice.baseUnit);
    if (!base) return { kind: "NEED", why: "BASE_UNIT" };
    units = [{ unitName: base.unitName, isBase: true }];
    dimension = base.unitDimension;
    flags.push("NEW_PRODUCT");
  } else {
    const p = ctx.products.find((x) => x.id === choice.id);
    if (!p) return { kind: "NEED", why: "PRODUCT" };
    units = p.units;
    dimension = p.dimension;
    if (!(l.proposal?.productId === p.id && l.proposal.how === "EXACT")) flags.push("MATCH_TO_CHECK");
  }
  if (l.qty === null) return { kind: "NEED", why: "QTY" };

  const base = units.find((u) => u.isBase)!;
  if (l.unit === null) {
    flags.push("NO_UNIT");
    return { kind: "OK", flags, qty: l.qty, unitName: base.unitName, unitIsNew: false, ratio: null };
  }
  const have = units.find((u) => normalizeUnit(u.unitName) === l.unit);
  if (have) return { kind: "OK", flags, qty: l.qty, unitName: have.unitName, unitIsNew: false, ratio: null };
  const conv = templateRatio(l.unit, base.unitName, dimension, ctx);
  if (conv !== null) {
    flags.push("UNIT_CONVERTED");
    return { kind: "OK", flags, qty: l.qty, unitName: l.unit, unitIsNew: true, ratio: conv };
  }
  if (l.ratio !== null && l.ratio > 0) return { kind: "OK", flags, qty: l.qty, unitName: l.unit, unitIsNew: true, ratio: l.ratio };
  return { kind: "NEED", why: "RATIO" };
}

/** 1 `unit` = ? `base`, when both are sizes the system knows in the same dimension. */
function templateRatio(unit: string, base: string, dimension: string, ctx: RecipeContext): number | null {
  const t = ctx.templates.find((x) => x.unitName === unit);
  const bt = ctx.templates.find((x) => x.unitName === base);
  return t && bt && t.unitDimension === dimension && bt.unitDimension === dimension && t.toSiRatio && bt.toSiRatio ? t.toSiRatio / bt.toSiRatio : null;
}

export type RecipeVerdict =
  | { kind: "SKIP"; why: "PRESSED" | "EMPTY" | "HAS_RECIPE" | "TRIM" }
  | { kind: "NEED"; why: "MENU" | "MENU_NAME" | "LINES" | "OUTPUT" | "OUTPUT_NAME" | "BASE_UNIT" | "YIELD" | "YIELD_UNIT" | "SELF" | "TWICE" }
  /** `servings` is what the recipe row stores: plates for a dish, the output's base units for a shop-made one. */
  | { kind: "READY"; review: boolean; servings: number };

/** Flags that mean "look at this" — a converted size or a link inside the file does not. */
const worthALook = (lines: IngVerdict[]) => lines.some((v) => v.kind === "OK" && v.flags.some((f) => f !== "UNIT_CONVERTED" && f !== "MADE_HERE"));

export function judgeRecipe(r: RecipeDraftRow, ctx: RecipeContext, lines: IngVerdict[], made: Map<string, MadeOut> = new Map()): RecipeVerdict {
  if (r.kind === "MADE") return judgeMade(r, ctx, lines, made);
  if (r.menu.kind === "SKIP") return { kind: "SKIP", why: "PRESSED" };
  if (r.menu.kind === "UNSET") return { kind: "NEED", why: "MENU" };
  if (r.menu.kind === "NEW" && r.menu.name.trim() === "") return { kind: "NEED", why: "MENU_NAME" };
  if (lines.some((v) => v.kind === "NEED")) return { kind: "NEED", why: "LINES" };
  if (!lines.some((v) => v.kind === "OK")) return { kind: "SKIP", why: "EMPTY" };
  const menu = r.menu.kind === "EXISTING" ? ctx.menus.find((m) => m.id === (r.menu as { id: string }).id) : null;
  const review = r.menuHow !== "EXACT" || r.servings === null || (menu?.hasRecipe ?? false) || worthALook(lines);
  return { kind: "READY", review, servings: r.servings ?? 1 };
}

/** Which product a line means, for telling two lines (or a line and the output) apart. */
function lineProductKey(c: IngChoice, made: (key: string) => string | null): string | null {
  if (c.kind === "PRODUCT") return `p:${c.id}`;
  if (c.kind === "NEW") return `n:${nameKey(c.name)}`;
  if (c.kind === "MADE") return made(c.key);
  return null;
}
const outputKey = (o: OutputChoice): string | null => (o.kind === "EXISTING" ? `p:${o.id}` : o.kind === "NEW" ? `n:${nameKey(o.name)}` : null);

function judgeMade(r: RecipeDraftRow, ctx: RecipeContext, lines: IngVerdict[], made: Map<string, MadeOut>): RecipeVerdict {
  const o = r.output;
  if (o.kind === "SKIP") return { kind: "SKIP", why: "PRESSED" };
  if (o.kind === "UNSET") return { kind: "NEED", why: "OUTPUT" };
  let units: { unitName: string; isBase: boolean; toBaseRatio: number }[];
  let dimension: string;
  if (o.kind === "EXISTING") {
    const p = ctx.products.find((x) => x.id === o.id);
    if (!p) return { kind: "NEED", why: "OUTPUT" };
    // One way to make a thing (ADR 0021 Q1): the import does not replace a
    // production recipe already in use, nor add one to a product cut from another.
    if (p.made === "RECIPE") return { kind: "SKIP", why: "HAS_RECIPE" };
    if (p.made === "TRIM") return { kind: "SKIP", why: "TRIM" };
    units = p.units;
    dimension = p.dimension;
  } else {
    if (o.name.trim() === "") return { kind: "NEED", why: "OUTPUT_NAME" };
    const t = ctx.templates.find((x) => x.unitName === o.baseUnit);
    if (!t) return { kind: "NEED", why: "BASE_UNIT" };
    units = [{ unitName: t.unitName, isBase: true, toBaseRatio: 1 }];
    dimension = t.unitDimension;
  }
  if (r.servings === null) return { kind: "NEED", why: "YIELD" };
  const ratio = yieldRatio(r, units, dimension, ctx);
  if (ratio === null) return { kind: "NEED", why: "YIELD_UNIT" };
  const servings = Math.round(r.servings * ratio * 1000) / 1000;
  if (!(servings > 0)) return { kind: "NEED", why: "YIELD" };

  const self = outputKey(o);
  const madeKey = (key: string) => {
    if (key === r.key) return self;
    const m = made.get(key);
    return m === undefined ? null : "id" in m.product ? `p:${m.product.id}` : `n:${m.product.ref.slice("new:".length)}`;
  };
  const keys = r.lines.map((l, i) => (lines[i].kind === "OK" ? lineProductKey(l.choice, madeKey) : null)).filter((k): k is string => k !== null);
  if (self !== null && keys.includes(self)) return { kind: "NEED", why: "SELF" };
  // The production recipe form refuses the same thing twice; say so here.
  if (new Set(keys).size !== keys.length) return { kind: "NEED", why: "TWICE" };
  if (lines.some((v) => v.kind === "NEED")) return { kind: "NEED", why: "LINES" };
  if (!lines.some((v) => v.kind === "OK")) return { kind: "SKIP", why: "EMPTY" };
  const review = r.outputHow !== "EXACT" || r.yieldUnit === "" || worthALook(lines);
  return { kind: "READY", review, servings };
}

/** 1 yield unit = ? base units of what the recipe makes. A blank unit is the base unit. */
export function yieldRatio(r: RecipeDraftRow, units: { unitName: string; isBase: boolean; toBaseRatio: number }[], dimension: string, ctx: RecipeContext): number | null {
  if (r.yieldUnit === "") return 1;
  const have = units.find((u) => normalizeUnit(u.unitName) === r.yieldUnit);
  if (have) return have.toBaseRatio;
  const conv = templateRatio(r.yieldUnit, units.find((u) => u.isBase)!.unitName, dimension, ctx);
  if (conv !== null) return conv;
  return r.yieldRatio !== null && r.yieldRatio > 0 ? r.yieldRatio : null;
}

// ------------------------------------------------------------
// 5. The save
// ------------------------------------------------------------

type SaveLine = { product: { id: string } | { ref: string }; unitName: string; ratio: number | null; qty: number; note: string | null };

export type RecipeSave = {
  newMenus: { ref: string; name: string }[];
  newProducts: { ref: string; name: string; baseUnitName: string; prepped: boolean }[];
  /** Existing ingredients that turned out to be made in the shop — RAW → PREPPED. */
  convert: string[];
  recipes: { menu: { id: string } | { ref: string }; servings: number; lines: SaveLine[] }[];
  /** Production recipes, written live; `servings` is in the output's base unit. */
  made: { output: { id: string } | { ref: string }; servings: number; lines: SaveLine[] }[];
};

export function toRecipeSave(drafts: RecipeDraftRow[], ctx: RecipeContext): RecipeSave {
  const newMenus = new Map<string, RecipeSave["newMenus"][number]>();
  const newProducts = new Map<string, RecipeSave["newProducts"][number]>();
  const addProduct = (ref: string, name: string, baseUnitName: string, prepped: boolean) => {
    const had = newProducts.get(ref);
    if (had) had.prepped ||= prepped;
    else newProducts.set(ref, { ref, name, baseUnitName, prepped });
  };
  const convert = new Set<string>();
  const recipes: RecipeSave["recipes"] = [];
  const madeList: RecipeSave["made"] = [];
  const made = madeOutputs(drafts, ctx);
  for (const r of drafts) {
    const lineVerdicts = r.lines.map((l) => judgeIngredient(l, ctx, made));
    const verdict = judgeRecipe(r, ctx, lineVerdicts, made);
    if (verdict.kind !== "READY") continue;
    const lines: SaveLine[] = [];
    r.lines.forEach((l, i) => {
      const v = lineVerdicts[i];
      if (v.kind !== "OK") return;
      let product: { id: string } | { ref: string };
      if (l.choice.kind === "NEW") {
        const ref = newProductRef(l.choice.name);
        addProduct(ref, l.choice.name.trim(), l.choice.baseUnit!, false);
        product = { ref };
      } else if (l.choice.kind === "MADE") {
        const m = made.get(l.choice.key)!;
        if (m.isNew) addProduct(newProductRef(m.name), m.name, m.baseUnitName, true);
        product = m.product;
      } else if (l.choice.kind === "PRODUCT") product = { id: l.choice.id };
      else return;
      lines.push({ product, unitName: v.unitName, ratio: v.unitIsNew ? v.ratio : null, qty: v.qty, note: l.original !== "" ? l.original.slice(0, 300) : null });
    });
    if (r.kind === "MADE") {
      const o = r.output;
      let output: { id: string } | { ref: string };
      if (o.kind === "EXISTING") {
        output = { id: o.id };
        if (ctx.products.find((p) => p.id === o.id)?.type === "RAW") convert.add(o.id);
      } else if (o.kind === "NEW") {
        const ref = newProductRef(o.name);
        addProduct(ref, o.name.trim(), o.baseUnit!, true);
        output = { ref };
      } else continue;
      madeList.push({ output, servings: verdict.servings, lines });
      continue;
    }
    let menu: { id: string } | { ref: string };
    if (r.menu.kind === "NEW") {
      const ref = `new:${nameKey(r.menu.name)}`;
      if (!newMenus.has(ref)) newMenus.set(ref, { ref, name: r.menu.name.trim() });
      menu = { ref };
    } else if (r.menu.kind === "EXISTING") menu = { id: r.menu.id };
    else continue;
    recipes.push({ menu, servings: verdict.servings, lines });
  }
  return { newMenus: [...newMenus.values()], newProducts: [...newProducts.values()], convert: [...convert], recipes, made: madeList };
}

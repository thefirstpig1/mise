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
// product with a production recipe in this system — not a draft — so this
// version names it and leaves it for the recipes screen.
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
  units: { id: string; unitName: string; toBaseRatio: number; isBase: boolean }[];
};
export type RecipeMenu = { id: string; name: string; code: string | null; hasRecipe: boolean; drafts: number };
export type RecipeTemplate = { unitName: string; unitDimension: string; toSiRatio: number | null };
export type RecipeContext = { menus: RecipeMenu[]; products: RecipeProduct[]; templates: RecipeTemplate[]; canCreateProducts: boolean };

// ------------------------------------------------------------
// 3. Drafts
// ------------------------------------------------------------

export type IngChoice = { kind: "PRODUCT"; id: string } | { kind: "NEW"; name: string; baseUnit: string | null } | { kind: "SKIP" } | { kind: "UNSET" };

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

export type RecipeDraftRow = {
  key: string;
  menuText: string;
  servings: number | null;
  yieldUnit: string;
  /** A shop-made component with a recipe of its own — not a dish. */
  component: boolean;
  menuHow: "EXACT" | "SIMILAR" | "NONE";
  menu: MenuChoice;
  lines: IngDraft[];
};

/** Yields measured by weight or volume are a batch, not a plate. */
const BATCH_UNITS = new Set(["kg", "g", "l", "ml", "ขีด", "หม้อ", "ถัง", "กะละมัง"]);

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
    const component = usedAsIngredient.has(key) || BATCH_UNITS.has(yieldUnit);
    const exact = menuByKey.get(key);
    const close = exact ? null : similarMenu(first.menu) ?? (() => {
      const hit = menuContaining(first.menu);
      return hit ? { item: hit, score: SIMILAR_AT } : null;
    })();
    return {
      key,
      menuText: first.menu.trim(),
      servings: servingsParsed.ok && servingsParsed.value > 0 ? servingsParsed.value : null,
      yieldUnit,
      component,
      menuHow: exact ? "EXACT" : close ? "SIMILAR" : "NONE",
      menu: component ? { kind: "SKIP" } : exact ? { kind: "EXISTING", id: exact.id } : close ? { kind: "EXISTING", id: close.item.id } : { kind: "UNSET" },
      lines: rs.map((r): IngDraft => {
        const ex = productByKey.get(nameKey(r.ingredient));
        const cl = ex ? null : similarProduct(r.ingredient) ?? (() => {
          const hit = containedIn(r.ingredient);
          return hit ? { item: hit, score: SIMILAR_AT } : null;
        })();
        const q = parseFileNumber(r.qty);
        const proposal = ex ? { productId: ex.id, how: "EXACT" as const } : cl ? { productId: cl.item.id, how: "SIMILAR" as const } : null;
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
          choice: proposal ? { kind: "PRODUCT", id: proposal.productId } : { kind: "UNSET" },
          ratio: null,
        };
      }),
    };
  });
}

// ------------------------------------------------------------
// 4. Judging
// ------------------------------------------------------------

export type IngFlag = "UNIT_CONVERTED" | "NO_UNIT" | "MATCH_TO_CHECK" | "AI_UNSURE" | "FROM_METHOD" | "NEW_PRODUCT";
export type IngNeed = "PRODUCT" | "NAME" | "BASE_UNIT" | "QTY" | "RATIO";

export type IngVerdict =
  | { kind: "SKIP" }
  | { kind: "NEED"; why: IngNeed }
  | { kind: "OK"; flags: IngFlag[]; qty: number; unitName: string; unitIsNew: boolean; ratio: number | null };

export function judgeIngredient(l: IngDraft, ctx: RecipeContext): IngVerdict {
  const choice = l.choice;
  if (choice.kind === "SKIP") return { kind: "SKIP" };
  if (choice.kind === "UNSET") return { kind: "NEED", why: "PRODUCT" };
  const flags: IngFlag[] = [];
  if (l.fromMethod) flags.push("FROM_METHOD");
  if (l.unsure.replace(FROM_METHOD_MARK, "").trim() !== "") flags.push("AI_UNSURE");

  let units: { unitName: string; isBase: boolean }[];
  let dimension: string;
  if (choice.kind === "NEW") {
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
  const t = ctx.templates.find((x) => x.unitName === l.unit);
  const bt = ctx.templates.find((x) => x.unitName === base.unitName);
  if (t && bt && t.unitDimension === dimension && bt.unitDimension === dimension && t.toSiRatio && bt.toSiRatio) {
    flags.push("UNIT_CONVERTED");
    return { kind: "OK", flags, qty: l.qty, unitName: l.unit, unitIsNew: true, ratio: t.toSiRatio / bt.toSiRatio };
  }
  if (l.ratio !== null && l.ratio > 0) return { kind: "OK", flags, qty: l.qty, unitName: l.unit, unitIsNew: true, ratio: l.ratio };
  return { kind: "NEED", why: "RATIO" };
}

export type RecipeVerdict =
  | { kind: "SKIP"; why: "COMPONENT" | "PRESSED" | "EMPTY" }
  | { kind: "NEED"; why: "MENU" | "MENU_NAME" | "LINES" }
  | { kind: "READY"; review: boolean };

export function judgeRecipe(r: RecipeDraftRow, ctx: RecipeContext, lines: IngVerdict[]): RecipeVerdict {
  if (r.component) return { kind: "SKIP", why: "COMPONENT" };
  if (r.menu.kind === "SKIP") return { kind: "SKIP", why: "PRESSED" };
  if (r.menu.kind === "UNSET") return { kind: "NEED", why: "MENU" };
  if (r.menu.kind === "NEW" && r.menu.name.trim() === "") return { kind: "NEED", why: "MENU_NAME" };
  if (lines.some((v) => v.kind === "NEED")) return { kind: "NEED", why: "LINES" };
  if (!lines.some((v) => v.kind === "OK")) return { kind: "SKIP", why: "EMPTY" };
  const menu = r.menu.kind === "EXISTING" ? ctx.menus.find((m) => m.id === (r.menu as { id: string }).id) : null;
  const review =
    r.menuHow !== "EXACT" ||
    r.servings === null ||
    (menu?.hasRecipe ?? false) ||
    lines.some((v) => v.kind === "OK" && v.flags.some((f) => f !== "UNIT_CONVERTED"));
  return { kind: "READY", review };
}

// ------------------------------------------------------------
// 5. The save
// ------------------------------------------------------------

export type RecipeSave = {
  newMenus: { ref: string; name: string }[];
  newProducts: { ref: string; name: string; baseUnitName: string }[];
  recipes: {
    menu: { id: string } | { ref: string };
    servings: number;
    lines: { product: { id: string } | { ref: string }; unitName: string; ratio: number | null; qty: number; note: string | null }[];
  }[];
};

export function toRecipeSave(drafts: RecipeDraftRow[], ctx: RecipeContext): RecipeSave {
  const newMenus = new Map<string, RecipeSave["newMenus"][number]>();
  const newProducts = new Map<string, RecipeSave["newProducts"][number]>();
  const recipes: RecipeSave["recipes"] = [];
  for (const r of drafts) {
    const lineVerdicts = r.lines.map((l) => judgeIngredient(l, ctx));
    if (judgeRecipe(r, ctx, lineVerdicts).kind !== "READY") continue;
    let menu: { id: string } | { ref: string };
    if (r.menu.kind === "NEW") {
      const ref = `new:${nameKey(r.menu.name)}`;
      if (!newMenus.has(ref)) newMenus.set(ref, { ref, name: r.menu.name.trim() });
      menu = { ref };
    } else if (r.menu.kind === "EXISTING") menu = { id: r.menu.id };
    else continue;
    const lines: RecipeSave["recipes"][number]["lines"] = [];
    r.lines.forEach((l, i) => {
      const v = lineVerdicts[i];
      if (v.kind !== "OK") return;
      let product: { id: string } | { ref: string };
      if (l.choice.kind === "NEW") {
        const ref = `new:${nameKey(l.choice.name)}`;
        if (!newProducts.has(ref)) newProducts.set(ref, { ref, name: l.choice.name.trim(), baseUnitName: l.choice.baseUnit! });
        product = { ref };
      } else if (l.choice.kind === "PRODUCT") product = { id: l.choice.id };
      else return;
      lines.push({ product, unitName: v.unitName, ratio: v.unitIsNew ? v.ratio : null, qty: v.qty, note: l.original !== "" ? l.original.slice(0, 300) : null });
    });
    recipes.push({ menu, servings: r.servings ?? 1, lines });
  }
  return { newMenus: [...newMenus.values()], newProducts: [...newProducts.values()], recipes };
}

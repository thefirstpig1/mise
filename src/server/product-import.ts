// ============================================================
// คิดครัว — products from a file: read it, then create the reviewed list
// ============================================================
// The rules live in src/lib/product-import.ts, shared with the review screen.
// This module is the two things the browser cannot do: open an .xlsx, and
// write. Reading writes nothing (Kong: "ยังไม่มีอะไรบันทึกจนกว่าจะกด").
// ============================================================

import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { prisma, withTenantContext } from "@/lib/db";
import { decodeSalesFile, looksLikeUtf8Bom, parseCsv } from "@/lib/sales-file";
import {
  PRODUCT_COLUMNS,
  PRODUCT_SHEET,
  RECIPE_COLUMNS,
  RECIPE_SHEET,
  countRecipeMenus,
  nameKey,
  readProductTable,
  splitPastedTable,
  type CategoryOption,
  type ExistingProduct,
  type ImportCreate,
  type TableResult,
  type UnitTemplate,
} from "@/lib/product-import";
import { reserveSkus } from "@/server/product";

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export type ImportContext = {
  existing: ExistingProduct[];
  categories: CategoryOption[];
  templates: UnitTemplate[];
};

/** Everything the review screen matches against. Products are read FRESH at each upload. */
export async function getImportContextLogic(tenantId: string): Promise<ImportContext> {
  const [products, categories, templates] = await Promise.all([
    withTenantContext(tenantId, (tx) =>
      tx.product.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, name: true, sku: true }, orderBy: { name: "asc" } })
    ),
    getImportCategoriesLogic(tenantId),
    getUnitTemplatesForImport(),
  ]);
  return { existing: products, categories, templates };
}

/** The shop's stock categories — what the prompt lists and the review offers. */
export async function getImportCategoriesLogic(tenantId: string): Promise<CategoryOption[]> {
  const rows = await withTenantContext(tenantId, (tx) =>
    tx.category.findMany({
      where: { tenantId, deletedAt: null, account: "COGS" },
      select: { id: true, groupName: true },
      orderBy: [{ accountingSection: "asc" }, { groupName: "asc" }],
    })
  );
  return rows.map((r) => ({ id: r.id, label: r.groupName }));
}

/** unit_template is global reference data — no tenant, no RLS. */
export async function getUnitTemplatesForImport(): Promise<UnitTemplate[]> {
  return prisma.unitTemplate.findMany({
    select: { unitName: true, unitDimension: true },
    orderBy: [{ unitDimension: "asc" }, { displayOrderTh: "asc" }],
  });
}

// ------------------------------------------------------------
// Reading what the person gave us
// ------------------------------------------------------------

export type ReadResult = { table: TableResult; recipeMenus: number };

function readGrid(grid: string[][]): ReadResult {
  return { table: readProductTable(grid), recipeMenus: countRecipeMenus(grid) };
}

/** Pasted text: whatever the AI answered, copied off the screen. */
export function readPastedText(text: string): ReadResult {
  return readGrid(splitPastedTable(text));
}

export type SheetGrid = { name: string; grid: string[][] };

/**
 * An uploaded file as grids of text, one per sheet (a CSV is one unnamed
 * sheet). CSV is decoded the way a Thai Excel writes it: a BOM means UTF-8,
 * otherwise UTF-8 if the bytes are valid UTF-8, else TIS-620. Shared by every
 * import (products, bills).
 */
export async function loadImportGrids(bytes: Uint8Array, fileName: string): Promise<SheetGrid[] | { error: "UNREADABLE" | "UNSUPPORTED" }> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    let text: string;
    if (looksLikeUtf8Bom(bytes)) text = decodeSalesFile(bytes, "UTF8");
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = decodeSalesFile(bytes, "TIS620");
      }
    }
    return [{ name: "", grid: lower.endsWith(".csv") ? parseCsv(text) : splitPastedTable(text) }];
  }
  if (!lower.endsWith(".xlsx")) return { error: "UNSUPPORTED" };

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    return { error: "UNREADABLE" };
  }
  return wb.worksheets.map((ws) => ({ name: ws.name.trim(), grid: sheetGrid(ws) }));
}

/** An uploaded products file. */
export async function readImportFile(bytes: Uint8Array, fileName: string): Promise<ReadResult | { error: "UNREADABLE" | "UNSUPPORTED" }> {
  const grids = await loadImportGrids(bytes, fileName);
  if ("error" in grids) return grids;
  if (grids.length === 1 && grids[0].name === "") return readGrid(grids[0].grid);
  // The products sheet by name; otherwise the first sheet that holds a products table.
  const named = grids.find((g) => g.name === PRODUCT_SHEET);
  const recipes = grids.find((g) => g.name === RECIPE_SHEET);
  const recipeMenus = recipes ? countRecipeMenus(recipes.grid) : grids.reduce((n, g) => Math.max(n, countRecipeMenus(g.grid)), 0);
  if (named) return { table: readProductTable(named.grid), recipeMenus };
  for (const g of grids) {
    const table = readProductTable(g.grid);
    if (table.ok) return { table, recipeMenus };
  }
  return { table: readProductTable(grids[0]?.grid ?? []), recipeMenus };
}

function sheetGrid(ws: ExcelJS.Worksheet): string[][] {
  const grid: string[][] = [];
  const width = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      // A date cell's text is locale-formatted; its value is the fact.
      cells.push(cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : (cell.text ?? ""));
    }
    grid.push(cells);
  }
  return grid;
}

/** The blank template, for a shop that fills it by hand. */
export async function buildImportTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const [name, headers] of [
    [PRODUCT_SHEET, Object.values(PRODUCT_COLUMNS)],
    [RECIPE_SHEET, [...RECIPE_COLUMNS]],
  ] as const) {
    const ws = wb.addWorksheet(name);
    ws.addRow([...headers]);
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 18));
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------
// Writing the reviewed list
// ------------------------------------------------------------

export class ImportUnitError extends Error {
  constructor(public readonly unitName: string) {
    super(`not a unit template: ${unitName}`);
    this.name = "ImportUnitError";
  }
}
export class ImportCategoryError extends Error {
  constructor() {
    super("category is not a live category of this tenant");
    this.name = "ImportCategoryError";
  }
}

export type ImportOutcome = {
  created: { id: string; name: string; sku: string }[];
  /** Names that existed by the time the person pressed save — skipped, not duplicated. */
  skipped: string[];
};

/**
 * Create the reviewed list in ONE transaction: all of it or none of it. Every
 * fact the review screen judged is judged again here — the screen is a
 * convenience, the server is the rule.
 */
export async function importProductsLogic(tenantId: string, rows: ImportCreate[]): Promise<ImportOutcome> {
  return withTenantContext(tenantId, (tx) => importProductsInTx(tx, tenantId, rows), { timeout: 30_000 });
}

/** The same list, inside a transaction the caller holds (the bill import creates products in its own). */
export async function importProductsInTx(tx: PrismaClient, tenantId: string, rows: ImportCreate[]): Promise<ImportOutcome> {
  const templates = await tx.unitTemplate.findMany({ select: { unitName: true, unitDimension: true } });
  const dimensionOf = new Map(templates.map((t) => [t.unitName, t.unitDimension]));
  const templateNames = new Map<string, Set<string>>();
  for (const t of templates) {
    if (!templateNames.has(t.unitDimension)) templateNames.set(t.unitDimension, new Set());
    templateNames.get(t.unitDimension)!.add(t.unitName);
  }

  const categoryIds = [...new Set(rows.map((r) => r.categoryId).filter((v): v is string => v !== null))];
  if (categoryIds.length > 0) {
    const found = await tx.category.count({ where: { tenantId, deletedAt: null, id: { in: categoryIds } } });
    if (found !== categoryIds.length) throw new ImportCategoryError();
  }

  const taken = new Set(
    (await tx.product.findMany({ where: { tenantId, deletedAt: null }, select: { name: true } })).map((p) => nameKey(p.name))
  );
  const skipped: string[] = [];
  const todo: ImportCreate[] = [];
  for (const r of rows) {
    const key = nameKey(r.name);
    if (taken.has(key)) {
      skipped.push(r.name);
      continue;
    }
    if (!dimensionOf.has(r.baseUnitName)) throw new ImportUnitError(r.baseUnitName);
    taken.add(key);
    todo.push(r);
  }
  if (todo.length === 0) return { created: [], skipped };

  const skus = await reserveSkus(tx, tenantId, todo.length);
  const created = await tx.product.createManyAndReturn({
    data: todo.map((r, i) => ({
      tenantId,
      sku: skus[i],
      name: r.name,
      type: "RAW",
      primaryDimension: dimensionOf.get(r.baseUnitName)!,
      categoryId: r.categoryId,
      isActive: true,
    })),
    select: { id: true, name: true, sku: true },
  });
  const idOf = new Map(created.map((p) => [p.sku, p.id]));

  await tx.productUnit.createMany({
    data: todo.flatMap((r, i) => {
      const productId = idOf.get(skus[i])!;
      const dimension = dimensionOf.get(r.baseUnitName)!;
      const extra = r.extraUnit !== null && r.extraUnit.unitName !== r.baseUnitName ? r.extraUnit : null;
      const units = [
        {
          productId,
          unitName: r.baseUnitName,
          unitDimension: dimension,
          toBaseRatio: 1,
          isBase: true,
          // The unit the shop buys in is the one an order should default to.
          isDefaultBuyUnit: extra === null,
          source: "system",
          displayOrder: 0,
        },
      ];
      if (extra !== null) {
        units.push({
          productId,
          unitName: extra.unitName,
          unitDimension: dimension,
          toBaseRatio: extra.toBaseRatio,
          isBase: false,
          isDefaultBuyUnit: true,
          source: templateNames.get(dimension)?.has(extra.unitName) ? "system" : "custom",
          displayOrder: 1,
        });
      }
      return units;
    }),
  });

  // Back in the order the person saw them.
  const bySku = new Map(created.map((p) => [p.sku, p]));
  return { created: skus.map((s) => bySku.get(s)!), skipped };
}

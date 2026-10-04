// The menu screen's READS, as plain GETs to /api/menus (see that route for why
// they are not Server Actions), with the sheets' answers kept per tab so a
// hover can start one and the click finds it ready (Kong 2026-10-04,
// "หน้าไหนโหลดช้า"). Anything that WRITES drops the cache, because a saved
// recipe or yield changes what the next open must show.

import type { IngredientInsight, IngredientOption, MenuSheet, PriceBook, StandardUnit } from "@/server/menu-manager";

type Res<K extends string, T> = ({ ok: true } & { [P in K]: T }) | { ok: false; error: string };

async function read<K extends string, T>(params: Record<string, string>): Promise<Res<K, T>> {
  try {
    const res = await fetch(`/api/menus?${new URLSearchParams(params)}`, { cache: "no-store" });
    if (res.redirected || res.headers.get("content-type")?.includes("text/html")) {
      // Signed out, or refused (requireTenant redirects) — say so, never crash.
      return { ok: false, error: "เปิดไม่ได้ — ลองรีเฟรชหน้า" };
    }
    return (await res.json()) as Res<K, T>;
  } catch {
    return { ok: false, error: "เชื่อมต่อไม่ได้ — ลองอีกครั้ง" };
  }
}

export const priceBook = (branchId: string) => read<"book", PriceBook>({ what: "book", branch: branchId });
export const ingredientOptions = async (): Promise<{ ok: true; options: IngredientOption[]; standards: StandardUnit[] } | { ok: false; error: string }> => {
  const r = (await read<"options", IngredientOption[]>({ what: "options" })) as { ok: true; options: IngredientOption[]; standards?: StandardUnit[] } | { ok: false; error: string };
  return r.ok ? { ok: true, options: r.options, standards: r.standards ?? [] } : r;
};

type SheetRes = Res<"sheet", MenuSheet>;
type InsightRes = Res<"insight", IngredientInsight>;
const sheets = new Map<string, Promise<SheetRes>>();
const insights = new Map<string, Promise<InsightRes>>();

export function menuSheet(menuId: string, branchId: string, fresh = false): Promise<SheetRes> {
  const key = `${menuId}|${branchId}`;
  if (fresh || !sheets.has(key)) {
    const p = read<"sheet", MenuSheet>({ what: "sheet", menu: menuId, branch: branchId });
    // A failed read must not be served again from the cache.
    void p.then((r) => !r.ok && sheets.delete(key));
    sheets.set(key, p);
  }
  return sheets.get(key)!;
}

export function ingredientInsight(productId: string, branchId: string, fresh = false): Promise<InsightRes> {
  const key = `${productId}|${branchId}`;
  if (fresh || !insights.has(key)) {
    const p = read<"insight", IngredientInsight>({ what: "ingredient", product: productId, branch: branchId });
    void p.then((r) => !r.ok && insights.delete(key));
    insights.set(key, p);
  }
  return insights.get(key)!;
}

/** After any save: every sheet may now read differently. */
export function dropPrefetched(): void {
  sheets.clear();
  insights.clear();
}

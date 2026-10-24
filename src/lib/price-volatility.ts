// การผันผวนราคาวัตถุดิบ — the pure rules (Kong 2026-10-24, mockup round 3
// https://claude.ai/artifact/GdWVDbQEZerSWLgWSd3Ago). A plain module so the
// server, the page and the tests share one implementation.
//
// Rule PV-ALLOW — the price the menus can bear. Kong: "ดูราคามะนาว สมมติขึ้นมา
// จากเดือนแรกๆ 500% ผ่านไป 5 ปีเพิ่งมาดูย้อนหลัง ก็ราคาไม่เปลี่ยนมานาน แต่ที่ไหน
// ได้ขายขาดทุนมาตลอด". A price that never moved can still be one no menu can
// carry, and comparing it with its own past will never say so.
//
// For each menu m: k_m = (target_m × price_m) / cost_m — the factor every
// ingredient of m would have to be multiplied by for m to sit exactly on its
// target. A product's k is the average of k_m over the menus that use it,
// weighted by the money it puts into each (cost per plate × plates sold). Its
// allowed price = current price × k. The overspend it causes =
// Σ cost-in-plate × plates × (1 − k_m): the baht by which it pushes its menus
// past their targets (negative = room left). The split assumes every
// ingredient of an over-target dish shares the overrun in proportion to its
// cost — said on screen, never hidden.

export type MenuCostRow = {
  menuId: string;
  name: string;
  department: string | null;
  /** Average sold price (after discount, excl VAT). */
  price: number;
  plates: number;
  /** Cost of one serving at today's FIFO prices. */
  cost: number;
  /** % of price. The menu's own, or the shop's when it has none. */
  target: number;
  ownTarget: boolean;
  /** Raw products in one serving: [productId, baht]. */
  leaves: [string, number][];
};

export type Allowance = {
  /** allowed price ÷ current price. < 1 = dearer than the menus can bear. */
  k: number;
  /** Baht per period (the plates' period) this product pushes its menus past target. */
  over: number;
  /** Baht of this product inside the menus (cost-in-plate × plates) — the weight. */
  use: number;
  menus: string[];
};

export function allowances(menus: readonly MenuCostRow[]): Map<string, Allowance> {
  const acc = new Map<string, { w: number; wk: number; over: number; menus: string[] }>();
  for (const m of menus) {
    if (m.cost <= 0 || m.price <= 0 || m.plates <= 0) continue;
    const k = ((m.target / 100) * m.price) / m.cost;
    for (const [pid, baht] of m.leaves) {
      if (baht <= 0) continue;
      const w = baht * m.plates;
      const a = acc.get(pid) ?? { w: 0, wk: 0, over: 0, menus: [] };
      a.w += w;
      a.wk += w * k;
      a.over += w * (1 - k);
      a.menus.push(m.menuId);
      acc.set(pid, a);
    }
  }
  const out = new Map<string, Allowance>();
  for (const [pid, a] of acc) out.set(pid, { k: a.wk / a.w, over: Math.round(a.over * 100) / 100, use: a.w, menus: a.menus });
  return out;
}

/** Change of one menu's cost per serving when its ingredients move from `before` to `after` prices (baht/base unit). */
export function menuCostDelta(m: MenuCostRow, ratio: (productId: string) => number | null): { delta: number; parts: [string, number][] } {
  let delta = 0;
  const parts: [string, number][] = [];
  for (const [pid, baht] of m.leaves) {
    const r = ratio(pid);
    if (r === null) continue;
    const d = baht * (r - 1);
    delta += d;
    if (Math.abs(d) >= 0.01) parts.push([pid, d]);
  }
  return { delta, parts: parts.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])) };
}

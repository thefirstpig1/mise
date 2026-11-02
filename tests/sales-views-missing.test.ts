// ============================================================
// คิดครัว — the profit view never turns "no recipe" into ฿0 (queue item 10)
// ============================================================
// /sales showed "กำไรขั้นต้นจากสูตร ฿0 · เฉลี่ย ฿0 ต่อวัน" for a shop with sales
// and no recipes: `perDay.profit ?? 0`. The view now keeps unknown as null and
// says whether ANY dish sold has a cost, so the page draws outlines instead.
// ============================================================

import { describe, it, expect } from "vitest";
import { buildSalesView } from "@/app/(app)/sales/_components/sales-views";
import { costKey, enrich, type CostMap, type MenuMeta } from "@/lib/sales-insight";

const meta = new Map<string, MenuMeta>([
  ["m1", { id: "m1", name: "ผัดกะเพรา", categoryKey: "c1", categoryName: "ข้าว", isPosStub: false }],
  ["m2", { id: "m2", name: "ต้มยำ", categoryKey: "c2", categoryName: "ต้ม", isPosStub: false }],
]);
const rows = [
  { day: "2026-10-01", branchId: "b1", menuId: "m1", net: 600, qty: 10 },
  { day: "2026-10-01", branchId: "b1", menuId: "m2", net: 400, qty: 4 },
  { day: "2026-10-02", branchId: "b1", menuId: "m1", net: 300, qty: 5 },
];

function view(costs: CostMap) {
  const cur = enrich(rows, meta, costs);
  return buildSalesView({ cur, before: [], menuMeta: meta, costs, tones: {}, day: null }, "profit");
}

describe("buildSalesView — profit with missing recipes", () => {
  it("SV1 — no dish has a recipe: the profit is unknown, not ฿0, and the page is told", () => {
    const v = view(new Map());
    expect(v.profitKnown).toBe(false);
    expect(v.profit?.total).toBeNull();
    expect(v.profit?.perDay).toBeNull();
    expect(v.profit?.unknownNet).toBe(1300);
  });

  it("SV2 — one dish has a recipe: a real figure, and the share of sales it covers", () => {
    const costs: CostMap = new Map([[costKey("b1", "m1"), { cost: 20, confidence: "HIGH", recipeId: "r1" }]]);
    const v = view(costs);
    expect(v.profitKnown).toBe(true);
    // ผัดกะเพรา: 900 sold − 15 plates × ฿20 = ฿600
    expect(v.profit?.total).toBeCloseTo(600, 6);
    expect(v.profit?.unknownNet).toBeCloseTo(400, 6);
    expect(v.profit?.knownShare).toBeCloseTo(900 / 1300, 6);
  });

  it("SV3 — the sales view is never 'unknown'", () => {
    const cur = enrich(rows, meta, new Map());
    expect(buildSalesView({ cur, before: [], menuMeta: meta, costs: new Map(), tones: {}, day: null }, "net").profitKnown).toBe(true);
  });
});

// ============================================================
// Mise — ราคาวัตถุดิบขึ้นลง (Part 35 D): the pure comparison
// ============================================================

import { describe, it, expect } from "vitest";
import { watch, type PricePoint } from "@/server/price-watch";

function pt(over: Partial<PricePoint>): PricePoint {
  return {
    date: new Date("2026-09-01T00:00:00Z"),
    productId: "pork",
    productName: "หมูสับ",
    baseUnit: "kg",
    section: "อาหาร",
    group: "เนื้อสัตว์",
    supplierId: "chai",
    supplierName: "ลุงชัย",
    pricePerBase: 130,
    qtyBase: 5,
    ...over,
  };
}

describe("watch", () => {
  it("compares the FIRST and LAST price in the window, whatever order they arrive in", () => {
    const w = watch(
      [pt({ date: new Date("2026-09-20T00:00:00Z"), pricePerBase: 143 }), pt({ pricePerBase: 130 }), pt({ date: new Date("2026-09-10T00:00:00Z"), pricePerBase: 150 })],
      {}
    );
    const p = w.products[0];
    expect(p.first).toBe(130);
    expect(p.last).toBe(143);
    expect(p.changePct).toBe(10);
    expect(p.max).toBe(150);
    expect(p.receipts).toBe(3);
  });

  it("one receipt is never a trend — its change is null, not 0%", () => {
    const w = watch([pt({})], {});
    expect(w.products[0].changePct).toBeNull();
    expect(w.groups).toEqual([]);
  });

  it("per supplier, the same product keeps two series", () => {
    const w = watch(
      [pt({}), pt({ date: new Date("2026-09-15T00:00:00Z"), pricePerBase: 140 }), pt({ supplierId: "makro", supplierName: "แม็คโคร", pricePerBase: 120 }), pt({ supplierId: "makro", supplierName: "แม็คโคร", date: new Date("2026-09-15T00:00:00Z"), pricePerBase: 114 })],
      {}
    );
    const chai = w.rows.find((r) => r.supplierId === "chai")!;
    const makro = w.rows.find((r) => r.supplierId === "makro")!;
    expect(chai.changePct).toBe(7.7);
    expect(makro.changePct).toBe(-5);
  });

  it("filters narrow the points, but the group row still offers every group", () => {
    const w = watch([pt({}), pt({ productId: "beer", productName: "เบียร์", group: "แอลกอฮอล์" })], { group: "แอลกอฮอล์" });
    expect(w.products.map((p) => p.productId)).toEqual(["beer"]);
    expect(w.options.groups).toEqual(expect.arrayContaining(["เนื้อสัตว์", "แอลกอฮอล์"]));
  });
});

// ============================================================
// คิดครัว — stock value: unknown is not ฿0 (queue item 10, rule ND5)
// ============================================================
// /cost said "฿0 · ไม่มีของในสต๊อก" for a shop whose shelf held goods counted
// in without a price. The shelf is now counted apart from its value, so the
// page can say "ยังไม่รู้มูลค่า · ของ N รายการยังไม่มีราคา" instead.
// ============================================================

import { describe, it, expect } from "vitest";
import { shelfOf } from "@/server/cost-overview";

describe("shelfOf", () => {
  it("CS1 — goods with no value are held AND unpriced; an empty shelf is neither", () => {
    expect(
      shelfOf([
        { qtyOnHand: 5, inventoryValue: 0 }, // counted in, no price
        { qtyOnHand: 2, inventoryValue: 180 }, // received with a price
        { qtyOnHand: 0, inventoryValue: 0 }, // used up
        undefined, // never moved here
      ])
    ).toEqual({ held: 2, unpriced: 1 });
  });

  it("CS2 — nothing on the shelf is held 0, so the page says it knows of no stock", () => {
    expect(shelfOf([undefined, { qtyOnHand: 0, inventoryValue: 0 }])).toEqual({ held: 0, unpriced: 0 });
  });
});

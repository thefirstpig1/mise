// Part 38 (ADR 0036) — the purchase request's pure rules. No database.

import { describe, expect, it } from "vitest";
import {
  cheaperElsewhere,
  defaultSupplierId,
  isOutstanding,
  kitchenCanEdit,
  latestKnownPrice,
  readiness,
  requestLineStatus,
  suggestedOrderQty,
  type OrderLink,
  type SupplierPrice,
} from "@/lib/purchase-request";

describe("PR1 — suggested quantity = par − on hand − on order", () => {
  const base = { par: 10, systemOnHand: 4, typedOnHand: null, onOrder: 0, unitToBase: 1 };
  it("orders the gap", () => {
    expect(suggestedOrderQty(base)).toBe(6);
  });
  it("what the kitchen typed beats what the system believes", () => {
    expect(suggestedOrderQty({ ...base, typedOnHand: 1 })).toBe(9);
    expect(suggestedOrderQty({ ...base, typedOnHand: 0 })).toBe(10); // 0 is a real answer, not "blank"
  });
  it("subtracts what is already on its way — never orders it twice", () => {
    expect(suggestedOrderQty({ ...base, onOrder: 5 })).toBe(1);
    expect(suggestedOrderQty({ ...base, onOrder: 6 })).toBeNull();
  });
  it("rounds UP to whole ordering units", () => {
    expect(suggestedOrderQty({ ...base, systemOnHand: 7.7, unitToBase: 1 })).toBe(3); // 2.3 kg of a 1 kg pack
    expect(suggestedOrderQty({ ...base, systemOnHand: 0, unitToBase: 25 })).toBe(1); // 10 kg of a 25 kg sack
    expect(suggestedOrderQty({ ...base, systemOnHand: 6, unitToBase: 2 })).toBe(2); // exactly 4 kg → 2 × 2 kg, not 3
  });
  it("no par, or already covered, suggests nothing", () => {
    expect(suggestedOrderQty({ ...base, par: null })).toBeNull();
    expect(suggestedOrderQty({ ...base, systemOnHand: 12 })).toBeNull();
    expect(suggestedOrderQty({ ...base, unitToBase: 0 })).toBeNull();
  });
});

describe("PR2 — someone else is cheaper", () => {
  const prices: SupplierPrice[] = [
    { supplierId: "A", supplierName: "ร้าน A", pricePerBase: 168, asOf: "2026-09-20", source: "paid" },
    { supplierId: "B", supplierName: "ร้าน B", pricePerBase: 145, asOf: "2026-09-12", source: "paid" },
    { supplierId: "C", supplierName: "ร้าน C", pricePerBase: 150, asOf: "2026-09-01", source: "list" },
  ];
  it("names the CHEAPEST other supplier and when its price was true", () => {
    const h = cheaperElsewhere("A", prices, true)!;
    expect(h.supplierName).toBe("ร้าน B");
    expect(h.asOf).toBe("2026-09-12");
    expect(h.money).toEqual({ theirs: 145, ours: 168 });
  });
  it("a cook gets the hint with NO money in it (Q2, R5)", () => {
    const h = cheaperElsewhere("A", prices, false)!;
    expect(h.supplierName).toBe("ร้าน B");
    expect(h.money).toBeNull();
    expect(JSON.stringify(h)).not.toMatch(/145|168/);
  });
  it("nothing to say when ours is already cheapest, or ours has no known price", () => {
    expect(cheaperElsewhere("B", prices, true)).toBeNull();
    expect(cheaperElsewhere("Z", prices, true)).toBeNull();
    expect(cheaperElsewhere(null, prices, true)).toBeNull();
  });
  it("an equal price is not cheaper", () => {
    expect(cheaperElsewhere("A", [prices[0], { ...prices[1], pricePerBase: 168.00001 }], true)).toBeNull();
  });
  it("the price actually paid wins over the price list", () => {
    expect(latestKnownPrice({ pricePerBase: 150, asOf: "2026-09-12" }, { pricePerBase: 140, asOf: "2026-09-20" })).toEqual({
      pricePerBase: 150,
      asOf: "2026-09-12",
      source: "paid",
    });
    expect(latestKnownPrice(null, { pricePerBase: 140, asOf: "2026-09-20" })?.source).toBe("list");
    expect(latestKnownPrice(null, null)).toBeNull();
  });
});

describe("Q11 — default supplier", () => {
  it("preferred, else last bought here, else nobody", () => {
    expect(defaultSupplierId("P", "L")).toBe("P");
    expect(defaultSupplierId(null, "L")).toBe("L");
    expect(defaultSupplierId(null, null)).toBeNull();
  });
});

describe("R1 — status is read from the PO lines, never stored", () => {
  const link = (over: Partial<OrderLink> = {}): OrderLink => ({
    poId: "po1",
    poNumber: "LP-PO-0001",
    poStatus: "SENT",
    poDeleted: false,
    poClosedShort: false,
    qtyOrdered: 5,
    qtyReceived: 0,
    unitName: "kg",
    supplierName: "ร้าน A",
    promisedDate: null,
    createdAt: "2026-09-29T08:00:00.000Z",
    ...over,
  });
  const open = { rejectReason: null, rejectedAt: null };
  const today = "2026-09-29";

  it("no PO line → waiting; rejected → rejected with its reason", () => {
    expect(requestLineStatus(open, [], today).kind).toBe("waiting");
    const s = requestLineStatus({ rejectReason: "ของยังพอ", rejectedAt: "2026-09-29" }, [], today);
    expect(s).toEqual({ kind: "rejected", reason: "ของยังพอ" });
  });
  it("draft → preparing · sent without a date → ordered (never a guessed date)", () => {
    expect(requestLineStatus(open, [link({ poStatus: "DRAFT" })], today).kind).toBe("preparing");
    expect(requestLineStatus(open, [link()], today).kind).toBe("ordered");
  });
  it("a promise, and how many days late it is", () => {
    const s = requestLineStatus(open, [link({ promisedDate: "2026-09-27" })], today);
    expect(s).toMatchObject({ kind: "promised", date: "2026-09-27", overdueDays: 2 });
    expect(requestLineStatus(open, [link({ promisedDate: "2026-10-01" })], today)).toMatchObject({ overdueDays: 0 });
  });
  it("part received, fully received, and closed short", () => {
    expect(requestLineStatus(open, [link({ poStatus: "PARTIALLY_RECEIVED", qtyReceived: 3 })], today).kind).toBe("partial");
    expect(requestLineStatus(open, [link({ poStatus: "RECEIVED", qtyReceived: 5 })], today).kind).toBe("received");
    expect(requestLineStatus(open, [link({ poStatus: "RECEIVED", qtyReceived: 3, poClosedShort: true })], today).kind).toBe(
      "closed_short"
    );
  });
  it("a CANCELLED order, or a DELETED draft, puts the line back to waiting by itself (Q10)", () => {
    expect(requestLineStatus(open, [link({ poStatus: "CANCELLED" })], today).kind).toBe("waiting");
    expect(requestLineStatus(open, [link({ poStatus: "DRAFT", poDeleted: true })], today).kind).toBe("waiting");
  });
  it("the NEWEST live order speaks — reordered after a cancellation", () => {
    const s = requestLineStatus(
      open,
      [
        link({ poId: "old", poStatus: "CANCELLED", createdAt: "2026-09-28T08:00:00.000Z" }),
        link({ poId: "new", poStatus: "SENT", createdAt: "2026-09-29T08:00:00.000Z" }),
      ],
      today
    );
    expect(s.kind === "ordered" && s.link.poId).toBe("new");
  });
  it("R4 — only a waiting line is the kitchen's to change; outstanding lines warn against asking twice", () => {
    expect(kitchenCanEdit({ kind: "waiting" })).toBe(true);
    expect(kitchenCanEdit(requestLineStatus(open, [link({ poStatus: "DRAFT" })], today))).toBe(false);
    expect(isOutstanding(requestLineStatus(open, [link()], today))).toBe(true);
    expect(isOutstanding(requestLineStatus(open, [link({ poStatus: "RECEIVED", qtyReceived: 5 })], today))).toBe(false);
    expect(isOutstanding({ kind: "rejected", reason: "" })).toBe(false);
  });
});

describe("Q3 — readiness", () => {
  const depts = [
    { id: "hot", name: "ครัวร้อน" },
    { id: "bar", name: "บาร์" },
  ];
  const at = { by: "u1", at: "2026-09-29T10:32:00Z" };
  it("Kong's case: the hot kitchen is ready and the bar has not STARTED — not ready", () => {
    const r = readiness(depts, new Map([["hot", 12]]), new Map([["hot", at]]));
    expect(r.allReady).toBe(false);
    expect(r.departments.find((d) => d.id === "bar")).toMatchObject({ ready: null, waitingLines: 0 });
  });
  it("a department with nothing to order says so by pressing ready", () => {
    const r = readiness(depts, new Map([["hot", 12]]), new Map([["hot", at], ["bar", at]]));
    expect(r.allReady).toBe(true);
  });
  it("everyone ready with nothing waiting is not a round to cut", () => {
    expect(readiness(depts, new Map(), new Map([["hot", at], ["bar", at]])).allReady).toBe(false);
  });
});

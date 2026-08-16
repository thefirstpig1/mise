// ============================================================
// Mise — Goods Receipt zod schemas (Sprint 2 Part 13 L2; ADR 0013)
// ============================================================
// Pure validation, no DB. Coverage of the write schema (header + lines), the two
// lifecycle transitions that carry data, and the list filter.
// ============================================================

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  addDays,
  bangkokDayEndUtc,
  bangkokDayStartUtc,
  computeBangkokToday,
} from "@/lib/bangkok-date";
import {
  closePurchaseOrderShortInputSchema,
  getGoodsReceiptsQuerySchema,
  goodsReceiptInputSchema,
  goodsReceiptLineInputSchema,
  GOODS_RECEIPT_STATUS_LABELS_TH,
  GOODS_RECEIPT_STATUS_VALUES,
  MAX_BACKDATE_DAYS,
  MAX_LINES,
  voidGoodsReceiptInputSchema,
} from "@/lib/validations/goods-receipt";

const U = () => randomUUID();
const today = computeBangkokToday();
/** 08:00 Bangkok today — always inside the accepted window. */
const validReceivedAt = new Date(bangkokDayStartUtc(today).getTime() + 8 * 3600_000);

const line = (over: Record<string, unknown> = {}) => ({
  purchaseOrderItemId: null,
  productId: U(),
  receivedUnitId: U(),
  qtyReceivedActual: 5,
  unitPriceActual: 100,
  notes: null,
  ...over,
});

const header = (over: Record<string, unknown> = {}) => ({
  submitKey: U(),
  branchId: U(),
  supplierId: U(),
  purchaseOrderId: null,
  invoiceNo: null,
  receivedAt: validReceivedAt,
  notes: null,
  lines: [line()],
  ...over,
});

/** First issue message for a given dotted path prefix. */
const msgAt = (r: { success: boolean; error?: any }, path: string) =>
  r.error?.issues.find((i: any) => i.path.join(".").startsWith(path))?.message;

describe("goods-receipt zod schemas (Part 13 L2)", () => {
  // ----------------------------------------------------------
  // Line
  // ----------------------------------------------------------

  it("G1: accepts a minimal line and nulls the blank optionals", () => {
    const r = goodsReceiptLineInputSchema.safeParse({
      purchaseOrderItemId: "",
      productId: U(),
      receivedUnitId: U(),
      qtyReceivedActual: "2.5",
      unitPriceActual: "80",
      notes: "   ",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.purchaseOrderItemId).toBeNull();
    expect(r.data.notes).toBeNull();
    expect(r.data.qtyReceivedActual).toBe(2.5);
  });

  it("G2: a received quantity must be strictly positive", () => {
    expect(
      goodsReceiptLineInputSchema.safeParse(line({ qtyReceivedActual: 0 })).success
    ).toBe(false);
    // Negative is the void path's business, never a user's (Q6).
    expect(
      goodsReceiptLineInputSchema.safeParse(line({ qtyReceivedActual: -1 })).success
    ).toBe(false);
  });

  it("G3: 3-decimal quantities are accepted — including the ones the float trick rejects", () => {
    // Pitfall #30: Number.isInteger(1.005 * 1000) is false. The toFixed
    // round-trip is why this passes.
    expect(
      goodsReceiptLineInputSchema.safeParse(line({ qtyReceivedActual: 1.005 }))
        .success
    ).toBe(true);
    expect(
      goodsReceiptLineInputSchema.safeParse(line({ qtyReceivedActual: 1.0005 }))
        .success
    ).toBe(false);
  });

  it("G4: price is >= 0 with at most 4 decimals", () => {
    expect(
      goodsReceiptLineInputSchema.safeParse(line({ unitPriceActual: 0 })).success
    ).toBe(true);
    expect(
      goodsReceiptLineInputSchema.safeParse(line({ unitPriceActual: -0.01 })).success
    ).toBe(false);
    expect(
      goodsReceiptLineInputSchema.safeParse(line({ unitPriceActual: 1.23456 }))
        .success
    ).toBe(false);
  });

  it("G5: allocations must sum to the received quantity", () => {
    const dept = U();
    const bad = goodsReceiptLineInputSchema.safeParse(
      line({
        qtyReceivedActual: 10,
        allocations: [{ departmentId: dept, qtyAllocatedActual: 9 }],
      })
    );
    expect(bad.success).toBe(false);
    expect(msgAt(bad, "allocations")).toContain("ยอดปันส่วน");
  });

  it("G6: a 0.1 + 0.2 split really does equal 0.3 (integer thousandths)", () => {
    const r = goodsReceiptLineInputSchema.safeParse(
      line({
        qtyReceivedActual: 0.3,
        allocations: [
          { departmentId: U(), qtyAllocatedActual: 0.1 },
          { departmentId: U(), qtyAllocatedActual: 0.2 },
        ],
      })
    );
    expect(r.success).toBe(true);
  });

  it("G7: a department may appear once per line", () => {
    const dept = U();
    const r = goodsReceiptLineInputSchema.safeParse(
      line({
        qtyReceivedActual: 4,
        allocations: [
          { departmentId: dept, qtyAllocatedActual: 2 },
          { departmentId: dept, qtyAllocatedActual: 2 },
        ],
      })
    );
    expect(r.success).toBe(false);
    expect(msgAt(r, "allocations")).toContain("ครั้งเดียว");
  });

  // ----------------------------------------------------------
  // Header
  // ----------------------------------------------------------

  it("G8: accepts a PO-based receipt", () => {
    const poItem = U();
    const r = goodsReceiptInputSchema.safeParse(
      header({
        purchaseOrderId: U(),
        invoiceNo: "  INV-001  ",
        lines: [line({ purchaseOrderItemId: poItem })],
      })
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.invoiceNo).toBe("INV-001");
    expect(r.data.lines[0].purchaseOrderItemId).toBe(poItem);
  });

  it("G9: accepts a standalone receipt — no PO anywhere (Q1)", () => {
    const r = goodsReceiptInputSchema.safeParse(
      header({ purchaseOrderId: "", lines: [line({ purchaseOrderItemId: "" })] })
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.purchaseOrderId).toBeNull();
    expect(r.data.lines[0].purchaseOrderItemId).toBeNull();
  });

  it("G10: submitKey is required and must be a uuid — it becomes the document id", () => {
    expect(goodsReceiptInputSchema.safeParse(header({ submitKey: undefined })).success).toBe(
      false
    );
    const r = goodsReceiptInputSchema.safeParse(header({ submitKey: "not-a-uuid" }));
    expect(r.success).toBe(false);
    expect(msgAt(r, "submitKey")).toBeTruthy();
  });

  it("G11: receivedAt may be any instant today, but not tomorrow (Bangkok, Q4)", () => {
    // 23:30 Bangkok tonight — under UTC bucketing this instant reads as tomorrow.
    const lateTonight = new Date(
      bangkokDayStartUtc(today).getTime() + 23.5 * 3600_000
    );
    expect(
      goodsReceiptInputSchema.safeParse(header({ receivedAt: lateTonight })).success
    ).toBe(true);

    // The exact start of tomorrow in Bangkok is the first rejected instant.
    const r = goodsReceiptInputSchema.safeParse(
      header({ receivedAt: bangkokDayEndUtc(today) })
    );
    expect(r.success).toBe(false);
    expect(msgAt(r, "receivedAt")).toContain("อนาคต");
  });

  it("G12: receivedAt honours the same 90-day backdate window as the ledger", () => {
    const edge = bangkokDayStartUtc(addDays(today, -MAX_BACKDATE_DAYS));
    expect(goodsReceiptInputSchema.safeParse(header({ receivedAt: edge })).success).toBe(
      true
    );

    const tooOld = new Date(edge.getTime() - 1);
    const r = goodsReceiptInputSchema.safeParse(header({ receivedAt: tooOld }));
    expect(r.success).toBe(false);
    expect(msgAt(r, "receivedAt")).toContain("ย้อนหลัง");
  });

  it("G13: a receipt needs at least one line and no more than MAX_LINES", () => {
    expect(goodsReceiptInputSchema.safeParse(header({ lines: [] })).success).toBe(false);
    const many = Array.from({ length: MAX_LINES + 1 }, () => line());
    expect(goodsReceiptInputSchema.safeParse(header({ lines: many })).success).toBe(
      false
    );
  });

  it("G14: the same PO line cannot appear twice — that would double-count the outstanding qty", () => {
    const poItem = U();
    const r = goodsReceiptInputSchema.safeParse(
      header({
        purchaseOrderId: U(),
        lines: [
          line({ purchaseOrderItemId: poItem }),
          line({ purchaseOrderItemId: poItem }),
        ],
      })
    );
    expect(r.success).toBe(false);
    expect(msgAt(r, "lines")).toContain("ใบสั่งซื้อบรรทัดเดียวกัน");
  });

  it("G15: free lines dedupe on (product, unit), and different PO lines never collide", () => {
    const product = U();
    const unit = U();

    const dupe = goodsReceiptInputSchema.safeParse(
      header({
        lines: [
          line({ productId: product, receivedUnitId: unit }),
          line({ productId: product, receivedUnitId: unit }),
        ],
      })
    );
    expect(dupe.success).toBe(false);
    expect(msgAt(dupe, "lines")).toContain("ซ้ำ");

    // Same product, different unit — legitimate (a sack and a loose kilo).
    expect(
      goodsReceiptInputSchema.safeParse(
        header({
          lines: [
            line({ productId: product, receivedUnitId: U() }),
            line({ productId: product, receivedUnitId: U() }),
          ],
        })
      ).success
    ).toBe(true);

    // Same product on two DIFFERENT PO lines — also legitimate, and the free-line
    // rule must not reach it.
    expect(
      goodsReceiptInputSchema.safeParse(
        header({
          purchaseOrderId: U(),
          lines: [
            line({ productId: product, receivedUnitId: unit, purchaseOrderItemId: U() }),
            line({ productId: product, receivedUnitId: unit, purchaseOrderItemId: U() }),
          ],
        })
      ).success
    ).toBe(true);
  });

  // ----------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------

  it("G16: voiding requires a reason — a confirmed receipt moved real stock", () => {
    expect(
      voidGoodsReceiptInputSchema.safeParse({ id: U(), voidReason: "รับผิดชนิด" }).success
    ).toBe(true);
    expect(voidGoodsReceiptInputSchema.safeParse({ id: U() }).success).toBe(false);
    expect(
      voidGoodsReceiptInputSchema.safeParse({ id: U(), voidReason: "   " }).success
    ).toBe(false);
    expect(
      voidGoodsReceiptInputSchema.safeParse({ id: U(), voidReason: "x".repeat(501) })
        .success
    ).toBe(false);
  });

  it("G17: closing a short order requires a reason too (Q8)", () => {
    expect(
      closePurchaseOrderShortInputSchema.safeParse({
        id: U(),
        closedShortReason: "ซัพแจ้งของหมด",
      }).success
    ).toBe(true);
    expect(
      closePurchaseOrderShortInputSchema.safeParse({ id: U(), closedShortReason: "" })
        .success
    ).toBe(false);
  });

  // ----------------------------------------------------------
  // List query + labels
  // ----------------------------------------------------------

  it("G18: blank filters drop out; a bad status is rejected", () => {
    const r = getGoodsReceiptsQuerySchema.safeParse({
      branchId: "",
      supplierId: "  ",
      purchaseOrderId: undefined,
      status: "",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.branchId).toBeUndefined();
    expect(r.data.supplierId).toBeUndefined();
    expect(r.data.status).toBeUndefined();

    expect(getGoodsReceiptsQuerySchema.safeParse({ status: "SENT" }).success).toBe(
      false
    );
    expect(
      getGoodsReceiptsQuerySchema.safeParse({ status: "CONFIRMED" }).success
    ).toBe(true);
  });

  it("G19: every status has a Thai label", () => {
    for (const s of GOODS_RECEIPT_STATUS_VALUES) {
      expect(GOODS_RECEIPT_STATUS_LABELS_TH[s]).toBeTruthy();
    }
    expect(Object.keys(GOODS_RECEIPT_STATUS_LABELS_TH).length).toBe(
      GOODS_RECEIPT_STATUS_VALUES.length
    );
  });
});

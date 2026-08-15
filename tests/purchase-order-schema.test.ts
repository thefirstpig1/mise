// ============================================================
// Mise — purchase order zod schemas unit tests (Sprint 2 Part 11 L2)
// ============================================================
// Pure zod validation (no DB). Mirrors tests/stock-movement-schema.test.ts.
// ADR 0012 decisions exercised: the line carries qty in the ORDERED unit with a
// hand-typable price (Q3/Q5), allocations are optional but must sum to the line
// when present (Q2), and blank VAT means "no VAT on this order" (Q6).
// ============================================================

import { describe, it, expect } from "vitest";
import {
  cancelPurchaseOrderInputSchema,
  getPurchaseOrdersQuerySchema,
  MAX_LINES,
  purchaseOrderInputSchema,
  purchaseOrderLineInputSchema,
  PURCHASE_ORDER_STATUS_LABELS_TH,
  PURCHASE_ORDER_STATUS_VALUES,
  QTY_MAX,
  UNIT_PRICE_MAX,
} from "@/lib/validations/purchase-order";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";
const UUID3 = "323e4567-e89b-12d3-a456-426614174000";
const UUID4 = "423e4567-e89b-12d3-a456-426614174000";

const validLine = {
  productId: UUID,
  orderUnitId: UUID2,
  qtyOrdered: 10,
  unitPrice: 125.5,
  supplierProductMappingId: UUID3,
  notes: null,
};

const validPo = {
  branchId: UUID,
  supplierId: UUID2,
  expectedDeliveryDate: "2026-08-20",
  vatRatePercent: 7,
  notes: "ส่งเช้าก่อน 9 โมง",
  lines: [validLine],
};

// ------------------------------------------------------------
// Line
// ------------------------------------------------------------

describe("purchaseOrderLineInputSchema", () => {
  it("accepts a valid line", () => {
    const r = purchaseOrderLineInputSchema.safeParse(validLine);
    expect(r.success).toBe(true);
  });

  it("coerces FormData strings", () => {
    const r = purchaseOrderLineInputSchema.parse({
      ...validLine,
      qtyOrdered: "2.5",
      unitPrice: "99.9999",
    });
    expect(r.qtyOrdered).toBe(2.5);
    expect(r.unitPrice).toBe(99.9999);
  });

  it("rejects a zero or negative qty — a line that orders nothing is not a line", () => {
    for (const qtyOrdered of [0, -1]) {
      expect(
        purchaseOrderLineInputSchema.safeParse({ ...validLine, qtyOrdered }).success,
        String(qtyOrdered)
      ).toBe(false);
    }
  });

  it("accepts a zero price (free goods) but not a negative one", () => {
    expect(
      purchaseOrderLineInputSchema.safeParse({ ...validLine, unitPrice: 0 }).success
    ).toBe(true);
    expect(
      purchaseOrderLineInputSchema.safeParse({ ...validLine, unitPrice: -0.01 })
        .success
    ).toBe(false);
  });

  it("allows a null mapping id — the price was typed by hand (Q5)", () => {
    const r = purchaseOrderLineInputSchema.parse({
      ...validLine,
      supplierProductMappingId: "",
    });
    expect(r.supplierProductMappingId).toBeNull();
  });

  // Pitfall #30: the float-multiply guard rejected ~1.2% of valid 3-dp values.
  it("accepts 3-decimal quantities the float-multiply guard used to reject", () => {
    for (const qtyOrdered of [1.005, 1.001, 2.005, 1234.005]) {
      expect(
        purchaseOrderLineInputSchema.safeParse({ ...validLine, qtyOrdered }).success,
        String(qtyOrdered)
      ).toBe(true);
    }
  });

  it("enforces the column scales: qty 3 dp, price 4 dp", () => {
    expect(
      purchaseOrderLineInputSchema.safeParse({ ...validLine, qtyOrdered: 1.2345 })
        .success
    ).toBe(false);
    expect(
      purchaseOrderLineInputSchema.safeParse({ ...validLine, unitPrice: 1.00005 })
        .success
    ).toBe(false);
    expect(
      purchaseOrderLineInputSchema.safeParse({ ...validLine, qtyOrdered: QTY_MAX })
        .success
    ).toBe(true);
    expect(
      purchaseOrderLineInputSchema.safeParse({
        ...validLine,
        unitPrice: UNIT_PRICE_MAX,
      }).success
    ).toBe(true);
    expect(
      purchaseOrderLineInputSchema.safeParse({
        ...validLine,
        unitPrice: UNIT_PRICE_MAX + 1,
      }).success
    ).toBe(false);
  });
});

// ------------------------------------------------------------
// Allocations (Q2)
// ------------------------------------------------------------

describe("purchaseOrderLineInputSchema — allocations", () => {
  it("is valid with allocations omitted — the server writes the single dept row", () => {
    const r = purchaseOrderLineInputSchema.safeParse(validLine);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.allocations).toBeUndefined();
  });

  it("accepts a split that sums to the line qty", () => {
    const r = purchaseOrderLineInputSchema.safeParse({
      ...validLine,
      qtyOrdered: 10,
      allocations: [
        { departmentId: UUID3, qtyAllocated: 6 },
        { departmentId: UUID4, qtyAllocated: 4 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a split that does not sum to the line qty", () => {
    const r = purchaseOrderLineInputSchema.safeParse({
      ...validLine,
      qtyOrdered: 10,
      allocations: [
        { departmentId: UUID3, qtyAllocated: 6 },
        { departmentId: UUID4, qtyAllocated: 3.9 },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toContain("allocations");
  });

  // Summed as floats, 0.1 + 0.2 !== 0.3 and this valid split would be rejected.
  it("sums exactly at 3 dp — a float-addition guard would fail this", () => {
    const r = purchaseOrderLineInputSchema.safeParse({
      ...validLine,
      qtyOrdered: 0.3,
      allocations: [
        { departmentId: UUID3, qtyAllocated: 0.1 },
        { departmentId: UUID4, qtyAllocated: 0.2 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects the same department twice on one line", () => {
    const r = purchaseOrderLineInputSchema.safeParse({
      ...validLine,
      qtyOrdered: 10,
      allocations: [
        { departmentId: UUID3, qtyAllocated: 6 },
        { departmentId: UUID3, qtyAllocated: 4 },
      ],
    });
    expect(r.success).toBe(false);
  });
});

// ------------------------------------------------------------
// Header
// ------------------------------------------------------------

describe("purchaseOrderInputSchema", () => {
  it("accepts a valid order", () => {
    const r = purchaseOrderInputSchema.safeParse(validPo);
    expect(r.success).toBe(true);
  });

  it("treats a blank VAT rate as 'this order carries no VAT' (Q6)", () => {
    const r = purchaseOrderInputSchema.parse({ ...validPo, vatRatePercent: "" });
    expect(r.vatRatePercent).toBeNull();
  });

  it("keeps a 0% VAT rate distinct from no VAT", () => {
    const r = purchaseOrderInputSchema.parse({ ...validPo, vatRatePercent: "0" });
    expect(r.vatRatePercent).toBe(0);
  });

  it("bounds the VAT rate to a percentage with 2 dp", () => {
    for (const vatRatePercent of [-1, 101, 7.005]) {
      expect(
        purchaseOrderInputSchema.safeParse({ ...validPo, vatRatePercent }).success,
        String(vatRatePercent)
      ).toBe(false);
    }
  });

  it("coerces the delivery date and allows it to be blank", () => {
    const r = purchaseOrderInputSchema.parse(validPo);
    expect(r.expectedDeliveryDate).toBeInstanceOf(Date);
    expect(
      purchaseOrderInputSchema.parse({ ...validPo, expectedDeliveryDate: "" })
        .expectedDeliveryDate
    ).toBeNull();
  });

  it("requires at least one line", () => {
    const r = purchaseOrderInputSchema.safeParse({ ...validPo, lines: [] });
    expect(r.success).toBe(false);
  });

  it(`caps an order at ${MAX_LINES} lines`, () => {
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => ({
      ...validLine,
      // distinct product per line so the duplicate rule is not what fires
      productId: `123e4567-e89b-12d3-a456-${String(426614174000 + i)}`,
    }));
    expect(purchaseOrderInputSchema.safeParse({ ...validPo, lines: many }).success)
      .toBe(false);
  });

  it("rejects the same product+unit twice, but allows the same product in another unit", () => {
    expect(
      purchaseOrderInputSchema.safeParse({
        ...validPo,
        lines: [validLine, { ...validLine }],
      }).success
    ).toBe(false);

    expect(
      purchaseOrderInputSchema.safeParse({
        ...validPo,
        lines: [validLine, { ...validLine, orderUnitId: UUID4 }],
      }).success
    ).toBe(true);
  });
});

// ------------------------------------------------------------
// Lifecycle + list
// ------------------------------------------------------------

describe("cancelPurchaseOrderInputSchema", () => {
  it("accepts a cancel with and without a reason", () => {
    expect(
      cancelPurchaseOrderInputSchema.safeParse({ id: UUID, cancelReason: "ของขาด" })
        .success
    ).toBe(true);
    const r = cancelPurchaseOrderInputSchema.parse({ id: UUID, cancelReason: "" });
    expect(r.cancelReason).toBeNull();
  });

  it("rejects an over-long reason", () => {
    expect(
      cancelPurchaseOrderInputSchema.safeParse({
        id: UUID,
        cancelReason: "ก".repeat(501),
      }).success
    ).toBe(false);
  });
});

describe("getPurchaseOrdersQuerySchema", () => {
  it("treats every filter as optional and drops blanks", () => {
    const r = getPurchaseOrdersQuerySchema.parse({
      branchId: "",
      supplierId: "",
      status: "",
    });
    expect(r).toEqual({});
  });

  it("accepts every status value and rejects an unknown one", () => {
    for (const status of PURCHASE_ORDER_STATUS_VALUES) {
      expect(getPurchaseOrdersQuerySchema.safeParse({ status }).success, status).toBe(
        true
      );
    }
    expect(getPurchaseOrdersQuerySchema.safeParse({ status: "OPEN" }).success).toBe(
      false
    );
  });

  it("has a Thai label for every status", () => {
    for (const s of PURCHASE_ORDER_STATUS_VALUES) {
      expect(PURCHASE_ORDER_STATUS_LABELS_TH[s]).toBeTruthy();
    }
  });
});

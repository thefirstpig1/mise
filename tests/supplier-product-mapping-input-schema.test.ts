// ============================================================
// Mise — supplierProductMappingInputSchema tests (Sprint 1 Part 8 L2)
// ============================================================
// Pure schema tests (no DB), mirroring tests/product-input-schema.test.ts.
// Field shape + ranges per grill Q8; the one cross-field rule is
// effectiveTo > effectiveFrom (Q4). The orderUnit-belongs-to-product guard is
// a DB lookup → deferred to L3 (server logic), NOT asserted here.
// RED until STEP B implements the schema (skeleton is z.never()).
// ============================================================

import { describe, it, expect } from "vitest";
import { supplierProductMappingInputSchema as schema } from "@/lib/validations/supplier-product-mapping";

const SUP = "11111111-1111-4111-8111-111111111111";
const PROD = "22222222-2222-4222-8222-222222222222";
const BR = "33333333-3333-4333-8333-333333333333";
const UNIT = "44444444-4444-4444-8444-444444444444";

/** Minimal valid input — only the required fields (mirrors the 7d helper). */
const valid = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  supplierId: SUP,
  productId: PROD,
  effectiveFrom: "2026-06-01",
  ...over,
});

/** Issue paths (dot-joined) of a failed parse; [] when it succeeded. */
const paths = (r: ReturnType<typeof schema.safeParse>): string[] =>
  r.success ? [] : r.error.issues.map((i) => i.path.join("."));

describe("supplierProductMappingInputSchema (Part 8 L2)", () => {
  // S1 — minimal valid (only required: supplierId / productId / effectiveFrom)
  it("S1 accepts a minimal valid input", () => {
    expect(schema.safeParse(valid()).success).toBe(true);
  });

  // S2 — full valid (every field populated within range)
  it("S2 accepts a full valid input (all fields within range)", () => {
    const r = schema.safeParse(
      valid({
        branchId: BR,
        supplierItemCode: "FB-12345",
        supplierItemName: "Salmon Atlantic Norway 5kg",
        orderUnitId: UNIT,
        currentUnitPrice: 250.5,
        minOrderQty: 5,
        leadTimeDays: 3,
        isPreferred: true,
        effectiveTo: "2026-12-31",
      })
    );
    expect(r.success).toBe(true);
  });

  // S3 — missing each required field → field error on that field
  it("S3 rejects missing required fields", () => {
    for (const f of ["supplierId", "productId", "effectiveFrom"] as const) {
      const { [f]: _drop, ...input } = valid();
      void _drop;
      const r = schema.safeParse(input);
      expect(r.success).toBe(false);
      expect(paths(r)).toContain(f);
    }
  });

  // S4 — out-of-range numerics (Q8: price ≥ 0, minOrderQty > 0, leadTime 0–365)
  it("S4 rejects out-of-range numerics", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ currentUnitPrice: -1 }, "currentUnitPrice"],
      [{ minOrderQty: 0 }, "minOrderQty"],
      [{ leadTimeDays: 366 }, "leadTimeDays"],
      [{ leadTimeDays: -1 }, "leadTimeDays"],
    ];
    for (const [over, field] of cases) {
      const r = schema.safeParse(valid(over));
      expect(r.success).toBe(false);
      expect(paths(r)).toContain(field);
    }
  });

  // S5 — over-length code/name (Q8: code ≤ 64, name ≤ 200)
  it("S5 rejects over-length code/name", () => {
    const code = schema.safeParse(valid({ supplierItemCode: "x".repeat(65) }));
    expect(code.success).toBe(false);
    expect(paths(code)).toContain("supplierItemCode");

    const name = schema.safeParse(valid({ supplierItemName: "x".repeat(201) }));
    expect(name.success).toBe(false);
    expect(paths(name)).toContain("supplierItemName");
  });

  // S6 — effectiveTo ≤ effectiveFrom → Thai issue on effectiveTo
  it("S6 rejects effectiveTo on/before effectiveFrom", () => {
    const r = schema.safeParse(
      valid({ effectiveFrom: "2026-06-01", effectiveTo: "2026-06-01" })
    );
    expect(r.success).toBe(false);
    expect(paths(r)).toContain("effectiveTo");
    const msg = r.success ? "" : r.error.issues.map((i) => i.message).join(" ");
    expect(msg).toContain("วันที่สิ้นสุดต้องมาหลังวันที่เริ่มมีผล");
  });

  // S7 — effectiveTo strictly after effectiveFrom → ok
  it("S7 accepts effectiveTo strictly after effectiveFrom", () => {
    expect(
      schema.safeParse(
        valid({ effectiveFrom: "2026-06-01", effectiveTo: "2026-06-02" })
      ).success
    ).toBe(true);
  });

  // S8 — isPreferred coerces string "true"/"false"
  it("S8 coerces isPreferred string 'true'/'false'", () => {
    const t = schema.safeParse(valid({ isPreferred: "true" }));
    expect(t.success).toBe(true);
    if (t.success) expect(t.data.isPreferred).toBe(true);

    const f = schema.safeParse(valid({ isPreferred: "false" }));
    expect(f.success).toBe(true);
    if (f.success) expect(f.data.isPreferred).toBe(false);
  });

  // S9 — defaults: isPreferred missing → false; blank optionals → null
  it("S9 defaults isPreferred to false and blank optionals to null", () => {
    const r = schema.safeParse(valid());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.isPreferred).toBe(false);
    expect(r.data.branchId).toBeNull();
    expect(r.data.supplierItemCode).toBeNull();
    expect(r.data.supplierItemName).toBeNull();
    expect(r.data.orderUnitId).toBeNull();
    expect(r.data.currentUnitPrice).toBeNull();
    expect(r.data.minOrderQty).toBeNull();
    expect(r.data.leadTimeDays).toBeNull();
    expect(r.data.effectiveTo).toBeNull();
  });
});

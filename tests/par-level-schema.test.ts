// ============================================================
// Mise — par level zod schemas unit tests (Sprint 3 Part 17 L2)
// ============================================================
// Pure zod, no DB. ADR 0017 Q5/Q6 exercised: a par is per (product, branch),
// entered in any unit · a par of 0 is REFUSED, because "no par" is the absence of
// a row and a stored zero would report the product permanently short · the list
// query carries a branch and nothing that would let it order anything.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  QTY_MAX,
  deleteParLevelInputSchema,
  getParLevelsQuerySchema,
  setParLevelInputSchema,
} from "@/lib/validations/par-level";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";
const UUID3 = "323e4567-e89b-12d3-a456-426614174000";

const validPar = {
  productId: UUID,
  branchId: UUID2,
  inputQty: 10,
  inputUnitId: UUID3,
};

describe("setParLevelInputSchema (ADR 0017 Q5)", () => {
  it("P1: accepts a par entered in any unit", () => {
    const r = setParLevelInputSchema.parse({ ...validPar, inputQty: "2.5" });
    expect(r.inputQty).toBe(2.5);
    expect(r.inputUnitId).toBe(UUID3);
    // The base-unit conversion is a DB read (toBaseRatio) and belongs to L3.
    expect(r).not.toHaveProperty("parQty");
  });

  it("P2: a par of ZERO is refused — 'no par' is the absence of a row", () => {
    // A stored 0 would put the product on the below-par list forever, since
    // on-hand can never be less than zero-but-not-equal. Removing a par deletes
    // the row instead; the DB agrees (par_level_qty_check).
    expect(setParLevelInputSchema.safeParse({ ...validPar, inputQty: 0 }).success).toBe(
      false
    );
    expect(setParLevelInputSchema.safeParse({ ...validPar, inputQty: -5 }).success).toBe(
      false
    );
  });

  it("P3: quantity limits match every other ledger quantity", () => {
    expect(
      setParLevelInputSchema.safeParse({ ...validPar, inputQty: 1.005 }).success
    ).toBe(true);
    expect(
      setParLevelInputSchema.safeParse({ ...validPar, inputQty: 1.0005 }).success
    ).toBe(false);
    expect(
      setParLevelInputSchema.safeParse({ ...validPar, inputQty: QTY_MAX + 1 }).success
    ).toBe(false);
  });

  it("P4: a par is always OF a product AT a branch (Q5)", () => {
    // ADR 0014 Q9b: a business is not a branch. A branch out of pork is out of
    // pork whatever the business holds elsewhere.
    const { branchId: _b, ...noBranch } = validPar;
    const { productId: _p, ...noProduct } = validPar;
    expect(setParLevelInputSchema.safeParse(noBranch).success).toBe(false);
    expect(setParLevelInputSchema.safeParse(noProduct).success).toBe(false);
  });
});

describe("deleteParLevelInputSchema", () => {
  it("P5: removing a par identifies the row, and carries nothing else", () => {
    const r = deleteParLevelInputSchema.parse({ id: UUID, inputQty: 0 });
    expect(r.id).toBe(UUID);
    expect(r).not.toHaveProperty("inputQty");
    expect(deleteParLevelInputSchema.safeParse({ id: "nope" }).success).toBe(false);
  });
});

describe("getParLevelsQuerySchema (Q6)", () => {
  it("P6: blank filters mean 'no filter'", () => {
    const r = getParLevelsQuerySchema.parse({ branchId: "", search: "" });
    expect(r.branchId).toBeUndefined();
    expect(r.search).toBeUndefined();
  });

  it("P7: belowOnly reads 'false' as FALSE (z.coerce.boolean cannot)", () => {
    expect(getParLevelsQuerySchema.parse({ belowOnly: "false" }).belowOnly).toBe(false);
    expect(getParLevelsQuerySchema.parse({ belowOnly: "true" }).belowOnly).toBe(true);
    expect(getParLevelsQuerySchema.parse({ belowOnly: "on" }).belowOnly).toBe(true);
    // The product page shows every par it has set; the alert list asks for
    // belowOnly explicitly.
    expect(getParLevelsQuerySchema.parse({}).belowOnly).toBe(false);
  });
});

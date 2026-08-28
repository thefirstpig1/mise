// ============================================================
// Part 26 L2 — staff meal zod schemas (ADR 0028)
// ============================================================
// Pure schema tests: no database, no session, no clock beyond Bangkok today.
//
// The cases that carry a decision rather than a keystroke are M1–M5. Everything
// else is a boundary that would be caught by the first person to use the form;
// those five would not be, because each of them fails silently in a way that
// still writes a plausible-looking row.
// ============================================================

import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createStaffMealInputSchema,
  createStaffMemberInputSchema,
  getStaffMembersQuerySchema,
  MAX_STAFF_MEAL_ITEMS,
  STAFF_MEAL_PRICE_SOURCE_LABELS_TH,
  STAFF_MEAL_PRICE_SOURCE_VALUES,
  voidStaffMealInputSchema,
} from "@/lib/validations/staff-meal";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";

const uuid = () => randomUUID();

/** A menu dish: an eater, a menu, no typed ingredients. */
const menuMeal = (over: Record<string, unknown> = {}) => ({
  submitKey: uuid(),
  branchId: uuid(),
  businessDate: computeBangkokToday(),
  staffMemberId: uuid(),
  menuId: uuid(),
  servings: 1,
  items: [],
  recordedByName: "",
  notes: "",
  ...over,
});

/** A pot: no menu, no single eater, ingredients typed by hand. */
const potMeal = (over: Record<string, unknown> = {}) => ({
  submitKey: uuid(),
  branchId: uuid(),
  businessDate: computeBangkokToday(),
  staffMemberId: "",
  menuId: "",
  servings: 1,
  items: [{ productId: uuid(), inputQty: 2, inputUnitId: uuid() }],
  recordedByName: "",
  notes: "",
  ...over,
});

describe("staff meal — zod", () => {
  // ----------------------------------------------------------
  // The two shapes, and the seam between them
  // ----------------------------------------------------------

  it("M1: a menu dish MUST name who ate it — the quota cannot be checked without one", () => {
    const ok = createStaffMealInputSchema.safeParse(menuMeal());
    expect(ok.success).toBe(true);

    const bad = createStaffMealInputSchema.safeParse(
      menuMeal({ staffMemberId: "" })
    );
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find(
        (i) => i.path.join(".") === "staffMemberId"
      );
      expect(issue?.message).toContain("ใครเป็นคนกิน");
    }
  });

  it("M2: a pot MUST NOT be forced to name one — that would be forcing a lie", () => {
    const parsed = createStaffMealInputSchema.safeParse(potMeal());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.staffMemberId).toBeNull();
      expect(parsed.data.menuId).toBeNull();
      expect(parsed.data.items).toHaveLength(1);
    }
  });

  it("M3: a menu dish may not also type ingredients — the recipe already answers that", () => {
    const bad = createStaffMealInputSchema.safeParse(
      menuMeal({ items: [{ productId: uuid(), inputQty: 1, inputUnitId: uuid() }] })
    );
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find((i) => i.path[0] === "items");
      expect(issue?.message).toContain("ตัดตามสูตร");
    }
  });

  it("M4: neither a menu nor an ingredient is not a meal", () => {
    const bad = createStaffMealInputSchema.safeParse(potMeal({ items: [] }));
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const issue = bad.error.issues.find((i) => i.path[0] === "items");
      expect(issue?.message).toContain("อย่างน้อย 1 รายการ");
    }
  });

  it("M5: the same product twice in one pot is refused HERE, not by the index mid-commit", () => {
    const productId = uuid();
    const bad = createStaffMealInputSchema.safeParse(
      potMeal({
        items: [
          { productId, inputQty: 2, inputUnitId: uuid() },
          { productId, inputQty: 3, inputUnitId: uuid() },
        ],
      })
    );
    expect(bad.success).toBe(false);
    if (!bad.success) {
      // Pointed at the SECOND row, so the form can highlight the one to remove.
      const issue = bad.error.issues.find((i) => i.path[0] === "items");
      expect(issue?.path).toEqual(["items", 1, "productId"]);
    }
  });

  // ----------------------------------------------------------
  // The ledger's window, borrowed rather than re-declared
  // ----------------------------------------------------------

  it("M6: the backdate window is the LEDGER's, and tomorrow is refused", () => {
    const today = computeBangkokToday();

    expect(
      createStaffMealInputSchema.safeParse(
        menuMeal({ businessDate: addDays(today, 1) })
      ).success
    ).toBe(false);

    expect(
      createStaffMealInputSchema.safeParse(
        menuMeal({ businessDate: addDays(today, -MAX_BACKDATE_DAYS) })
      ).success
    ).toBe(true);

    expect(
      createStaffMealInputSchema.safeParse(
        menuMeal({ businessDate: addDays(today, -MAX_BACKDATE_DAYS - 1) })
      ).success
    ).toBe(false);
  });

  // ----------------------------------------------------------
  // Quantities
  // ----------------------------------------------------------

  it("M7: a zero or negative quantity is not an event", () => {
    for (const inputQty of [0, -1]) {
      expect(
        createStaffMealInputSchema.safeParse(
          potMeal({ items: [{ productId: uuid(), inputQty, inputUnitId: uuid() }] })
        ).success
      ).toBe(false);
    }
    expect(
      createStaffMealInputSchema.safeParse(menuMeal({ servings: 0 })).success
    ).toBe(false);
  });

  it("M8: quantities carry at most three decimals, matching Decimal(15,3)", () => {
    expect(
      createStaffMealInputSchema.safeParse(
        potMeal({ items: [{ productId: uuid(), inputQty: 1.234, inputUnitId: uuid() }] })
      ).success
    ).toBe(true);
    expect(
      createStaffMealInputSchema.safeParse(
        potMeal({ items: [{ productId: uuid(), inputQty: 1.2345, inputUnitId: uuid() }] })
      ).success
    ).toBe(false);
  });

  it("M9: an unbounded ingredient list is refused before it reaches one transaction", () => {
    const items = Array.from({ length: MAX_STAFF_MEAL_ITEMS + 1 }, () => ({
      productId: uuid(),
      inputQty: 1,
      inputUnitId: uuid(),
    }));
    expect(createStaffMealInputSchema.safeParse(potMeal({ items })).success).toBe(
      false
    );
  });

  // ----------------------------------------------------------
  // The warning flag, and what it is not
  // ----------------------------------------------------------

  it("M10: acknowledgeDuplicateRisk defaults to false and only 'true'/'on' turn it on", () => {
    const base = createStaffMealInputSchema.safeParse(menuMeal());
    expect(base.success && base.data.acknowledgeDuplicateRisk).toBe(false);

    // The trap flagPreprocess exists for: z.coerce.boolean("false") === true.
    const lying = createStaffMealInputSchema.safeParse(
      menuMeal({ acknowledgeDuplicateRisk: "false" })
    );
    expect(lying.success && lying.data.acknowledgeDuplicateRisk).toBe(false);

    const real = createStaffMealInputSchema.safeParse(
      menuMeal({ acknowledgeDuplicateRisk: "on" })
    );
    expect(real.success && real.data.acknowledgeDuplicateRisk).toBe(true);
  });

  // ----------------------------------------------------------
  // Voiding
  // ----------------------------------------------------------

  it("M11: a void must carry a reason, and carries no quantity to make it partial", () => {
    const blank = voidStaffMealInputSchema.safeParse({
      id: uuid(),
      voidReason: "   ",
    });
    expect(blank.success).toBe(false);

    const ok = voidStaffMealInputSchema.safeParse({
      id: uuid(),
      voidReason: "คีย์ผิดคน",
      qty: 1,
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect("qty" in ok.data).toBe(false);
  });

  // ----------------------------------------------------------
  // The roster
  // ----------------------------------------------------------

  it("M12: a blank per-person quota is null — 'follow the default', never 'no quota'", () => {
    const parsed = createStaffMemberInputSchema.safeParse({
      name: "  สมชาย  ",
      branchId: uuid(),
      dailyQuotaAmount: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dailyQuotaAmount).toBeNull();
      expect(parsed.data.name).toBe("สมชาย");
    }
  });

  it("M13: includeInactive is REQUIRED, so no caller can inherit an opinion", () => {
    // Part 27's includeRetired pattern: the type error is the point, and this
    // pins the runtime half of it.
    expect(getStaffMembersQuerySchema.safeParse({}).success).toBe(false);
    expect(
      getStaffMembersQuerySchema.safeParse({ includeInactive: false }).success
    ).toBe(true);
  });

  // ----------------------------------------------------------
  // Labels
  // ----------------------------------------------------------

  it("M14: every price source has a Thai label, and PLANNED does not claim to be a price", () => {
    for (const v of STAFF_MEAL_PRICE_SOURCE_VALUES) {
      expect(STAFF_MEAL_PRICE_SOURCE_LABELS_TH[v]).toBeTruthy();
    }
    // ADR 0025 Q2: a dish that has never sold has not earned the shorter word.
    expect(STAFF_MEAL_PRICE_SOURCE_LABELS_TH.PLANNED).toBe("ราคาที่ตั้งใจ");
    expect(STAFF_MEAL_PRICE_SOURCE_LABELS_TH.NONE).not.toContain("0");
  });
});

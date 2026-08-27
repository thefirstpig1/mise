// ============================================================
// Mise — a menu's lifecycle, the wire shapes (Part 27 L2, ADR 0027)
// ============================================================
// Pure zod. No database, so what is pinned here is only what can be decided
// without one: the shape, the defaults, and the checkbox coercions.
//
// The five delete blockers need a query every time — a POS code, any sale ever,
// use as an ingredient, a live merge, a confirmed spelling — so they are L3's
// and this file does not pretend to cover them.
// ============================================================

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DELETE_BLOCKED_USE_RETIRE_TH,
  DELETE_TAKES_RECIPE_TH,
  RESTORE_OFFER_TH,
  RETIRED_STILL_SELLING_TH,
  RETIRE_MEANS_TH,
  RETIRE_NOT_IN_POS_TH,
  deleteMenuInputSchema,
  restoreMenuInputSchema,
  setMenuActiveInputSchema,
} from "@/lib/validations/menu-lifecycle";

describe("menu lifecycle wire shapes (ADR 0027 L2)", () => {
  // ------------------------------------------------------------
  // เลิกขาย / กลับมาขาย
  // ------------------------------------------------------------

  it("S1 carries the state being ASKED FOR, so a double-click is harmless", () => {
    const off = setMenuActiveInputSchema.parse({
      menuId: randomUUID(),
      isActive: false,
    });
    expect(off.isActive).toBe(false);

    // Parsing the same request twice yields the same request. Nothing here
    // toggles, so two presses land on one state rather than racing back.
    const again = setMenuActiveInputSchema.parse({
      menuId: off.menuId,
      isActive: false,
    });
    expect(again).toEqual(off);
  });

  it("S2 reads a checkbox and a typed caller as the same boolean", () => {
    // A form with no JS sends "on" for ticked and nothing at all for unticked.
    expect(
      setMenuActiveInputSchema.parse({ menuId: randomUUID(), isActive: "on" })
        .isActive
    ).toBe(true);
    expect(
      setMenuActiveInputSchema.parse({ menuId: randomUUID(), isActive: undefined })
        .isActive
    ).toBe(false);
    expect(
      setMenuActiveInputSchema.parse({ menuId: randomUUID(), isActive: true })
        .isActive
    ).toBe(true);
  });

  it("S3 refuses a menu id that is not one, in Thai", () => {
    const res = setMenuActiveInputSchema.safeParse({
      menuId: "not-a-uuid",
      isActive: false,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toBe("เมนูไม่ถูกต้อง");
    }
  });

  // ------------------------------------------------------------
  // ลบ
  // ------------------------------------------------------------

  it("S4 defaults acknowledgeRecipe to false — nobody acknowledges by accident", () => {
    const parsed = deleteMenuInputSchema.parse({ menuId: randomUUID() });
    expect(parsed.acknowledgeRecipe).toBe(false);
  });

  it("S5 accepts the acknowledgement only when it is actually sent", () => {
    const id = randomUUID();
    expect(
      deleteMenuInputSchema.parse({ menuId: id, acknowledgeRecipe: "on" })
        .acknowledgeRecipe
    ).toBe(true);
    // Anything that is not the flag is not the flag — an empty string arriving
    // from an untouched hidden input must not read as consent.
    expect(
      deleteMenuInputSchema.parse({ menuId: id, acknowledgeRecipe: "" })
        .acknowledgeRecipe
    ).toBe(false);
  });

  it("S6 has no way to skip a blocker — the shape offers no force", () => {
    const parsed = deleteMenuInputSchema.parse({
      menuId: randomUUID(),
      // Four of the five blockers are hard (Q4/Q8). A caller inventing a flag
      // gets it stripped, not honoured.
      force: true,
      acknowledgePosCode: true,
    } as Record<string, unknown>);
    expect(Object.keys(parsed).sort()).toEqual(["acknowledgeRecipe", "menuId"]);
  });

  // ------------------------------------------------------------
  // กู้คืน
  // ------------------------------------------------------------

  it("S7 restore takes an id and nothing else — no rename, because none is possible", () => {
    // ADR 0010's product restore carries `newSku` because a live product may
    // already hold that sku. `menu` has no unique on name, so the conflict this
    // would resolve cannot happen (ADR 0027 Context 4).
    const parsed = restoreMenuInputSchema.parse({
      menuId: randomUUID(),
      newName: "ชื่อใหม่",
    } as Record<string, unknown>);
    expect(Object.keys(parsed)).toEqual(["menuId"]);
  });

  // ------------------------------------------------------------
  // The shared sentences
  // ------------------------------------------------------------

  it("S8 every shared sentence is Thai, non-empty, and distinct", () => {
    const all = [
      RETIRE_MEANS_TH,
      RETIRE_NOT_IN_POS_TH,
      RETIRED_STILL_SELLING_TH,
      DELETE_BLOCKED_USE_RETIRE_TH,
      DELETE_TAKES_RECIPE_TH,
      RESTORE_OFFER_TH,
    ];
    for (const s of all) {
      expect(s.trim().length).toBeGreaterThan(0);
      expect(/[ก-๙]/.test(s)).toBe(true);
    }
    // Shared so three screens cannot drift into three stories about one flag.
    expect(new Set(all).size).toBe(all.length);
  });

  it("S9 the retire sentences say the two things ADR 0027 Q2 turns on", () => {
    // Future-only, and "retired in Mise" is not "retired in the POS" — the half
    // people get wrong, and the reason the import preview warns at all.
    expect(RETIRE_MEANS_TH).toContain("อนาคต");
    expect(RETIRE_NOT_IN_POS_TH).toContain("POS");
    expect(RETIRE_NOT_IN_POS_TH).toContain("ตัดสต๊อก");
  });
});

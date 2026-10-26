// ============================================================
// Mise — a cook counts the walk-in and sees no money (ADR 0038 audit, 2026-10-26)
// ============================================================
// The count sheet is opened with `count:write`, which cooks and heads of
// department hold and which says nothing about money. Until this fix the page
// valued every variance for whoever opened it, printed มูลค่าส่วนต่าง ฿, and
// shipped each product's unit cost in the payload. The read now takes the
// cost ticket and answers `null` without one — no figure is computed at all.
// ============================================================

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { costAccessFor } from "@/lib/permissions/cost-access";
import { getCountVarianceCostsLogic } from "@/server/stock-count";

describe("getCountVarianceCostsLogic — the money card's gate", () => {
  const ids = [randomUUID(), randomUUID()];

  it.each(["kitchen_staff", "dept_head", "cashier", "viewer"])(
    "%s gets no costs at all",
    async (role) => {
      // Tenant and branch need not exist: a reader without the ticket must be
      // refused before anything touches the database.
      await expect(
        getCountVarianceCostsLogic(randomUUID(), costAccessFor(role), randomUUID(), ids)
      ).resolves.toBeNull();
      await expect(
        getCountVarianceCostsLogic(randomUUID(), costAccessFor(role), randomUUID(), [])
      ).resolves.toBeNull();
    }
  );

  it.each(["owner", "manager", "accountant"])("%s holding cost:view gets a valuation", async (role) => {
    await expect(
      getCountVarianceCostsLogic(randomUUID(), costAccessFor(role), randomUUID(), [])
    ).resolves.toEqual({});
  });
});

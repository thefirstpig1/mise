// ============================================================
// Mise — staff meal tickets (Part 37, ADR 0035)
// ============================================================
// The eater requests with their own account; a head approves (never their
// own); the shop setting decides whether THIS system deducts; a waiting ticket
// never touches the ledger; a part-timer without an account is recorded on
// their behalf. Real Neon, real ledger — the harness staff-meal-logic.test.ts
// uses.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { getStockBalanceLogic } from "@/server/stock-movement";
import {
  createStaffMealInputSchema,
  rejectStaffMealInputSchema,
  requestStaffMealInputSchema,
  voidStaffMealInputSchema,
} from "@/lib/validations/staff-meal";
import {
  approveStaffMealLogic,
  createStaffMealLogic,
  createStaffMemberLogic,
  rejectStaffMealLogic,
  requestStaffMealLogic,
  StaffMealNoRecipeError,
  StaffMealNotApprovedError,
  StaffMealNotPendingError,
  StaffMealOnBehalfNotAllowedError,
  StaffMealSelfApprovalError,
  voidStaffMealLogic,
} from "@/server/staff-meal";
import {
  getMyStaffMealTicketsLogic,
  getPendingStaffMealTicketsLogic,
  getStaffMealQuotaLogic,
} from "@/server/staff-meal-read";

describe("staff meal tickets (ADR 0035 Part 37)", () => {
  let tenantA: string;
  let branchA: string;
  let head: string; // approves
  let cook: string; // requests
  let cook2: string;
  let partTimer: string; // roster row, no account

  let pork: ProductWithUnits;
  let kaphrao: { id: string };
  let noRecipe: { id: string };

  const today = computeBangkokToday();

  const makeMenu = (name: string) =>
    withRlsBypass((tx) =>
      tx.menu.create({
        data: { tenantId: tenantA, source: "MISE", name: `${name}-${randomUUID().slice(0, 4)}` },
        select: { id: true },
      })
    );

  const request = (userId: string, over: Record<string, unknown> = {}) =>
    requestStaffMealLogic(
      tenantA,
      requestStaffMealInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate: today,
        menuId: kaphrao.id,
        servings: 1,
        notes: "",
        ...over,
      }),
      userId
    );

  const balance = () =>
    getStockBalanceLogic(tenantA, { productId: pork.id, branchId: branchA }).then((b) =>
      Number(b.balance)
    );
  const itemsOf = (id: string) =>
    withRlsBypass((tx) => tx.staffMealItem.count({ where: { staffMealId: id } }));
  const mealOf = (id: string) =>
    withRlsBypass((tx) => tx.staffMeal.findUniqueOrThrow({ where: { id } }));
  const setSource = (v: "SYSTEM" | "POS") =>
    withRlsBypass((tx) =>
      tx.tenant.update({ where: { id: tenantA }, data: { staffMealStockSource: v } })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Staff Meal Ticket Tenant" } });
      tenantA = t.id;
      branchA = (await tx.branch.create({ data: { tenantId: t.id, name: "สีลม", code: "SMK" } })).id;
      const mk = (name: string) =>
        tx.user.create({ data: { email: `smk-${randomUUID()}@example.com`, name } });
      head = (await mk("หัวหน้าครัว")).id;
      cook = (await mk("น้องเอ")).id;
      cook2 = (await mk("น้องบี")).id;
    });

    pork = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `SMK-pork-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
      })
    );
    kaphrao = await makeMenu("กะเพรา");
    noRecipe = await makeMenu("ไม่มีสูตร");
    await createRecipeLogic(
      tenantA,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: kaphrao.id,
        outputProductId: null,
        servings: 1,
        effectiveFrom: addDays(today, -30),
        ingredients: [
          {
            productId: pork.id,
            componentMenuId: null,
            qty: 0.1,
            productUnitId: pork.productUnits[0].id,
            sortOrder: 0,
            notes: null,
          },
        ],
        notes: null,
      }),
      head
    );
    // ราคาที่ตั้งใจ ฿50, so a ticket has a price to count against the quota.
    await withRlsBypass((tx) =>
      tx.recipe.updateMany({ where: { tenantId: tenantA, menuId: kaphrao.id }, data: { plannedPrice: 50 } })
    );

    partTimer = (
      await createStaffMemberLogic(tenantA, { name: "พาร์ทไทม์", branchId: branchA, dailyQuotaAmount: 100 })
    ).id;
  }, 300_000);

  afterAll(async () => {
    await withRlsBypass(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMealItem.deleteMany({ where: { tenantId: tenantA, reversalOfItemId: { not: null } } });
      await tx.staffMealItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMeal.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMember.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeIngredient.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipeBranch.deleteMany({ where: { tenantId: tenantA } });
      await tx.recipe.deleteMany({ where: { tenantId: tenantA } });
      await tx.menu.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.delete({ where: { id: tenantA } });
      await tx.user.deleteMany({ where: { id: { in: [head, cook, cook2] } } });
    });
  }, 300_000);

  it("T1: a request is a PENDING ticket that touches nothing, and makes the requester a roster row", async () => {
    const before = await balance();
    const t = await request(cook);

    expect(t.ticketNo).toMatch(/^SMK-SM-\d{4}$/);
    const meal = await mealOf(t.id);
    expect(meal.status).toBe("PENDING");
    expect(meal.stockPosted).toBe(false);
    expect(await itemsOf(t.id)).toBe(0);
    expect(await balance()).toBe(before);

    // The eater is the account — found by it, created the first time.
    const member = await withRlsBypass((tx) =>
      tx.staffMember.findFirstOrThrow({ where: { id: meal.staffMemberId! } })
    );
    expect(member.userId).toBe(cook);
    expect(member.name).toBe("น้องเอ");

    // Asking again reuses the same row — one person, one row.
    const again = await request(cook);
    expect((await mealOf(again.id)).staffMemberId).toBe(meal.staffMemberId);
  });

  it("T2: approval (SYSTEM) explodes the recipe and posts; approving twice is refused and posts once", async () => {
    await setSource("SYSTEM");
    const t = await request(cook);
    const before = await balance();

    const res = await approveStaffMealLogic(tenantA, t.id, head);
    expect(res.stockPosted).toBe(true);
    expect(await itemsOf(t.id)).toBe(1);
    expect(await balance()).toBeCloseTo(before - 0.1, 5);

    const meal = await mealOf(t.id);
    expect(meal.status).toBe("APPROVED");
    expect(meal.approvedBy).toBe(head);

    await expect(approveStaffMealLogic(tenantA, t.id, head)).rejects.toBeInstanceOf(StaffMealNotPendingError);
    expect(await balance()).toBeCloseTo(before - 0.1, 5);
  });

  it("T3: nobody approves or rejects their own ticket", async () => {
    const t = await request(cook);
    await expect(approveStaffMealLogic(tenantA, t.id, cook)).rejects.toBeInstanceOf(StaffMealSelfApprovalError);
    await expect(
      rejectStaffMealLogic(tenantA, rejectStaffMealInputSchema.parse({ id: t.id, reason: "x" }), cook)
    ).rejects.toBeInstanceOf(StaffMealSelfApprovalError);
    // Another cook is not stopped HERE — the capability gate is the action's.
    expect((await mealOf(t.id)).status).toBe("PENDING");
  });

  it("T4: a rejected ticket moves no stock and cannot then be approved", async () => {
    const t = await request(cook2);
    const before = await balance();
    await rejectStaffMealLogic(tenantA, rejectStaffMealInputSchema.parse({ id: t.id, reason: "เกินโควตา" }), head);

    const meal = await mealOf(t.id);
    expect(meal.status).toBe("REJECTED");
    expect(meal.rejectedReason).toBe("เกินโควตา");
    expect(await balance()).toBe(before);
    await expect(approveStaffMealLogic(tenantA, t.id, head)).rejects.toBeInstanceOf(StaffMealNotPendingError);
  });

  it("T5: under POS the approval posts nothing, and the ticket keeps that answer when the setting changes", async () => {
    await setSource("POS");
    const t = await request(cook);
    const before = await balance();
    const res = await approveStaffMealLogic(tenantA, t.id, head);
    expect(res.stockPosted).toBe(false);
    expect(await itemsOf(t.id)).toBe(0);
    expect(await balance()).toBe(before);

    await setSource("SYSTEM");
    expect((await mealOf(t.id)).stockPosted).toBe(false); // frozen at approval
  });

  it("T6: the quota counts approved tickets only", async () => {
    await setSource("SYSTEM");
    const approved = await request(cook2);
    await request(cook2); // left waiting
    await approveStaffMealLogic(tenantA, approved.id, head);

    const memberId = (await mealOf(approved.id)).staffMemberId!;
    const q = await getStaffMealQuotaLogic(tenantA, { staffMemberId: memberId, businessDate: today });
    // T4's rejected one (฿50) and the waiting one are not "used"; the approved one is.
    expect(Number(q.used)).toBe(50);
  });

  it("T7: a head records on behalf of someone WITHOUT an account — never of someone with one", async () => {
    await setSource("SYSTEM");
    const before = await balance();
    const res = await createStaffMealLogic(
      tenantA,
      createStaffMealInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branchA,
        businessDate: today,
        staffMemberId: partTimer,
        menuId: kaphrao.id,
        servings: 1,
        items: [],
        recordedByName: "",
        notes: "",
      }),
      head,
      { onBehalf: true }
    );
    const meal = await mealOf(res.id);
    expect(meal.onBehalf).toBe(true);
    expect(meal.status).toBe("APPROVED");
    expect(meal.recordedBy).toBe(head);
    expect(await balance()).toBeCloseTo(before - 0.1, 5);

    const cooksRow = (await mealOf((await request(cook)).id)).staffMemberId!;
    await expect(
      createStaffMealLogic(
        tenantA,
        createStaffMealInputSchema.parse({
          submitKey: randomUUID(),
          branchId: branchA,
          businessDate: today,
          staffMemberId: cooksRow,
          menuId: kaphrao.id,
          servings: 1,
          items: [],
          recordedByName: "",
          notes: "",
        }),
        head,
        { onBehalf: true }
      )
    ).rejects.toBeInstanceOf(StaffMealOnBehalfNotAllowedError);
  });

  it("T8: a waiting ticket is rejected, not voided — it took nothing", async () => {
    const t = await request(cook);
    await expect(
      voidStaffMealLogic(tenantA, voidStaffMealInputSchema.parse({ id: t.id, voidReason: "x" }), head)
    ).rejects.toBeInstanceOf(StaffMealNotApprovedError);
  });

  it("T9: under SYSTEM a dish with no recipe is refused when ASKED, not left for the approver", async () => {
    await setSource("SYSTEM");
    await expect(request(cook, { menuId: noRecipe.id })).rejects.toBeInstanceOf(StaffMealNoRecipeError);
  });

  it("T10: the queue holds only waiting tickets; 'my tickets' holds the eater's own", async () => {
    const queue = await getPendingStaffMealTicketsLogic(tenantA, [branchA]);
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((q) => q.status === "PENDING")).toBe(true);

    const mine = await getMyStaffMealTicketsLogic(tenantA, cook2, addDays(today, -1));
    expect(mine.length).toBeGreaterThan(0);
    // cook2's own tickets only — including the rejected one, with its reason.
    const names = new Set(mine.map((m) => m.staffMemberName));
    expect([...names]).toEqual(["น้องบี"]);
    expect(mine.some((m) => m.status === "REJECTED" && m.rejectedReason === "เกินโควตา")).toBe(true);
  });
});

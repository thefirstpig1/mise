// ============================================================
// Mise — the gate, pressed (Sprint 6 Part 28 L6, ADR 0029 Q15)
// ============================================================
// Everything else in this Part checks a rule. This checks a REFUSAL: real
// memberships in the database, real server actions, and the real
// `requireTenant` deciding.
//
// WHAT IS MOCKED, AND WHY IT IS ONLY THIS. Just `auth()` — the one thing that
// cannot exist outside a request — plus `next/cache`, whose revalidatePath has
// nowhere to revalidate. `requireTenant` itself runs: it queries the membership,
// reads the role, asks the capability table, checks branch reach, and redirects.
// The existing throwaway E2E harness mocks requireTenant wholesale, which would
// have made this file assert that a mock returns what it was told to.
//
// Two cases from ADR 0029 Q15 belong to Part 28 (the other four need invites,
// which are Part 29):
//
//   E1  a `viewer` presses "record staff meal"  -> refused, and the ledger
//       does not move
//   E2  a `manager` at อโศก opens a count at สีลม -> refused
//
// Each has a POSITIVE CONTROL in the same fixture — the owner doing the same
// thing successfully — because a refusal proves nothing if the call was going
// to fail anyway.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

/** The signed-in user for the next action call. Set by `actingAs`. */
let currentUserId: string | null = null;

vi.mock("@/lib/auth", () => ({
  auth: async () =>
    currentUserId === null ? null : { user: { id: currentUserId } },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

const { withAdminContext } = await import("@/lib/db");
const { computeBangkokToday } = await import("@/lib/bangkok-date");
const { productInputSchema } = await import("@/lib/validations/product");
const { createProductLogic } = await import("@/server/product");
const { createStaffMealAction, createStaffMemberAction } = await import(
  "@/app/staff-meals/actions"
);
const { openStockCountAction } = await import("@/app/stock-counts/actions");

type ProductWithUnits = Awaited<ReturnType<typeof createProductLogic>>;

/**
 * What `redirect()` throws. Next has no public matcher, and the digest is
 * `NEXT_REDIRECT;<kind>;<url>;<status>;` — the URL is found by shape rather
 * than by index, because the field order is Next's business and has moved
 * before. Reading index 1 gave "replace" and made three real refusals look
 * like failures.
 */
function redirectTarget(e: unknown): string | null {
  const digest = (e as { digest?: string })?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";").find((part) => part.startsWith("/")) ?? "";
}

async function expectDenied(run: () => Promise<unknown>, need: string) {
  let thrown: unknown;
  try {
    await run();
  } catch (e) {
    thrown = e;
  }
  const target = redirectTarget(thrown);
  expect(target, `expected a redirect, got ${String(thrown)}`).not.toBeNull();
  expect(target).toContain("/denied");
  expect(decodeURIComponent(target!)).toContain(need);
}

describe("the gate, pressed (ADR 0029 Part 28 L6)", () => {
  let tenantA: string;
  let ownerId: string;
  let viewerId: string;
  let managerId: string;
  let asok: string;
  let silom: string;
  let pork: ProductWithUnits;
  let somchai: string;

  const today = computeBangkokToday();
  const todayIso = today.toISOString().slice(0, 10);

  const actingAs = (userId: string) => {
    currentUserId = userId;
  };

  const mealForm = (branchId: string) => {
    const fd = new FormData();
    fd.set("submit_key", randomUUID());
    fd.set("branch_id", branchId);
    fd.set("business_date", todayIso);
    fd.set("staff_member_id", somchai);
    fd.set("menu_id", "");
    fd.set("servings", "1");
    fd.set("recorded_by_name", "");
    fd.set("notes", "");
    fd.set("item_product_id", pork.id);
    fd.set("item_input_qty", "0.5");
    fd.set(
      "item_input_unit_id",
      pork.productUnits.find((u) => u.isBase)!.id
    );
    return fd;
  };

  const countForm = (branchId: string) => {
    const fd = new FormData();
    fd.set("branch_id", branchId);
    fd.set("count_date", todayIso);
    fd.set("notes", "");
    return fd;
  };

  const movementCount = () =>
    withAdminContext((tx) =>
      tx.stockMovement.count({ where: { tenantId: tenantA } })
    );

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Gate Pressed Tenant" } });
      tenantA = t.id;

      const a = await tx.branch.create({
        data: { tenantId: t.id, name: "อโศก", code: "GPA" },
      });
      asok = a.id;
      const s = await tx.branch.create({
        data: { tenantId: t.id, name: "สีลม", code: "GPS" },
      });
      silom = s.id;

      const mk = async (email: string, name: string) =>
        (await tx.user.create({ data: { email, name } })).id;

      ownerId = await mk(`gp-owner-${randomUUID()}@example.com`, "เจ้าของ");
      viewerId = await mk(`gp-viewer-${randomUUID()}@example.com`, "คนดู");
      managerId = await mk(`gp-mgr-${randomUUID()}@example.com`, "ผจก.อโศก");

      // The owner reaches every branch by the flag, exactly as tenant-init
      // writes it — no role special case anywhere (rule A2).
      await tx.tenantMembership.create({
        data: { tenantId: t.id, userId: ownerId, role: "owner", allBranches: true },
      });
      await tx.tenantMembership.create({
        data: { tenantId: t.id, userId: viewerId, role: "viewer", allBranches: true },
      });
      // Reaches ONE branch, by enumeration. This is the second person a real
      // shop invites, and the case role alone cannot handle.
      const mgr = await tx.tenantMembership.create({
        data: { tenantId: t.id, userId: managerId, role: "manager", allBranches: false },
      });
      await tx.userBranchAccess.create({
        data: { tenantMembershipId: mgr.id, branchId: asok },
      });
    });

    pork = await createProductLogic(
      tenantA,
      productInputSchema.parse({
        name: `GP-pork-${randomUUID().slice(0, 6)}`,
        type: "RAW",
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        additionalUnits: [{ unitName: "g", toBaseRatio: 0.001, isBase: false }],
        defaultBuyUnitName: "kg",
      })
    );

    actingAs(ownerId);
    const fd = new FormData();
    fd.set("name", "สมชาย");
    fd.set("branch_id", asok);
    fd.set("notes", "");
    const made = await createStaffMemberAction({ ok: false }, fd);
    expect(made.ok, "fixture: the owner could not create a staff member").toBe(true);
    somchai = (made as { ok: true; staffMemberId: string }).staffMemberId;
  });

  afterAll(async () => {
    currentUserId = null;
    await withAdminContext(async (tx) => {
      await tx.stockCountEntry.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCountItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockCount.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMealItem.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMeal.deleteMany({ where: { tenantId: tenantA } });
      await tx.staffMember.deleteMany({ where: { tenantId: tenantA } });
      await tx.stockMovement.deleteMany({ where: { tenantId: tenantA } });
      await tx.userBranchAccess.deleteMany({
        where: { membership: { tenantId: tenantA } },
      });
      await tx.tenantMembership.deleteMany({ where: { tenantId: tenantA } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: tenantA } } });
      await tx.product.deleteMany({ where: { tenantId: tenantA } });
      await tx.category.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({
        where: { id: { in: [ownerId, viewerId, managerId] } },
      });
    });
  });

  it("E0 — the owner can do both things, so a refusal below means something", async () => {
    // The positive control. Without it, E1 and E2 would pass just as happily
    // against a broken form or a bad fixture.
    actingAs(ownerId);

    const before = await movementCount();
    const meal = await createStaffMealAction({ ok: false }, mealForm(asok));
    expect(meal.ok, JSON.stringify(meal)).toBe(true);
    expect(await movementCount()).toBe(before + 1);

    const count = await openStockCountAction({ ok: false }, countForm(silom));
    expect(count.ok, JSON.stringify(count)).toBe(true);
  });

  it("E1 — a viewer presses record-staff-meal, and the ledger does not move", async () => {
    // The sentence that has been true since Sprint 0 and is now false:
    // "any authenticated member of a tenant can perform any action, including
    // a viewer" (ADR 0021 Q18).
    actingAs(viewerId);

    const before = await movementCount();
    await expectDenied(
      () => createStaffMealAction({ ok: false }, mealForm(asok)),
      "staffmeal:write"
    );

    // The refusal has to be BEFORE the write, not a message after it.
    expect(await movementCount()).toBe(before);
  });

  it("E2 — a manager at อโศก cannot open a count at สีลม", async () => {
    // Role alone cannot express this: `manager` legitimately writes. What has
    // to narrow is WHERE, and before this Part there was no way to say it.
    actingAs(managerId);

    await expectDenied(
      () => openStockCountAction({ ok: false }, countForm(silom)),
      "branch"
    );
  });

  it("E3 — the same manager CAN open a count at อโศก", async () => {
    // The other half of E2. A refusal that also refused the branch they were
    // hired to run would be a broken feature, not a working gate.
    actingAs(managerId);

    const ok = await openStockCountAction({ ok: false }, countForm(asok));
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
  });

  it("E4 — an unauthenticated press reaches /login, not the ledger", async () => {
    currentUserId = null;

    const before = await movementCount();
    let thrown: unknown;
    try {
      await createStaffMealAction({ ok: false }, mealForm(asok));
    } catch (e) {
      thrown = e;
    }
    expect(redirectTarget(thrown)).toContain("/login");
    expect(await movementCount()).toBe(before);
  });
});

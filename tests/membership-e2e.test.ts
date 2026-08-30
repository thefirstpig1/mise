// ============================================================
// Mise — the invite screen, pressed (Sprint 6 Part 29 L6, ADR 0029 Q15)
// ============================================================
// The remaining four cases from ADR 0029 Q15, which Part 28 could not run
// because nobody could be invited yet:
//
//   Q3  a manager at อโศก invites somebody into สีลม        -> refused
//   Q4  a manager invites their own second address as owner -> refused
//   Q5  an admin deactivates the last owner                 -> refused
//   +   a person in two shops is asked WHICH, never guessed
//
// Q4 is the one that matters. It is not a hypothetical: an invitation is a
// single INSERT (Q2), the manager controls the second inbox, and without rule 4
// the whole of Part 28's gate is bypassable in thirty seconds by the person it
// was built to constrain.
//
// Real memberships, real actions, real requireTenant. Only `auth()` and the
// cookie jar are mocked — the two things that cannot exist outside a request.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

let currentUserId: string | null = null;
let cookieValue: string | null = null;

vi.mock("@/lib/auth", () => ({
  auth: async () =>
    currentUserId === null ? null : { user: { id: currentUserId } },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValue === null ? undefined : { name, value: cookieValue },
    set: () => {},
  }),
}));

const { withAdminContext } = await import("@/lib/db");
const {
  inviteMemberAction,
  setMemberActiveAction,
  updateMemberAction,
} = await import("@/app/settings/members/actions");

function redirectTarget(e: unknown): string | null {
  const digest = (e as { digest?: string })?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";").find((p) => p.startsWith("/")) ?? "";
}

describe("the invite screen, pressed (ADR 0029 Part 29 L6)", () => {
  let tenantA: string;
  let tenantB: string;
  let ownerId: string;
  let ownerMembership: string;
  let adminId: string;
  let managerId: string;
  let twoShopId: string;
  let asok: string;
  let silom: string;

  const email = (tag: string) => `e2e-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const actingAs = (id: string | null) => {
    currentUserId = id;
  };

  const inviteForm = (over: Record<string, string | string[]> = {}) => {
    const fd = new FormData();
    fd.set("email", (over.email as string) ?? email("invitee"));
    fd.set("name", "คนใหม่");
    fd.set("role", (over.role as string) ?? "kitchen_staff");
    if (over.all_branches) fd.set("all_branches", over.all_branches as string);
    const branches = (over.branch_id as string[]) ?? [asok];
    for (const b of branches) fd.append("branch_id", b);
    return fd;
  };

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Invite E2E Shop" } });
      tenantA = t.id;
      const t2 = await tx.tenant.create({ data: { name: "The Other Shop" } });
      tenantB = t2.id;

      asok = (await tx.branch.create({
        data: { tenantId: t.id, name: "อโศก", code: "IEA" },
      })).id;
      silom = (await tx.branch.create({
        data: { tenantId: t.id, name: "สีลม", code: "IES" },
      })).id;
      await tx.branch.create({
        data: { tenantId: t2.id, name: "ร้านที่สอง", code: "IEB" },
      });

      const mk = async (tag: string) =>
        (await tx.user.create({ data: { email: email(tag), name: tag } })).id;

      ownerId = await mk("owner");
      adminId = await mk("admin");
      managerId = await mk("mgr");
      twoShopId = await mk("bookkeeper");

      ownerMembership = (
        await tx.tenantMembership.create({
          data: { tenantId: t.id, userId: ownerId, role: "owner", allBranches: true },
        })
      ).id;
      await tx.tenantMembership.create({
        data: { tenantId: t.id, userId: adminId, role: "admin", allBranches: true },
      });
      const mgr = await tx.tenantMembership.create({
        data: { tenantId: t.id, userId: managerId, role: "manager", allBranches: false },
      });
      await tx.userBranchAccess.create({
        data: { tenantMembershipId: mgr.id, branchId: asok },
      });

      // The outside bookkeeper: two shops, which nobody could be before now.
      await tx.tenantMembership.create({
        data: { tenantId: t.id, userId: twoShopId, role: "accountant", allBranches: true },
      });
      await tx.tenantMembership.create({
        data: { tenantId: t2.id, userId: twoShopId, role: "accountant", allBranches: true },
      });
    });
  });

  afterAll(async () => {
    currentUserId = null;
    cookieValue = null;
    const users = await withAdminContext((tx) =>
      tx.tenantMembership.findMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
        select: { userId: true },
      })
    );
    await withAdminContext(async (tx) => {
      await tx.userBranchAccess.deleteMany({
        where: { membership: { tenantId: { in: [tenantA, tenantB] } } },
      });
      await tx.tenantMembership.deleteMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
      });
      await tx.branch.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
      await tx.user.deleteMany({ where: { id: { in: users.map((u) => u.userId) } } });
    });
  });

  it("I0 — the owner can invite, so a refusal below means something", async () => {
    actingAs(ownerId);
    const res = await inviteMemberAction({ ok: false }, inviteForm({ role: "purchaser" }));
    expect(res.ok, JSON.stringify(res)).toBe(true);
  });

  it("I1 — a cook cannot reach this screen at all", async () => {
    // Before the four rules can matter, `member:manage` has to keep the wrong
    // people out of the room.
    const cook = await withAdminContext(async (tx) => {
      const u = await tx.user.create({ data: { email: email("cook"), name: "คนครัว" } });
      await tx.tenantMembership.create({
        data: { tenantId: tenantA, userId: u.id, role: "kitchen_staff", allBranches: true },
      });
      return u.id;
    });
    actingAs(cook);

    let thrown: unknown;
    try {
      await inviteMemberAction({ ok: false }, inviteForm());
    } catch (e) {
      thrown = e;
    }
    expect(redirectTarget(thrown)).toContain("/denied");
    expect(decodeURIComponent(redirectTarget(thrown)!)).toContain("member:manage");
  });

  it("Q15-4 — a manager cannot invite their own address as owner (rule 4)", async () => {
    // THE attack. One INSERT, an inbox they control, and the whole gate is
    // theirs. Rule 4 refuses it without any ranking of roles: `owner` simply
    // holds capabilities `manager` does not.
    //
    // ⚠️ THE ASSERTION IS ON THE DISTINCTIVE HALF OF THE SENTENCE, and it has
    // to be. Rules 1 and 4 BOTH refuse this press, and both messages contain
    // the words "เจ้าของร้าน" — so an assertion on that phrase stayed green
    // when rule 4 was deleted, and again when rule 1 was. The test proved
    // "something refused", which is the weakest possible claim. Q15-4b below is
    // the other half of the pair.
    actingAs(managerId);

    const res = await inviteMemberAction(
      { ok: false },
      inviteForm({ email: email("second-inbox"), role: "owner" })
    );

    expect(res.ok).toBe(false);
    // Rule 4's sentence, and only rule 4's: "your own role does not hold
    // everything that role holds".
    expect(!res.ok && res.formError).toContain("ไม่มีสิทธิ์ทั้งหมด");

    // Nothing written: no membership, and no user row either.
    const count = await withAdminContext((tx) =>
      tx.tenantMembership.count({ where: { tenantId: tenantA, role: "owner" } })
    );
    expect(count).toBe(1);
  });

  it("Q15-4b — an admin cannot invite an owner either, and rule 4 is NOT why", async () => {
    // The discriminating half. An admin holds every capability, so containment
    // is satisfied and rule 4 lets this through — only rule 1 stops it, because
    // CREATING an owner is touching one. Without this case, deleting rule 1
    // leaves the suite green.
    actingAs(adminId);

    const res = await inviteMemberAction(
      { ok: false },
      inviteForm({ email: email("admin-owner"), role: "owner" })
    );

    expect(res.ok).toBe(false);
    // Rule 1's sentence, and only rule 1's.
    expect(!res.ok && res.formError).toContain("แก้ไขได้โดยเจ้าของร้านเท่านั้น");

    const owners = await withAdminContext((tx) =>
      tx.tenantMembership.count({ where: { tenantId: tenantA, role: "owner" } })
    );
    expect(owners).toBe(1);
  });

  it("Q15-3 — a manager at อโศก cannot invite anybody into สีลม", async () => {
    actingAs(managerId);

    const res = await inviteMemberAction({ ok: false }, inviteForm({ branch_id: [silom] }));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.formError).toContain("สาขา");

    // ...and cannot launder their one branch into all of them.
    const laundered = await inviteMemberAction(
      { ok: false },
      inviteForm({ all_branches: "on", branch_id: [] })
    );
    expect(laundered.ok).toBe(false);
  });

  it("Q15-3b — the same manager CAN staff their own branch", async () => {
    // A rule that also refused the branch they run would be a broken feature.
    actingAs(managerId);
    const res = await inviteMemberAction({ ok: false }, inviteForm({ branch_id: [asok] }));
    expect(res.ok, JSON.stringify(res)).toBe(true);
  });

  it("Q15-5 — the last owner cannot remove THEMSELVES (rule 3)", async () => {
    // Rule 3, and the one refusal in this Part that is not about escalation: a
    // tenant with no owner can never be administered again.
    //
    // ⚠️ THE ACTOR HAD TO BE THE OWNER, and finding that out took a break that
    // stayed green. This case was first written with the ADMIN pressing the
    // button — but rule 1 refuses an admin before rule 3 is ever consulted, so
    // deleting rule 3 changed nothing and the test still passed. A rule that
    // sits behind another rule is a rule nothing tests.
    //
    // An owner touching an owner passes rule 1 by definition, so this press
    // reaches rule 3 and only rule 3.
    actingAs(ownerId);

    const fd = new FormData();
    fd.set("membership_id", ownerMembership);
    fd.set("is_active", "false");

    const res = await setMemberActiveAction({ ok: false }, fd);
    expect(res.ok).toBe(false);
    // Rule 3's sentence, and only rule 3's.
    expect(!res.ok && res.formError).toContain("อย่างน้อย 1 คน");

    const stillThere = await withAdminContext((tx) =>
      tx.tenantMembership.count({
        where: { tenantId: tenantA, role: "owner", isActive: true },
      })
    );
    expect(stillThere).toBe(1);
  });

  it("Q15-5c — an admin is stopped one rule earlier, by rule 1", async () => {
    // The same button, a different person, a different reason — and the reason
    // is what this case exists to pin. Both refusals mention เจ้าของ, so only
    // the distinctive half of each sentence can tell them apart.
    actingAs(adminId);

    const fd = new FormData();
    fd.set("membership_id", ownerMembership);
    fd.set("is_active", "false");

    const res = await setMemberActiveAction({ ok: false }, fd);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.formError).toContain("แก้ไขได้โดยเจ้าของร้านเท่านั้น");
  });

  it("Q15-5b — an admin cannot demote the owner either, and rule 3 is not why", async () => {
    // Rule 1 stops this one, not rule 3 — an admin holds every capability, so
    // containment is satisfied and only "the account belongs to somebody" is
    // left. Worth a separate case because the two refusals read identically
    // from outside and mean different things.
    actingAs(adminId);

    const fd = new FormData();
    fd.set("membership_id", ownerMembership);
    fd.set("role", "manager");
    fd.set("branch_id", asok);

    const res = await updateMemberAction({ ok: false }, fd);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.formError).toContain("แก้ไขได้โดยเจ้าของร้านเท่านั้น");
  });

  it("Q3 — a person in two shops is asked which, never guessed", async () => {
    // Before Part 29 this person would have silently seen whichever shop was
    // oldest, for ever, with nothing on screen suggesting the other existed.
    actingAs(twoShopId);
    cookieValue = null;

    let thrown: unknown;
    try {
      await inviteMemberAction({ ok: false }, inviteForm());
    } catch (e) {
      thrown = e;
    }
    expect(redirectTarget(thrown)).toBe("/choose-shop");
  });

  it("Q3b — a cookie naming a shop they do not belong to is ignored", async () => {
    // Rule A9. The cookie only ever SELECTS from a list fetched by userId, so a
    // forged one selects nothing and lands back at the chooser — it must never
    // reach a query.
    actingAs(twoShopId);
    cookieValue = randomUUID();

    let thrown: unknown;
    try {
      await inviteMemberAction({ ok: false }, inviteForm());
    } catch (e) {
      thrown = e;
    }
    expect(redirectTarget(thrown)).toBe("/choose-shop");
  });

  it("Q3c — a good cookie puts them in that shop, and the refusal proves it", async () => {
    // An accountant holds no member:manage, so reaching /denied — rather than
    // /choose-shop — is the evidence that the cookie actually selected a
    // membership and the request carried on with it.
    actingAs(twoShopId);
    cookieValue = tenantB;

    let thrown: unknown;
    try {
      await inviteMemberAction({ ok: false }, inviteForm());
    } catch (e) {
      thrown = e;
    }
    expect(decodeURIComponent(redirectTarget(thrown)!)).toContain("member:manage");

    cookieValue = null;
  });
});

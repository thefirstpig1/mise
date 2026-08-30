// ============================================================
// Mise — the second person, written (Sprint 6 Part 29 L3, ADR 0029 Q2/Q10)
// ============================================================
// `tenant_membership` had one writer for twenty-eight Parts. This is the
// second, and it is the file where a `viewer` first becomes possible — which
// makes it also the file where the account can first be stolen if the four
// rules are wrong.
//
// The three pure rules are pinned in permissions-grant-rules.test.ts. What is
// here is what needs a database: rule 3 (an owner must remain), the invitation
// actually landing as a row, and re-inviting somebody who was removed.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass } from "@/lib/db-admin";
import { prisma } from "@/lib/db";
import {
  inviteMemberInputSchema,
  setMemberActiveInputSchema,
  updateMemberInputSchema,
} from "@/lib/validations/membership";
import {
  AlreadyMemberError,
  BranchNotFoundError,
  CannotGrantBranchError,
  CannotGrantRoleError,
  CannotTouchOwnerError,
  LastOwnerError,
  inviteMemberLogic,
  setMemberActiveLogic,
  updateMemberLogic,
  type MembershipActor,
} from "@/server/membership";

describe("membership writes (ADR 0029 Part 29 L3)", () => {
  let tenantA: string;
  let ownerUser: string;
  let ownerMembership: string;
  let asok: string;
  let silom: string;
  /**
   * Users this spec creates that never get a membership — the actor in M13.
   * The teardown below collects everybody else THROUGH their membership, so
   * a user without one walks straight past it and is left in `app_user` for
   * ever. The run stays green and only the sweep notices (ADR 0023 Q5).
   */
  const strayUsers: string[] = [];

  const email = (tag: string) => `mem-${tag}-${randomUUID().slice(0, 8)}@example.com`;

  const OWNER = (): MembershipActor => ({
    userId: ownerUser,
    role: "owner",
    reach: { allBranches: true, allowedBranchIds: [] },
  });

  const BRANCH_MANAGER = (): MembershipActor => ({
    userId: ownerUser,
    role: "manager",
    reach: { allBranches: false, allowedBranchIds: [asok] },
  });

  const ADMIN = (): MembershipActor => ({
    userId: ownerUser,
    role: "admin",
    reach: { allBranches: true, allowedBranchIds: [] },
  });

  const invite = (over: Record<string, unknown> = {}, actor = OWNER()) =>
    inviteMemberLogic(
      tenantA,
      inviteMemberInputSchema.parse({
        email: email("x"),
        name: "คนใหม่",
        role: "kitchen_staff",
        allBranches: false,
        branchIds: [asok],
        ...over,
      }),
      actor
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Membership Tenant" } });
      tenantA = t.id;
      asok = (
        await tx.branch.create({
          data: { tenantId: t.id, name: "อโศก", code: "MMA" },
        })
      ).id;
      silom = (
        await tx.branch.create({
          data: { tenantId: t.id, name: "สีลม", code: "MMS" },
        })
      ).id;
      ownerUser = (
        await tx.user.create({ data: { email: email("owner"), name: "เจ้าของ" } })
      ).id;
      ownerMembership = (
        await tx.tenantMembership.create({
          data: {
            tenantId: t.id,
            userId: ownerUser,
            role: "owner",
            allBranches: true,
          },
        })
      ).id;
    });
  });

  afterAll(async () => {
    const users = await withRlsBypass((tx) =>
      tx.tenantMembership.findMany({
        where: { tenantId: tenantA },
        select: { userId: true },
      })
    );
    await withRlsBypass(async (tx) => {
      await tx.userBranchAccess.deleteMany({
        where: { membership: { tenantId: tenantA } },
      });
      await tx.tenantMembership.deleteMany({ where: { tenantId: tenantA } });
      await tx.branch.deleteMany({ where: { tenantId: tenantA } });
      await tx.tenant.deleteMany({ where: { id: tenantA } });
      await tx.user.deleteMany({
        where: { id: { in: [...users.map((u) => u.userId), ...strayUsers] } },
      });
    });
  });

  // ── the invitation is a row ───────────────────────────────────────────────

  it("M1 — an invitation creates the user AND the membership, in one act", async () => {
    // Q2: no token, no acceptance step. What exists afterwards is exactly what
    // `requireTenant` needs to let the person in when they follow a magic link.
    const addr = email("m1");
    const res = await invite({ email: addr, role: "purchaser" });

    const row = await withRlsBypass((tx) =>
      tx.tenantMembership.findUniqueOrThrow({
        where: { id: res.membershipId },
        select: {
          role: true,
          isActive: true,
          allBranches: true,
          roleChangedBy: true,
          roleChangedAt: true,
          user: { select: { email: true, emailVerified: true } },
          branchAccess: { select: { branchId: true } },
        },
      })
    );

    expect(row.role).toBe("purchaser");
    expect(row.isActive).toBe(true);
    expect(row.user.email).toBe(addr);
    // Never signed in — which is exactly how the screen tells "invited" from
    // "working here" without a status column.
    expect(row.user.emailVerified).toBeNull();
    expect(row.branchAccess.map((b) => b.branchId)).toEqual([asok]);
    // The invitation IS the first change (Q14).
    expect(row.roleChangedBy).toBe(ownerUser);
    expect(row.roleChangedAt).not.toBeNull();
  });

  it("M2 — an email is identity, so case and spaces cannot fork a person", async () => {
    const addr = email("m2");
    await invite({ email: `  ${addr.toUpperCase()}  `, role: "viewer" });

    const users = await prisma.user.findMany({
      where: { email: { in: [addr, addr.toUpperCase()] } },
      select: { email: true },
    });
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe(addr);
  });

  it("M3 — inviting somebody who is already here is refused by name", async () => {
    const addr = email("m3");
    await invite({ email: addr });
    await expect(invite({ email: addr })).rejects.toBeInstanceOf(AlreadyMemberError);
  });

  it("M4 — a name is only written for somebody who has never signed in", async () => {
    // Overwriting what a person chose for their own account because a colleague
    // typed something else into an invite form would be rude, and it is the
    // kind of thing an upsert does by accident.
    const addr = email("m4");
    await prisma.user.create({ data: { email: addr, name: "ชื่อที่เจ้าตัวตั้ง" } });

    await invite({ email: addr, name: "ชื่อที่เพื่อนพิมพ์" });

    const u = await prisma.user.findUniqueOrThrow({
      where: { email: addr },
      select: { name: true },
    });
    expect(u.name).toBe("ชื่อที่เจ้าตัวตั้ง");
  });

  // ── rule 3, which needs the rows ──────────────────────────────────────────

  it("M5 — the last owner cannot be demoted", async () => {
    // Not a policy. A tenant with no owner is a tenant nobody can administer
    // again: no admin console, no support tool, no way back.
    await expect(
      updateMemberLogic(
        tenantA,
        updateMemberInputSchema.parse({
          membershipId: ownerMembership,
          role: "manager",
          allBranches: true,
          branchIds: [],
        }),
        OWNER()
      )
    ).rejects.toBeInstanceOf(LastOwnerError);
  });

  it("M6 — the last owner cannot be deactivated either", async () => {
    await expect(
      setMemberActiveLogic(
        tenantA,
        setMemberActiveInputSchema.parse({
          membershipId: ownerMembership,
          isActive: false,
        }),
        OWNER()
      )
    ).rejects.toBeInstanceOf(LastOwnerError);
  });

  it("M7 — with a second owner, the first may step down", async () => {
    // The other half of M5. A rule that refused a real handover would be a bug
    // wearing a rule's clothes — this is how a shop changes hands.
    const second = await invite({ email: email("m7"), role: "owner" });

    const demoted = await updateMemberLogic(
      tenantA,
      updateMemberInputSchema.parse({
        membershipId: ownerMembership,
        role: "manager",
        allBranches: true,
        branchIds: [],
      }),
      OWNER()
    );
    expect(demoted.role).toBe("manager");

    // ...and now the NEW owner is the last one, so the rule follows them.
    await expect(
      setMemberActiveLogic(
        tenantA,
        setMemberActiveInputSchema.parse({
          membershipId: second.membershipId,
          isActive: false,
        }),
        OWNER()
      )
    ).rejects.toBeInstanceOf(LastOwnerError);

    // put the fixture back for the tests below
    await withRlsBypass((tx) =>
      tx.tenantMembership.update({
        where: { id: ownerMembership },
        data: { role: "owner" },
      })
    );
    await setMemberActiveLogic(
      tenantA,
      setMemberActiveInputSchema.parse({
        membershipId: second.membershipId,
        isActive: false,
      }),
      OWNER()
    );
  });

  // ── the rules, through the write path ─────────────────────────────────────

  it("M8 — a manager cannot invite an owner (the real escalation)", async () => {
    // Invite my own second address as `owner`, sign in as it. Thirty seconds,
    // without rule 4.
    await expect(
      invite({ email: email("m8"), role: "owner" }, BRANCH_MANAGER())
    ).rejects.toBeInstanceOf(CannotGrantRoleError);
  });

  it("M9 — an admin cannot create an owner either, and rule 4 is not why", async () => {
    // An admin holds every capability, so containment is satisfied and rule 4
    // would let this through. Rule 1 is what stops it — CREATING an owner is
    // touching one in every sense that matters.
    await expect(
      invite({ email: email("m9"), role: "owner" }, ADMIN())
    ).rejects.toBeInstanceOf(CannotTouchOwnerError);
  });

  it("M10 — a branch manager cannot staff a branch they do not reach", async () => {
    await expect(
      invite({ email: email("m10"), branchIds: [silom] }, BRANCH_MANAGER())
    ).rejects.toBeInstanceOf(CannotGrantBranchError);

    // ...and cannot launder one branch into all of them.
    await expect(
      invite(
        { email: email("m10b"), allBranches: true, branchIds: [] },
        BRANCH_MANAGER()
      )
    ).rejects.toBeInstanceOf(CannotGrantBranchError);

    // Their own branch is fine, or the role could hire nobody.
    const ok = await invite({ email: email("m10c"), branchIds: [asok] }, BRANCH_MANAGER());
    expect(ok.membershipId).toBeTruthy();
  });

  it("M11 — a branch id from another shop is refused before anything is written", async () => {
    const other = await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Someone Else" } });
      const b = await tx.branch.create({
        data: { tenantId: t.id, name: "ของร้านอื่น", code: "OTH" },
      });
      return { tenantId: t.id, branchId: b.id };
    });

    const addr = email("m11");
    await expect(
      invite({ email: addr, branchIds: [other.branchId] })
    ).rejects.toBeInstanceOf(BranchNotFoundError);

    // Nothing half-written: no membership...
    const rows = await withRlsBypass((tx) =>
      tx.tenantMembership.count({
        where: { tenantId: tenantA, user: { email: addr } },
      })
    );
    expect(rows).toBe(0);

    // ...AND no person. The `user.upsert` cannot run inside the tenant
    // transaction (it keys on email, so it is cross-tenant by nature), which
    // means it is not rolled back by the refusal — the branch check has to
    // happen BEFORE it or a rejected form leaves a stranger in `app_user`
    // for ever.
    //
    // This assertion exists because the suite went green and the test SWEEP
    // reported orphaned users, which is the case ADR 0023 Q5 built that
    // warning for. Without this line the bug is invisible again the moment
    // somebody reorders the function.
    const people = await prisma.user.count({ where: { email: addr } });
    expect(people, "a refused invitation left a user row behind").toBe(0);

    await withRlsBypass(async (tx) => {
      await tx.branch.deleteMany({ where: { tenantId: other.tenantId } });
      await tx.tenant.deleteMany({ where: { id: other.tenantId } });
    });
  });

  // ── coming back ───────────────────────────────────────────────────────────

  it("M12 — re-inviting a removed person reuses their row and their identity", async () => {
    // `@@unique([tenantId, userId])` makes this a database fact rather than a
    // preference: there cannot be a second row. Every document they wrote still
    // points at the same user.
    const addr = email("m12");
    const first = await invite({ email: addr, role: "kitchen_staff" });

    await setMemberActiveLogic(
      tenantA,
      setMemberActiveInputSchema.parse({
        membershipId: first.membershipId,
        isActive: false,
      }),
      OWNER()
    );

    const back = await invite({ email: addr, role: "purchaser", branchIds: [silom] });

    expect(back.wasReactivated).toBe(true);
    expect(back.membershipId).toBe(first.membershipId);
    expect(back.userId).toBe(first.userId);

    const row = await withRlsBypass((tx) =>
      tx.tenantMembership.findUniqueOrThrow({
        where: { id: back.membershipId },
        select: {
          role: true,
          isActive: true,
          branchAccess: { select: { branchId: true } },
        },
      })
    );
    expect(row.isActive).toBe(true);
    expect(row.role).toBe("purchaser");
    // Re-hired is not "never left": the reach is what was chosen now.
    expect(row.branchAccess.map((b) => b.branchId)).toEqual([silom]);
  });

  it("M13 — every change records who made it", async () => {
    const addr = email("m13");
    const m = await invite({ email: addr, role: "viewer" });

    const before = await withRlsBypass((tx) =>
      tx.tenantMembership.findUniqueOrThrow({
        where: { id: m.membershipId },
        select: { roleChangedAt: true },
      })
    );

    const second = await withRlsBypass((tx) =>
      tx.user.create({ data: { email: email("m13-actor"), name: "ผู้จัดการ" } })
    );
    strayUsers.push(second.id);

    await updateMemberLogic(
      tenantA,
      updateMemberInputSchema.parse({
        membershipId: m.membershipId,
        role: "kitchen_staff",
        allBranches: false,
        branchIds: [asok],
      }),
      { userId: second.id, role: "owner", reach: { allBranches: true, allowedBranchIds: [] } }
    );

    const after = await withRlsBypass((tx) =>
      tx.tenantMembership.findUniqueOrThrow({
        where: { id: m.membershipId },
        select: { roleChangedBy: true, roleChangedAt: true },
      })
    );

    expect(after.roleChangedBy).toBe(second.id);
    expect(after.roleChangedAt!.getTime()).toBeGreaterThanOrEqual(
      before.roleChangedAt!.getTime()
    );
  });
});

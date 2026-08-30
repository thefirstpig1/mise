// ============================================================
// Mise — the second person (Sprint 6 Part 29 L3, ADR 0029 Q2/Q10)
// ============================================================
// Until this file, `tenant_membership` had exactly ONE writer in the whole
// project — `tenant-init.ts:50`, making the owner — which is why the hole that
// Part 28 closed had never had a day on which it could happen: no `viewer` had
// ever existed to be stopped. This is where they start existing.
//
// AN INVITATION IS THE MEMBERSHIP ROW (Q2). There is no token, no expiry, no
// acceptance step, and no `tenant_invitation` table. Signing in with a magic
// link already proves a person owns the address, and that IS the acceptance —
// a second credential would be machinery duplicating the first, and the email
// to carry it cannot be sent until Sprint 7 anyway.
//
// THE FOUR RULES (Q10). Three are pure and live in permissions/service.ts.
// Rule 3 lives here, because "at least one active owner" is a question about
// rows and can only be answered where the rows are:
//
//   1  an `owner` row is only touched by an `owner`         canModifyMembershipOf
//   2  you only grant branch reach you hold yourself        canGrantReach
//   3  a tenant always keeps one active owner               HERE
//   4  you only grant a role whose capabilities you hold    canGrantRole
//
// Rule 3 is the one REFUSAL in this Part, and it is not a policy. ADR 0028
// established that Mise does not block on policy — the food is already eaten,
// and refusing the record makes the stock wrong AND hides the overspend. This
// is the other kind: a tenant with no owner is a tenant nobody can ever
// administer again. There is no admin console, no support tool, no way back.
// That is an inability, and inabilities are refused.
// ============================================================

import type { PrismaClient, TenantMembership } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withTenantContext } from "@/lib/db";
import {
  canGrantReach,
  canGrantRole,
  canModifyMembershipOf,
  type BranchReach,
} from "@/lib/permissions/service";
import type {
  InviteMemberInput,
  SetMemberActiveInput,
  UpdateMemberInput,
} from "@/lib/validations/membership";

// ------------------------------------------------------------
// Refusals
// ------------------------------------------------------------

/** Rule 4. Names the role so the screen can say which one, in Thai. */
export class CannotGrantRoleError extends Error {
  constructor(readonly role: string) {
    super(`cannot grant role ${role}`);
    this.name = "CannotGrantRoleError";
  }
}

/** Rule 1. */
export class CannotTouchOwnerError extends Error {
  constructor() {
    super("only an owner may modify an owner");
    this.name = "CannotTouchOwnerError";
  }
}

/** Rule 2. Names the branches that were out of reach. */
export class CannotGrantBranchError extends Error {
  constructor(readonly branchIds: readonly string[]) {
    super("cannot grant branches outside your own reach");
    this.name = "CannotGrantBranchError";
  }
}

/** Rule 3. */
export class LastOwnerError extends Error {
  constructor() {
    super("a tenant must keep at least one active owner");
    this.name = "LastOwnerError";
  }
}

/** The person is already in this shop and active. */
export class AlreadyMemberError extends Error {
  constructor(readonly email: string) {
    super(`${email} is already a member`);
    this.name = "AlreadyMemberError";
  }
}

export class MembershipNotFoundError extends Error {
  constructor() {
    super("membership not found");
    this.name = "MembershipNotFoundError";
  }
}

/** A branch id that is not this tenant's at all. */
export class BranchNotFoundError extends Error {
  constructor(readonly branchIds: readonly string[]) {
    super("branch not found");
    this.name = "BranchNotFoundError";
  }
}

// ------------------------------------------------------------
// Who is doing it
// ------------------------------------------------------------

/**
 * The actor, as `requireTenant` already knows them. Passed in rather than
 * looked up so this layer stays a pure function of its inputs — the same
 * discipline every other `*Logic` in `src/server` keeps.
 */
export interface MembershipActor {
  userId: string;
  role: string;
  reach: BranchReach;
}

const wantedReach = (input: {
  allBranches: boolean;
  branchIds: string[];
}): BranchReach => ({
  allBranches: input.allBranches,
  allowedBranchIds: input.branchIds,
});

/**
 * Rules 1, 2 and 4 for one act, in a fixed order.
 *
 * THE ORDER DECIDES WHICH REASON A PERSON IS GIVEN when more than one rule
 * refuses, and it took a failing test to get right. A manager inviting an
 * `owner` trips rule 1 AND rule 4; checking rule 1 first told them "you cannot
 * modify an owner", which is true and useless — they were not modifying
 * anybody, and the same refusal would have met them at `admin`, for a reason
 * that sentence never mentions.
 *
 * So rule 4 goes first, and each actor now gets the reason that is distinctive
 * for THEM: a manager is told they cannot hand out capabilities they do not
 * hold (true of `owner`, `admin`, and anything else they try), while an `admin`
 * — who passes containment, holding everything — is told the one thing that is
 * actually special about their case, which is that the account belongs to
 * somebody.
 */
function assertMayGrant(
  actor: MembershipActor,
  targetRole: string,
  wanted: BranchReach,
  currentRoleOfTarget: string | null
): void {
  // Rule 4 — first, because it is the general reason and the informative one.
  if (!canGrantRole(actor.role, targetRole)) {
    throw new CannotGrantRoleError(targetRole);
  }

  // Rule 1 — what is left after containment: an `admin` holds every capability,
  // so only this stops them. CREATING an owner counts as touching one, which is
  // why the check is on the role being granted as well as the one being
  // replaced.
  if (targetRole === "owner" && actor.role !== "owner") {
    throw new CannotTouchOwnerError();
  }
  if (
    currentRoleOfTarget !== null &&
    !canModifyMembershipOf(actor.role, currentRoleOfTarget)
  ) {
    throw new CannotTouchOwnerError();
  }

  // Rule 2 — last, because a role you may not grant is a bigger problem than a
  // branch you may not reach, and fixing the branch first fixes nothing.
  if (!canGrantReach(actor.reach, wanted)) {
    const outside = wanted.allBranches
      ? []
      : wanted.allowedBranchIds.filter(
          (id) => !actor.reach.allowedBranchIds.includes(id)
        );
    throw new CannotGrantBranchError(outside);
  }
}

/**
 * Rule 3, asked inside the caller's transaction.
 *
 * `excludingMembershipId` is the row about to change: the question is whether
 * an owner would remain AFTERWARDS, not whether one exists now.
 */
async function assertOwnerRemains(
  tx: PrismaClient,
  tenantId: string,
  excludingMembershipId: string
): Promise<void> {
  const others = await tx.tenantMembership.count({
    where: {
      tenantId,
      role: "owner",
      isActive: true,
      id: { not: excludingMembershipId },
    },
  });
  if (others === 0) throw new LastOwnerError();
}

/** Branch ids must belong to this tenant before they can be granted. */
async function assertBranchesExist(
  tx: PrismaClient,
  tenantId: string,
  branchIds: readonly string[]
): Promise<void> {
  if (branchIds.length === 0) return;
  const found = await tx.branch.findMany({
    where: { tenantId, id: { in: [...branchIds] }, deletedAt: null },
    select: { id: true },
  });
  const seen = new Set(found.map((b) => b.id));
  const missing = branchIds.filter((id) => !seen.has(id));
  if (missing.length > 0) throw new BranchNotFoundError(missing);
}

async function writeBranchAccess(
  tx: PrismaClient,
  membershipId: string,
  branchIds: readonly string[]
): Promise<void> {
  await tx.userBranchAccess.deleteMany({
    where: { tenantMembershipId: membershipId },
  });
  if (branchIds.length === 0) return;
  await tx.userBranchAccess.createMany({
    data: branchIds.map((branchId) => ({
      tenantMembershipId: membershipId,
      branchId,
    })),
  });
}

// ------------------------------------------------------------
// 1. Inviting
// ------------------------------------------------------------

/**
 * Add a person to the shop.
 *
 * THE USER LOOKUP IS CROSS-TENANT BY NATURE — it keys on email, not tenantId,
 * exactly like `requireTenant`'s membership discovery (ADR 0004) — so it runs
 * as bare `prisma` OUTSIDE the tenant-scoped transaction. The membership write
 * is inside it.
 *
 * A person who was removed and is being added back UPDATES their existing row
 * rather than getting a second one: `@@unique([tenantId, userId])` makes that a
 * database fact, not a preference. Their old branch access is replaced, because
 * being re-hired is not the same as never having left and the person doing the
 * inviting is choosing afresh.
 */
export async function inviteMemberLogic(
  tenantId: string,
  input: InviteMemberInput,
  actor: MembershipActor
): Promise<{ membershipId: string; userId: string; wasReactivated: boolean }> {
  assertMayGrant(actor, input.role, wantedReach(input), null);

  // ── the branches are checked BEFORE the person is created ────────────────
  //
  // Order, not tidiness. The upsert below cannot live inside the scoped
  // transaction — it keys on email, not tenantId, so it is cross-tenant by
  // nature like `requireTenant`'s own discovery (ADR 0004) — which means an
  // invitation that fails validation AFTER it would leave a `User` row behind
  // for somebody who was never added to anything.
  //
  // Found by the test sweep, not by reading: the suite went green and the
  // teardown reported orphaned users, which is exactly the case ADR 0023 Q5
  // built that warning to surface.
  await withTenantContext(tenantId, (tx) =>
    assertBranchesExist(tx, tenantId, input.branchIds)
  );

  // Cross-tenant by nature: bare prisma, outside the scoped transaction.
  const user = await prisma.user.upsert({
    where: { email: input.email },
    // The name is only written when the person is NEW. Overwriting what
    // somebody chose for their own account because a colleague typed something
    // different into an invite form would be rude and confusing.
    create: { email: input.email, name: input.name, emailVerified: null },
    update: {},
    select: { id: true },
  });

  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.tenantMembership.findFirst({
      where: { tenantId, userId: user.id },
      select: { id: true, isActive: true, role: true },
    });

    if (existing?.isActive) throw new AlreadyMemberError(input.email);

    if (existing) {
      // Rule 1 again on the way back in: re-activating somebody who was an
      // owner is handing the account back.
      if (!canModifyMembershipOf(actor.role, existing.role)) {
        throw new CannotTouchOwnerError();
      }
      const row = await tx.tenantMembership.update({
        where: { id: existing.id },
        data: {
          role: input.role,
          isActive: true,
          allBranches: input.allBranches,
          roleChangedAt: new Date(),
          roleChangedBy: actor.userId,
        },
        select: { id: true },
      });
      await writeBranchAccess(tx, row.id, input.branchIds);
      return { membershipId: row.id, userId: user.id, wasReactivated: true };
    }

    const row = await tx.tenantMembership.create({
      data: {
        tenantId,
        userId: user.id,
        role: input.role,
        isActive: true,
        allBranches: input.allBranches,
        // The invitation IS the first change, and saying who made it is the
        // whole point of the column (Q14).
        roleChangedAt: new Date(),
        roleChangedBy: actor.userId,
      },
      select: { id: true },
    });
    await writeBranchAccess(tx, row.id, input.branchIds);
    return { membershipId: row.id, userId: user.id, wasReactivated: false };
  });
}

// ------------------------------------------------------------
// 2. Changing what someone may do
// ------------------------------------------------------------

export async function updateMemberLogic(
  tenantId: string,
  input: UpdateMemberInput,
  actor: MembershipActor
): Promise<TenantMembership> {
  return withTenantContext(tenantId, async (tx) => {
    const target = await tx.tenantMembership.findFirst({
      where: { id: input.membershipId, tenantId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) throw new MembershipNotFoundError();

    assertMayGrant(actor, input.role, wantedReach(input), target.role);
    await assertBranchesExist(tx, tenantId, input.branchIds);

    // Rule 3 — demoting the last owner leaves nobody who can ever administer
    // this tenant again.
    if (target.role === "owner" && input.role !== "owner" && target.isActive) {
      await assertOwnerRemains(tx, tenantId, target.id);
    }

    const row = await tx.tenantMembership.update({
      where: { id: target.id },
      data: {
        role: input.role,
        allBranches: input.allBranches,
        roleChangedAt: new Date(),
        roleChangedBy: actor.userId,
      },
    });
    await writeBranchAccess(tx, row.id, input.branchIds);
    return row;
  });
}

// ------------------------------------------------------------
// 3. Removing and restoring
// ------------------------------------------------------------

/**
 * `isActive` is the removal, and it is deliberately not a delete.
 *
 * `requireTenant` already filters on it, every document a person wrote still
 * points at their user row, and somebody who comes back gets the same identity
 * rather than a stranger's — the same reasoning ADR 0027 used for a menu that
 * stops being sold.
 */
export async function setMemberActiveLogic(
  tenantId: string,
  input: SetMemberActiveInput,
  actor: MembershipActor
): Promise<TenantMembership> {
  return withTenantContext(tenantId, async (tx) => {
    const target = await tx.tenantMembership.findFirst({
      where: { id: input.membershipId, tenantId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) throw new MembershipNotFoundError();

    // Rule 1
    if (!canModifyMembershipOf(actor.role, target.role)) {
      throw new CannotTouchOwnerError();
    }
    // Rule 4 — turning somebody back on is granting their role again.
    if (input.isActive && !canGrantRole(actor.role, target.role)) {
      throw new CannotGrantRoleError(target.role);
    }
    // Rule 3
    if (!input.isActive && target.role === "owner" && target.isActive) {
      await assertOwnerRemains(tx, tenantId, target.id);
    }

    return tx.tenantMembership.update({
      where: { id: target.id },
      data: {
        isActive: input.isActive,
        roleChangedAt: new Date(),
        roleChangedBy: actor.userId,
      },
    });
  });
}

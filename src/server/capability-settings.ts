// ============================================================
// Mise — changing what a role or a person may do (ADR 0038)
// ============================================================
// Two writes and one read. Both writes store only the difference from the
// default (Q3) and log every effective change (Q1.5), and both keep the price
// pairs whole (Q2) — the screen ticks a pair with its reason, and these refuse
// or complete what the screen would have done, so a hand-made request cannot
// put a price in front of somebody who must not see one.
//
// The rules, in the order they are asked:
//   * the role table is the OWNER's (Q1.4); owner and admin rows never change
//   * an exception is for someone else, never an owner, never yourself
//   * you open only what you hold yourself (Q1.3 — rule 4 on one capability)
// ============================================================

import type { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import {
  ADJUSTABLE_CAPABILITIES,
  CAPABILITY_NEEDS,
  capabilitiesOf,
  effectiveCapabilities,
  type Capability,
} from "@/lib/permissions/service";
import type { SetMemberCapabilityInput, SetRoleCapabilitiesInput } from "@/lib/validations/permissions";

type Tx = Prisma.TransactionClient;

export interface PermissionActor {
  userId: string;
  role: string;
  /** `requireTenant().capabilities` — what the actor may actually do. */
  capabilities: ReadonlySet<Capability>;
}

// ------------------------------------------------------------
// Refusals (the action maps each to Thai)
// ------------------------------------------------------------

export class OwnerOnlyError extends Error {
  constructor() {
    super("Only an owner may change the role table");
    this.name = "OwnerOnlyError";
  }
}

/** A capability that prints money, asked for without the money it prints. */
export class PairBrokenError extends Error {
  constructor(public readonly capability: Capability, public readonly needs: Capability) {
    super(`${capability} requires ${needs}`);
    this.name = "PairBrokenError";
  }
}

export class CannotGrantCapabilityError extends Error {
  constructor(public readonly capability: Capability) {
    super(`Actor does not hold ${capability} and cannot open it for anyone`);
    this.name = "CannotGrantCapabilityError";
  }
}

export class ExceptionTargetError extends Error {
  constructor(public readonly reason: "owner" | "self" | "missing") {
    super(`Cannot set an exception for this member: ${reason}`);
    this.name = "ExceptionTargetError";
  }
}

const DEPENDENTS = (need: Capability) =>
  (Object.entries(CAPABILITY_NEEDS) as [Capability, Capability][]).filter(([, n]) => n === need).map(([c]) => c);

async function log(
  tx: Tx,
  tenantId: string,
  actorUserId: string,
  target: { role: string } | { tenantMembershipId: string },
  capability: Capability,
  change: "grant" | "revoke" | "reset"
) {
  await tx.permissionChangeLog.create({
    data: { tenantId, actorUserId, capability, change, ...target },
  });
}

// ------------------------------------------------------------
// The role table
// ------------------------------------------------------------

/**
 * Make `role` hold exactly `capabilities` among the adjustable sixteen.
 *
 * Stores a row only where that differs from the default; a cell set back to
 * its default deletes its row, so "back to default" is the absence of data and
 * a capability added later reaches this shop untouched.
 */
export async function setRoleCapabilitiesLogic(
  tenantId: string,
  actor: PermissionActor,
  input: SetRoleCapabilitiesInput
): Promise<{ changed: number }> {
  if (actor.role !== "owner") throw new OwnerOnlyError();

  const defaults = capabilitiesOf(input.role);
  const wanted = new Set<Capability>(
    input.reset ? [...ADJUSTABLE_CAPABILITIES].filter((c) => defaults.has(c)) : (input.capabilities as Capability[])
  );
  for (const [cap, need] of Object.entries(CAPABILITY_NEEDS) as [Capability, Capability][]) {
    if (wanted.has(cap) && !wanted.has(need)) throw new PairBrokenError(cap, need);
  }

  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.roleCapabilityOverride.findMany({ where: { tenantId, role: input.role } });
    const rowOf = new Map(rows.map((r) => [r.capability, r]));
    let changed = 0;

    for (const cap of ADJUSTABLE_CAPABILITIES) {
      const row = rowOf.get(cap);
      const before = row ? row.granted : defaults.has(cap);
      const after = wanted.has(cap);
      if (after === defaults.has(cap)) {
        if (row) await tx.roleCapabilityOverride.delete({ where: { id: row.id } });
      } else if (!row || row.granted !== after) {
        await tx.roleCapabilityOverride.upsert({
          where: { tenantId_role_capability: { tenantId, role: input.role, capability: cap } },
          create: { tenantId, role: input.role, capability: cap, granted: after, changedBy: actor.userId },
          update: { granted: after, changedBy: actor.userId, changedAt: new Date() },
        });
      }
      if (before !== after) {
        changed++;
        await log(tx, tenantId, actor.userId, { role: input.role }, cap, input.reset ? "reset" : after ? "grant" : "revoke");
      }
    }
    return { changed };
  });
}

// ------------------------------------------------------------
// One person's exception
// ------------------------------------------------------------

/**
 * Follow the role, or open / close one capability for one person.
 *
 * The pair is completed rather than refused, because that is what the screen
 * promises: opening "รับของ" for somebody who cannot see cost opens cost too
 * (and the actor must hold both), and closing cost closes what depends on it.
 */
export async function setMemberCapabilityLogic(
  tenantId: string,
  actor: PermissionActor,
  input: SetMemberCapabilityInput
): Promise<{ capabilities: Capability[] }> {
  const cap = input.capability as Capability;

  return withTenantContext(tenantId, async (tx) => {
    const target = await tx.tenantMembership.findFirst({
      where: { id: input.membershipId, tenantId },
      select: { id: true, role: true, userId: true },
    });
    if (!target) throw new ExceptionTargetError("missing");
    if (target.role === "owner") throw new ExceptionTargetError("owner");
    if (target.userId === actor.userId) throw new ExceptionTargetError("self");

    const [roleRows, rows] = await Promise.all([
      tx.roleCapabilityOverride.findMany({ where: { tenantId, role: target.role } }),
      tx.membershipCapabilityOverride.findMany({ where: { tenantId, tenantMembershipId: target.id } }),
    ]);
    const roleCaps = effectiveCapabilities(target.role, roleRows, []);
    const before = effectiveCapabilities(target.role, roleRows, rows);

    // The person's exceptions after this press, as capability → granted.
    const next = new Map(rows.filter((r) => ADJUSTABLE_CAPABILITIES.has(r.capability as Capability)).map((r) => [r.capability as Capability, r.granted]));
    const set = (c: Capability, want: boolean) => {
      if (roleCaps.has(c) === want) next.delete(c);
      else next.set(c, want);
    };
    if (input.state === "inherit") next.delete(cap);
    else set(cap, input.state === "grant");

    // Keep the pairs whole (Q2).
    const need = CAPABILITY_NEEDS[cap];
    if (input.state === "grant" && need) set(need, true);
    // Closing a money view closes what prints it — explicitly, so the person
    // does not get it back silently the day cost is opened again.
    if (input.state === "revoke") for (const d of DEPENDENTS(cap)) if (before.has(d)) set(d, false);
    const after = effectiveCapabilities(
      target.role,
      roleRows,
      [...next].map(([capability, granted]) => ({ capability, granted }))
    );

    // You open only what you hold (Q1.3).
    for (const c of after) {
      if (!before.has(c) && !actor.capabilities.has(c)) throw new CannotGrantCapabilityError(c);
    }

    // Write the difference, then log each capability whose effect changed.
    const old = new Map(rows.map((r) => [r.capability, r]));
    for (const c of ADJUSTABLE_CAPABILITIES) {
      const was = old.get(c);
      const want = next.get(c);
      if (want === undefined) {
        if (was) await tx.membershipCapabilityOverride.delete({ where: { id: was.id } });
      } else if (!was || was.granted !== want) {
        await tx.membershipCapabilityOverride.upsert({
          where: { tenantMembershipId_capability: { tenantMembershipId: target.id, capability: c } },
          create: { tenantId, tenantMembershipId: target.id, capability: c, granted: want, changedBy: actor.userId },
          update: { granted: want, changedBy: actor.userId, changedAt: new Date() },
        });
      }
      const target_ = { tenantMembershipId: target.id };
      if (before.has(c) !== after.has(c)) {
        await log(tx, tenantId, actor.userId, target_, c, after.has(c) ? "grant" : "revoke");
      } else if (c === cap && input.state === "inherit" && was) {
        await log(tx, tenantId, actor.userId, target_, c, "reset");
      }
    }
    return { capabilities: [...after] };
  });
}

// ------------------------------------------------------------
// The read
// ------------------------------------------------------------

export async function getPermissionSettingsLogic(tenantId: string) {
  return withTenantContext(tenantId, async (tx) => {
    const [roleRows, memberRows, changes] = await Promise.all([
      tx.roleCapabilityOverride.findMany({ where: { tenantId }, select: { role: true, capability: true, granted: true } }),
      tx.membershipCapabilityOverride.findMany({
        where: { tenantId },
        select: { tenantMembershipId: true, capability: true, granted: true },
      }),
      tx.permissionChangeLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          role: true,
          capability: true,
          change: true,
          createdAt: true,
          actor: { select: { name: true, email: true } },
          membership: { select: { role: true, user: { select: { name: true, email: true } } } },
        },
      }),
    ]);
    return { roleRows, memberRows, changes };
  });
}

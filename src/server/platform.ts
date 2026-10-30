// ============================================================
// คิดครัว — the platform screens' reads and writes (ADR 0043)
// ============================================================
// 🔴 The SECOND door around row-level security (ADR 0030 allowed one). These
// queries are cross-tenant by nature — "every shop" has no tenant to name —
// so they run on the bypass connection. Every exported function takes a
// `PlatformActor`, which only `requirePlatformAdmin()` can produce, so none of
// them can be reached without the admin check having run.
//
// Every write is logged to platform_audit_log in the same transaction: there
// is no change from here without a record of who made it.
// ============================================================

import { Prisma } from "@prisma/client";
import { prismaBypass } from "@/lib/db-admin";
import type { PlatformActor } from "@/lib/platform-admin";
import { getShopAccuracySnapshotLogic, type ShopAccuracy } from "@/server/deduction-accuracy";

export const PLANS = { trial: "ทดลองใช้", standard: "มาตรฐาน" } as const;
export type PlanCode = keyof typeof PLANS;

export type ShopRow = {
  id: string;
  name: string;
  createdAt: string;
  owners: string[];
  branches: number;
  members: number;
  /** Latest stock movement or bill — a cheap "is anyone using it". */
  lastActivity: string | null;
  plan: string;
  freeUntil: string | null;
  planNote: string | null;
};

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function listShopsLogic(_actor: PlatformActor): Promise<ShopRow[]> {
  const tenants = await prismaBypass.tenant.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      plan: true,
      planFreeUntil: true,
      planNote: true,
      _count: { select: { branches: { where: { deletedAt: null } }, memberships: { where: { isActive: true } } } },
      memberships: { where: { isActive: true, role: "owner" }, select: { user: { select: { email: true } } } },
    },
  });
  const [moves, bills] = await Promise.all([
    prismaBypass.stockMovement.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    prismaBypass.expense.groupBy({ by: ["tenantId"], where: { deletedAt: null }, _max: { createdAt: true } }),
  ]);
  const last = new Map<string, Date>();
  for (const r of [...moves, ...bills]) {
    const d = r._max.createdAt;
    if (d && (!last.has(r.tenantId) || d > last.get(r.tenantId)!)) last.set(r.tenantId, d);
  }
  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt.toISOString(),
    owners: t.memberships.map((m) => m.user.email),
    branches: t._count.branches,
    members: t._count.memberships,
    lastActivity: last.get(t.id)?.toISOString() ?? null,
    plan: t.plan,
    freeUntil: ymd(t.planFreeUntil),
    planNote: t.planNote,
  }));
}

/**
 * Kong 2026-10-31 (accuracy mockup, question 2): one number per shop — how far
 * its latest comparable count was from what the recipes deducted. Read inside
 * each shop's own tenant context (RLS applies as for the shop itself); no
 * product, no money leaves it. A few shops at a time: each is a FIFO replay.
 */
export async function listShopAccuracyLogic(_actor: PlatformActor): Promise<Record<string, ShopAccuracy | null>> {
  const tenants = await prismaBypass.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
  const out: Record<string, ShopAccuracy | null> = {};
  const queue = tenants.map((t) => t.id);
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          out[id] = await getShopAccuracySnapshotLogic(id);
        } catch (e) {
          console.error(`[platform] accuracy for ${id} failed`, e);
          out[id] = null;
        }
      }
    })
  );
  return out;
}

export type ShopDetail = {
  id: string;
  name: string;
  branches: { name: string; code: string }[];
  members: { name: string | null; email: string; role: string; active: boolean; allBranches: boolean; since: string }[];
};

export async function getShopDetailLogic(_actor: PlatformActor, tenantId: string): Promise<ShopDetail | null> {
  const t = await prismaBypass.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      branches: { where: { deletedAt: null }, select: { name: true, code: true }, orderBy: { name: "asc" } },
      memberships: {
        orderBy: { createdAt: "asc" },
        select: { role: true, isActive: true, allBranches: true, createdAt: true, user: { select: { name: true, email: true } } },
      },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    branches: t.branches,
    members: t.memberships.map((m) => ({
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      active: m.isActive,
      allBranches: m.allBranches,
      since: m.createdAt.toISOString(),
    })),
  };
}

export class PlatformInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformInputError";
  }
}

/** Set a shop's package — and log it, in the same transaction. */
export async function setShopPlanLogic(
  actor: PlatformActor,
  input: { tenantId: string; plan: PlanCode; freeUntil: string | null; note: string | null }
): Promise<void> {
  if (!(input.plan in PLANS)) throw new PlatformInputError("แพ็กเกจไม่ถูกต้อง");
  if (input.freeUntil !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(input.freeUntil) || Number.isNaN(Date.parse(`${input.freeUntil}T00:00:00Z`)))) {
    throw new PlatformInputError("วันที่ไม่ถูกต้อง");
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;
  await prismaBypass.$transaction(async (tx) => {
    const before = await tx.tenant.findFirst({
      where: { id: input.tenantId, deletedAt: null },
      select: { name: true, plan: true, planFreeUntil: true, planNote: true },
    });
    if (!before) throw new PlatformInputError("ไม่พบร้านนี้");
    await tx.tenant.update({
      where: { id: input.tenantId },
      data: {
        plan: input.plan,
        planFreeUntil: input.freeUntil ? new Date(`${input.freeUntil}T00:00:00Z`) : null,
        planNote: note,
        planUpdatedAt: new Date(),
      },
    });
    await tx.platformAuditLog.create({
      data: {
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: "set_plan",
        targetTenantId: input.tenantId,
        targetName: before.name,
        before: { plan: before.plan, freeUntil: ymd(before.planFreeUntil), note: before.planNote },
        after: { plan: input.plan, freeUntil: input.freeUntil, note },
      },
    });
  });
}

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  memberships: { tenantId: string; shop: string; role: string; active: boolean }[];
};

/** Find people by e-mail — the support question "which shop is this person in". */
export async function searchUsersLogic(_actor: PlatformActor, query: string): Promise<UserRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const users = await prismaBypass.user.findMany({
    where: { deletedAt: null, OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      memberships: { select: { tenantId: true, role: true, isActive: true, tenant: { select: { name: true } } } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt.toISOString(),
    memberships: u.memberships.map((m) => ({ tenantId: m.tenantId, shop: m.tenant.name, role: m.role, active: m.isActive })),
  }));
}

export type AuditRow = { id: string; at: string; actor: string; action: string; target: string | null; before: unknown; after: unknown };

export async function listAuditLogic(_actor: PlatformActor, limit = 100): Promise<AuditRow[]> {
  const rows = await prismaBypass.platformAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    actor: r.actorEmail,
    action: r.action,
    target: r.targetName,
    before: r.before as Prisma.JsonValue,
    after: r.after as Prisma.JsonValue,
  }));
}

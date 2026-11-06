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
import type { ReportKind, ReportStatus, UpdateReportInput } from "@/lib/problem-report";
import { platformAdminEmails } from "@/lib/platform-admins";
import { buildOverview, buildTodos, type FeatureKey, type OverviewShop, type PlatformOverview, type Todo } from "@/lib/platform-overview";

export const PLANS = { trial: "Free", standard: "Standard" } as const;
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

// ------------------------------------------------------------
// ADR 0044 — problem reports, the operator's side (every function takes the PlatformActor)
// ------------------------------------------------------------

export type PlatformReport = {
  id: string;
  number: number;
  kind: ReportKind;
  status: ReportStatus;
  message: string;
  reply: string | null;
  internalNote: string | null;
  shopName: string;
  branchName: string | null;
  reporter: string;
  reporterRole: string | null;
  pagePath: string;
  buildId: string | null;
  userAgent: string | null;
  viewport: string | null;
  errorDigest: string | null;
  createdAt: string;
  fileIds: string[];
};

export async function listPlatformReportsLogic(_actor: PlatformActor, limit = 200): Promise<PlatformReport[]> {
  const rows = await prismaBypass.problemReport.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      tenantId: true,
      number: true,
      kind: true,
      status: true,
      message: true,
      reply: true,
      internalNote: true,
      pagePath: true,
      buildId: true,
      userAgent: true,
      viewport: true,
      errorDigest: true,
      createdAt: true,
      reporterId: true,
      tenant: { select: { name: true } },
      branch: { select: { name: true } },
      reporter: { select: { name: true, email: true } },
      files: { where: { deletedAt: null }, select: { id: true } },
    },
  });
  const roles = await prismaBypass.tenantMembership.findMany({
    where: { OR: rows.map((r) => ({ tenantId: r.tenantId, userId: r.reporterId })) },
    select: { tenantId: true, userId: true, role: true },
  });
  const roleOf = new Map(roles.map((m) => [`${m.tenantId}|${m.userId}`, m.role]));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    kind: r.kind,
    status: r.status,
    message: r.message,
    reply: r.reply,
    internalNote: r.internalNote,
    shopName: r.tenant.name,
    branchName: r.branch?.name ?? null,
    reporter: r.reporter.name ?? r.reporter.email ?? "",
    reporterRole: roleOf.get(`${r.tenantId}|${r.reporterId}`) ?? null,
    pagePath: r.pagePath,
    buildId: r.buildId,
    userAgent: r.userAgent,
    viewport: r.viewport,
    errorDigest: r.errorDigest,
    createdAt: r.createdAt.toISOString(),
    fileIds: r.files.map((f) => f.id),
  }));
}

/** How many reports nobody has looked at yet — the tab's count. */
export async function newReportCountLogic(_actor: PlatformActor): Promise<number> {
  return prismaBypass.problemReport.count({ where: { status: "NEW" } });
}

export type ReportUpdated = {
  /** The status just became FIXED_LIVE: write to the reporter (after this returns). */
  tellReporter: { to: string; number: number; message: string; reply: string | null } | null;
};

/**
 * Status, the answer to the reporter, the internal note. A changed reply stamps
 * `repliedAt` (the reporter's badge). Logged to platform_audit_log like every
 * platform write (ADR 0043 Q4) — the note is not, it is Kong's own scratchpad.
 */
export async function updatePlatformReportLogic(actor: PlatformActor, input: UpdateReportInput): Promise<ReportUpdated | null> {
  return prismaBypass.$transaction(async (tx) => {
    const before = await tx.problemReport.findUnique({
      where: { id: input.id },
      select: { status: true, reply: true, number: true, message: true, tenantId: true, tenant: { select: { name: true } }, reporter: { select: { email: true } } },
    });
    if (!before) return null;
    const reply = input.reply === undefined ? before.reply : input.reply || null;
    const replyChanged = reply !== before.reply;
    await tx.problemReport.update({
      where: { id: input.id },
      data: {
        status: input.status,
        reply,
        ...(replyChanged && reply ? { repliedAt: new Date() } : {}),
        ...(input.internalNote === undefined ? {} : { internalNote: input.internalNote || null }),
      },
    });
    if (before.status !== input.status || replyChanged) {
      await tx.platformAuditLog.create({
        data: {
          actorUserId: actor.userId,
          actorEmail: actor.email,
          action: "problem_report.update",
          targetTenantId: before.tenantId,
          targetName: `${before.tenant.name} · R-${String(before.number).padStart(4, "0")}`,
          before: { status: before.status, reply: before.reply },
          after: { status: input.status, reply },
        },
      });
    }
    const nowLive = input.status === "FIXED_LIVE" && before.status !== "FIXED_LIVE";
    return {
      tellReporter: nowLive && before.reporter.email ? { to: before.reporter.email, number: before.number, message: before.message, reply } : null,
    };
  });
}

/**
 * A report's screenshot, for the operator's inbox. ONLY a file attached to a
 * problem report — this door must not become a way to read a shop's bills.
 */
export async function getReportScreenshotLogic(_actor: PlatformActor, fileId: string): Promise<{ storageKey: string; contentType: string } | null> {
  return prismaBypass.storedFile.findFirst({
    where: { id: fileId, kind: "REPORT_SCREENSHOT", problemReportId: { not: null }, deletedAt: null },
    select: { storageKey: true, contentType: true },
  });
}

// ------------------------------------------------------------
// ADR 0045 — ภาพรวม and ต้องทำ. One groupBy per table across every shop, never
// a loop per shop: the page is opened often and the shop count only grows
// (Consequence 3). The figures are built in src/lib/platform-overview.ts.
// ------------------------------------------------------------

type MaxRow = { tenantId: string; _max: { createdAt?: Date | null; closedAt?: Date | null } };
const latest = (rows: MaxRow[]) => new Map(rows.map((r) => [r.tenantId, (r._max.createdAt ?? r._max.closedAt) as Date | null]));

async function overviewRows(): Promise<{ shops: OverviewShop[]; newReports: { count: number; oldest: Date | null } }> {
  const db = prismaBypass;
  const live = { deletedAt: null };
  const [
    tenants,
    suppliers,
    products,
    salesDays,
    recipes,
    counts,
    movement,
    salesImport,
    goodsReceipt,
    stockCount,
    expense,
    purchaseOrder,
    purchaseRequest,
    consumption,
    waste,
    dailyClose,
    staffMeal,
    menuLab,
    transfer,
    production,
    pos,
    branches,
    staff,
    overrides,
    reports,
  ] = await Promise.all([
    db.tenant.findMany({
      where: live,
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        plan: true,
        planFreeUntil: true,
        grossProfitMethod: true,
        _count: { select: { branches: { where: live } } },
        memberships: { where: { isActive: true }, select: { role: true, userId: true, user: { select: { email: true } } } },
      },
    }),
    db.supplier.groupBy({ by: ["tenantId"], where: live, _count: { _all: true } }),
    db.product.groupBy({ by: ["tenantId"], where: live, _count: { _all: true } }),
    db.salesDay.groupBy({ by: ["tenantId"], _count: { _all: true } }),
    db.recipe.groupBy({ by: ["tenantId"], where: { menuId: { not: null }, isDraft: false, supersededAt: null }, _count: { _all: true } }),
    db.stockCount.groupBy({ by: ["tenantId"], where: { status: "CLOSED", deletedAt: null }, _count: { _all: true } }),
    db.stockMovement.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.salesImportBatch.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.goodsReceipt.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.stockCount.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.expense.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.purchaseOrder.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.purchaseRequestLine.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.salesConsumptionRun.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.wasteLog.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.dailyClose.groupBy({ by: ["tenantId"], _max: { closedAt: true } }),
    db.staffMeal.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.recipe.groupBy({ by: ["tenantId"], where: { isDraft: true }, _max: { createdAt: true } }),
    db.stockTransfer.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.production.groupBy({ by: ["tenantId"], _max: { createdAt: true } }),
    db.posIntegration.findMany({ where: { deletedAt: null, isActive: true }, select: { tenantId: true, branchId: true, posType: true } }),
    db.branch.findMany({ where: live, select: { id: true, tenantId: true } }),
    db.staffMember.groupBy({ by: ["tenantId"], where: { deletedAt: null, isActive: true }, _count: { _all: true } }),
    db.membershipCapabilityOverride.findMany({ distinct: ["tenantMembershipId"], select: { tenantId: true, tenantMembershipId: true } }),
    db.problemReport.aggregate({ where: { status: "NEW" }, _count: { _all: true }, _min: { createdAt: true } }),
  ]);

  const has = (rows: { tenantId: string }[]) => new Set(rows.map((r) => r.tenantId));
  const [hasSupplier, hasProduct, hasSales, hasRecipe, hasCount] = [suppliers, products, salesDays, recipes, counts].map(has);
  const byFeature: [FeatureKey, Map<string, Date | null>][] = [
    ["salesImport", latest(salesImport)],
    ["goodsReceipt", latest(goodsReceipt)],
    ["stockCount", latest(stockCount)],
    ["expense", latest(expense)],
    ["purchaseOrder", latest(purchaseOrder)],
    ["purchaseRequest", latest(purchaseRequest)],
    ["consumption", latest(consumption)],
    ["waste", latest(waste)],
    ["dailyClose", latest(dailyClose)],
    ["staffMeal", latest(staffMeal)],
    ["menuLab", latest(menuLab)],
    ["transfer", latest(transfer)],
    ["production", latest(production)],
  ];
  const lastMove = latest(movement);

  // POS is counted in branches: a branch with two integrations counts once per brand.
  const posByTenant = new Map<string, Map<string, Set<string>>>();
  const branchWithPos = new Set<string>();
  for (const p of pos) {
    const t = posByTenant.get(p.tenantId) ?? posByTenant.set(p.tenantId, new Map()).get(p.tenantId)!;
    (t.get(p.posType) ?? t.set(p.posType, new Set()).get(p.posType)!).add(p.branchId);
    branchWithPos.add(p.branchId);
  }
  const noPos = new Map<string, number>();
  for (const b of branches) if (!branchWithPos.has(b.id)) noPos.set(b.tenantId, (noPos.get(b.tenantId) ?? 0) + 1);
  const staffCount = new Map(staff.map((r) => [r.tenantId, r._count._all]));
  const overrideCount = new Map<string, number>();
  for (const o of overrides) overrideCount.set(o.tenantId, (overrideCount.get(o.tenantId) ?? 0) + 1);

  const shops: OverviewShop[] = tenants.map((t) => {
    const lastByFeature: OverviewShop["lastByFeature"] = {};
    for (const [key, m] of byFeature) {
      const d = m.get(t.id);
      if (d) lastByFeature[key] = d;
    }
    return {
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      plan: t.plan,
      freeUntil: t.planFreeUntil,
      method: t.grossProfitMethod,
      branches: t._count.branches,
      members: t.memberships.map((m) => ({ userId: m.userId, email: m.user.email, role: m.role })),
      facts: {
        hasSupplier: hasSupplier.has(t.id),
        hasProduct: hasProduct.has(t.id),
        hasSalesDay: hasSales.has(t.id),
        hasLiveRecipe: hasRecipe.has(t.id),
        hasClosedCount: hasCount.has(t.id),
      },
      lastByFeature,
      lastMovement: lastMove.get(t.id) ?? null,
      pos: Object.fromEntries([...(posByTenant.get(t.id) ?? new Map<string, Set<string>>())].map(([k, v]) => [k, v.size])),
      branchesWithoutPos: noPos.get(t.id) ?? 0,
      staffWithoutAccount: staffCount.get(t.id) ?? 0,
      peopleWithOwnPermissions: overrideCount.get(t.id) ?? 0,
    };
  });
  return { shops, newReports: { count: reports._count._all, oldest: reports._min.createdAt } };
}

export async function getPlatformOverviewLogic(_actor: PlatformActor, now: Date = new Date()): Promise<{ overview: PlatformOverview; todos: Todo[] }> {
  const { shops, newReports } = await overviewRows();
  const admins = platformAdminEmails();
  return { overview: buildOverview(shops, admins, now), todos: buildTodos({ shops, admins, newReports, now }) };
}

/**
 * The orange number on the dark strip — read after paint, by GET (ADR 0045 Q2).
 * The strip asks on every page Kong opens, and the answer is two dozen
 * cross-shop queries, so it is kept for a minute; /platform itself is always fresh.
 */
let todoMemo: { count: number; at: number } | null = null;
const TODO_MEMO_MS = 60_000;
export async function platformTodoCountLogic(actor: PlatformActor, now: number = Date.now()): Promise<number> {
  if (todoMemo && now - todoMemo.at < TODO_MEMO_MS) return todoMemo.count;
  const count = (await getPlatformOverviewLogic(actor)).todos.length;
  todoMemo = { count, at: now };
  return count;
}


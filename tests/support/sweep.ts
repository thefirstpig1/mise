// ============================================================
// Mise — test tenant sweep (Sprint 5 Part 23, ADR 0023 Q4/Q5)
// ============================================================
// Deletes a test tenant and everything hanging off it.
//
// Two ways in, one body of code:
//   • `globalTeardown` calls it with the window this run opened, so a worker
//     that died before its `afterAll` leaves nothing behind.
//   • `pnpm test:sweep` calls it with no window, to clean up by hand.
//
// It is NOT the normal cleanup path. Every spec still tears down its own
// fixtures in `afterAll`, and residue found after a GREEN run means one of
// those teardowns is incomplete — which is why the sweep names what it deleted
// instead of tidying up in silence (ADR 0023 Q5).
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Every model carrying a `tenantId`, plus the three that hang off one without
 * carrying it, in an order that never violates a foreign key: children first,
 * parents last.
 *
 * DERIVED, NOT REMEMBERED. This list is a topological sort of the relation
 * graph in `schema.prisma`, and it agrees with the two orderings Part 22 had to
 * learn the hard way — `SalesConsumptionItem` before `SalesConsumptionRun`, and
 * `Menu` before `PosIntegration`.
 *
 * `sweep-coverage.test.ts` fails if a model with a `tenantId` is missing here,
 * so a Part that adds a table finds out on its next test run instead of leaking
 * quietly for a sprint.
 */
export const TENANT_SCOPED_DELETE_ORDER = [
  "ExpenseItem",
  "GoodsReceiptItemAllocation",
  "MenuAlias",
  "MenuMerge",
  "ParLevel",
  "RecipeBranch",
  "RecipeIngredient",
  "SalesConsumptionItem",
  "SalesLine",
  "StaffMealItem",
  "StockAdjustment",
  "StockCostDeclaration",
  "StockCountEntry",
  "StockTransferItem",
  "UserBranchAccess",
  "UserDepartmentAssignment",
  "WasteLog",
  "Expense",
  "GoodsReceiptItem",
  "PurchaseOrderItemAllocation",
  "Recipe",
  "SalesConsumptionRun",
  "StaffMeal",
  "SalesDay",
  "StockCountItem",
  "StockMovement",
  "StockTransfer",
  "TenantMembership",
  "StaffMember",
  "GoodsReceipt",
  "Menu",
  "PurchaseOrderItem",
  "RecurringExpense",
  "SalesImportBatch",
  "StockCount",
  "Department",
  "MenuCategory",
  "PurchaseOrder",
  "SalesImportProfile",
  "SupplierProductMapping",
  "PosIntegration",
  "ProductUnit",
  "Supplier",
  "Branch",
  "Product",
  "Category",
] as const;

/**
 * The three models above that reach a tenant through a parent rather than a
 * `tenantId` column of their own. Everything else is scoped by `tenantId`.
 */
const SCOPE_VIA_PARENT: Record<string, (ids: string[]) => object> = {
  ProductUnit: (ids) => ({ product: { tenantId: { in: ids } } }),
  UserBranchAccess: (ids) => ({ branch: { tenantId: { in: ids } } }),
  UserDepartmentAssignment: (ids) => ({ department: { tenantId: { in: ids } } }),
};

/**
 * Models that point at themselves, and the column that does it.
 *
 * These are deleted a layer at a time, leaves inward — NEVER by nulling the
 * pointer first. Nulling looks simpler and is a trap: a `reversalOf*` column is
 * half of a partial unique index, so blanking it makes every reversal collide
 * with the row it reverses. Part 22 hit exactly that during teardown.
 */
const SELF_REFERENCING: Record<string, string> = {
  Department: "parentDeptId",
  GoodsReceiptItem: "reversalOfItemId",
  Product: "parentProductId",
  Recipe: "supersededById",
  SalesConsumptionItem: "reversalOfItemId",
  StaffMealItem: "reversalOfItemId",
  StockCountItem: "reversalOfItemId",
  StockTransferItem: "reversalOfItemId",
  WasteLog: "reversalOfId",
};

/** `ExpenseItem` → `expenseItem`: the Prisma client's delegate for a model. */
const delegateFor = (model: string) =>
  model.charAt(0).toLowerCase() + model.slice(1);

type Delegate = {
  deleteMany: (args: { where: object }) => Promise<{ count: number }>;
  count: (args: { where: object }) => Promise<number>;
  findMany: (args: { where: object; select: object }) => Promise<
    Record<string, unknown>[]
  >;
};

const delegate = (db: PrismaClient, model: string): Delegate =>
  (db as unknown as Record<string, Delegate>)[delegateFor(model)];

export type SweptTenant = { id: string; name: string; createdAt: Date };

/**
 * Delete a self-referencing model one layer at a time: rows nothing else points
 * at go first, and that exposes the next layer. Terminates because every pass
 * either deletes something or the table is empty — a pass that deletes nothing
 * while rows remain means a reference cycle, which throws rather than spinning.
 */
async function deleteSelfReferencing(
  db: PrismaClient,
  model: string,
  where: object
): Promise<number> {
  const d = delegate(db, model);
  const fk = SELF_REFERENCING[model];
  let removed = 0;

  for (;;) {
    const left = await d.count({ where });
    if (left === 0) return removed;

    const pointers = await d.findMany({
      where: { ...where, [fk]: { not: null } },
      select: { [fk]: true },
    });
    const stillPointedAt = pointers
      .map((r) => r[fk] as string | null)
      .filter((v): v is string => v !== null);

    const pass = await d.deleteMany({
      where: { ...where, id: { notIn: stillPointedAt } },
    });

    if (pass.count === 0) {
      throw new Error(
        `sweep: ${model} has ${left} rows that all point at each other — cannot delete`
      );
    }
    removed += pass.count;
  }
}

/**
 * What a sweep is allowed to touch. With NEITHER field it takes every tenant in
 * the database, which is what `pnpm test:sweep` wants and what nothing running
 * beside other specs ever does.
 */
export type SweepScope = {
  /** Only tenants created at or after this instant — `globalTeardown`'s window,
   *  so a sweep can never touch anything that existed before the run began. */
  createdAfter?: Date;
  /** Only these tenants. Anything sweeping while other specs are still running
   *  MUST pass this, or it deletes their fixtures out from under them. */
  ids?: string[];
};

/** Delete the tenants in scope and everything beneath them. */
export async function sweepTestTenants(
  db: PrismaClient,
  scope: SweepScope = {}
): Promise<SweptTenant[]> {
  const victims = await db.tenant.findMany({
    where: {
      ...(scope.createdAfter ? { createdAt: { gte: scope.createdAfter } } : {}),
      ...(scope.ids ? { id: { in: scope.ids } } : {}),
    },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (victims.length === 0) return [];

  const ids = victims.map((t) => t.id);

  for (const model of TENANT_SCOPED_DELETE_ORDER) {
    const where = SCOPE_VIA_PARENT[model]
      ? SCOPE_VIA_PARENT[model](ids)
      : { tenantId: { in: ids } };

    if (SELF_REFERENCING[model]) {
      await deleteSelfReferencing(db, model, where);
    } else {
      await delegate(db, model).deleteMany({ where });
    }
  }

  await db.tenant.deleteMany({ where: { id: { in: ids } } });
  return victims;
}

/**
 * Delete users that belong to nobody.
 *
 * `User` is Auth.js's table and carries no `tenantId`, which is why it escaped
 * every cleanup this project has run: "Neon swept to 0" has always counted
 * tenants, and 16 test users had been accumulating across sprints underneath a
 * count that read zero.
 *
 * A user is residue only when NOTHING claims it — no tenant membership, no
 * OAuth account, no session. A real person who has signed in has at least one
 * of the three, so the same window that protects a pre-existing tenant protects
 * a pre-existing login as well.
 */
export async function sweepOrphanUsers(
  db: PrismaClient,
  scope: SweepScope = {}
): Promise<{ id: string; email: string | null }[]> {
  const orphans = await db.user.findMany({
    where: {
      memberships: { none: {} },
      accounts: { none: {} },
      sessions: { none: {} },
      ...(scope.createdAfter ? { createdAt: { gte: scope.createdAfter } } : {}),
      // Same rule as tenants, and for the same reason: a spec sweeping while
      // its neighbours are still running MUST name its own rows. Most fixtures
      // create a user with no membership, so an unscoped sweep would delete
      // another spec's user out from under it mid-test.
      ...(scope.ids ? { id: { in: scope.ids } } : {}),
    },
    select: { id: true, email: true },
  });
  if (orphans.length === 0) return [];

  await db.user.deleteMany({ where: { id: { in: orphans.map((u) => u.id) } } });
  return orphans;
}

/**
 * Every model in the schema that carries a `tenantId`, read from the generated
 * client rather than from a list somebody has to remember to update.
 */
export function tenantScopedModels(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "tenantId"))
    .map((m) => m.name)
    .sort();
}

// ============================================================
// คิดครัว — erasing a shop's data, table by table (ADR 0045 Q10)
// ============================================================
// Moved from tests/support/sweep.ts so the operator's "ลบถาวร" and the test
// sweep delete with ONE order: a table the sweep would miss is a table a real
// erasure would leave behind, and tests/sweep-coverage.test.ts fails the run
// when a model with a tenantId is missing from the list below.
//
// Takes the client it is handed — the test sweep's, or the platform door's —
// and never decides on its own which shops to erase.
// ============================================================

import type { PrismaClient } from "@prisma/client";

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
  // ADR 0037 Q5–Q6: files point at payments, refunds and bills; payments at
  // refunds and bills — so files, then payments, then refunds.
  "StoredFile",
  "ExpensePayment",
  "StaffRefund",
  // ADR 0044: a report's screenshots go first (StoredFile above).
  "ProblemReport",
  // ADR 0045: a shop's days of use, which point only at the tenant.
  "UserActivityDay",
  "PurchaseRequestMessage",
  "PurchaseRequestReady",
  "PurchaseOrderDeliveryPromise",
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
  // ADR 0040: items and parts and shortfalls before their documents.
  "ProductionItem",
  "TrimRecipePart",
  "PreppedShortfall",
  "StockAdjustment",
  "StockCostDeclaration",
  "StockCountEntry",
  "StockCountContribution",
  "StockTransferItem",
  "UserBranchAccess",
  "UserDepartmentAssignment",
  "WasteLog",
  // ADR 0038: overrides and their log, before the memberships they name.
  "RoleCapabilityOverride",
  "MembershipCapabilityOverride",
  "PermissionChangeLog",
  // Daily close (ADR 0042): children first, the close before its branch.
  "DailyComment",
  "DailyIssue",
  "DailyCloseMix",
  "DailyClose",
  "CustomerType",
  "Expense",
  "GoodsReceiptItem",
  "PurchaseOrderItemAllocation",
  // Before the recipes and trim recipes it names (ADR 0040).
  "Production",
  "Recipe",
  "TrimRecipe",
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
  // After the PO lines that point at it (ADR 0036 R1).
  "PurchaseRequestLine",
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
  ProductionItem: "reversalOfItemId",
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
 * Delete everything that belongs to these shops, children first, then the
 * shops themselves. Re-runnable: a run that stops halfway leaves rows that the
 * next run, with the same ids, finishes.
 */
export async function eraseTenantRows(db: PrismaClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (const model of TENANT_SCOPED_DELETE_ORDER) {
    const where = SCOPE_VIA_PARENT[model] ? SCOPE_VIA_PARENT[model](ids) : { tenantId: { in: ids } };
    if (SELF_REFERENCING[model]) await deleteSelfReferencing(db, model, where);
    else await delegate(db, model).deleteMany({ where });
  }
  await db.tenant.deleteMany({ where: { id: { in: ids } } });
}

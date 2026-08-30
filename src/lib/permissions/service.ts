// ============================================================
// Mise — capabilities, roles, and branch reach (Sprint 6 Part 28, ADR 0029)
// ============================================================
// This file replaces the Sprint 0 `PermissionService`, which was never called
// from anywhere in the application and described a system that was never built:
// its `ResourceType` union named `purchase_request` and `sales_transaction`,
// neither of which has a table, while roughly fourteen real tables — waste,
// transfers, staff meals, menu merges, sales lines — had no place in it at all.
// So the matrix was DELETED rather than repaired (ADR 0029 Q4).
//
// THE UNIT IS A CAPABILITY, NOT `resource × action`. Two axes force everything
// that must be protected to first be a "thing", and several of the things worth
// protecting here are not: **cost** is stored nowhere at all (ADR 0014 — it is
// the result of a ledger replay), **approving a purchase order** is not a table,
// and **inviting a person** is not a table. A resource axis would have made us
// invent a fake resource named "cost" to have something to check against, which
// is a lie told in the shape of the data.
//
// It also dissolves the flaw ADR 0021 Q18 named and could not fix: a cook is
// the person who most needs to READ a recipe, and the thing they should not see
// is its COST. One axis could not say that. `cost:view` says it in one word.
//
// ROLE ANSWERS *WHAT*. `allBranches` + `user_branch_access` ANSWER *WHERE*.
// They never mix — which is why `canAccessBranch` below contains no role.
// ============================================================

/**
 * The seven roles. `role` is a `String` in the schema, deliberately not an
 * enum: adding an eighth is a code change reviewed once, with no migration and
 * no deploy ordering, and this union gives the readers more checking than a
 * Postgres enum would (a typo is a compile error where it is written).
 */
export type Role =
  | "owner"
  | "admin"
  | "manager"
  | "purchaser"
  | "kitchen_staff"
  | "accountant"
  | "viewer";

/**
 * One named thing a person may do or see.
 *
 * Thirteen of these guard WRITING. Four guard READING, and only four: reads are
 * open to every member of the tenant except where the screen shows money that
 * not everyone should see (ADR 0029 Q7). A `stock:view` would be granted to all
 * seven roles — nobody wants to stop a cook seeing what is in the walk-in — and
 * a switch that is always on is a gate that is always green.
 */
export type Capability =
  // ── writing ────────────────────────────────────────────────────────────
  /** Suppliers, products, categories, units, supplier-product mappings, menus. */
  | "master:write"
  /** Draft a purchase order. */
  | "purchase:write"
  /** Send or cancel one — the step that commits the shop to spending. */
  | "purchase:approve"
  /** Receive goods against an order, confirm and void receipts. */
  | "receive:write"
  /** Adjustments, waste, par levels, inter-branch transfers. */
  | "stock:write"
  /** Open, fill, close and void a stock count. */
  | "count:write"
  /** Expenses and recurring expense templates. */
  | "expense:write"
  /** Import a POS export, record the daily pulse, configure an integration. */
  | "sales:import"
  /** Post (and void) a day's consumption from sales. */
  | "consumption:post"
  /** Recipes, Menu Lab drafts, publishing, merges, menu lifecycle. */
  | "recipe:write"
  /** Record and void a staff meal, and maintain the roster it picks from. */
  | "staffmeal:write"
  /** Invite people, set their role and their branch reach. */
  | "member:manage"
  /** Tenant settings: VAT registration, gross-profit method, departments. */
  | "settings:write"
  // ── the four confidential reads ────────────────────────────────────────
  /** Ingredient cost, purchase prices, food-cost %, gross profit. */
  | "cost:view"
  /** What the shop spends off the shelf: rent, utilities, services. */
  | "expense:view"
  /** Revenue and the sales figures derived from it. */
  | "sales:view"
  /** Who ate what — the per-person staff-meal history (PDPA). */
  | "staff:view";

/**
 * What a surface declares it needs. `any:member` is not a capability and is
 * held by no role — it is the honest way for `/dashboard`, `/settings` and the
 * login flow to say "being a member of this tenant is the whole requirement",
 * rather than leaving the argument off and letting a reader guess whether the
 * author thought about it (ADR 0029 Q6).
 */
export type Requirement = Capability | "any:member";

/** Every capability, in declaration order. Used by the drift tests. */
export const ALL_CAPABILITIES = [
  "master:write",
  "purchase:write",
  "purchase:approve",
  "receive:write",
  "stock:write",
  "count:write",
  "expense:write",
  "sales:import",
  "consumption:post",
  "recipe:write",
  "staffmeal:write",
  "member:manage",
  "settings:write",
  "cost:view",
  "expense:view",
  "sales:view",
  "staff:view",
] as const satisfies readonly Capability[];

export const ALL_ROLES = [
  "owner",
  "admin",
  "manager",
  "purchaser",
  "kitchen_staff",
  "accountant",
  "viewer",
] as const satisfies readonly Role[];

// ============================================================
// The role table
// ============================================================
// Kept in TypeScript rather than a `role_permission` table (ADR 0029 Q8 —
// master-spec H.4 is superseded whole). A table would put capability names
// beyond the compiler's reach, where `cost:veiw` is a permission that silently
// disappears with nothing going red — which throws away half of what the
// required `requireTenant` argument was bought for. It would also be a table
// with no editing screen: a table nothing writes.
//
// ONE INVARIANT RUNS THROUGH THESE SETS, AND IT IS NOT COSMETIC. Rule 4 of
// ADR 0029 Q10 says a person may only grant a role whose capabilities are a
// SUBSET of their own. That is what closes the real escalation — inviting your
// own second email address as `owner` and signing in as it. So every role that
// holds `member:manage` must be a superset of the roles it is expected to
// create, and `tests/permissions-matrix.test.ts` pins exactly that. Where it
// bites, it is telling the truth: whoever can grant a capability effectively
// has it already, because they can always grant it to an address they own.
// ============================================================

/** Everything. The account belongs to this person. */
const OWNER: readonly Capability[] = ALL_CAPABILITIES;

/**
 * Head office (ส่วนกลาง). Operationally identical to the owner — and that
 * breadth is forced by rule 4, not chosen: an `admin` holding only
 * `member:manage` could not create a `manager`, because a manager sees cost,
 * and creating branch managers is the whole job. What separates the two is not
 * a capability but the two rules Part 29 enforces: an admin may not modify an
 * `owner` row, and may not grant the `owner` role (which falls out of rule 4
 * on its own). Billing, when it exists, will be owner-only.
 */
const ADMIN: readonly Capability[] = ALL_CAPABILITIES;

/**
 * Runs the branches they reach — including the people in them, limited to those
 * branches by rule 2. An area manager is this role with `allBranches`, not a
 * role of its own.
 *
 * Everything except `settings:write`: VAT registration and the gross-profit
 * method change what every past figure MEANS, and belong to whoever owns the
 * business.
 */
const MANAGER: readonly Capability[] = [
  "master:write",
  "purchase:write",
  "purchase:approve",
  "receive:write",
  "stock:write",
  "count:write",
  "expense:write",
  "sales:import",
  "consumption:post",
  "recipe:write",
  "staffmeal:write",
  "member:manage",
  "cost:view",
  "expense:view",
  "sales:view",
  "staff:view",
];

/**
 * Buys. Holds `cost:view` because a purchase price IS a cost — a purchaser who
 * cannot see what things cost cannot do the job. Does not see the shop's
 * overheads (`expense:view`) or its revenue.
 */
const PURCHASER: readonly Capability[] = [
  "master:write",
  "purchase:write",
  "purchase:approve",
  "receive:write",
  "cost:view",
];

/**
 * Cooks. Counts stock, records waste and staff meals, reads every recipe — and
 * sees no money anywhere. This is ADR 0021 Q18's unfixable case, fixed.
 *
 * `staffmeal:write` carries the roster picker on the entry form; `staff:view`
 * is the separate question of reading back who ate how much, which the kitchen
 * does not need and PDPA says not to hand out for free.
 */
const KITCHEN_STAFF: readonly Capability[] = [
  "stock:write",
  "count:write",
  "staffmeal:write",
];

/**
 * Books. Sees every figure and writes only financial ones. `sales:import` is
 * here because loading the POS export is bookkeeping, not kitchen work — but
 * `consumption:post` is not, because posting a day moves the ledger.
 */
const ACCOUNTANT: readonly Capability[] = [
  "expense:write",
  "sales:import",
  "cost:view",
  "expense:view",
  "sales:view",
];

/** Reads what is open to every member, and writes nothing at all. */
const VIEWER: readonly Capability[] = [];

export const ROLE_CAPABILITIES: Readonly<Record<Role, ReadonlySet<Capability>>> =
  {
    owner: new Set(OWNER),
    admin: new Set(ADMIN),
    manager: new Set(MANAGER),
    purchaser: new Set(PURCHASER),
    kitchen_staff: new Set(KITCHEN_STAFF),
    accountant: new Set(ACCOUNTANT),
    viewer: new Set(VIEWER),
  };

const NO_CAPABILITIES: ReadonlySet<Capability> = new Set();

/** The capabilities a role holds. Unknown role strings hold nothing. */
export function capabilitiesOf(role: string): ReadonlySet<Capability> {
  return ROLE_CAPABILITIES[role as Role] ?? NO_CAPABILITIES;
}

/**
 * Does this role satisfy this requirement?
 *
 * `any:member` is true for every role INCLUDING unknown ones: the caller has
 * already proved an active membership, and that was the whole requirement.
 */
export function hasCapability(role: string, need: Requirement): boolean {
  if (need === "any:member") return true;
  return capabilitiesOf(role).has(need);
}

// ============================================================
// Where — a separate question, answered without the word "role"
// ============================================================

/** The shape of a person's reach. `UserContext` satisfies it structurally. */
export interface BranchReach {
  allBranches: boolean;
  allowedBranchIds: readonly string[];
}

/**
 * May this person act on this branch?
 *
 * The Sprint 0 version opened with `if (user.role === "owner") return true`,
 * which was the only way "every branch" was expressible and put two meanings in
 * one column. The owner now carries `allBranches` like anybody else
 * (`tenant-init.ts`), so this line names no role — and an area manager, a
 * bookkeeper who reads every branch, and an owner who wants one branch on
 * screen are the same tick box rather than three new roles (ADR 0029 Q5b).
 */
export function canAccessBranch(user: BranchReach, branchId: string): boolean {
  return user.allBranches || user.allowedBranchIds.includes(branchId);
}

/** The branches to show, from the branches that exist. Rule A5. */
export function narrowBranches<T extends { id: string }>(
  user: BranchReach,
  branches: readonly T[]
): T[] {
  if (user.allBranches) return [...branches];
  return branches.filter((b) => user.allowedBranchIds.includes(b.id));
}

// ============================================================
// Departments — present, and deliberately NOT wired
// ============================================================
// `canAccessDepartment` keeps its Sprint 0 shape and keeps having no callers,
// and that is a decision rather than an omission (ADR 0029 Q5). Three axes were
// specified in master-spec H.4; two are enforced.
//
// WHY NOT THE THIRD. `department_id` reaches exactly three business tables —
// `po_item_allocation`, `gr_item_allocation`, `expense_item` — against
// `branch_id`'s fifty-eight, the ledger has no department column at all
// (ADR 0022 Q8 settled that), and `tenant.enable_departments` defaults to
// false. Wiring it would produce a check that almost every tenant passes
// through `enableDepartments === false → return true`: a gate that is always
// green, which is the exact thing this Part exists to stop shipping.
//
// It is left standing rather than deleted because departments are a real,
// shipped feature that a future Part may need to scope. If you are reading this
// because you found a function with no callers: that is expected, the question
// has been asked and answered, and the answer is above.
// ============================================================

/**
 * NOT WIRED — see the block comment above before calling this.
 *
 * If `tenant.enable_departments` is false the tenant has one "Main" department
 * and every check passes.
 */
export function canAccessDepartment(
  user: { enableDepartments: boolean; allowedDeptIds: readonly string[] },
  departmentId: string
): boolean {
  if (!user.enableDepartments) return true;
  return user.allowedDeptIds.includes(departmentId);
}

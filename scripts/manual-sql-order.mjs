// ============================================================
// Mise — the order the manual SQL files run in (Part 34, ADR 0033 Q6)
// ============================================================
// `prisma migrate deploy` gives a fresh database its tables and NOTHING ELSE.
// Everything in prisma/manual/ is there because Prisma 5.22 cannot express it
// in schema.prisma — partial unique indexes, GIN/trigram indexes, extensions,
// RLS policies, a role. None of it is optional, and all of it fails SILENTLY:
// the app starts, the screens render, and then a shop re-imports a sales day
// and gets a duplicate instead of a replacement.
//
// This list is the single source of truth for what runs and in what order.
// `scripts/apply-manual-sql.mjs` executes it; `tests/manual-sql-coverage.test.ts`
// goes red when a file exists in the directory and is not named here, which is
// the only way a future Part's file cannot be forgotten.
//
// PLAIN .mjs, NOT TypeScript, deliberately. This runs inside the production
// image as Fly's release command (ADR 0033 Q9), and tsx is a devDependency
// that has no business being there. Vitest imports this file directly, so the
// script and its test read one list rather than two that agree by hand.
// ============================================================

/** Where the files live, relative to the repository root. */
export const MANUAL_SQL_DIR = "prisma/manual";

/**
 * Run order. Within group 1 the order is free; between groups it is not.
 *
 * 1. INDEXES AND EXTENSIONS — every statement is `IF NOT EXISTS`, so they are
 *    idempotent and mutually independent. They need only the tables, which
 *    `prisma migrate deploy` has just created.
 *
 * 2. `enable_rls.sql` — creates the 47 policies. Must come before enforce.
 *
 * 3. `enforce_rls.sql` — LAST, and it is the only file that depends on another.
 *    Its section 4 ALTERs each policy that enable_rls.sql created, so running
 *    it first fails on a policy that does not exist. Its sections 1-2 also
 *    grant on ALL TABLES, which must mean all of them.
 */
export const MANUAL_SQL_ORDER = [
  // --- 1. indexes and extensions -----------------------------------------
  "branch_code_unique.sql",
  "expense_unique.sql",
  "goods_receipt_number_unique.sql",
  "menu_merge_unique.sql",
  "product_sku_unique.sql",
  "product_trgm_idx.sql",
  "purchase_order_number_unique.sql",
  "sales_consumption_unique.sql",
  "sales_unique.sql",
  "staff_meal_unique.sql",
  "stock_cost_declaration_live_unique.sql",
  "stock_count_unique.sql",
  "stock_transfer_unique.sql",
  "supplier_code_unique.sql",
  "supplier_product_mapping_unique.sql",
  "waste_and_par_unique.sql",

  // --- 2. the policies ----------------------------------------------------
  "enable_rls.sql",

  // --- 3. the switch ------------------------------------------------------
  "enforce_rls.sql",
];

/**
 * Environment variables a file may interpolate as `${NAME}`.
 *
 * An allowlist rather than "anything in process.env", because the expansion
 * writes its result into a SQL string: a typo that silently expanded to empty
 * would set a blank password, and a file that could reach any variable could
 * reach AUTH_SECRET.
 */
export const ALLOWED_SQL_ENV = ["MISE_APP_DB_PASSWORD"];

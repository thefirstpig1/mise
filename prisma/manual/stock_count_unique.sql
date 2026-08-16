-- ============================================================
-- Mise — stock_count / stock_count_item partial uniques
-- Sprint 3 Part 15 (ADR 0015)
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause) in schema.prisma. The models carry ///-comments pointing here.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/stock_count_unique.sql --schema prisma/schema.prisma
-- ============================================================

-- 1. The document number, per tenant, live rows only.
-- The number already embeds the branch code ({BRANCH_CODE}-SC-####), so scoping
-- by tenant is enough. PARTIAL, not full: a discarded draft must not reserve its
-- number forever (Pitfall #22/#23). The generator also takes an advisory lock
-- (src/server/counter-lock.ts) — this index is the backstop, as it is for sku,
-- po_number and gr_number.
CREATE UNIQUE INDEX IF NOT EXISTS stock_count_number_unique
  ON stock_count (tenant_id, sc_number)
  WHERE deleted_at IS NULL;

-- 2. AT MOST ONE OPEN COUNT PER BRANCH (ADR 0015 Q8).
-- This is the constraint that prevents a silent halving of stock: two people
-- opening their own count of the same shelf would both read the same expected
-- figure, both find the same shortage, and both post it. Two counters are meant
-- to share ONE sheet and enter their own lines, which is what the per-line
-- counted_by exists for.
CREATE UNIQUE INDEX IF NOT EXISTS stock_count_open_unique
  ON stock_count (tenant_id, branch_id)
  WHERE status = 'DRAFT'::stock_count_status AND deleted_at IS NULL;

-- 3. A product appears at most once in a count.
-- Counting the same product on two lines would diff each of them against the
-- SAME expected quantity and post both variances, double-counting the discrepancy
-- — the same class of bug ADR 0013 L3b shape 3 rejected for GR lines against one
-- PO line. Reversal rows are excluded: a void appends a second row for the very
-- product the original counted.
CREATE UNIQUE INDEX IF NOT EXISTS stock_count_item_product_unique
  ON stock_count_item (stock_count_id, product_id)
  WHERE reversal_of_item_id IS NULL;

-- ============================================================
-- Mise — sales_consumption_run / sales_consumption_item partial uniques
-- Sprint 5 Part 22 (ADR 0022)
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause) in schema.prisma. The models carry ///-comments pointing here.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/sales_consumption_unique.sql --schema prisma/schema.prisma
-- ============================================================

-- 1. ONE LIVE RUN PER BRANCH PER BUSINESS DAY (ADR 0022 Q1/Q2b).
-- This is the real guard against consuming a day twice, and it is the reason the
-- table has no plain UNIQUE(branch_id, business_date): a voided run and the run
-- that replaced it must both stand, side by side, so the screen can show the
-- mistake next to its correction (ADR 0013 Q6's argument).
--
-- The ledger's own UNIQUE(source_type, source_id) cannot cover this. Each run
-- mints fresh item ids, so a second run for the same day is a legitimately
-- different set of sources and posts a second full set of movements — the day is
-- consumed twice and every balance below it is wrong, with nothing in the ledger
-- looking wrong.
CREATE UNIQUE INDEX IF NOT EXISTS sales_consumption_run_live_unique
  ON sales_consumption_run (branch_id, business_date)
  WHERE voided_at IS NULL;

-- 2. ONE ITEM PER PRODUCT PER RUN (ADR 0022 Q1).
-- The item is an aggregate — a day's whole cooking for one raw product — so two
-- rows for the same product in one run means the explosion was summed twice.
--
-- PARTIAL on the originals only: a void appends its reversal items into the SAME
-- run, and a reversal legitimately repeats its original's product.
CREATE UNIQUE INDEX IF NOT EXISTS sales_consumption_item_product_unique
  ON sales_consumption_item (run_id, product_id)
  WHERE reversal_of_item_id IS NULL;

-- 3. ONE REVERSAL PER ITEM (ADR 0022 Q5).
-- The waste_log_reversal_unique rule, applied to the same shape. A re-import
-- fires the void automatically inside the import's transaction, so a retried or
-- double-submitted commit is not hypothetical: without this index it credits the
-- stock back twice and the day ends up with more pork than it started with.
--
-- PARTIAL because reversal_of_item_id is NULL on every original, and NULLs are
-- distinct in Postgres anyway — the WHERE clause says so out loud and keeps the
-- index small.
CREATE UNIQUE INDEX IF NOT EXISTS sales_consumption_item_reversal_unique
  ON sales_consumption_item (reversal_of_item_id)
  WHERE reversal_of_item_id IS NOT NULL;

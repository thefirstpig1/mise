-- ============================================================
-- Mise — waste_log / par_level partial uniques
-- Sprint 3 Part 17 (ADR 0017)
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause) in schema.prisma. The models carry ///-comments pointing here.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/waste_and_par_unique.sql --schema prisma/schema.prisma
-- ============================================================

-- 1. ONE VOID PER WASTE ROW (ADR 0017 Q2).
-- A void appends a second waste_log row against the original and posts the
-- compensating ADJUST_GAIN. Without this index a double-submitted void writes two
-- reversals and credits the stock back TWICE — the same double-post class of bug
-- ADR 0015 Q8 guarded against with one-draft-per-branch, and that Part 13 had to
-- invent a submit key for. The ledger's own UNIQUE(source_type, source_id) cannot
-- help here: each reversal row is a legitimately different source id.
--
-- PARTIAL because reversal_of_id is NULL on every original, and NULLs are
-- distinct in Postgres anyway — the WHERE clause just says so out loud and keeps
-- the index small.
CREATE UNIQUE INDEX IF NOT EXISTS waste_log_reversal_unique
  ON waste_log (reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

-- 2. ONE LIVE PAR PER PRODUCT PER BRANCH (ADR 0017 Q5).
-- Two par rows for the same shelf would make "below par" ambiguous — the list
-- would show the product twice, with two different gaps, and neither wrong.
--
-- PARTIAL on deleted_at: removing a par soft-deletes the row, and a full unique
-- would let that dead row reserve the pair forever, so the product could never be
-- given a par again (Pitfall #22/#23).
CREATE UNIQUE INDEX IF NOT EXISTS par_level_product_branch_unique
  ON par_level (product_id, branch_id)
  WHERE deleted_at IS NULL;

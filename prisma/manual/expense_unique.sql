-- ============================================================
-- Mise — expense partial uniques
-- Sprint 3 Part 16 (ADR 0016)
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause) in schema.prisma. The models carry ///-comments pointing here.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/expense_unique.sql --schema prisma/schema.prisma
-- ============================================================

-- 1. ONE EXPENSE PER GOODS RECEIPT (ADR 0016 Q3).
-- Confirming a receipt writes its expense in the same transaction; a replayed
-- confirm must find it already there rather than book the purchase twice. This
-- is the same idempotency mechanism the ledger uses on (source_type, source_id)
-- and stock counts get from the count line's own identity.
--
-- PARTIAL on deleted_at: a voided receipt soft-deletes its expense, and the
-- receipt must remain free to be re-received later without the dead row blocking
-- it (Pitfall #22/#23).
CREATE UNIQUE INDEX IF NOT EXISTS expense_source_gr_unique
  ON expense (source_gr_id)
  WHERE source_gr_id IS NOT NULL AND deleted_at IS NULL;

-- 2. ONE EXPENSE PER RECURRING TEMPLATE PER MONTH (ADR 0016 Q5).
-- What is "due" is computed by asking which months have no expense carrying the
-- template's id; this index is what makes confirming the same month twice
-- impossible rather than merely unlikely — the double-submit case that Part 13
-- had to invent a submit key for.
CREATE UNIQUE INDEX IF NOT EXISTS expense_recurring_period_unique
  ON expense (recurring_expense_id, period)
  WHERE recurring_expense_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- Mise — stock_transfer_item partial unique
-- Sprint 3 Part 18 (ADR 0018)
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause) in schema.prisma. The model carries a ///-comment pointing here.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/stock_transfer_unique.sql --schema prisma/schema.prisma
-- ============================================================

-- ONE VOID PER TRANSFER LINE (ADR 0018 Q6).
-- A void appends a reversal line into the same document and posts the
-- compensating movements at BOTH branches. Without this index a double-submitted
-- void moves the goods back twice — and unlike waste, it does so at two branches
-- at once, so the two errors are equal, opposite and neither one obviously wrong
-- when someone finally looks.
--
-- The ledger's own UNIQUE(source_type, source_id) cannot help: each reversal line
-- is a legitimately different source id. Nor can the document's submit key —
-- stock_transfer.id IS that key, and it guards the DISPATCH, not the void.
--
-- PARTIAL because reversal_of_item_id is NULL on every ordinary line, and NULLs
-- are distinct in Postgres anyway — the WHERE clause says so out loud and keeps
-- the index small.
CREATE UNIQUE INDEX IF NOT EXISTS stock_transfer_item_reversal_unique
  ON stock_transfer_item (reversal_of_item_id)
  WHERE reversal_of_item_id IS NOT NULL;

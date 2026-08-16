-- ============================================================
-- Mise — goods_receipt.gr_number PARTIAL unique (Part 13 L1a, ADR 0013 Q5/Q6)
-- ============================================================
-- Why manual: same reason as purchase_order_number_unique.sql — Prisma 5.22 can
-- only write a FULL @@unique, and a DRAFT receipt CAN be soft-deleted, so a FULL
-- unique would let a discarded draft hold its number hostage (Pitfall #22/#23).
--
-- Scope: per tenant, live rows only. The number already embeds the branch code
-- ({BRANCH_CODE}-GR-####), so scoping by tenant is enough.
--
-- This index is also what the gr_number generator races against (scan max + 1,
-- inherited from generateSku via generatePoNumber — Pitfall #25). It is the
-- backstop: a losing writer gets P2002 rather than a duplicate document number.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/goods_receipt_number_unique.sql --schema prisma/schema.prisma
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS goods_receipt_number_unique
  ON goods_receipt (tenant_id, gr_number)
  WHERE deleted_at IS NULL;

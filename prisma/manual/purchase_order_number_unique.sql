-- ============================================================
-- Mise — purchase_order.po_number PARTIAL unique (Part 11 L1, ADR 0012 Q8/Q9)
-- ============================================================
-- Why manual: same reason as branch_code_unique.sql — Prisma 5.22 can only write
-- a FULL @@unique, and a DRAFT purchase order CAN be soft-deleted (Q9), so a FULL
-- unique would let a discarded draft hold its number hostage (Pitfall #22/#23).
--
-- Scope: per tenant, live rows only. The number already embeds the branch code
-- ({BRANCH_CODE}-PO-####, Q8), so scoping the index by tenant is enough — two
-- branches of the same tenant cannot collide, and two tenants never share a row.
--
-- NOTE this index is also what the po_number generator races against
-- (scan max + 1, inherited from generateSku — Pitfall #25). It is the backstop:
-- a losing writer gets P2002 rather than a duplicate document number.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/purchase_order_number_unique.sql --schema prisma/schema.prisma
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_number_unique
  ON purchase_order (tenant_id, po_number)
  WHERE deleted_at IS NULL;

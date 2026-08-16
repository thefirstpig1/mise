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
-- NOTE this index is the BACKSTOP for the po_number generator (scan max + 1,
-- inherited from generateSku — Pitfall #25): a losing writer gets P2002 rather
-- than a duplicate document number. Since Part 13.5 the generator also takes an
-- advisory lock (src/server/counter-lock.ts, key `po_number:{tenantId}:{branchCode}`),
-- so the race should no longer reach this index — which is not a reason to drop it.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/purchase_order_number_unique.sql --schema prisma/schema.prisma
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_number_unique
  ON purchase_order (tenant_id, po_number)
  WHERE deleted_at IS NULL;

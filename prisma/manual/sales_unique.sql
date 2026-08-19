-- ============================================================
-- Mise — Part 19 partial uniques + fuzzy-match index
-- Sprint 4 Part 19 (ADR 0019)
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause), a GIN index, nor gin_trgm_ops in schema.prisma. Each model carries a
-- ///-comment pointing here.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/sales_unique.sql --schema prisma/schema.prisma
--
-- Idempotent: IF NOT EXISTS throughout — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. A POS menu code is that POS's identity for a dish (ADR 0019 Q7)
-- ============================================================
-- IDENTITY IS THE CODE, NOT THE NAME. This index is what makes a POS rename, a
-- stray space or a dropped character a non-event: the same code resolves to the
-- same menu, and Mise's own name (layer 2) is never overwritten by the sync.
--
-- PARTIAL twice over:
--   - WHERE source = 'POS'         -> a MISE menu has no POS identity to collide on
--   - WHERE pos_menu_id IS NOT NULL -> a daily-summary file often carries names
--     only, so a POS menu legitimately has no code; those are matched through
--     menu_alias instead, and must not all collide with each other on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS menu_pos_identity_unique
  ON menu (pos_integration_id, pos_menu_id)
  WHERE source = 'POS' AND pos_menu_id IS NOT NULL;

-- ============================================================
-- 2. A menu category name is unique while it is alive (Q9)
-- ============================================================
-- PARTIAL, not full: a full unique would let a soft-deleted category hold its
-- name forever, so a shop that deleted "เครื่องดื่ม" could never create it again
-- (Pitfall #22/#23 — the same trap branch_code and product_sku already avoid).
CREATE UNIQUE INDEX IF NOT EXISTS menu_category_name_unique
  ON menu_category (tenant_id, name)
  WHERE deleted_at IS NULL;

-- ============================================================
-- 3. Every sales read filters out superseded rows (Q5)
-- ============================================================
-- Replaced rows are kept rather than deleted, because in Sprint 5 these rows
-- drive CONSUMPTION into an append-only ledger and a deleted sale would leave
-- stock consumed with nothing to point at. The cost of keeping them is that
-- every read carries `superseded_at IS NULL`, so the index says so.
CREATE INDEX IF NOT EXISTS sales_line_live_branch_date_idx
  ON sales_line (branch_id, business_date)
  WHERE superseded_at IS NULL;

-- ============================================================
-- 4. Fuzzy menu-name suggestion (Q7)
-- ============================================================
-- Reuses the machinery ADR 0010 already installed for restore-on-recreate:
-- pg_trgm similarity, threshold 0.4, coarse Thai badges, raw score never shown.
--
-- ⚠️ THIS INDEX SUPPORTS A SUGGESTION, NEVER AN AUTOMATIC MERGE. Thai menu names
-- differ by one word for genuinely different dishes, so any threshold that
-- catches a typo also merges two real dishes — which would corrupt revenue now
-- and consume the wrong ingredient in Sprint 5. The system suggests, a person
-- decides, and menu_alias remembers.
--
-- NOT partial on deleted_at (unlike the product indexes, which search only the
-- soft-deleted set): here the search target is LIVE menus, because the question
-- is "which dish that we currently sell is this row?".
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS menu_name_trgm_idx
  ON menu USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS menu_pos_name_trgm_idx
  ON menu USING gin (pos_menu_name gin_trgm_ops)
  WHERE deleted_at IS NULL AND pos_menu_name IS NOT NULL;

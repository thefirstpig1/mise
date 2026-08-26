-- ============================================================
-- Mise — Part 25 partial unique
-- Sprint 5 Part 25 (ADR 0026)
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause). The model carries a ///-comment pointing here.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/menu_merge_unique.sql --schema prisma/schema.prisma
--
-- Idempotent: IF NOT EXISTS — safe to re-run.
-- ============================================================

-- ============================================================
-- A menu is the spelling of ONE dish at a time (ADR 0026 Q4)
-- ============================================================
-- PARTIAL on `revoked_at IS NULL`, not a full unique, and the difference is the
-- whole point of keeping revoked rows: a shop may merge ข้าวผัดกุ้ง (อโศก) into
-- the ทองหล่อ row, decide that was wrong, revoke it, and merge it into a MISE
-- menu instead. A full unique would let the first, dead merge hold that menu
-- for ever — the trap `branch_code`, `product_sku` and `menu_category_name`
-- each already avoid (Pitfall #22/#23).
--
-- What it forbids is two LIVE merges for one losing menu, which is the
-- ambiguity that would make folding non-deterministic: two winners, and a
-- tiebreak nobody chose.
--
-- It does NOT forbid many losing menus sharing one winner — that is the ordinary
-- case for a shop with five branches, and it is a star, never a chain.
CREATE UNIQUE INDEX IF NOT EXISTS menu_merge_live_losing_unique
  ON menu_merge (losing_menu_id)
  WHERE revoked_at IS NULL;

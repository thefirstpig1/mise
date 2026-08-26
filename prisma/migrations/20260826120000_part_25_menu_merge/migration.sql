-- ============================================================
-- Part 25 — the merge that moves nothing  (ADR 0026)
-- ============================================================
-- A POS reports one dish under more than one code, so Mise carries more than
-- one `menu` row for it and the shop's revenue, its recipe work and its stock
-- deduction all split along that seam.
--
-- THIS TABLE IS THE ONLY THING A MERGE WRITES. No `sales_line` is repointed and
-- none is superseded — that table takes no write after INSERT except the
-- supersede pair, and it carries no `updated_at` to record one (Part 19 Q5).
-- Repointing would not even work: `menu_pos_identity_unique` has no
-- `deleted_at` predicate (deliberately — `menu_category_name_unique` ten lines
-- below it in sales_unique.sql DOES have one, with the reason written out), so
-- the losing menu holds its POS code for ever, goes on matching byCode, and
-- goes on collecting sales after the merge. A rewrite would have to re-run
-- after every import, for ever.
--
-- WHY THIS IS NOT TWO COLUMNS ON `menu` (Q4): Part 24 chose columns and was
-- right to, because a draft IS a recipe. A merge is not a menu — it is a
-- relationship between two menus with a start date, an author and an end. A
-- mutable pointer that can be cleared and re-aimed, with nothing recording
-- where it pointed last month, is by hand the very defect that ruled out
-- rewriting `sales_line`.
--
-- DUPLICATE MENUS ARE STRUCTURAL, NOT ACCIDENTAL: `pos_integration.branch_id`
-- is NOT NULL and `menu` is unique on (pos_integration_id, pos_menu_id), so a
-- two-branch shop carries two rows for one dish from its first import and a
-- five-branch shop carries five.
-- ============================================================

CREATE TABLE "menu_merge" (
    "id"              UUID         NOT NULL,
    "tenant_id"       UUID         NOT NULL,

    -- The spelling. Stays alive, keeps its code, keeps collecting sales.
    "losing_menu_id"  UUID         NOT NULL,
    -- The dish. What reports, recipes and stock deduction speak of.
    "winning_menu_id" UUID         NOT NULL,

    -- When this starts applying TO STOCK. A plain DATE, compared against
    -- `sales_line.business_date` — never a timestamp to be truncated later,
    -- the same rule `recipe.effective_from` follows (rule P15).
    --
    -- Reporting ignores this and folds retroactively: it stores nothing and
    -- reverses instantly, and "these are the same dish" is a fact about the
    -- dish rather than an event that happened on a Tuesday. The LEDGER folds
    -- only from this date, because writing movements into a past day changes
    -- what happened (Q5, rule G2).
    "effective_from"  DATE         NOT NULL,

    "merged_by"       TEXT         NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Un-merging sets these. The row is never deleted, as nothing in this
    -- system is.
    "revoked_at"      TIMESTAMP(3),
    "revoked_by"      TEXT,

    CONSTRAINT "menu_merge_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "menu_merge" ADD CONSTRAINT "menu_merge_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT on both menus: neither side of a live merge may be hard-deleted, and
-- the losing side cannot be deleted at all while the POS still knows its code.
ALTER TABLE "menu_merge" ADD CONSTRAINT "menu_merge_losing_menu_id_fkey"
  FOREIGN KEY ("losing_menu_id") REFERENCES "menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "menu_merge" ADD CONSTRAINT "menu_merge_winning_menu_id_fkey"
  FOREIGN KEY ("winning_menu_id") REFERENCES "menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "menu_merge" ADD CONSTRAINT "menu_merge_merged_by_fkey"
  FOREIGN KEY ("merged_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "menu_merge" ADD CONSTRAINT "menu_merge_revoked_by_fkey"
  FOREIGN KEY ("revoked_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "menu_merge_tenant_id_idx" ON "menu_merge"("tenant_id");
-- "which menus fold into this one" — the read every folding query performs.
CREATE INDEX "menu_merge_winning_idx" ON "menu_merge"("winning_menu_id");
-- "is this menu a spelling of something" — the read the menu screen performs.
CREATE INDEX "menu_merge_losing_idx" ON "menu_merge"("losing_menu_id");

-- ============================================================
-- Part 25 CHECK constraints (ADR 0026)
-- ============================================================

-- A dish is not a spelling of itself.
ALTER TABLE "menu_merge"
  ADD CONSTRAINT "menu_merge_not_self_check"
  CHECK ("losing_menu_id" <> "winning_menu_id");

-- A revoked merge must say WHO revoked it, and a row naming a revoker must be
-- revoked. Half of this pair on its own is a merge that ended with nobody
-- responsible — the same shape `sales_line_superseded_pair_check` refuses.
ALTER TABLE "menu_merge"
  ADD CONSTRAINT "menu_merge_revoked_pair_check"
  CHECK (
    ("revoked_at" IS NULL     AND "revoked_by" IS NULL)
    OR
    ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
  );

-- A merge cannot be revoked before it was made.
ALTER TABLE "menu_merge"
  ADD CONSTRAINT "menu_merge_revoked_after_created_check"
  CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

-- NOT ENFORCED HERE, ON PURPOSE — the no-chain rule (Q4: a winner may not be
-- somebody's loser and a loser may not be anybody's winner) spans rows, which a
-- CHECK cannot see. It is an application guard, like the one-central-recipe
-- rule that `RecipeAlreadyExistsError` enforces for the same reason.

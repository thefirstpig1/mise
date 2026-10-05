-- ============================================================
-- Part 41 — a Menu Lab draft's way to the kitchen  (ADR 0041)
-- ============================================================
-- Kong 2026-10-05: a cook may write a draft but not apply it; a branch
-- manager endorses it (credit, "รับรองโดย"); whoever may apply it does.
-- Three nullable columns on recipe — no new table. NULL on every recipe that
-- is not a draft; every draft that exists today is backfilled to DRAFT.
-- recipe already has RLS (enable_rls.sql); new columns need no policy.
-- ============================================================

CREATE TYPE "RecipeDraftStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ENDORSED');

ALTER TABLE "recipe" ADD COLUMN "draft_status" "RecipeDraftStatus",
ADD COLUMN "endorsed_at" TIMESTAMP(3),
ADD COLUMN "endorsed_by" TEXT;

ALTER TABLE "recipe" ADD CONSTRAINT "recipe_endorsed_by_fkey" FOREIGN KEY ("endorsed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "recipe" SET "draft_status" = 'DRAFT' WHERE "is_draft" = true;

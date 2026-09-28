-- ============================================================
-- Part 36 — one person's count is a row of its own  (ADR 0034 Q2)
-- ============================================================
-- Five devices count one sheet. Until now a second count of the same product
-- OVERWROTE the first (ADR 0015 Q2), which was right while one person counted
-- and is silent data loss the moment two do — and the same product genuinely
-- lives in two places (the walk-in and the tray at the line).
--
-- Kong chose "add it up, and keep every counter's name". A contribution is one
-- person's count at one moment: its own counter, time and note, and the units
-- they typed (the existing stock_count_entry rows). The line keeps qty_counted
-- as the TOTAL, so closing, the ledger and fifo-replay.ts are untouched.
--
-- ORDER MATTERS. Prisma's own diff adds contribution_id NOT NULL in one step,
-- which fails on every existing entry. So: table, nullable column, backfill,
-- then NOT NULL.
--
-- BACKFILL. Every existing line that has entries becomes exactly one
-- contribution, from the line's own counted_by / counted_at / notes. The
-- retired free-text counted_by_name (ADR 0034 Q1) is appended to the note, so
-- "who actually walked" on an old sheet is not lost. Reversal lines carry no
-- entries and get no contribution.
--
-- RLS: the new table has tenant_id, so its policy lives in
-- prisma/manual/enable_rls.sql and its FORCE in enforce_rls.sql, both applied
-- by the release command after this migration (ADR 0033 Q6/Q9).
-- ============================================================

-- CreateTable
CREATE TABLE "stock_count_contribution" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_count_item_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "counted_by" TEXT NOT NULL,
    "counted_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_count_contribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_count_contribution_tenant_id_idx" ON "stock_count_contribution"("tenant_id");
CREATE UNIQUE INDEX "stock_count_contribution_seq_unique" ON "stock_count_contribution"("stock_count_item_id", "seq");

ALTER TABLE "stock_count_contribution" ADD CONSTRAINT "stock_count_contribution_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_contribution" ADD CONSTRAINT "stock_count_contribution_stock_count_item_id_fkey" FOREIGN KEY ("stock_count_item_id") REFERENCES "stock_count_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_contribution" ADD CONSTRAINT "stock_count_contribution_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The column, nullable until every existing entry has somewhere to point.
ALTER TABLE "stock_count_entry" ADD COLUMN "contribution_id" UUID;

-- Backfill: one contribution per existing line that has entries.
INSERT INTO "stock_count_contribution"
  ("id", "tenant_id", "stock_count_item_id", "seq", "counted_by", "counted_at", "note", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  i."tenant_id",
  i."id",
  1,
  i."counted_by",
  i."counted_at",
  NULLIF(
    concat_ws(' · ', i."notes", CASE WHEN i."counted_by_name" IS NOT NULL THEN 'นับโดย ' || i."counted_by_name" END),
    ''
  ),
  i."created_at",
  i."updated_at"
FROM "stock_count_item" i
WHERE EXISTS (SELECT 1 FROM "stock_count_entry" e WHERE e."stock_count_item_id" = i."id");

UPDATE "stock_count_entry" e
SET "contribution_id" = c."id"
FROM "stock_count_contribution" c
WHERE c."stock_count_item_id" = e."stock_count_item_id";

ALTER TABLE "stock_count_entry" ALTER COLUMN "contribution_id" SET NOT NULL;

CREATE INDEX "stock_count_entry_contribution_idx" ON "stock_count_entry"("contribution_id");
ALTER TABLE "stock_count_entry" ADD CONSTRAINT "stock_count_entry_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "stock_count_contribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

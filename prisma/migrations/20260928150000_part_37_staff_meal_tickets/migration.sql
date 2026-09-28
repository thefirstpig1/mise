-- ============================================================
-- Part 37 — staff meal tickets  (ADR 0035)
-- ============================================================
-- The person who eats requests a meal with their own account and gets a ticket;
-- a head approves it. Whether THIS system or the POS deducts the stock is a shop
-- setting, frozen onto each ticket at approval.
--
-- BACKFILL. Every existing meal was recorded and deducted in one step, so it is
-- exactly an approved ticket whose stock this system posted: the column
-- defaults (status APPROVED, stock_posted true) say that, and the UPDATE below
-- dates the request and the approval to when the row was written, by the person
-- who wrote it. No ticket numbers are invented for them — NULL is honest.
--
-- The partial uniques (one roster row per account, ticket number per tenant)
-- live in prisma/manual/staff_meal_unique.sql, applied by the release command.
-- ============================================================

CREATE TYPE "staff_meal_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "staff_meal_stock_source" AS ENUM ('SYSTEM', 'POS');

ALTER TABLE "staff_meal" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "on_behalf" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rejected_reason" TEXT,
ADD COLUMN     "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "staff_meal_status" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "stock_posted" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ticket_no" TEXT;

UPDATE "staff_meal"
SET "requested_at" = "created_at",
    "approved_at"  = "created_at",
    "approved_by"  = "recorded_by";

ALTER TABLE "staff_member" ADD COLUMN "user_id" TEXT;

ALTER TABLE "tenant" ADD COLUMN "staff_meal_stock_source" "staff_meal_stock_source" NOT NULL DEFAULT 'SYSTEM';

CREATE INDEX "staff_meal_branch_status_idx" ON "staff_meal"("branch_id", "status");

ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_meal" ADD CONSTRAINT "staff_meal_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "stock_count_status" AS ENUM ('DRAFT', 'CLOSED', 'VOIDED');

-- AlterEnum
ALTER TYPE "source_type" ADD VALUE 'STOCK_COUNT';

-- CreateTable
CREATE TABLE "stock_count" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "sc_number" TEXT NOT NULL,
    "count_date" DATE NOT NULL,
    "status" "stock_count_status" NOT NULL DEFAULT 'DRAFT',
    "show_expected" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "started_by" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "stock_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "qty_counted" DECIMAL(15,3) NOT NULL,
    "qty_expected" DECIMAL(15,3) NOT NULL,
    "counted_at" TIMESTAMP(3) NOT NULL,
    "counted_by" TEXT NOT NULL,
    "counted_by_name" TEXT,
    "notes" TEXT,
    "reversal_of_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_count_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_count_item_id" UUID NOT NULL,
    "product_unit_id" UUID NOT NULL,
    "qty_in_unit" DECIMAL(15,3) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_count_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_count_tenant_id_idx" ON "stock_count"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_count_branch_date_idx" ON "stock_count"("branch_id", "count_date");

-- CreateIndex
CREATE INDEX "stock_count_item_tenant_id_idx" ON "stock_count_item"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_count_item_count_idx" ON "stock_count_item"("stock_count_id");

-- CreateIndex
CREATE INDEX "stock_count_entry_tenant_id_idx" ON "stock_count_entry"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_count_entry_item_idx" ON "stock_count_entry"("stock_count_item_id");

-- AddForeignKey
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_item" ADD CONSTRAINT "stock_count_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_item" ADD CONSTRAINT "stock_count_item_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_count"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_item" ADD CONSTRAINT "stock_count_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_item" ADD CONSTRAINT "stock_count_item_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_item" ADD CONSTRAINT "stock_count_item_reversal_of_item_id_fkey" FOREIGN KEY ("reversal_of_item_id") REFERENCES "stock_count_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entry" ADD CONSTRAINT "stock_count_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entry" ADD CONSTRAINT "stock_count_entry_stock_count_item_id_fkey" FOREIGN KEY ("stock_count_item_id") REFERENCES "stock_count_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entry" ADD CONSTRAINT "stock_count_entry_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Inline CHECK constraints (Part 15, ADR 0015)
-- ============================================================
-- Prisma cannot express CHECKs; they live here rather than in prisma/manual/,
-- which is reserved for what a migration file cannot write by hand (partial
-- index / NULLS NOT DISTINCT / CREATE EXTENSION). Precedent: Part 10's sign
-- check, Part 11's five range checks, Part 14's three.

-- The status machine, in the database and not only in the app (ADR 0012's
-- precedent): a closed count must record WHEN it closed, and a voided one must
-- record when it was voided. Without these a bug could leave a CLOSED document
-- with no closing timestamp, and no read would notice.
ALTER TABLE stock_count
  ADD CONSTRAINT stock_count_closed_stamped_check
  CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL);

ALTER TABLE stock_count
  ADD CONSTRAINT stock_count_voided_stamped_check
  CHECK (status <> 'VOIDED' OR voided_at IS NOT NULL);

-- Only a DRAFT may be discarded. A CLOSED count has posted to the ledger and
-- must be VOIDED (which appends reversals), never hidden — mirrors
-- purchase_order_draft_delete_check from Part 11.
ALTER TABLE stock_count
  ADD CONSTRAINT stock_count_draft_delete_check
  CHECK (deleted_at IS NULL OR status = 'DRAFT');

-- You cannot count a negative quantity of anything: qty_counted is what someone
-- physically found. Reversal rows are EXEMPT because a void writes the original's
-- numbers swapped (ADR 0015 Q6), and qty_expected may legitimately be negative
-- (ADR 0011 Q9 allows a negative balance) — so a reversal's qty_counted inherits
-- that sign. qty_expected itself carries no check, for the same reason.
ALTER TABLE stock_count_item
  ADD CONSTRAINT stock_count_item_qty_counted_check
  CHECK (reversal_of_item_id IS NOT NULL OR qty_counted >= 0);

ALTER TABLE stock_count_item
  ADD CONSTRAINT stock_count_item_line_no_check
  CHECK (line_no > 0);

-- An entry is a quantity the user typed into a unit box. Zero is allowed (a row
-- they started and left) but negative is not.
ALTER TABLE stock_count_entry
  ADD CONSTRAINT stock_count_entry_qty_check
  CHECK (qty_in_unit >= 0);

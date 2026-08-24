-- CreateEnum
CREATE TYPE "cancelled_sale_policy" AS ENUM ('TREAT_AS_COOKED', 'TREAT_AS_NOT_COOKED');

-- CreateEnum
CREATE TYPE "consumption_void_reason" AS ENUM ('RE_IMPORT', 'REPOST');

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "cancelled_sale_policy" "cancelled_sale_policy" NOT NULL DEFAULT 'TREAT_AS_COOKED';

-- CreateTable
CREATE TABLE "sales_consumption_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "posted_by" TEXT NOT NULL,
    "cancelled_sale_policy" "cancelled_sale_policy" NOT NULL,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" "consumption_void_reason",
    "covered_net_amount" DECIMAL(15,2) NOT NULL,
    "total_net_amount" DECIMAL(15,2) NOT NULL,
    "menus_posted" INTEGER NOT NULL,
    "menus_skipped" INTEGER NOT NULL,
    "skipped_menus" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_consumption_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_consumption_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "reversal_of_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_consumption_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_consumption_run_tenant_id_idx" ON "sales_consumption_run"("tenant_id");

-- CreateIndex
CREATE INDEX "sales_consumption_run_branch_date_idx" ON "sales_consumption_run"("branch_id", "business_date");

-- CreateIndex
CREATE INDEX "sales_consumption_item_tenant_id_idx" ON "sales_consumption_item"("tenant_id");

-- CreateIndex
CREATE INDEX "sales_consumption_item_run_idx" ON "sales_consumption_item"("run_id");

-- AddForeignKey
ALTER TABLE "sales_consumption_run" ADD CONSTRAINT "sales_consumption_run_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_consumption_run" ADD CONSTRAINT "sales_consumption_run_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_consumption_run" ADD CONSTRAINT "sales_consumption_run_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_consumption_run" ADD CONSTRAINT "sales_consumption_run_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_consumption_item" ADD CONSTRAINT "sales_consumption_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_consumption_item" ADD CONSTRAINT "sales_consumption_item_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sales_consumption_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_consumption_item" ADD CONSTRAINT "sales_consumption_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_consumption_item" ADD CONSTRAINT "sales_consumption_item_reversal_of_item_id_fkey" FOREIGN KEY ("reversal_of_item_id") REFERENCES "sales_consumption_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Hand-written below this line — Part 22 (ADR 0022)
-- ============================================================
-- Inline in migration.sql, not prisma/manual/: the precedent is
-- stock_movement_sign_check (Part 10), waste_log's four (Part 17) and
-- stock_transfer's (Part 18). prisma/manual/ is reserved for what a hand-written
-- migration.sql cannot do at all: partial indexes, NULLS NOT DISTINCT,
-- CREATE EXTENSION. The partial uniques for this Part live there.
-- ============================================================

-- A zero item is noise with a movement attached: it would post a stock_movement
-- that changes nothing, and every FIFO replay would walk it forever after.
--
-- Deliberately NOT the sign rule stock_transfer_item carries. A non-reversal item
-- may legitimately be POSITIVE: under cancelled_sale_policy = TREAT_AS_NOT_COOKED
-- a day whose cancellations outweighed its sales returns stock (ADR 0022 Q6's
-- clarification), and that is an ordinary item, not a reversal of anything.
ALTER TABLE "sales_consumption_item"
  ADD CONSTRAINT sales_consumption_item_qty_check
  CHECK ("qty" <> 0);

-- Nothing reverses itself. Without it, one bad id makes a row its own reversal
-- and the void walk never terminates.
ALTER TABLE "sales_consumption_item"
  ADD CONSTRAINT sales_consumption_item_reversal_self_check
  CHECK ("reversal_of_item_id" IS NULL OR "reversal_of_item_id" <> "id");

-- An event records WHO and WHY, or it did not happen. Same rule as waste_log's
-- void, extended to the reason because here it is machine-set: a run taken back
-- with no reason cannot tell a re-import from a re-post, which is the only
-- question anyone asks of a voided run.
ALTER TABLE "sales_consumption_run"
  ADD CONSTRAINT sales_consumption_run_voided_stamped_check
  CHECK (
    ("voided_at" IS NULL) = ("voided_by" IS NULL)
    AND ("voided_at" IS NULL) = ("void_reason" IS NULL)
  );

-- Counts are counts. Amounts are NOT checked: a day of nothing but refunds has a
-- negative net, and sales_line carries no sign check for exactly that reason.
ALTER TABLE "sales_consumption_run"
  ADD CONSTRAINT sales_consumption_run_menu_counts_check
  CHECK ("menus_posted" >= 0 AND "menus_skipped" >= 0);

-- ============================================================
-- stock_movement_sign_check — DROP and re-declare (ADR 0011 Q2)
-- ============================================================
-- The standing item every new movement type triggers. CONSUMPTION joins the
-- negative arm (stock leaving to be cooked); CONSUMPTION_REVERSAL joins the
-- positive one (a re-import or a re-post giving the day back).
--
-- The values themselves were committed by 20260824153758_part_22a — Postgres
-- refuses to reference a new enum value in the transaction that added it.
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_sign_check";

ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_sign_check" CHECK (
  ("type" IN ('PO_RECEIVE', 'ADJUST_GAIN', 'TRANSFER_IN', 'TRANSFER_OUT_REVERSAL', 'CONSUMPTION_REVERSAL') AND "qty" > 0)
  OR ("type" IN ('PO_RECEIVE_REVERSAL', 'ADJUST_LOSS', 'TRANSFER_OUT', 'TRANSFER_IN_REVERSAL', 'CONSUMPTION') AND "qty" < 0)
);

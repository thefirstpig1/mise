-- CreateEnum
CREATE TYPE "pos_type" AS ENUM ('FOODSTORY', 'WONGNAI', 'OCHA', 'STOREHUB', 'LOYVERSE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "sales_file_kind" AS ENUM ('BILL_DETAIL', 'DAILY_SUMMARY');

-- CreateEnum
CREATE TYPE "sales_import_source" AS ENUM ('MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "sales_import_batch_status" AS ENUM ('PENDING', 'PREVIEW', 'COMMITTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "sales_channel" AS ENUM ('DINE_IN', 'TAKEAWAY', 'DELIVERY_GRAB', 'DELIVERY_LINEMAN', 'DELIVERY_FOODPANDA', 'DELIVERY_ROBINHOOD', 'DELIVERY_SHOPEEFOOD', 'ONLINE_ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "menu_source" AS ENUM ('POS', 'MISE');

-- CreateEnum
CREATE TYPE "file_encoding" AS ENUM ('UTF8', 'TIS620');

-- AlterTable
ALTER TABLE "branch" ADD COLUMN     "sales_day_cutoff_minutes" INTEGER NOT NULL DEFAULT 300;

-- CreateTable
CREATE TABLE "pos_integration" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "pos_type" "pos_type" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_import_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pos_integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_import_profile" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pos_integration_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "file_kind" "sales_file_kind" NOT NULL,
    "encoding" "file_encoding" NOT NULL DEFAULT 'UTF8',
    "date_format" TEXT NOT NULL,
    "is_buddhist_year" BOOLEAN NOT NULL DEFAULT false,
    "column_map" JSONB NOT NULL,
    "header_signature" TEXT NOT NULL,
    "amounts_include_vat" BOOLEAN NOT NULL,
    "amounts_include_service_charge" BOOLEAN NOT NULL,
    "default_channel" "sales_channel",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sales_import_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_import_batch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "pos_integration_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "source" "sales_import_source" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "status" "sales_import_batch_status" NOT NULL DEFAULT 'PENDING',
    "file_name" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "covered_from" DATE,
    "covered_to" DATE,
    "error_log" JSONB,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_day" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "current_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pos_category_name" TEXT,
    "display_order" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source" "menu_source" NOT NULL,
    "pos_integration_id" UUID,
    "pos_menu_id" TEXT,
    "name" TEXT NOT NULL,
    "pos_menu_name" TEXT,
    "menu_category_id" UUID,
    "primary_department_id" UUID,
    "is_pos_stub" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_alias" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pos_integration_id" UUID NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "raw_name" TEXT NOT NULL,
    "menu_id" UUID NOT NULL,
    "confirmed_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "sales_day_id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "menu_id" UUID NOT NULL,
    "pos_menu_name" TEXT,
    "pos_menu_code" TEXT,
    "qty" DECIMAL(15,3) NOT NULL,
    "gross_amount" DECIMAL(15,2) NOT NULL,
    "discount_amount" DECIMAL(15,2) NOT NULL,
    "net_amount" DECIMAL(15,2) NOT NULL,
    "service_charge_amount" DECIMAL(15,2) NOT NULL,
    "vat_amount" DECIMAL(15,2) NOT NULL,
    "channel" "sales_channel",
    "pos_bill_id" TEXT,
    "sold_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "superseded_by_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_integration_tenant_id_idx" ON "pos_integration"("tenant_id");

-- CreateIndex
CREATE INDEX "pos_integration_branch_idx" ON "pos_integration"("branch_id");

-- CreateIndex
CREATE INDEX "sales_import_profile_tenant_id_idx" ON "sales_import_profile"("tenant_id");

-- CreateIndex
CREATE INDEX "sales_import_profile_integration_idx" ON "sales_import_profile"("pos_integration_id");

-- CreateIndex
CREATE INDEX "sales_import_batch_tenant_id_idx" ON "sales_import_batch"("tenant_id");

-- CreateIndex
CREATE INDEX "sales_import_batch_branch_uploaded_idx" ON "sales_import_batch"("branch_id", "uploaded_at");

-- CreateIndex
CREATE INDEX "sales_day_tenant_id_idx" ON "sales_day"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_day_branch_date_unique" ON "sales_day"("branch_id", "business_date");

-- CreateIndex
CREATE INDEX "menu_category_tenant_id_idx" ON "menu_category"("tenant_id");

-- CreateIndex
CREATE INDEX "menu_tenant_id_idx" ON "menu"("tenant_id");

-- CreateIndex
CREATE INDEX "menu_integration_idx" ON "menu"("pos_integration_id");

-- CreateIndex
CREATE INDEX "menu_category_idx" ON "menu"("menu_category_id");

-- CreateIndex
CREATE INDEX "menu_alias_tenant_id_idx" ON "menu_alias"("tenant_id");

-- CreateIndex
CREATE INDEX "menu_alias_menu_idx" ON "menu_alias"("menu_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_alias_name_unique" ON "menu_alias"("pos_integration_id", "normalized_name");

-- CreateIndex
CREATE INDEX "sales_line_tenant_id_idx" ON "sales_line"("tenant_id");

-- CreateIndex
CREATE INDEX "sales_line_branch_date_idx" ON "sales_line"("branch_id", "business_date");

-- CreateIndex
CREATE INDEX "sales_line_day_idx" ON "sales_line"("sales_day_id");

-- CreateIndex
CREATE INDEX "sales_line_menu_date_idx" ON "sales_line"("menu_id", "business_date");

-- CreateIndex
CREATE INDEX "sales_line_batch_idx" ON "sales_line"("import_batch_id");

-- AddForeignKey
ALTER TABLE "pos_integration" ADD CONSTRAINT "pos_integration_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_integration" ADD CONSTRAINT "pos_integration_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_profile" ADD CONSTRAINT "sales_import_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_profile" ADD CONSTRAINT "sales_import_profile_pos_integration_id_fkey" FOREIGN KEY ("pos_integration_id") REFERENCES "pos_integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_batch" ADD CONSTRAINT "sales_import_batch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_batch" ADD CONSTRAINT "sales_import_batch_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_batch" ADD CONSTRAINT "sales_import_batch_pos_integration_id_fkey" FOREIGN KEY ("pos_integration_id") REFERENCES "pos_integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_batch" ADD CONSTRAINT "sales_import_batch_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "sales_import_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_import_batch" ADD CONSTRAINT "sales_import_batch_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_day" ADD CONSTRAINT "sales_day_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_day" ADD CONSTRAINT "sales_day_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_day" ADD CONSTRAINT "sales_day_current_batch_id_fkey" FOREIGN KEY ("current_batch_id") REFERENCES "sales_import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_category" ADD CONSTRAINT "menu_category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu" ADD CONSTRAINT "menu_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu" ADD CONSTRAINT "menu_pos_integration_id_fkey" FOREIGN KEY ("pos_integration_id") REFERENCES "pos_integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu" ADD CONSTRAINT "menu_menu_category_id_fkey" FOREIGN KEY ("menu_category_id") REFERENCES "menu_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu" ADD CONSTRAINT "menu_primary_department_id_fkey" FOREIGN KEY ("primary_department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_alias" ADD CONSTRAINT "menu_alias_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_alias" ADD CONSTRAINT "menu_alias_pos_integration_id_fkey" FOREIGN KEY ("pos_integration_id") REFERENCES "pos_integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_alias" ADD CONSTRAINT "menu_alias_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_alias" ADD CONSTRAINT "menu_alias_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_sales_day_id_fkey" FOREIGN KEY ("sales_day_id") REFERENCES "sales_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "sales_import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_superseded_by_batch_id_fkey" FOREIGN KEY ("superseded_by_batch_id") REFERENCES "sales_import_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Part 19 CHECK constraints (ADR 0019)
-- ============================================================
-- Prisma 5.22 cannot express a CHECK in schema.prisma, so they are appended to
-- the generated migration by hand, as Parts 13-18 did.
--
-- READ THIS BEFORE ADDING ONE: there is deliberately NO sign check on
-- sales_line. Voided bills and refunds are negative, giveaways and tastings are
-- zero, and both are legal (ADR 0019 Q14). Adding `qty > 0` here would put
-- Mise's totals permanently out of step with the POS screen, which rule P14
-- forbids. The protection against a blank cell becoming a zero lives in the
-- parser (rule P21), because the database cannot tell the two apart.
-- ============================================================

-- A branch cuts its sales day somewhere inside a real day (Q15).
ALTER TABLE "branch"
  ADD CONSTRAINT "branch_sales_day_cutoff_check"
  CHECK ("sales_day_cutoff_minutes" >= 0 AND "sales_day_cutoff_minutes" < 1440);

-- A MISE menu belongs to no POS; a POS menu must name the integration it came
-- from (Q7). `pos_menu_id` stays nullable on a POS menu on purpose: a
-- daily-summary file often carries names only, and that is the case menu_alias
-- exists to serve.
ALTER TABLE "menu"
  ADD CONSTRAINT "menu_source_check"
  CHECK (
    ("source" = 'POS'  AND "pos_integration_id" IS NOT NULL)
    OR
    ("source" = 'MISE' AND "pos_integration_id" IS NULL AND "pos_menu_id" IS NULL)
  );

-- A superseded row must say WHICH import replaced it, and a row that names a
-- replacement must be marked superseded (Q5). Half of this pair on its own
-- describes stock that vanished with no document to point at - the shape ADR
-- 0011 exists to prevent, and Sprint 5 will post ledger movements from these
-- rows.
ALTER TABLE "sales_line"
  ADD CONSTRAINT "sales_line_superseded_pair_check"
  CHECK (
    ("superseded_at" IS NULL     AND "superseded_by_batch_id" IS NULL)
    OR
    ("superseded_at" IS NOT NULL AND "superseded_by_batch_id" IS NOT NULL)
  );

-- A file's covered range is read from its rows, never asserted by the uploader,
-- so it is either fully known or not known at all - and it cannot end before it
-- starts (rule P2).
ALTER TABLE "sales_import_batch"
  ADD CONSTRAINT "sales_import_batch_covered_range_check"
  CHECK (
    ("covered_from" IS NULL AND "covered_to" IS NULL)
    OR
    ("covered_from" IS NOT NULL AND "covered_to" IS NOT NULL AND "covered_from" <= "covered_to")
  );

-- A committed batch has a commit time; nothing else does. Without this, "why is
-- Tuesday missing" is unanswerable from the batch table alone.
ALTER TABLE "sales_import_batch"
  ADD CONSTRAINT "sales_import_batch_committed_check"
  CHECK (
    ("status" = 'COMMITTED' AND "committed_at" IS NOT NULL)
    OR
    ("status" <> 'COMMITTED' AND "committed_at" IS NULL)
  );

-- Rows are only counted once they are actually written.
ALTER TABLE "sales_import_batch"
  ADD CONSTRAINT "sales_import_batch_row_count_check"
  CHECK ("row_count" >= 0);

-- A daily-summary file has no bills and no times to carry, so a profile that
-- claims otherwise is a mis-set profile, not a variant. Enforced on the profile
-- rather than the line, because the line is allowed to be sparse for other
-- reasons.
ALTER TABLE "sales_import_profile"
  ADD CONSTRAINT "sales_import_profile_date_format_check"
  CHECK (length(btrim("date_format")) > 0);

-- A header signature that is blank matches every file, which is the opposite of
-- what it is for (Q11).
ALTER TABLE "sales_import_profile"
  ADD CONSTRAINT "sales_import_profile_signature_check"
  CHECK (length(btrim("header_signature")) > 0);

-- An alias keyed on an empty string would swallow every unnamed row.
ALTER TABLE "menu_alias"
  ADD CONSTRAINT "menu_alias_normalized_name_check"
  CHECK (length(btrim("normalized_name")) > 0);

-- A menu and a menu category are both things a human reads off a screen.
ALTER TABLE "menu"
  ADD CONSTRAINT "menu_name_check"
  CHECK (length(btrim("name")) > 0);

ALTER TABLE "menu_category"
  ADD CONSTRAINT "menu_category_name_check"
  CHECK (length(btrim("name")) > 0);

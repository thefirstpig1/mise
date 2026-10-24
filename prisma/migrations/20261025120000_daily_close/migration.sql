-- ============================================================
-- Kong 2026-10-25 — ปิดร้านประจำวัน (daily close), an add-on a shop turns on.
-- Brief 91qf84tZN7oT349Wzw2bfE, mockup L7xH4nsUVuc5xGwZocrrEj, ADR 0042.
--
-- * The till total stays where it is (sales_day.pulse_*, ADR 0020); the guest
--   count joins it there, with where it came from.
-- * daily_close holds the cash count; every figure is nullable — a blank is
--   "not recorded", never zero.
-- * The customer-type split is an ESTIMATE in tenths ("out of 10 customers"),
--   never a head count — so it is stored as parts 1..10, not people.
-- * Comments are append-only (no updated_at, no deleted_at): they are the
--   history a manager tracks back through.
-- RLS: enable_rls.sql / enforce_rls.sql (manual SQL, applied every release).
-- ============================================================

CREATE TYPE "guest_count_source" AS ENUM ('MANUAL', 'POS');
CREATE TYPE "daily_issue_category" AS ENUM ('OUT_OF_STOCK', 'EQUIPMENT', 'COMPLAINT', 'STAFF', 'OTHER');

ALTER TABLE "tenant" ADD COLUMN "daily_close_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sales_day" ADD COLUMN "guest_count" INTEGER,
  ADD COLUMN "guest_count_source" "guest_count_source";
ALTER TABLE "sales_day" ADD CONSTRAINT "sales_day_guest_count_check" CHECK ("guest_count" IS NULL OR "guest_count" >= 0);

CREATE TABLE "customer_type" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_type_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_type_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "customer_type_tenant_id_idx" ON "customer_type"("tenant_id");

CREATE TABLE "daily_close" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "business_date" DATE NOT NULL,
  "cash_float" DECIMAL(15,2),
  "cash_sales" DECIMAL(15,2),
  "cash_counted" DECIMAL(15,2),
  "cash_note" TEXT,
  "closed_by" TEXT NOT NULL,
  "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_close_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_close_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_close_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_close_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_close_cash_check" CHECK (("cash_float" IS NULL OR "cash_float" >= 0) AND ("cash_sales" IS NULL OR "cash_sales" >= 0) AND ("cash_counted" IS NULL OR "cash_counted" >= 0))
);
CREATE UNIQUE INDEX "daily_close_branch_date_unique" ON "daily_close"("branch_id", "business_date");
CREATE INDEX "daily_close_tenant_id_idx" ON "daily_close"("tenant_id");

CREATE TABLE "daily_close_mix" (
  "tenant_id" UUID NOT NULL,
  "daily_close_id" UUID NOT NULL,
  "customer_type_id" UUID NOT NULL,
  "parts" INTEGER NOT NULL,
  CONSTRAINT "daily_close_mix_pkey" PRIMARY KEY ("daily_close_id", "customer_type_id"),
  CONSTRAINT "daily_close_mix_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_close_mix_daily_close_id_fkey" FOREIGN KEY ("daily_close_id") REFERENCES "daily_close"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_close_mix_customer_type_id_fkey" FOREIGN KEY ("customer_type_id") REFERENCES "customer_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_close_mix_parts_check" CHECK ("parts" BETWEEN 1 AND 10)
);
CREATE INDEX "daily_close_mix_tenant_id_idx" ON "daily_close_mix"("tenant_id");

CREATE TABLE "daily_issue" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "daily_close_id" UUID NOT NULL,
  "category" "daily_issue_category" NOT NULL,
  "body" TEXT NOT NULL,
  "follow_up" BOOLEAN NOT NULL DEFAULT false,
  "resolved_at" TIMESTAMP(3),
  "resolved_by" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_issue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_issue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_issue_daily_close_id_fkey" FOREIGN KEY ("daily_close_id") REFERENCES "daily_close"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_issue_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_issue_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "daily_issue_tenant_id_idx" ON "daily_issue"("tenant_id");
CREATE INDEX "daily_issue_close_idx" ON "daily_issue"("daily_close_id");

CREATE TABLE "daily_comment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "daily_close_id" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_comment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_comment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_comment_daily_close_id_fkey" FOREIGN KEY ("daily_close_id") REFERENCES "daily_close"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_comment_author_fkey" FOREIGN KEY ("author") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "daily_comment_tenant_id_idx" ON "daily_comment"("tenant_id");
CREATE INDEX "daily_comment_close_idx" ON "daily_comment"("daily_close_id", "created_at");

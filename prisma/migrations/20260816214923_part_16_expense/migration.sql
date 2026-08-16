-- CreateEnum
CREATE TYPE "expense_source" AS ENUM ('MANUAL', 'FROM_GOODS_RECEIPT');

-- CreateEnum
CREATE TYPE "expense_payment_status" AS ENUM ('UNPAID', 'PAID');

-- AlterTable
ALTER TABLE "goods_receipt" ADD COLUMN     "vat_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vat_rate_percent" DECIMAL(5,2),
ADD COLUMN     "vat_reclaimable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "expense" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID,
    "source" "expense_source" NOT NULL DEFAULT 'MANUAL',
    "source_gr_id" UUID,
    "recurring_expense_id" UUID,
    "period" TEXT,
    "bill_date" DATE NOT NULL,
    "bill_no" TEXT,
    "vat_invoice_no" TEXT,
    "subtotal_excl_vat" DECIMAL(15,2) NOT NULL,
    "vat_rate_percent" DECIMAL(5,2),
    "vat_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "is_price_vat_inclusive" BOOLEAN NOT NULL DEFAULT true,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "subject_to_wht" BOOLEAN NOT NULL DEFAULT false,
    "wht_rate_percent" DECIMAL(5,2),
    "wht_amount" DECIMAL(15,2),
    "wht_certificate_no" TEXT,
    "net_payment_amount" DECIMAL(15,2) NOT NULL,
    "payment_method" TEXT,
    "payment_status" "expense_payment_status" NOT NULL DEFAULT 'UNPAID',
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "category_id" UUID NOT NULL,
    "department_id" UUID,
    "product_id" UUID,
    "product_unit_id" UUID,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(15,3),
    "unit_price" DECIMAL(15,4),
    "total_price" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_expense" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "default_amount" DECIMAL(15,2) NOT NULL,
    "is_price_vat_inclusive" BOOLEAN NOT NULL DEFAULT true,
    "vat_rate_percent" DECIMAL(5,2),
    "subject_to_wht" BOOLEAN NOT NULL DEFAULT false,
    "wht_rate_percent" DECIMAL(5,2),
    "day_of_month" INTEGER NOT NULL,
    "start_period" TEXT NOT NULL,
    "end_period" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "recurring_expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_tenant_id_idx" ON "expense"("tenant_id");

-- CreateIndex
CREATE INDEX "expense_branch_date_idx" ON "expense"("branch_id", "bill_date");

-- CreateIndex
CREATE INDEX "expense_item_tenant_id_idx" ON "expense_item"("tenant_id");

-- CreateIndex
CREATE INDEX "expense_item_expense_idx" ON "expense_item"("expense_id");

-- CreateIndex
CREATE INDEX "recurring_expense_tenant_id_idx" ON "recurring_expense"("tenant_id");

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_source_gr_id_fkey" FOREIGN KEY ("source_gr_id") REFERENCES "goods_receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_recurring_expense_id_fkey" FOREIGN KEY ("recurring_expense_id") REFERENCES "recurring_expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_item" ADD CONSTRAINT "expense_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_item" ADD CONSTRAINT "expense_item_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_item" ADD CONSTRAINT "expense_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_item" ADD CONSTRAINT "expense_item_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_item" ADD CONSTRAINT "expense_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_item" ADD CONSTRAINT "expense_item_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Inline CHECK constraints (Part 16, ADR 0016)
-- ============================================================
-- Prisma cannot express CHECKs; they live here rather than in prisma/manual/,
-- which is reserved for what a migration file cannot write by hand. Precedent:
-- Part 10's sign check through Part 15's six.

-- Money is never negative on a bill. Zero IS allowed: a zero-rated or exempt
-- purchase is real, and so is a 0.00 VAT line on a non-VAT supplier's invoice.
ALTER TABLE expense
  ADD CONSTRAINT expense_amounts_check
  CHECK (
    subtotal_excl_vat >= 0
    AND vat_amount >= 0
    AND total_amount >= 0
    AND net_payment_amount >= 0
    AND (wht_amount IS NULL OR wht_amount >= 0)
  );

-- The source enum and its FK must agree in both directions. Without this a row
-- could claim to come from a receipt while pointing at nothing, or point at a
-- receipt while claiming to be hand-typed — and /cost reads spend from this
-- table, so a lie here is a lie in the executive view.
ALTER TABLE expense
  ADD CONSTRAINT expense_source_gr_check
  CHECK (
    (source = 'FROM_GOODS_RECEIPT' AND source_gr_id IS NOT NULL)
    OR (source = 'MANUAL' AND source_gr_id IS NULL)
  );

-- Withholding needs a rate to be computable, and a rate without the flag is a
-- number nobody applies.
ALTER TABLE expense
  ADD CONSTRAINT expense_wht_check
  CHECK (
    (subject_to_wht = false AND wht_rate_percent IS NULL AND wht_amount IS NULL)
    OR (subject_to_wht = true AND wht_rate_percent IS NOT NULL AND wht_amount IS NOT NULL)
  );

-- A paid bill must record WHEN — the same rule Part 11 applied to a sent order
-- and Part 15 to a closed count. A status with no timestamp behind it cannot be
-- reconciled against a bank statement.
ALTER TABLE expense
  ADD CONSTRAINT expense_paid_stamped_check
  CHECK (payment_status <> 'PAID' OR paid_at IS NOT NULL);

-- A recurring confirmation carries both halves of its identity or neither; the
-- partial unique that makes confirming idempotent is on the PAIR.
ALTER TABLE expense
  ADD CONSTRAINT expense_recurring_pair_check
  CHECK (
    (recurring_expense_id IS NULL AND period IS NULL)
    OR (recurring_expense_id IS NOT NULL AND period IS NOT NULL)
  );

-- "YYYY-MM". A period is a label, not a timestamp — there is no timezone
-- question to get wrong, but there is a format one.
ALTER TABLE expense
  ADD CONSTRAINT expense_period_format_check
  CHECK (period IS NULL OR period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE expense_item
  ADD CONSTRAINT expense_item_amounts_check
  CHECK (
    total_price >= 0
    AND (qty IS NULL OR qty >= 0)
    AND (unit_price IS NULL OR unit_price >= 0)
    AND line_no > 0
  );

-- Capped at 28 deliberately: a template due on the 30th would skip February,
-- and a template that silently skips a month is worse than one that lands early.
ALTER TABLE recurring_expense
  ADD CONSTRAINT recurring_expense_day_check
  CHECK (day_of_month BETWEEN 1 AND 28);

ALTER TABLE recurring_expense
  ADD CONSTRAINT recurring_expense_amount_check
  CHECK (default_amount >= 0);

ALTER TABLE recurring_expense
  ADD CONSTRAINT recurring_expense_period_check
  CHECK (
    start_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    AND (end_period IS NULL OR end_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    AND (end_period IS NULL OR end_period >= start_period)
  );

-- Part 16 Q2 on the receipt: VAT is never negative, and an amount without a rate
-- is a number with no explanation.
ALTER TABLE goods_receipt
  ADD CONSTRAINT goods_receipt_vat_check
  CHECK (
    vat_amount >= 0
    AND (vat_rate_percent IS NOT NULL OR vat_amount = 0)
  );

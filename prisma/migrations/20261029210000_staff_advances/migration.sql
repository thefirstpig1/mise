-- ADR 0037 Q5–Q6 (Kong 2026-10-29: "mockup สำรองจ่าย ดูดีเอาตามนี้" + approved
-- the new tables; "เอาตามแนะนำทั้ง 4 ข้อ"). A staff member pays for something,
-- photographs the bill and the slip, and the shop pays them back.
--   stored_file      the photos — bytes in object storage, never here
--   expense_payment  how ONE bill was paid; STAFF = the shop owes that person
--   staff_refund     the shop paying one person back for several payments
-- Pre-existing drift (daily_issue / waste_log FKs, uuid defaults) is left out
-- on purpose, as in every migration since Part 38.

-- CreateEnum
CREATE TYPE "stored_file_kind" AS ENUM ('BILL', 'PAYMENT_SLIP', 'REFUND_SLIP');

-- CreateEnum
CREATE TYPE "payment_payer" AS ENUM ('SHOP', 'STAFF');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('TRANSFER', 'CASH', 'CARD', 'OTHER');

-- AlterTable
ALTER TABLE "expense" ADD COLUMN     "vendor_name" TEXT;

-- AlterTable
ALTER TABLE "goods_receipt_item" ADD COLUMN     "purchase_request_line_id" UUID;

-- AlterTable
ALTER TABLE "supplier" ADD COLUMN     "is_walk_in" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "refund_approval_all" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refund_approval_over" DECIMAL(15,2);

-- CreateTable
CREATE TABLE "stored_file" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "stored_file_kind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "original_name" TEXT,
    "expense_id" UUID,
    "expense_payment_id" UUID,
    "staff_refund_id" UUID,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "stored_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "payer" "payment_payer" NOT NULL,
    "paid_by_user_id" TEXT,
    "method" "payment_method" NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "no_slip_reason" TEXT,
    "endorsed_at" TIMESTAMP(3),
    "endorsed_by" TEXT,
    "endorse_note" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "staff_refund_id" UUID,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "expense_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_refund" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "method" "payment_method" NOT NULL,
    "refunded_at" TIMESTAMP(3) NOT NULL,
    "refunded_by" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "staff_refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stored_file_tenant_id_idx" ON "stored_file"("tenant_id");

-- CreateIndex
CREATE INDEX "stored_file_sha_idx" ON "stored_file"("tenant_id", "sha256");

-- CreateIndex
CREATE INDEX "stored_file_expense_idx" ON "stored_file"("expense_id");

-- CreateIndex
CREATE INDEX "stored_file_payment_idx" ON "stored_file"("expense_payment_id");

-- CreateIndex
CREATE INDEX "stored_file_refund_idx" ON "stored_file"("staff_refund_id");

-- CreateIndex
CREATE INDEX "expense_payment_tenant_id_idx" ON "expense_payment"("tenant_id");

-- CreateIndex
CREATE INDEX "expense_payment_payer_idx" ON "expense_payment"("tenant_id", "paid_by_user_id");

-- CreateIndex
CREATE INDEX "expense_payment_refund_idx" ON "expense_payment"("staff_refund_id");

-- CreateIndex
CREATE INDEX "staff_refund_tenant_id_idx" ON "staff_refund"("tenant_id");

-- CreateIndex
CREATE INDEX "staff_refund_to_idx" ON "staff_refund"("tenant_id", "to_user_id");

-- AddForeignKey
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_purchase_request_line_id_fkey" FOREIGN KEY ("purchase_request_line_id") REFERENCES "purchase_request_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_expense_payment_id_fkey" FOREIGN KEY ("expense_payment_id") REFERENCES "expense_payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_staff_refund_id_fkey" FOREIGN KEY ("staff_refund_id") REFERENCES "staff_refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_staff_refund_id_fkey" FOREIGN KEY ("staff_refund_id") REFERENCES "staff_refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_paid_by_user_id_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_endorsed_by_fkey" FOREIGN KEY ("endorsed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_refund" ADD CONSTRAINT "staff_refund_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_refund" ADD CONSTRAINT "staff_refund_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_refund" ADD CONSTRAINT "staff_refund_refunded_by_fkey" FOREIGN KEY ("refunded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_refund" ADD CONSTRAINT "staff_refund_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------- what the columns above cannot say ----------

-- A file belongs to at most one document (none between upload and save).
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_one_owner"
  CHECK (num_nonnulls("expense_id", "expense_payment_id", "staff_refund_id") <= 1);
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_size_check" CHECK ("byte_size" > 0);

-- A staff payment names the person; the shop's own money names nobody, and is
-- never repaid to anyone.
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_payer_check"
  CHECK (("payer" = 'STAFF') = ("paid_by_user_id" IS NOT NULL));
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_refund_staff_only"
  CHECK ("staff_refund_id" IS NULL OR "payer" = 'STAFF');
ALTER TABLE "expense_payment" ADD CONSTRAINT "expense_payment_amount_check" CHECK ("amount" > 0);

ALTER TABLE "staff_refund" ADD CONSTRAINT "staff_refund_amount_check" CHECK ("amount" > 0);
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_refund_approval_over_check"
  CHECK ("refund_approval_over" IS NULL OR "refund_approval_over" > 0);

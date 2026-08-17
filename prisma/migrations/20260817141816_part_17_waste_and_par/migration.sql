-- CreateEnum
CREATE TYPE "waste_reason" AS ENUM ('SPOILED', 'DAMAGED', 'COOKING_ERROR', 'CUSTOMER_RETURN', 'OTHER');

-- AlterEnum
ALTER TYPE "source_type" ADD VALUE 'WASTE_LOG';

-- CreateTable
CREATE TABLE "waste_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "reason" "waste_reason" NOT NULL,
    "input_qty" DECIMAL(15,3) NOT NULL,
    "input_unit_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "wasted_by" TEXT NOT NULL,
    "wasted_by_name" TEXT,
    "notes" TEXT,
    "reversal_of_id" UUID,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "par_level" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "par_qty" DECIMAL(15,3) NOT NULL,
    "input_qty" DECIMAL(15,3) NOT NULL,
    "input_unit_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "par_level_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waste_log_tenant_id_idx" ON "waste_log"("tenant_id");

-- CreateIndex
CREATE INDEX "waste_log_branch_occurred_idx" ON "waste_log"("branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "waste_log_product_branch_idx" ON "waste_log"("product_id", "branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "par_level_tenant_id_idx" ON "par_level"("tenant_id");

-- CreateIndex
CREATE INDEX "par_level_branch_idx" ON "par_level"("branch_id");

-- AddForeignKey
ALTER TABLE "waste_log" ADD CONSTRAINT "waste_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_log" ADD CONSTRAINT "waste_log_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_log" ADD CONSTRAINT "waste_log_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_log" ADD CONSTRAINT "waste_log_input_unit_id_fkey" FOREIGN KEY ("input_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_log" ADD CONSTRAINT "waste_log_wasted_by_fkey" FOREIGN KEY ("wasted_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_log" ADD CONSTRAINT "waste_log_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_log" ADD CONSTRAINT "waste_log_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "waste_log"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "par_level" ADD CONSTRAINT "par_level_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "par_level" ADD CONSTRAINT "par_level_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "par_level" ADD CONSTRAINT "par_level_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "par_level" ADD CONSTRAINT "par_level_input_unit_id_fkey" FOREIGN KEY ("input_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Inline CHECK constraints (Part 17, ADR 0017)
-- ============================================================
-- Prisma cannot express CHECKs; they live here rather than in prisma/manual/,
-- which is reserved for what a migration file cannot write by hand (partial
-- index / NULLS NOT DISTINCT / CREATE EXTENSION). Precedent: Part 10's sign
-- check, Part 11's five range checks, Part 14's three, Part 15's five.
--
-- NOTE on the single migration: 'WASTE_LOG' is only ADDED to source_type above,
-- never referenced as a literal by anything below, so Postgres does not need the
-- two-step Part 13 used for movement_type. Parts 15 and 16 both confirmed this.

-- input_qty is a MAGNITUDE. Direction is carried by reversal_of_id — an original
-- posts ADJUST_LOSS, its reversal posts ADJUST_GAIN — so a negative here would be
-- a second, contradictory way of saying the same thing. Zero is refused too:
-- throwing away nothing is not an event.
ALTER TABLE waste_log
  ADD CONSTRAINT waste_log_input_qty_check
  CHECK (input_qty > 0);

-- A void records WHO, or it is not a void. Same family as Part 15's
-- stock_count_voided_stamped_check: without it a bug could leave a row that
-- claims to be voided with nobody attached, and no read would notice.
ALTER TABLE waste_log
  ADD CONSTRAINT waste_log_voided_stamped_check
  CHECK ((voided_at IS NULL) = (voided_by IS NULL));

-- A reversal row cannot itself be voided. Voiding a void has no meaning in an
-- append-only ledger: the correct move is a NEW waste entry, not a chain of
-- compensations nobody can read back.
ALTER TABLE waste_log
  ADD CONSTRAINT waste_log_reversal_not_voided_check
  CHECK (reversal_of_id IS NULL OR voided_at IS NULL);

-- A par of 0 means "no par", and "no par" is the ABSENCE of a row — otherwise the
-- below-par list would report every product with a zero par as permanently short.
-- Removing a par soft-deletes the row instead (ADR 0017 Q5).
ALTER TABLE par_level
  ADD CONSTRAINT par_level_qty_check
  CHECK (par_qty > 0 AND input_qty > 0);

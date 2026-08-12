-- CreateEnum
CREATE TYPE "movement_type" AS ENUM ('PO_RECEIVE', 'ADJUST_GAIN', 'ADJUST_LOSS');

-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('GR_LINE', 'ADJUSTMENT', 'SYSTEM_INITIAL');

-- CreateEnum
CREATE TYPE "adjustment_reason" AS ENUM ('RECOUNT', 'SPOILAGE', 'DAMAGE', 'OTHER');

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "type" "movement_type" NOT NULL,
    "source_type" "source_type" NOT NULL,
    "source_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" "movement_type" NOT NULL,
    "reason" "adjustment_reason" NOT NULL,
    "input_qty" DECIMAL(15,3) NOT NULL,
    "input_unit_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "stock_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movement_branch_audit_idx" ON "stock_movement"("branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movement_chronological_idx" ON "stock_movement"("product_id", "branch_id", "occurred_at", "created_at");

-- CreateIndex
CREATE INDEX "stock_movement_tenant_id_idx" ON "stock_movement"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_source_unique" ON "stock_movement"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_tenant_id_idx" ON "stock_adjustment"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_product_branch_idx" ON "stock_adjustment"("product_id", "branch_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_input_unit_id_fkey" FOREIGN KEY ("input_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Part 10 (ADR 0011 Q2 / Q10) — CHECK constraints, hand-added below the
-- Prisma-generated block above.
-- ============================================================
-- Prisma 5.22 cannot express a CHECK in schema.prisma, so it is written INLINE
-- here — precedent: product_density_xor in
-- 20260529151309_part_7d_density_data_capture.
--
-- Why INLINE and not prisma/manual/: manual/ is reserved for what a hand-edited
-- migration.sql CANNOT express (partial indexes, NULLS NOT DISTINCT,
-- CREATE EXTENSION). A CHECK can be written here, and being here means
-- `prisma migrate reset` / a fresh clone gets the constraint automatically
-- instead of depending on someone remembering a second manual command.
-- (ADR 0011 Q2 originally specified a manual file citing a Sprint 1 "mapping
-- effective_to > effective_from" CHECK that does not exist — corrected at L1.)
--
-- STANDING ITEM: every new MovementType in Sprint 3+ (WASTE, TRANSFER_*,
-- RECIPE_CONSUME) must DROP + re-declare stock_movement_sign_check via ALTER in
-- its own migration, or the new type's rows will be rejected.
-- ============================================================

-- Q2: sign bound to type on the ledger (an app bug cannot bypass it).
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_sign_check" CHECK (
  ("type" IN ('PO_RECEIVE', 'ADJUST_GAIN') AND "qty" > 0)
  OR ("type" = 'ADJUST_LOSS' AND "qty" < 0)
);

-- Q10: adjustments are ADJUST_GAIN | ADJUST_LOSS only (PO_RECEIVE is GR-only).
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_type_check" CHECK (
  "type" IN ('ADJUST_GAIN', 'ADJUST_LOSS')
);

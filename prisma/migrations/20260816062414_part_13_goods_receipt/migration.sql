-- CreateEnum
CREATE TYPE "goods_receipt_status" AS ENUM ('DRAFT', 'CONFIRMED', 'VOIDED');

-- NOTE: `ALTER TYPE "movement_type" ADD VALUE 'PO_RECEIVE_REVERSAL'` was moved
-- into its own earlier migration (20260816062400_part_13a_movement_type_reversal)
-- because Postgres will not let a new enum value be USED in the transaction that
-- added it — and the CHECK section at the tail of this file uses it.

-- AlterTable
ALTER TABLE "purchase_order" ADD COLUMN     "closed_short_at" TIMESTAMP(3),
ADD COLUMN     "closed_short_by" TEXT,
ADD COLUMN     "closed_short_reason" TEXT;

-- CreateTable
CREATE TABLE "goods_receipt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "gr_number" TEXT NOT NULL,
    "status" "goods_receipt_status" NOT NULL DEFAULT 'DRAFT',
    "invoice_no" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "received_by" TEXT NOT NULL,
    "notes" TEXT,
    "has_discrepancy" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "goods_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_item_id" UUID,
    "product_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "qty_received_actual" DECIMAL(15,3) NOT NULL,
    "received_unit_id" UUID NOT NULL,
    "received_unit_name" TEXT NOT NULL,
    "to_base_ratio" DECIMAL(15,6) NOT NULL,
    "unit_price_actual" DECIMAL(15,4) NOT NULL,
    "line_total_actual" DECIMAL(15,2) NOT NULL,
    "reversal_of_item_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_item_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "goods_receipt_item_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "qty_allocated_actual" DECIMAL(15,3) NOT NULL,
    "source_po_allocation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_item_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goods_receipt_tenant_id_idx" ON "goods_receipt"("tenant_id");

-- CreateIndex
CREATE INDEX "goods_receipt_tenant_status_idx" ON "goods_receipt"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "goods_receipt_branch_received_idx" ON "goods_receipt"("branch_id", "received_at");

-- CreateIndex
CREATE INDEX "goods_receipt_po_idx" ON "goods_receipt"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipt_supplier_idx" ON "goods_receipt"("supplier_id");

-- CreateIndex
CREATE INDEX "goods_receipt_item_tenant_id_idx" ON "goods_receipt_item"("tenant_id");

-- CreateIndex
CREATE INDEX "goods_receipt_item_parent_idx" ON "goods_receipt_item"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "goods_receipt_item_po_item_idx" ON "goods_receipt_item"("purchase_order_item_id");

-- CreateIndex
CREATE INDEX "goods_receipt_item_product_idx" ON "goods_receipt_item"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_item_line_unique" ON "goods_receipt_item"("goods_receipt_id", "line_no");

-- CreateIndex
CREATE INDEX "goods_receipt_item_allocation_tenant_id_idx" ON "goods_receipt_item_allocation"("tenant_id");

-- CreateIndex
CREATE INDEX "gr_item_allocation_dept_idx" ON "goods_receipt_item_allocation"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "gr_item_allocation_dept_unique" ON "goods_receipt_item_allocation"("goods_receipt_item_id", "department_id");

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_closed_short_by_fkey" FOREIGN KEY ("closed_short_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_received_unit_id_fkey" FOREIGN KEY ("received_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_reversal_of_item_id_fkey" FOREIGN KEY ("reversal_of_item_id") REFERENCES "goods_receipt_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item_allocation" ADD CONSTRAINT "goods_receipt_item_allocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item_allocation" ADD CONSTRAINT "goods_receipt_item_allocation_goods_receipt_item_id_fkey" FOREIGN KEY ("goods_receipt_item_id") REFERENCES "goods_receipt_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item_allocation" ADD CONSTRAINT "goods_receipt_item_allocation_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_item_allocation" ADD CONSTRAINT "goods_receipt_item_allocation_source_po_allocation_id_fkey" FOREIGN KEY ("source_po_allocation_id") REFERENCES "purchase_order_item_allocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Part 13 (ADR 0013) — CHECK constraints, hand-added below the Prisma block.
-- ============================================================
-- Same rule as Part 10 / 11: Prisma 5.22 cannot express a CHECK, so they live
-- INLINE here (prisma/manual/ is reserved for partial indexes, NULLS NOT
-- DISTINCT and CREATE EXTENSION). Every quantity and money column with a legal
-- range declares it, continuing the symmetry Part 11 restored.
-- ============================================================

-- Q6: the sign rule that makes a reversal line legible at the database.
-- A normal line receives something (> 0); a reversal line gives it back (< 0).
-- Zero is excluded on both sides — a line that moved nothing has no reason to
-- exist, and the ledger's own sign CHECK would reject its movement anyway.
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_sign_check" CHECK (
  ("reversal_of_item_id" IS NULL AND "qty_received_actual" > 0)
  OR ("reversal_of_item_id" IS NOT NULL AND "qty_received_actual" < 0)
);

-- Snapshot + money on a line (Q3/Q7). line_total_actual follows the sign of the
-- quantity, so it is bounded by the same fork rather than by >= 0.
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_amount_check" CHECK (
  "to_base_ratio" > 0
  AND "unit_price_actual" >= 0
  AND (
    ("reversal_of_item_id" IS NULL AND "line_total_actual" >= 0)
    OR ("reversal_of_item_id" IS NOT NULL AND "line_total_actual" <= 0)
  )
);

-- Allocations mirror their parent line's sign; the SUM = line qty invariant is
-- enforced in the write transaction (ADR 0012 Q2 / ADR 0013 Consequence 7).
ALTER TABLE "goods_receipt_item_allocation" ADD CONSTRAINT "gr_item_allocation_qty_check" CHECK (
  "qty_allocated_actual" <> 0
);

-- Q2/Q6: a receipt that posted to the ledger must record WHEN it was confirmed,
-- and a voided one must additionally record when it was reversed. This is the
-- status machine restated at the database, mirroring purchase_order_sent_at_check.
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_confirmed_at_check" CHECK (
  ("status" = 'DRAFT' AND "confirmed_at" IS NULL AND "voided_at" IS NULL)
  OR ("status" = 'CONFIRMED' AND "confirmed_at" IS NOT NULL AND "voided_at" IS NULL)
  OR ("status" = 'VOIDED' AND "confirmed_at" IS NOT NULL AND "voided_at" IS NOT NULL)
);

-- Q6: only a DRAFT may be soft-deleted. A confirmed receipt is voided and stays
-- visible forever — it moved stock, and the ledger row that proves it is immortal.
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_soft_delete_check" CHECK (
  "deleted_at" IS NULL OR "status" = 'DRAFT'
);

-- ------------------------------------------------------------
-- Ledger: re-declare the sign CHECK for the new movement type.
-- ------------------------------------------------------------
-- The standing item ADR 0011 Q2 recorded: "every new movement type must DROP +
-- re-declare this CHECK via ALTER inside its own migration, or rows of the new
-- type are rejected." PO_RECEIVE_REVERSAL is the first one to come due.
-- (The enum value itself was added in 20260816062400 — Postgres will not let a
-- new enum value be used in the transaction that created it.)
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_sign_check";

ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_sign_check" CHECK (
  ("type" IN ('PO_RECEIVE', 'ADJUST_GAIN') AND "qty" > 0)
  OR ("type" IN ('PO_RECEIVE_REVERSAL', 'ADJUST_LOSS') AND "qty" < 0)
);

/*
  Warnings:

  - Made the column `code` on table `branch` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "purchase_order_status" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "branch" ALTER COLUMN "code" SET NOT NULL;

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "status" "purchase_order_status" NOT NULL DEFAULT 'DRAFT',
    "expected_delivery_date" DATE,
    "subtotal_excl_vat" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "vat_rate_percent" DECIMAL(5,2),
    "vat_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "sent_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "qty_ordered" DECIMAL(15,3) NOT NULL,
    "order_unit_id" UUID NOT NULL,
    "order_unit_name" TEXT NOT NULL,
    "to_base_ratio" DECIMAL(15,6) NOT NULL,
    "unit_price" DECIMAL(15,4) NOT NULL,
    "line_total" DECIMAL(15,2) NOT NULL,
    "supplier_product_mapping_id" UUID,
    "qty_received" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_item_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "qty_allocated" DECIMAL(15,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_item_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_order_tenant_id_idx" ON "purchase_order"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_order_tenant_status_idx" ON "purchase_order"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "purchase_order_branch_status_idx" ON "purchase_order"("branch_id", "status");

-- CreateIndex
CREATE INDEX "purchase_order_supplier_idx" ON "purchase_order"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_order_item_tenant_id_idx" ON "purchase_order_item"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_order_item_parent_idx" ON "purchase_order_item"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_item_product_idx" ON "purchase_order_item"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_item_line_unique" ON "purchase_order_item"("purchase_order_id", "line_no");

-- CreateIndex
CREATE INDEX "purchase_order_item_allocation_tenant_id_idx" ON "purchase_order_item_allocation"("tenant_id");

-- CreateIndex
CREATE INDEX "po_item_allocation_dept_idx" ON "purchase_order_item_allocation"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "po_item_allocation_dept_unique" ON "purchase_order_item_allocation"("purchase_order_item_id", "department_id");

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_order_unit_id_fkey" FOREIGN KEY ("order_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_supplier_product_mapping_id_fkey" FOREIGN KEY ("supplier_product_mapping_id") REFERENCES "supplier_product_mapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item_allocation" ADD CONSTRAINT "purchase_order_item_allocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item_allocation" ADD CONSTRAINT "purchase_order_item_allocation_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_item_allocation" ADD CONSTRAINT "purchase_order_item_allocation_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Part 11 (ADR 0012) — CHECK constraints, hand-added below the Prisma block.
-- ============================================================
-- Prisma 5.22 cannot express a CHECK, so these are written INLINE here rather
-- than in prisma/manual/ — precedent: stock_movement_sign_check (Part 10) and
-- product_density_xor (Part 7d). Inline means a fresh clone / migrate reset
-- picks them up without anyone remembering a second command.
--
-- The Part 10 post-completion review flagged that stock_adjustment.input_qty
-- shipped with NO positivity CHECK while the ledger had a full sign CHECK. That
-- asymmetry is not repeated here: every quantity and money column that has a
-- legal range gets it declared at the database.
-- ============================================================

-- Quantities and money on a line. A zero-qty order line is meaningless; a
-- negative one would silently invert a receipt in Part 13.
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_qty_check" CHECK (
  "qty_ordered" > 0
  AND "to_base_ratio" > 0
  AND "unit_price" >= 0
  AND "line_total" >= 0
  AND "qty_received" >= 0
);

-- Allocation rows split a positive quantity; the SUM = qty_ordered invariant
-- itself is enforced in the write transaction (ADR 0012 Q2 — no H.2 trigger).
ALTER TABLE "purchase_order_item_allocation" ADD CONSTRAINT "po_item_allocation_qty_check" CHECK (
  "qty_allocated" > 0
);

-- Header money: totals are never negative, and a VAT rate is a percentage.
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_amount_check" CHECK (
  "subtotal_excl_vat" >= 0
  AND "vat_amount" >= 0
  AND "total_amount" >= 0
  AND ("vat_rate_percent" IS NULL OR ("vat_rate_percent" >= 0 AND "vat_rate_percent" <= 100))
);

-- Q4: a document that has been sent must record WHEN. CANCELLED is excluded
-- because a DRAFT can be cancelled without ever having been sent.
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_sent_at_check" CHECK (
  "status" NOT IN ('SENT', 'PARTIALLY_RECEIVED', 'RECEIVED') OR "sent_at" IS NOT NULL
);

-- Q9: only a DRAFT may be soft-deleted. Anything that left the building is
-- cancelled, never hidden.
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_soft_delete_check" CHECK (
  "deleted_at" IS NULL OR "status" = 'DRAFT'
);

-- CreateEnum
CREATE TYPE "cost_source" AS ENUM ('FRONT_LAYER', 'DECLARED', 'LAST_KNOWN', 'UNPRICED');

-- CreateEnum
CREATE TYPE "stock_transfer_status" AS ENUM ('SENT', 'RECEIVED', 'VOIDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "source_type" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "source_type" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "source_type" ADD VALUE 'TRANSFER_SHORTAGE';

-- CreateTable
CREATE TABLE "stock_transfer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "tf_number" TEXT NOT NULL,
    "status" "stock_transfer_status" NOT NULL DEFAULT 'SENT',
    "dispatched_at" TIMESTAMP(3) NOT NULL,
    "dispatched_by" TEXT NOT NULL,
    "dispatched_by_name" TEXT,
    "driver_user_id" TEXT,
    "driver_name" TEXT,
    "driver_confirmed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "received_by" TEXT,
    "received_by_name" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "qty_sent" DECIMAL(15,3) NOT NULL,
    "qty_received" DECIMAL(15,3),
    "input_unit_id" UUID NOT NULL,
    "input_unit_name" TEXT NOT NULL,
    "to_base_ratio" DECIMAL(15,6) NOT NULL,
    "cost_total" DECIMAL(15,2) NOT NULL,
    "cost_source" "cost_source" NOT NULL,
    "reversal_of_item_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_transfer_tenant_id_idx" ON "stock_transfer"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_transfer_from_dispatched_idx" ON "stock_transfer"("from_branch_id", "dispatched_at");

-- CreateIndex
CREATE INDEX "stock_transfer_to_status_idx" ON "stock_transfer"("to_branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_number_unique" ON "stock_transfer"("tenant_id", "tf_number");

-- CreateIndex
CREATE INDEX "stock_transfer_item_tenant_id_idx" ON "stock_transfer_item"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_transfer_item_parent_idx" ON "stock_transfer_item"("stock_transfer_id");

-- CreateIndex
CREATE INDEX "stock_transfer_item_product_idx" ON "stock_transfer_item"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_item_line_unique" ON "stock_transfer_item"("stock_transfer_id", "line_no");

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_dispatched_by_fkey" FOREIGN KEY ("dispatched_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_item" ADD CONSTRAINT "stock_transfer_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_item" ADD CONSTRAINT "stock_transfer_item_stock_transfer_id_fkey" FOREIGN KEY ("stock_transfer_id") REFERENCES "stock_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_item" ADD CONSTRAINT "stock_transfer_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_item" ADD CONSTRAINT "stock_transfer_item_input_unit_id_fkey" FOREIGN KEY ("input_unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_item" ADD CONSTRAINT "stock_transfer_item_reversal_of_item_id_fkey" FOREIGN KEY ("reversal_of_item_id") REFERENCES "stock_transfer_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Inline CHECK constraints (Part 18, ADR 0018)
-- ============================================================
-- Prisma cannot express CHECKs, so they live here rather than in prisma/manual/ —
-- the precedent is stock_movement_sign_check (Part 10) and waste_log's four
-- (Part 17). prisma/manual/ is reserved for what a hand-written migration.sql
-- cannot do at all: partial indexes, NULLS NOT DISTINCT, CREATE EXTENSION.
-- ============================================================

-- A transfer to itself is not a transfer. Without this, a mis-set dropdown posts
-- an equal and opposite pair of movements at one branch: the balance is right,
-- the history is nonsense, and the ledger is append-only so it stays that way.
ALTER TABLE "stock_transfer"
  ADD CONSTRAINT stock_transfer_branch_differs_check
  CHECK (from_branch_id <> to_branch_id);

-- An event records WHO or it did not happen. Same rule as waste_log's void.
ALTER TABLE "stock_transfer"
  ADD CONSTRAINT stock_transfer_received_stamped_check
  CHECK ((received_at IS NULL) = (received_by IS NULL));

ALTER TABLE "stock_transfer"
  ADD CONSTRAINT stock_transfer_voided_stamped_check
  CHECK ((voided_at IS NULL) = (voided_by IS NULL));

-- The status may never claim more than the timestamps can support. Deliberately
-- one-directional: a VOIDED transfer may ALSO carry received_at, because Q6
-- allows voiding after receipt and that receipt really did happen.
ALTER TABLE "stock_transfer"
  ADD CONSTRAINT stock_transfer_status_received_check
  CHECK (status <> 'RECEIVED' OR received_at IS NOT NULL);

ALTER TABLE "stock_transfer"
  ADD CONSTRAINT stock_transfer_status_voided_check
  CHECK (status <> 'VOIDED' OR voided_at IS NOT NULL);

-- A driver confirmation attached to nobody is not a confirmation (Q3). Either
-- side satisfies it: the free-text name today, the FK the day a company driver
-- signs in for themselves.
ALTER TABLE "stock_transfer"
  ADD CONSTRAINT stock_transfer_driver_confirmed_check
  CHECK (
    driver_confirmed_at IS NULL
    OR driver_name IS NOT NULL
    OR driver_user_id IS NOT NULL
  );

-- Direction comes from reversal_of_item_id, never from a hand-typed sign —
-- goods_receipt_item_sign_check's rule, applied to the same shape.
ALTER TABLE "stock_transfer_item"
  ADD CONSTRAINT stock_transfer_item_sign_check
  CHECK (
    (reversal_of_item_id IS NULL AND qty_sent > 0)
    OR (reversal_of_item_id IS NOT NULL AND qty_sent < 0)
  );

-- NULL is a real state here: nobody has counted yet (Q2). 0 is a different real
-- state: someone counted and nothing arrived.
ALTER TABLE "stock_transfer_item"
  ADD CONSTRAINT stock_transfer_item_received_sign_check
  CHECK (
    qty_received IS NULL
    OR (reversal_of_item_id IS NULL AND qty_received >= 0)
    OR (reversal_of_item_id IS NOT NULL AND qty_received <= 0)
  );

-- Receiving MORE than was dispatched is refused. A shortfall has a posting, a
-- cost and a name attached (TRANSFER_SHORTAGE); a surplus has none of the three,
-- because no stock was created by driving a truck. It means one of the two counts
-- is wrong, which is a conversation rather than a ledger entry.
ALTER TABLE "stock_transfer_item"
  ADD CONSTRAINT stock_transfer_item_received_le_sent_check
  CHECK (qty_received IS NULL OR abs(qty_received) <= abs(qty_sent));

-- The frozen money moves with the goods, so it carries the goods' sign (Q5).
-- >= / <= rather than > / <: an UNPRICED product legitimately freezes 0.00, which
-- is exactly why cost_source is stored beside it.
ALTER TABLE "stock_transfer_item"
  ADD CONSTRAINT stock_transfer_item_cost_sign_check
  CHECK (
    (qty_sent > 0 AND cost_total >= 0)
    OR (qty_sent < 0 AND cost_total <= 0)
  );

-- A zero or negative ratio would send a negative quantity to the ledger from a
-- positive entry, straight past the sign check above.
ALTER TABLE "stock_transfer_item"
  ADD CONSTRAINT stock_transfer_item_ratio_check
  CHECK (to_base_ratio > 0);

-- ============================================================
-- Ledger: re-declare the sign CHECK for the four new movement types
-- ============================================================
-- The standing item ADR 0011 Q2 recorded: "every new movement type must DROP +
-- re-declare this CHECK via ALTER inside its own migration, or rows of the new
-- type are rejected." PO_RECEIVE_REVERSAL came due in Part 13; these four come
-- due here, and they are the last of Sprint 3 (RECIPE_CONSUME is Sprint 5).
--
-- (The enum values themselves were added in 20260818144758 — Postgres will not
-- let a new enum value be used in the transaction that created it.)
--
-- Read the two lists as directions, not as bookkeeping: stock ARRIVES on a
-- TRANSFER_IN and on the reversal of a dispatch; stock LEAVES on a TRANSFER_OUT
-- and on the reversal of an arrival.
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_sign_check";

ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_sign_check" CHECK (
  ("type" IN ('PO_RECEIVE', 'ADJUST_GAIN', 'TRANSFER_IN', 'TRANSFER_OUT_REVERSAL') AND "qty" > 0)
  OR ("type" IN ('PO_RECEIVE_REVERSAL', 'ADJUST_LOSS', 'TRANSFER_OUT', 'TRANSFER_IN_REVERSAL') AND "qty" < 0)
);

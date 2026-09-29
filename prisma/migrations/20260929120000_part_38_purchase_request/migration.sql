-- ============================================================
-- Part 38 — purchase request  (ADR 0036)
-- ============================================================
-- The kitchen's always-open list of what a branch needs, split by a purchaser
-- into POs per supplier. Three new tables, one nullable pointer on the PO line,
-- and the history of a supplier's promised delivery date.
--
-- BACKFILL. Every existing order that carries an expected date gets that date
-- as its first (and only) promise, set by whoever sent the order — or created
-- it, if it was never sent — at that moment. purchase_order.expected_delivery_date
-- is kept and stays the mirror of the latest promise, so nothing that reads it
-- (the par "ตามของ" state, the order list) changes.
--
-- RLS for the four new tables lives in prisma/manual/enable_rls.sql and
-- enforce_rls.sql, applied by the release command.
-- ============================================================

-- AlterTable
ALTER TABLE "purchase_order_item" ADD COLUMN     "purchase_request_line_id" UUID;

-- CreateTable
CREATE TABLE "purchase_order_delivery_promise" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "promised_date" DATE NOT NULL,
    "note" TEXT,
    "set_by" TEXT NOT NULL,
    "set_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_delivery_promise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "unit_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "supplier_id" UUID,
    "on_hand_qty" DECIMAL(15,3),
    "note" TEXT,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejected_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "purchase_request_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_message" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_request_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_ready" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "ready_by" TEXT NOT NULL,
    "ready_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_request_ready_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_order_delivery_promise_tenant_id_idx" ON "purchase_order_delivery_promise"("tenant_id");

-- CreateIndex
CREATE INDEX "po_delivery_promise_po_idx" ON "purchase_order_delivery_promise"("purchase_order_id", "set_at");

-- CreateIndex
CREATE INDEX "purchase_request_line_tenant_id_idx" ON "purchase_request_line"("tenant_id");

-- CreateIndex
CREATE INDEX "pr_line_branch_idx" ON "purchase_request_line"("branch_id", "deleted_at");

-- CreateIndex
CREATE INDEX "pr_line_product_idx" ON "purchase_request_line"("product_id");

-- CreateIndex
CREATE INDEX "purchase_request_message_tenant_id_idx" ON "purchase_request_message"("tenant_id");

-- CreateIndex
CREATE INDEX "pr_message_line_idx" ON "purchase_request_message"("line_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_request_ready_tenant_id_idx" ON "purchase_request_ready"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pr_ready_branch_dept_unique" ON "purchase_request_ready"("branch_id", "department_id");

-- CreateIndex
CREATE INDEX "purchase_order_item_request_line_idx" ON "purchase_order_item"("purchase_request_line_id");

-- AddForeignKey
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_purchase_request_line_id_fkey" FOREIGN KEY ("purchase_request_line_id") REFERENCES "purchase_request_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_delivery_promise" ADD CONSTRAINT "purchase_order_delivery_promise_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_delivery_promise" ADD CONSTRAINT "purchase_order_delivery_promise_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_delivery_promise" ADD CONSTRAINT "purchase_order_delivery_promise_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "product_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_message" ADD CONSTRAINT "purchase_request_message_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_message" ADD CONSTRAINT "purchase_request_message_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "purchase_request_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_message" ADD CONSTRAINT "purchase_request_message_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_ready" ADD CONSTRAINT "purchase_request_ready_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_ready" ADD CONSTRAINT "purchase_request_ready_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_ready" ADD CONSTRAINT "purchase_request_ready_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_ready" ADD CONSTRAINT "purchase_request_ready_ready_by_fkey" FOREIGN KEY ("ready_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: one promise per order that already has an expected date.
INSERT INTO "purchase_order_delivery_promise" ("id", "tenant_id", "purchase_order_id", "promised_date", "set_by", "set_at")
SELECT gen_random_uuid(), po."tenant_id", po."id", po."expected_delivery_date",
       COALESCE(po."sent_by", po."created_by"), COALESCE(po."sent_at", po."created_at")
FROM "purchase_order" po
WHERE po."expected_delivery_date" IS NOT NULL;

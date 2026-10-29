-- ============================================================
-- Part 40 — making prepped stock, and trim recipes  (ADR 0040)
-- ============================================================
-- Four tables of documents and one of record:
--   production / production_item  — one act of making, at one branch (Q3).
--                                  Each item posts ONE movement; a void appends
--                                  reversal items into the same document.
--   trim_recipe / trim_recipe_part — how a whole thing is cut into parts (Q7).
--   prepped_shortfall             — "ระบบตัดแทน" (Q1): the days a sale or a staff
--                                  meal cut raw ingredients because the prepped
--                                  item was not on the shelf. Recorded because
--                                  the Q5 re-post has to find them.
--
-- NO MONEY IS STORED ANYWHERE IN THIS PART (Q4, ADR 0014). value_share_pct is a
-- percentage — a decision made when the fish was cut — not an amount.
--
-- Also: tenant.count_show_expected_default (Q2), and the two product columns
-- reserved since Sprint 1 for joint costing, which never had a reader or a
-- writer and whose job moved onto trim_recipe_part (Consequence 5).
--
-- Deliberately NOT in this file: drift `prisma migrate diff` reports on
-- daily_issue / waste_log foreign keys and five id defaults. It predates this
-- Part and has nothing to do with it.
-- ============================================================

-- CreateEnum
CREATE TYPE "production_kind" AS ENUM ('PRODUCE', 'TRIM');

-- CreateEnum
CREATE TYPE "production_origin" AS ENUM ('MANUAL', 'STOCK_COUNT', 'WASTE', 'ADJUSTMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "production_item_role" AS ENUM ('INPUT', 'OUTPUT');

-- AlterTable
ALTER TABLE "product" DROP COLUMN "expected_yield_g",
DROP COLUMN "target_market_price";

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "count_show_expected_default" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "production" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "pd_number" TEXT NOT NULL,
    "kind" "production_kind" NOT NULL,
    "origin" "production_origin" NOT NULL DEFAULT 'MANUAL',
    "origin_id" UUID,
    "produced_at" TIMESTAMP(3) NOT NULL,
    "recipe_id" UUID,
    "trim_recipe_id" UUID,
    "inputs_unconfirmed" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by" TEXT NOT NULL,
    "notes" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "production_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "role" "production_item_role" NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "input_qty" DECIMAL(15,3),
    "input_unit_id" UUID,
    "value_share_pct" DECIMAL(7,4),
    "reversal_of_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "production_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trim_recipe" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

CONSTRAINT "trim_recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trim_recipe_part" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "trim_recipe_id" UUID NOT NULL,
    "product_id" UUID,
    "label" TEXT,
    "weight_pct" DECIMAL(7,4) NOT NULL,
    "value_pct" DECIMAL(7,4) NOT NULL,
    "value_locked" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),

CONSTRAINT "trim_recipe_part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepped_shortfall" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "sales_consumption_run_id" UUID,
    "staff_meal_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "prepped_shortfall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_tenant_id_idx" ON "production"("tenant_id");

-- CreateIndex
CREATE INDEX "production_branch_time_idx" ON "production"("branch_id", "produced_at");

-- CreateIndex
CREATE UNIQUE INDEX "production_number_unique" ON "production"("tenant_id", "pd_number");

-- CreateIndex
CREATE INDEX "production_item_tenant_id_idx" ON "production_item"("tenant_id");

-- CreateIndex
CREATE INDEX "production_item_production_idx" ON "production_item"("production_id");

-- CreateIndex
CREATE INDEX "production_item_product_idx" ON "production_item"("product_id");

-- CreateIndex
CREATE INDEX "trim_recipe_tenant_id_idx" ON "trim_recipe"("tenant_id");

-- CreateIndex
CREATE INDEX "trim_recipe_parent_idx" ON "trim_recipe"("parent_product_id");

-- CreateIndex
CREATE INDEX "trim_recipe_part_tenant_id_idx" ON "trim_recipe_part"("tenant_id");

-- CreateIndex
CREATE INDEX "trim_recipe_part_recipe_idx" ON "trim_recipe_part"("trim_recipe_id");

-- CreateIndex
CREATE INDEX "prepped_shortfall_tenant_id_idx" ON "prepped_shortfall"("tenant_id");

-- CreateIndex
CREATE INDEX "prepped_shortfall_branch_product_date_idx" ON "prepped_shortfall"("branch_id", "product_id", "business_date");

-- CreateIndex
CREATE INDEX "prepped_shortfall_run_idx" ON "prepped_shortfall"("sales_consumption_run_id");

-- CreateIndex
CREATE INDEX "prepped_shortfall_staff_meal_idx" ON "prepped_shortfall"("staff_meal_id");

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_trim_recipe_id_fkey" FOREIGN KEY ("trim_recipe_id") REFERENCES "trim_recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item" ADD CONSTRAINT "production_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item" ADD CONSTRAINT "production_item_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item" ADD CONSTRAINT "production_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item" ADD CONSTRAINT "production_item_input_unit_id_fkey" FOREIGN KEY ("input_unit_id") REFERENCES "product_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item" ADD CONSTRAINT "production_item_reversal_of_item_id_fkey" FOREIGN KEY ("reversal_of_item_id") REFERENCES "production_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trim_recipe" ADD CONSTRAINT "trim_recipe_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trim_recipe" ADD CONSTRAINT "trim_recipe_parent_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trim_recipe_part" ADD CONSTRAINT "trim_recipe_part_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trim_recipe_part" ADD CONSTRAINT "trim_recipe_part_trim_recipe_id_fkey" FOREIGN KEY ("trim_recipe_id") REFERENCES "trim_recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trim_recipe_part" ADD CONSTRAINT "trim_recipe_part_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepped_shortfall" ADD CONSTRAINT "prepped_shortfall_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepped_shortfall" ADD CONSTRAINT "prepped_shortfall_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepped_shortfall" ADD CONSTRAINT "prepped_shortfall_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepped_shortfall" ADD CONSTRAINT "prepped_shortfall_sales_consumption_run_id_fkey" FOREIGN KEY ("sales_consumption_run_id") REFERENCES "sales_consumption_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepped_shortfall" ADD CONSTRAINT "prepped_shortfall_staff_meal_id_fkey" FOREIGN KEY ("staff_meal_id") REFERENCES "staff_meal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- CHECKs — inline here, not prisma/manual/ (the Part 17/18/22 precedent;
-- prisma/manual is for what a migration cannot express: partial indexes).
-- ============================================================

-- A zero or negative line is noise with a movement attached. The movement TYPE
-- carries the direction, so the quantity is always a magnitude.
ALTER TABLE "production_item"
  ADD CONSTRAINT production_item_qty_check CHECK ("qty" > 0);

-- Nothing reverses itself — one bad id would make the void walk never end.
ALTER TABLE "production_item"
  ADD CONSTRAINT production_item_reversal_self_check
  CHECK ("reversal_of_item_id" IS NULL OR "reversal_of_item_id" <> "id");

-- What the person typed is kept as a pair or not at all.
ALTER TABLE "production_item"
  ADD CONSTRAINT production_item_input_pair_check
  CHECK (("input_qty" IS NULL) = ("input_unit_id" IS NULL));

-- A share of the money belongs to what was MADE. An input has none; an original
-- output must have one, between 0 and 100 (a reversal copies its original's
-- movement, not its share, so it may leave it NULL).
ALTER TABLE "production_item"
  ADD CONSTRAINT production_item_value_share_check
  CHECK (
    ("role" = 'INPUT' AND "value_share_pct" IS NULL)
    OR ("role" = 'OUTPUT' AND (
          ("value_share_pct" IS NULL AND "reversal_of_item_id" IS NOT NULL)
          OR ("value_share_pct" >= 0 AND "value_share_pct" <= 100)))
  );

-- MANUAL is a person; everything else names the document that made the system
-- write it. Neither half is allowed without the other.
ALTER TABLE "production"
  ADD CONSTRAINT production_origin_check
  CHECK (("origin" = 'MANUAL') = ("origin_id" IS NULL));

-- A production recipe fills a PRODUCE; a trim recipe splits a TRIM.
ALTER TABLE "production"
  ADD CONSTRAINT production_recipe_kind_check
  CHECK (
    ("recipe_id" IS NULL OR "kind" = 'PRODUCE')
    AND ("trim_recipe_id" IS NULL OR "kind" = 'TRIM')
  );

-- A void records WHO, or it did not happen (waste_log's rule).
ALTER TABLE "production"
  ADD CONSTRAINT production_voided_stamped_check
  CHECK (("voided_at" IS NULL) = ("voided_by" IS NULL));

-- A part is a real share of the whole: more than nothing, never more than all.
ALTER TABLE "trim_recipe_part"
  ADD CONSTRAINT trim_recipe_part_weight_check
  CHECK ("weight_pct" > 0 AND "weight_pct" <= 100);

-- Q7: what is thrown away carries no value. Otherwise its share of the cost
-- would leave the fish and arrive on no shelf, and the parts would stop adding
-- up to what the fish cost — the one property the trim recipe exists to keep.
ALTER TABLE "trim_recipe_part"
  ADD CONSTRAINT trim_recipe_part_value_check
  CHECK (
    "value_pct" >= 0 AND "value_pct" <= 100
    AND ("product_id" IS NOT NULL OR "value_pct" = 0)
  );

-- A shortfall belongs to exactly one document: a day's sales, or a staff meal.
ALTER TABLE "prepped_shortfall"
  ADD CONSTRAINT prepped_shortfall_source_check
  CHECK (num_nonnulls("sales_consumption_run_id", "staff_meal_id") = 1);

ALTER TABLE "prepped_shortfall"
  ADD CONSTRAINT prepped_shortfall_qty_check CHECK ("qty" > 0);

-- ============================================================
-- stock_movement_sign_check — DROP and re-declare (ADR 0011 Q2)
-- ============================================================
-- The standing item every new movement type triggers. PRODUCTION_IN and a void
-- giving an input back join the positive arm; an input used up, and a void
-- taking an output back off the shelf, join the negative one.
--
-- The values were committed by 20261029120000_part_40a — Postgres refuses to
-- reference a new enum value in the transaction that added it.
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_sign_check";

ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_sign_check" CHECK (
  ("type" IN ('PO_RECEIVE', 'ADJUST_GAIN', 'TRANSFER_IN', 'TRANSFER_OUT_REVERSAL', 'CONSUMPTION_REVERSAL', 'PRODUCTION_IN', 'PRODUCTION_OUT_REVERSAL') AND "qty" > 0)
  OR ("type" IN ('PO_RECEIVE_REVERSAL', 'ADJUST_LOSS', 'TRANSFER_OUT', 'TRANSFER_IN_REVERSAL', 'CONSUMPTION', 'PRODUCTION_OUT', 'PRODUCTION_IN_REVERSAL') AND "qty" < 0)
);

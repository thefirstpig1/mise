-- ============================================================
-- Part 26 - the meal that collected no money  (ADR 0028)
-- ============================================================
-- Three real-world shapes, and only two of them are here. A shop that budgets
-- and buys staff food separately never puts it on a shelf: that is an ordinary
-- expense under an OpEx/Labor category, which tenant-init.ts already seeds, and
-- it needs no table. What this migration serves is food that leaves the shop's
-- OWN stock - rung as a menu dish, or cooked from raw ingredients.
--
-- WHY THERE IS NO NEW MOVEMENT TYPE. `CONSUMPTION` already means "stock that
-- left to be cooked and eaten", and it was named for what happened to the stock
-- rather than for what caused it precisely so that a sale and a staff meal
-- could share it (ADR 0021 Q12). So `stock_movement_sign_check` is UNTOUCHED
-- and ADR 0013's two-migration dance does not apply - the same conclusion
-- WASTE_LOG and STOCK_COUNT reached before this.
--
-- WHY THE ITEM IS THE LEDGER'S SOURCE AND THE DOCUMENT IS NOT. One menu
-- explodes into N raw products, and `stock_movement_source_unique` is a key on
-- the PAIR (source_type, source_id). ADR 0018 Q4's three-values-over-one-id
-- trick does not stretch to an unbounded N. This is ADR 0022 Q1's finding,
-- unchanged, arriving at the same answer for the same reason.
--
-- WHY `staff_meal_item` IS NOT AGGREGATED, WHERE `sales_consumption_item` IS.
-- There, a day holds thousands of sales lines and one item per line x product
-- would have multiplied the ledger ~50x. Here a day holds about ten rows, and
-- aggregating would destroy the per-person attribution that is the entire
-- reason `staff_member` exists - a saving that does not exist, paid for with
-- the feature.
--
-- WHY `staff_member` IS NOT `app_user`, AND NOT AN HR RECORD. A login answers
-- who may sign in; this answers who ate. In a Thai SME the owner holds the only
-- account and the staff do the work - which is why four documents in this
-- schema already carry a free-text `*_by_name` beside their FK. Transparency
-- about who went over a quota cannot be counted from free text, so a roster
-- exists; it holds a name, a home branch and whether they still work here, and
-- nothing else. No ID number, no wage, no phone: no question in this Part is
-- answered by them, and each is a duty to protect bought for nothing.
--
-- WHY `staff_member_id` AND `menu_id` ARE BOTH NULLABLE, WITH NO CHECK TYING
-- THEM. A dish rung from the menu has an eater and the application requires
-- one. A pot the kitchen cooked for everybody has no single eater, and no menu
-- either. Making the pairing a CHECK would encode "the empty case is an error"
-- when in fact it is one of the two shapes this table was built for.
--
-- WHY `frozen_unit_price` IS A SELLING PRICE AND NEVER A COST. A staff meal
-- carries two figures that are not equal and do not replace each other: the
-- ledger moves at what the ingredients cost, which only the FIFO walk is
-- entitled to say (ADR 0014), and the dish's selling price is a control number
-- for keeping staff off the expensive dishes. Booking the selling price as the
-- cost would invent an expense with no money leaving the business. It is FROZEN
-- because it is derived live from sales and drifts - unfrozen, last month's
-- quota check would answer differently every time it was asked.
--
-- WHY `sales_line.discount_reason` IS IN THIS MIGRATION AT ALL. A shop whose
-- POS rings staff meals as a 100% discount is ALREADY having them posted as
-- CONSUMPTION today, correctly as stock and wrongly as cost of goods sold. If
-- such a shop also types them here, the stock is deducted TWICE with nothing on
-- screen looking wrong. The defence is a warning that can say WHICH zero-price
-- line is which - and a blunt net_amount = 0 test cannot, because it lumps a
-- staff meal in with a giveaway, a voucher and a cancelled bill. The tag is
-- stored exactly as the file wrote it and interpreted by nobody: letting a
-- spelling move money between accounts is what ADR 0019 Q7 spent a Part
-- refusing.
--
-- STILL MANUAL, in prisma/manual/ (Pitfall #18 - needs DIRECT_URL):
--   staff_meal_unique.sql  - one reversal per item, which is the only thing
--                            stopping a double-submitted void from crediting
--                            the stock back twice
--   enable_rls.sql         - RLS on all three new tenant-scoped tables
-- ============================================================

-- CreateEnum
CREATE TYPE "staff_meal_price_source" AS ENUM ('SOLD', 'PLANNED', 'NONE');

-- AlterEnum
ALTER TYPE "source_type" ADD VALUE 'STAFF_MEAL';

-- AlterTable
ALTER TABLE "sales_line" ADD COLUMN     "discount_reason" TEXT;

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "staff_meal_daily_quota" DECIMAL(15,2),
ADD COLUMN     "staff_meal_max_menu_price" DECIMAL(15,2);

-- CreateTable
CREATE TABLE "staff_member" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "daily_quota_amount" DECIMAL(15,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "staff_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_meal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "staff_member_id" UUID,
    "menu_id" UUID,
    "servings" DECIMAL(15,3) NOT NULL DEFAULT 1,
    "frozen_unit_price" DECIMAL(15,2),
    "price_source" "staff_meal_price_source" NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "recorded_by_name" TEXT,
    "notes" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_meal_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "staff_meal_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" DECIMAL(15,3) NOT NULL,
    "input_qty" DECIMAL(15,3),
    "input_unit_id" UUID,
    "reversal_of_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_meal_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_member_tenant_id_idx" ON "staff_member"("tenant_id");

-- CreateIndex
CREATE INDEX "staff_member_branch_active_idx" ON "staff_member"("branch_id", "is_active");

-- CreateIndex
CREATE INDEX "staff_meal_tenant_id_idx" ON "staff_meal"("tenant_id");

-- CreateIndex
CREATE INDEX "staff_meal_branch_date_idx" ON "staff_meal"("branch_id", "business_date");

-- CreateIndex
CREATE INDEX "staff_meal_member_date_idx" ON "staff_meal"("staff_member_id", "business_date");

-- CreateIndex
CREATE INDEX "staff_meal_item_tenant_id_idx" ON "staff_meal_item"("tenant_id");

-- CreateIndex
CREATE INDEX "staff_meal_item_meal_idx" ON "staff_meal_item"("staff_meal_id");

-- CreateIndex
CREATE INDEX "staff_meal_item_product_idx" ON "staff_meal_item"("product_id");

-- AddForeignKey
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal" ADD CONSTRAINT "staff_meal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal" ADD CONSTRAINT "staff_meal_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal" ADD CONSTRAINT "staff_meal_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal" ADD CONSTRAINT "staff_meal_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal" ADD CONSTRAINT "staff_meal_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal" ADD CONSTRAINT "staff_meal_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal_item" ADD CONSTRAINT "staff_meal_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal_item" ADD CONSTRAINT "staff_meal_item_staff_meal_id_fkey" FOREIGN KEY ("staff_meal_id") REFERENCES "staff_meal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal_item" ADD CONSTRAINT "staff_meal_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal_item" ADD CONSTRAINT "staff_meal_item_input_unit_id_fkey" FOREIGN KEY ("input_unit_id") REFERENCES "product_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_meal_item" ADD CONSTRAINT "staff_meal_item_reversal_of_item_id_fkey" FOREIGN KEY ("reversal_of_item_id") REFERENCES "staff_meal_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- CHECK constraints (ADR 0028 Q8)
-- ============================================================

-- A zero item is noise with a stock movement attached. Deliberately only `<> 0`
-- and NOT a sign rule tied to `reversal_of_item_id`: `sales_consumption_item`
-- learned that a non-reversal row can legitimately be positive, and there is no
-- reason to be stricter here than the table this one is modelled on.
ALTER TABLE "staff_meal_item"
  ADD CONSTRAINT staff_meal_item_qty_check CHECK (qty <> 0);

-- Servings is an as-entered magnitude, always positive - direction lives on the
-- item's signed qty, never on this. A pot leaves it at its default of 1 and puts
-- the real quantities on the items.
ALTER TABLE "staff_meal"
  ADD CONSTRAINT staff_meal_servings_check CHECK (servings > 0);

-- A frozen price is either a real figure or absent. 0.00 would read as "the meal
-- was free", which is a different claim from "the dish has never sold and we
-- cannot say" - rule S3, and ADR 0019's null-is-not-zero rule one table across.
ALTER TABLE "staff_meal"
  ADD CONSTRAINT staff_meal_frozen_price_check
  CHECK (frozen_unit_price IS NULL OR frozen_unit_price > 0);

-- The price must be able to say where it came from. NONE is the only source
-- allowed to carry no number, and SOLD/PLANNED must carry one - otherwise a row
-- claims a provenance for a figure it does not have.
ALTER TABLE "staff_meal"
  ADD CONSTRAINT staff_meal_price_source_check
  CHECK (
    (price_source = 'NONE' AND frozen_unit_price IS NULL)
    OR (price_source <> 'NONE' AND frozen_unit_price IS NOT NULL)
  );

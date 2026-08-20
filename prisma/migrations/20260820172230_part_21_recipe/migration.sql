-- CreateTable
CREATE TABLE "recipe" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "menu_id" UUID,
    "output_product_id" UUID,
    "servings" DECIMAL(15,3) NOT NULL DEFAULT 1,
    "effective_from" DATE NOT NULL,
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" UUID,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredient" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "product_id" UUID,
    "component_menu_id" UUID,
    "qty" DECIMAL(15,3) NOT NULL,
    "product_unit_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_branch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_branch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipe_tenant_id_idx" ON "recipe"("tenant_id");

-- CreateIndex
CREATE INDEX "recipe_line_effective_idx" ON "recipe"("line_id", "effective_from");

-- CreateIndex
CREATE INDEX "recipe_menu_idx" ON "recipe"("menu_id");

-- CreateIndex
CREATE INDEX "recipe_output_product_idx" ON "recipe"("output_product_id");

-- CreateIndex
CREATE INDEX "recipe_ingredient_tenant_id_idx" ON "recipe_ingredient"("tenant_id");

-- CreateIndex
CREATE INDEX "recipe_ingredient_recipe_idx" ON "recipe_ingredient"("recipe_id");

-- CreateIndex
CREATE INDEX "recipe_ingredient_product_idx" ON "recipe_ingredient"("product_id");

-- CreateIndex
CREATE INDEX "recipe_ingredient_component_menu_idx" ON "recipe_ingredient"("component_menu_id");

-- CreateIndex
CREATE INDEX "recipe_branch_tenant_id_idx" ON "recipe_branch"("tenant_id");

-- CreateIndex
CREATE INDEX "recipe_branch_branch_idx" ON "recipe_branch"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_branch_unique" ON "recipe_branch"("line_id", "branch_id");

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_output_product_id_fkey" FOREIGN KEY ("output_product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_component_menu_id_fkey" FOREIGN KEY ("component_menu_id") REFERENCES "menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_branch" ADD CONSTRAINT "recipe_branch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_branch" ADD CONSTRAINT "recipe_branch_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_branch" ADD CONSTRAINT "recipe_branch_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Part 21 CHECK constraints (ADR 0021)
-- ============================================================
-- Written by hand into this migration rather than generated: Prisma 5.22 cannot
-- express a CHECK in schema.prisma. Each model carries a ///-comment naming the
-- constraint it is guarded by.
--
-- What is NOT here, and why: the rule that a PREPPED product is made by a parent
-- + yield OR by a production recipe (never both) spans `product` and `recipe`,
-- and a CHECK cannot see across tables. It lives in app logic, the same place
-- and for the same reason as ADR 0007's depth-and-cycle guard.

-- One recipe makes exactly one thing (ADR 0021 Q1/Q2): a menu that is sold, or a
-- PREPPED product that is produced. `<>` on two booleans is XOR.
ALTER TABLE "recipe"
  ADD CONSTRAINT "recipe_target_check"
  CHECK (("menu_id" IS NOT NULL) <> ("output_product_id" IS NOT NULL));

-- A recipe makes at least some fraction of a portion. Zero would make the
-- per-serving division (rule R2) a divide-by-zero on every cost read.
ALTER TABLE "recipe"
  ADD CONSTRAINT "recipe_servings_check"
  CHECK ("servings" > 0);

-- Both halves of the supersede pair, or neither. Same shape as
-- `sales_line_superseded_pair_check` (Part 19): a superseded row that cannot say
-- what corrected it is an audit trail with the answer torn out.
ALTER TABLE "recipe"
  ADD CONSTRAINT "recipe_superseded_pair_check"
  CHECK (("superseded_at" IS NULL) = ("superseded_by_id" IS NULL));

-- An ingredient points at exactly one thing (ADR 0021 Q3): a product, or another
-- menu. Never a recipe version, which is why there is no third column here.
ALTER TABLE "recipe_ingredient"
  ADD CONSTRAINT "recipe_ingredient_target_check"
  CHECK (("product_id" IS NOT NULL) <> ("component_menu_id" IS NOT NULL));

-- A product ingredient carries a unit ("120 g of minced pork"); a menu
-- ingredient does not ("1 steak"). Binding the two means a set-menu line can
-- never acquire a unit belonging to some other product, and a product line can
-- never lose the unit its quantity is meaningless without.
ALTER TABLE "recipe_ingredient"
  ADD CONSTRAINT "recipe_ingredient_unit_check"
  CHECK (("product_id" IS NOT NULL) = ("product_unit_id" IS NOT NULL));

-- Strictly positive, and this table is allowed to say so. `sales_line` is not:
-- a voided bill is negative and a giveaway is zero, which is why rule P21 forbids
-- leaning on `.positive()` there. Here a recipe that uses none of something
-- simply has no line, so 0 is not a legal answer and a blank must not become one.
ALTER TABLE "recipe_ingredient"
  ADD CONSTRAINT "recipe_ingredient_qty_check"
  CHECK ("qty" > 0);

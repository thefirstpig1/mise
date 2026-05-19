-- CreateTable
CREATE TABLE "unit_template" (
    "id" UUID NOT NULL,
    "unit_name" TEXT NOT NULL,
    "unit_dimension" TEXT NOT NULL,
    "to_si_ratio" DECIMAL(15,6),
    "display_order_th" INTEGER,
    "display_order_en" INTEGER,

    CONSTRAINT "unit_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquid_density_template" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ml_per_g" DECIMAL(15,6) NOT NULL,
    "description" TEXT,
    "display_order" INTEGER,

    CONSTRAINT "liquid_density_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT,
    "name_full" TEXT NOT NULL,
    "name_short" TEXT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "line_id" TEXT,
    "address" TEXT,
    "tax_id" TEXT,
    "payment_terms" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_vat_registered" BOOLEAN NOT NULL DEFAULT false,
    "default_vat_rate_percent" DECIMAL(5,2),
    "default_subject_to_wht" BOOLEAN NOT NULL DEFAULT false,
    "default_wht_rate_percent" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "accounting_section" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "type" TEXT NOT NULL,
    "primary_dimension" TEXT NOT NULL,
    "category_id" UUID,
    "liquid_density_template_id" UUID,
    "density_ml_per_g_override" DECIMAL(15,6),
    "yield_percent" DECIMAL(5,2),
    "parent_product_id" UUID,
    "expected_yield_g" DECIMAL(15,6),
    "target_market_price" DECIMAL(15,4),
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_unit" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_name" TEXT NOT NULL,
    "unit_dimension" TEXT NOT NULL,
    "to_base_ratio" DECIMAL(15,6) NOT NULL,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "is_default_buy_unit" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "display_order" INTEGER,

    CONSTRAINT "product_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_product_mapping" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID,
    "supplier_item_code" TEXT,
    "supplier_item_name" TEXT,
    "order_unit_id" UUID,
    "current_unit_price" DECIMAL(15,4),
    "min_order_qty" DECIMAL(15,6),
    "lead_time_days" INTEGER,
    "is_preferred" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "supplier_product_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_template_unit_name_key" ON "unit_template"("unit_name");

-- CreateIndex
CREATE INDEX "supplier_tenant_id_idx" ON "supplier"("tenant_id");

-- CreateIndex
CREATE INDEX "category_tenant_id_idx" ON "category"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_tenant_id_account_accounting_section_group_key" ON "category"("tenant_id", "account", "accounting_section", "group");

-- CreateIndex
CREATE INDEX "product_tenant_id_idx" ON "product"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenant_id_sku_key" ON "product"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "product_unit_product_id_idx" ON "product_unit"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_unit_product_id_unit_name_key" ON "product_unit"("product_id", "unit_name");

-- CreateIndex
CREATE INDEX "supplier_product_mapping_tenant_id_idx" ON "supplier_product_mapping"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_product_mapping_tenant_id_supplier_id_product_id_b_key" ON "supplier_product_mapping"("tenant_id", "supplier_id", "product_id", "branch_id", "effective_from");

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_liquid_density_template_id_fkey" FOREIGN KEY ("liquid_density_template_id") REFERENCES "liquid_density_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_parent_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit" ADD CONSTRAINT "product_unit_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_mapping" ADD CONSTRAINT "supplier_product_mapping_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_mapping" ADD CONSTRAINT "supplier_product_mapping_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_mapping" ADD CONSTRAINT "supplier_product_mapping_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_mapping" ADD CONSTRAINT "supplier_product_mapping_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_mapping" ADD CONSTRAINT "supplier_product_mapping_order_unit_id_fkey" FOREIGN KEY ("order_unit_id") REFERENCES "product_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

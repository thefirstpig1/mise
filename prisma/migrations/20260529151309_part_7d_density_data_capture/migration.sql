-- Q1: rename columns (values unchanged, lossless)
ALTER TABLE "liquid_density_template" RENAME COLUMN "ml_per_g" TO "g_per_ml";
ALTER TABLE "product" RENAME COLUMN "density_ml_per_g_override" TO "density_g_per_ml_override";

-- Q8: unique on name (full unique safe — no soft-delete on this table)
CREATE UNIQUE INDEX "liquid_density_template_name_key" ON "liquid_density_template"("name");

-- Q2: XOR — template OR override, never both
ALTER TABLE "product" ADD CONSTRAINT "product_density_xor"
  CHECK ("liquid_density_template_id" IS NULL OR "density_g_per_ml_override" IS NULL);

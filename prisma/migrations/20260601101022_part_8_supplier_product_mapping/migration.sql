/*
  Warnings:

  - Made the column `effective_from` on table `supplier_product_mapping` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "supplier_product_mapping_tenant_id_supplier_id_product_id_b_key";

-- AlterTable
ALTER TABLE "supplier_product_mapping" ALTER COLUMN "effective_from" SET NOT NULL,
ALTER COLUMN "effective_from" SET DATA TYPE DATE,
ALTER COLUMN "effective_to" SET DATA TYPE DATE;

-- CreateEnum
CREATE TYPE "gross_profit_method" AS ENUM ('PERIODIC_INVENTORY', 'RECIPE_CONSUMPTION');

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "gross_profit_method" "gross_profit_method" NOT NULL DEFAULT 'PERIODIC_INVENTORY';

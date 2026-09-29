-- ============================================================
-- Part 39 — suppliers that quote VAT-inclusive prices  (ADR 0036 Q7, rule PR3)
-- ============================================================
-- A supplier may quote ฿107 with VAT inside rather than ฿100 + VAT. The price
-- AS QUOTED is kept in new columns for display and printing; every existing
-- money column keeps meaning EXCLUDING VAT, so none of their readers (FIFO,
-- expenses, /cost/prices, the supplier catalog, the price-variance flag)
-- changes. All defaults are "excluding VAT" — exactly what every existing row
-- already is, so there is nothing to backfill.
--
-- Also ADR 0036 Q9: tenant_membership.notify_purchase_ready — purchasers are
-- e-mailed when a branch's purchase request is ready, on by default.
-- ============================================================

-- AlterTable
ALTER TABLE "goods_receipt" ADD COLUMN     "prices_include_vat" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "goods_receipt_item" ADD COLUMN     "line_total_quoted" DECIMAL(15,2),
ADD COLUMN     "unit_price_quoted" DECIMAL(15,4);

-- AlterTable
ALTER TABLE "purchase_order" ADD COLUMN     "prices_include_vat" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "purchase_order_item" ADD COLUMN     "line_total_quoted" DECIMAL(15,2),
ADD COLUMN     "unit_price_quoted" DECIMAL(15,4);

-- AlterTable
ALTER TABLE "supplier" ADD COLUMN     "prices_include_vat" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tenant_membership" ADD COLUMN     "notify_purchase_ready" BOOLEAN NOT NULL DEFAULT true;


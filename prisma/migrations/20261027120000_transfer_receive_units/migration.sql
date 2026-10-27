-- ============================================================
-- Transfer receipt in any unit (Kong 2026-10-27, option A; mockup 58mU74dLaAMwH6nF3AC6zw).
--
-- The receiver counts in whatever unit is in front of them — packs, bottles,
-- or both ("1 แพ็ค + 11 ขวด"). Storing that in the SENT unit at 3 decimals
-- cannot be exact (20 bottles of a 12-bottle pack = 1.667 packs = 20.004
-- bottles), and the difference would post as a phantom loss in transit.
--
-- * qty_received_base — what arrived, in the product's base unit, exactly.
--   The shortage is now sent-in-base minus this. NULL on rows received
--   before this migration (their qty_received, in the sent unit, still holds).
-- * received_detail   — how the receiver counted it, for display only.
-- qty_received stays, rounded into the sent unit, for every existing reader.
-- No new table: RLS is unchanged.
-- ============================================================

ALTER TABLE "stock_transfer_item"
  ADD COLUMN "qty_received_base" DECIMAL(15,3),
  ADD COLUMN "received_detail" TEXT;

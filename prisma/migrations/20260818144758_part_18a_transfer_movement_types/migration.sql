-- ============================================================
-- Part 18a — MovementType += the four TRANSFER_* values  (ADR 0018 Q4)
-- ============================================================
-- This is a SEPARATE migration from part_18_stock_transfer on purpose, for
-- exactly the reason Part 13a records: Postgres refuses to USE a newly added
-- enum value inside the transaction that added it (55P04, "unsafe use of new
-- value of enum type"), and Prisma runs each migration file in one transaction.
-- The next migration re-declares stock_movement_sign_check naming all four, so
-- they have to be committed first.
--
-- ALL FOUR live in this one file — the dance is per MIGRATION, not per value.
-- Parts 15 and 17 skipped it entirely by adding a SourceType instead; Part 18
-- cannot, because ADR 0014 Q8 requires a reversal to cut its own FIFO layer and
-- only the movement type can express that.
--
-- Nothing else belongs in this file.

-- AlterEnum
ALTER TYPE "movement_type" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "movement_type" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "movement_type" ADD VALUE 'TRANSFER_OUT_REVERSAL';
ALTER TYPE "movement_type" ADD VALUE 'TRANSFER_IN_REVERSAL';

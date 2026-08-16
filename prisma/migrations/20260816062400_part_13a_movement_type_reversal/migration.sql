-- ============================================================
-- Part 13a — MovementType += PO_RECEIVE_REVERSAL  (ADR 0013 Q6)
-- ============================================================
-- This is a SEPARATE migration from part_13_goods_receipt on purpose.
-- Postgres refuses to USE a newly added enum value inside the same transaction
-- that added it (55P04, "unsafe use of new value of enum type"), and Prisma runs
-- each migration file in one transaction. The next migration re-declares
-- stock_movement_sign_check with 'PO_RECEIVE_REVERSAL' in it, so the value has
-- to be committed first.
--
-- Nothing else belongs in this file.

-- AlterEnum
ALTER TYPE "movement_type" ADD VALUE 'PO_RECEIVE_REVERSAL';

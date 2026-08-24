-- ============================================================
-- Part 22a — the enum values CONSUMPTION lives on  (ADR 0022)
-- ============================================================
-- A SEPARATE migration from part_22_sales_consumption on purpose, for the reason
-- Parts 13a and 18a both record: Postgres refuses to USE a newly added enum value
-- inside the transaction that added it (55P04, "unsafe use of new value of enum
-- type"), and Prisma runs each migration file in one transaction. The next
-- migration re-declares stock_movement_sign_check naming CONSUMPTION and
-- CONSUMPTION_REVERSAL, so they have to be committed first.
--
-- ALL THREE live in this one file — the dance is per MIGRATION, not per value.
-- SALES_CONSUMPTION is not named by any CHECK and could have travelled with the
-- main migration; it rides along so that "the enum changes" is one place.
--
-- Nothing else belongs in this file.

-- AlterEnum
ALTER TYPE "movement_type" ADD VALUE 'CONSUMPTION';
ALTER TYPE "movement_type" ADD VALUE 'CONSUMPTION_REVERSAL';

-- AlterEnum
ALTER TYPE "source_type" ADD VALUE 'SALES_CONSUMPTION';

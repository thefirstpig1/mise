-- ============================================================
-- Part 40a — the enum values production lives on  (ADR 0040)
-- ============================================================
-- A SEPARATE migration from part_40_production for the reason Parts 13a, 18a
-- and 22a all record: Postgres refuses to USE a newly added enum value inside
-- the transaction that added it (55P04), and Prisma runs each migration file in
-- one transaction. The next migration re-declares stock_movement_sign_check
-- naming all four, so they have to be committed first.
--
-- PRODUCTION (source_type) is named by no CHECK and rides along so that "the
-- enum changes" stay one place. Nothing else belongs in this file.

-- AlterEnum
ALTER TYPE "movement_type" ADD VALUE 'PRODUCTION_OUT';
ALTER TYPE "movement_type" ADD VALUE 'PRODUCTION_IN';
ALTER TYPE "movement_type" ADD VALUE 'PRODUCTION_OUT_REVERSAL';
ALTER TYPE "movement_type" ADD VALUE 'PRODUCTION_IN_REVERSAL';

-- AlterEnum
ALTER TYPE "source_type" ADD VALUE 'PRODUCTION';

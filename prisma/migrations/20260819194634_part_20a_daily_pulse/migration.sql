-- CreateEnum
CREATE TYPE "sales_pulse_source" AS ENUM ('MANUAL');

-- AlterTable
ALTER TABLE "sales_day" ADD COLUMN     "pulse_amount" DECIMAL(15,2),
ADD COLUMN     "pulse_note" TEXT,
ADD COLUMN     "pulse_recorded_at" TIMESTAMP(3),
ADD COLUMN     "pulse_recorded_by" TEXT,
ADD COLUMN     "pulse_source" "sales_pulse_source";

-- AddForeignKey
ALTER TABLE "sales_day" ADD CONSTRAINT "sales_day_pulse_recorded_by_fkey" FOREIGN KEY ("pulse_recorded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- Part 20a CHECK constraints (ADR 0020)
-- ============================================================

-- The five pulse columns move together. Half a pulse — an amount with nobody's
-- name on it, or a name with no amount — is not a smaller version of the record,
-- it is a record that cannot be used as evidence (Q2).
ALTER TABLE "sales_day"
  ADD CONSTRAINT "sales_day_pulse_complete_check"
  CHECK (
    (
      "pulse_amount" IS NULL AND "pulse_source" IS NULL
      AND "pulse_recorded_by" IS NULL AND "pulse_recorded_at" IS NULL
    )
    OR
    (
      "pulse_amount" IS NOT NULL AND "pulse_source" IS NOT NULL
      AND "pulse_recorded_by" IS NOT NULL AND "pulse_recorded_at" IS NOT NULL
    )
  );

-- A day's takings are not negative.
--
-- This is the OPPOSITE of the decision sales_line took, and deliberately so.
-- sales_line mirrors the POS, where a refund really is negative and Mise is not
-- the authority (ADR 0019 Q14). The pulse is typed by a person, where a leading
-- minus is a slip and this constraint is the only check there is.
ALTER TABLE "sales_day"
  ADD CONSTRAINT "sales_day_pulse_amount_check"
  CHECK ("pulse_amount" IS NULL OR "pulse_amount" >= 0);

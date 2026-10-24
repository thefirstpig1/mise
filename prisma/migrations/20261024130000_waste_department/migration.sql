-- ============================================================
-- Kong 2026-10-24 (duplication review D2) — waste split by department.
-- Part 32 (ADR 0032 Consequence) left waste_log without a department "until a
-- real shop says it splits waste by department"; Kong asked for it. Nullable:
-- every existing row stays ไม่ระบุแผนก, and a shop without departments never
-- sets it. A reversal row copies its original's department. waste_log already
-- has RLS.
-- ============================================================

ALTER TABLE "waste_log" ADD COLUMN "department_id" UUID;
ALTER TABLE "waste_log"
  ADD CONSTRAINT "waste_log_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "waste_log_department_idx" ON "waste_log"("department_id");

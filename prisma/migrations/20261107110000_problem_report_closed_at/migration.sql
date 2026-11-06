-- ADR 0045 Q11 — a problem report is kept one year after it is closed
-- (privacy draft §5), so the day it was closed has to be known. updated_at
-- cannot stand in: marking replies as read touches every replied report each
-- time the reporter opens their list, so an active reporter's closed reports
-- would never age (Kong 2026-11-07: "เพิ่มช่องวันที่ปิด").
ALTER TABLE "problem_report" ADD COLUMN "closed_at" TIMESTAMP(3);

-- Reports already closed: their last change is the best date there is.
UPDATE "problem_report" SET "closed_at" = "updated_at" WHERE "status" IN ('FIXED_LIVE', 'CLOSED');

CREATE INDEX "problem_report_closed_idx" ON "problem_report"("closed_at");

-- ADR 0044 — problem reports (Kong 2026-11-03: "อนุมัติ ทำ mockup …" → "ตามนั้น").
-- A person in a shop reports a problem, an idea or a question from inside the
-- app; คิดครัว answers on their "เรื่องที่ฉันแจ้ง". Tenant-scoped like every
-- table (policy in prisma/manual/enable_rls.sql). Hand-written: the generated
-- diff also carried unrelated drift (id defaults, two FKs) that is not this
-- Part's to change.

CREATE TYPE "problem_report_kind" AS ENUM ('PROBLEM', 'IDEA', 'QUESTION');

CREATE TYPE "problem_report_status" AS ENUM ('NEW', 'LOOKING', 'FIXED_PENDING', 'FIXED_LIVE', 'CONSIDERING', 'CLOSED');

-- Not used in this migration, so it may be added inside its transaction.
ALTER TYPE "stored_file_kind" ADD VALUE 'REPORT_SCREENSHOT';

CREATE TABLE "problem_report" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "branch_id" UUID,
    "reporter_id" TEXT NOT NULL,
    "kind" "problem_report_kind" NOT NULL,
    "message" TEXT NOT NULL,
    "page_path" TEXT NOT NULL,
    "build_id" TEXT,
    "user_agent" TEXT,
    "viewport" TEXT,
    "error_digest" TEXT,
    "status" "problem_report_status" NOT NULL DEFAULT 'NEW',
    "reply" TEXT,
    "replied_at" TIMESTAMP(3),
    "seen_at" TIMESTAMP(3),
    "internal_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "problem_report_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "problem_report_number_key" ON "problem_report"("tenant_id", "number");
CREATE INDEX "problem_report_reporter_idx" ON "problem_report"("tenant_id", "reporter_id");
CREATE INDEX "problem_report_status_idx" ON "problem_report"("status", "created_at");

ALTER TABLE "problem_report" ADD CONSTRAINT "problem_report_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "problem_report" ADD CONSTRAINT "problem_report_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "problem_report" ADD CONSTRAINT "problem_report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What the columns above cannot say: a message has words in it, and a running
-- number starts at 1. The length cap is the form's, held here too.
ALTER TABLE "problem_report" ADD CONSTRAINT "problem_report_message_check" CHECK (length(btrim("message")) > 0 AND length("message") <= 4000);
ALTER TABLE "problem_report" ADD CONSTRAINT "problem_report_number_check" CHECK ("number" > 0);

-- A screenshot belongs to a report, the way a photo belongs to a bill.
ALTER TABLE "stored_file" ADD COLUMN "problem_report_id" UUID;
CREATE INDEX "stored_file_report_idx" ON "stored_file"("problem_report_id");
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_problem_report_id_fkey" FOREIGN KEY ("problem_report_id") REFERENCES "problem_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- …and still to at most one document.
ALTER TABLE "stored_file" DROP CONSTRAINT "stored_file_one_owner";
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_one_owner"
  CHECK (num_nonnulls("expense_id", "expense_payment_id", "staff_refund_id", "problem_report_id") <= 1);

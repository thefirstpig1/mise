-- Kong 2026-10-29: billing, first step. Each shop has a package and the day it
-- stops being free. Nothing is enforced on that date yet — collecting money and
-- what happens to a shop that does not pay are decided before the first free
-- year ends. Written by the operator's script (scripts/plan.mjs) only.

ALTER TABLE "tenant" ADD COLUMN "plan_free_until" DATE,
ADD COLUMN "plan_note" TEXT,
ADD COLUMN "plan_updated_at" TIMESTAMP(3);

-- `plan` has existed since Sprint 0 with a comment listing four values nobody
-- ever wrote ("trial" is the only one in the database). Two are real now.
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_plan_check" CHECK ("plan" IN ('trial', 'standard'));

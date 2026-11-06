-- ADR 0045 Q13 — a day of use is written without waiting (never slows a page),
-- so it can land after an erase has already cleared the shop's day rows and
-- before the shop row goes; with RESTRICT that late row made the erase fail
-- (seen in the test teardown). The rows mean nothing without their shop, so
-- they go with it — the one tenant table that cascades, on purpose.
ALTER TABLE "user_activity_day" DROP CONSTRAINT "user_activity_day_tenant_id_fkey";
ALTER TABLE "user_activity_day" ADD CONSTRAINT "user_activity_day_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

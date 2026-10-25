-- Kong 2026-10-25 (stock mockup XYYyUgNP18V4HL3vUwrUf1): how often this shop
-- means to count. งานสต๊อก warns on the นับสต๊อก tile once the last closed count
-- is older than this. A shop setting, not a rule: weekly and monthly counters
-- both exist. tenant already has RLS.
ALTER TABLE "tenant" ADD COLUMN "count_cycle_days" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_count_cycle_days_check" CHECK ("count_cycle_days" BETWEEN 1 AND 365);

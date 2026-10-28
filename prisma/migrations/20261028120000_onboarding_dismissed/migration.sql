-- ============================================================
-- เริ่มต้นใช้งาน: hidden per person (Kong 2026-10-28, approved with mockup
-- GG5e43SSLmNFxEHfa5RQJH).
--
-- The setup checklist on a new shop's dashboard can be hidden. Kong asked for
-- it to follow the ACCOUNT, not the device: one owner hiding it must not hide
-- it from a co-owner, and it must stay hidden on the phone as well as the
-- laptop. A membership is exactly "this person in this shop", so the moment
-- they hid it lives there. NULL = showing.
--
-- No new table: RLS is unchanged.
-- ============================================================

ALTER TABLE "tenant_membership"
  ADD COLUMN "onboarding_dismissed_at" TIMESTAMP(3);

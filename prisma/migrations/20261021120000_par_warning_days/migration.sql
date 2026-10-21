-- ============================================================
-- Kong 2026-10-21 — "ใกล้ขั้นต่ำ": how many days ahead a shop is warned
-- that a product will fall below its par (rule PAR-2). Default 3; the
-- shop changes it in ตั้งค่าร้าน. tenant already has RLS.
-- ============================================================

ALTER TABLE "tenant" ADD COLUMN "par_warning_days" INTEGER NOT NULL DEFAULT 3;

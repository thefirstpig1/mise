-- ============================================================
-- คิดครัว — staff advances (สำรองจ่าย) partial uniques
-- ADR 0037 Q5–Q6
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause) in schema.prisma. Every statement is IF NOT EXISTS, so the release
-- command may run it on every deploy (ADR 0033 Q6).
-- ============================================================

-- ONE LIVE PAYMENT PER BILL (Q5: a bill is paid once, never several bills in
-- one payment and never one bill twice). A correction voids and writes again,
-- so the index looks only at rows still standing. Without it a double-tapped
-- "ส่งให้บัญชี" would put the same ฿344 in the staff member's "รอคืน" twice.
CREATE UNIQUE INDEX IF NOT EXISTS expense_payment_live_unique
  ON expense_payment (expense_id)
  WHERE voided_at IS NULL;

-- ONE WALK-IN SUPPLIER PER SHOP. It is found by the flag, created on first
-- use; two would split a shop's market purchases between rows that read the same.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_walk_in_unique
  ON supplier (tenant_id)
  WHERE is_walk_in AND deleted_at IS NULL;

-- ============================================================
-- Mise — the default department in the shop's language (review 2026-10-28)
-- ============================================================
-- Every shop was seeded with a department named "Main" and described in
-- English ("Default department (auto-created on tenant init)"), and both
-- reached customers: receipts, orders and the แผนก list printed them. New shops
-- have been seeded as "ครัวหลัก" since 2026-10-27 (tenant-init.ts); this brings
-- the shops created before that into line. Kong approved it with the settings
-- mockup 6A5E893FefkuYmW3Z5vzbn.
--
-- WHAT IT TOUCHES, AND WHAT IT NEVER DOES
--   * The name only where it is still EXACTLY "Main" on the MAIN-coded row. A
--     shop that already renamed its default department is never matched.
--   * The description only where it is still EXACTLY the English seed text.
--   * The code stays MAIN — code reads it (DEFAULT_DEPARTMENT_CODE).
--   * department has no unique name, so a shop that also made its own
--     "ครัวหลัก" cannot stop the release; it gets two rows of that name, which
--     the shop can tell apart by code and rename.
--
-- IDEMPOTENT: once renamed, nothing matches again.
-- ============================================================

UPDATE department
SET name = 'ครัวหลัก', updated_at = now()
WHERE code = 'MAIN' AND name = 'Main';

UPDATE department
SET description = NULL, updated_at = now()
WHERE description = 'Default department (auto-created on tenant init)';

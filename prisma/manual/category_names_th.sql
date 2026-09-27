-- ============================================================
-- Mise — Thai names for the categories every shop was seeded with (Part 35)
-- ============================================================
-- Shops created before Part 35 got 17 categories in English (Meat, Rent…)
-- plus the on-demand "Food / ไม่ระบุหมวด" bucket. New shops are seeded in
-- Thai (src/lib/category-seed.ts); this renames the old ones to match.
--
-- WHAT IT TOUCHES, AND WHAT IT NEVER DOES
--   * Only a row whose account + section + group are EXACTLY a seeded English
--     triple. A category a person created or already renamed is never matched.
--   * Never a row whose Thai target already exists in the same shop: the unique
--     (tenant_id, account, accounting_section, "group") would refuse, and the
--     whole release would stop on one shop's data. That row stays English and
--     nothing else is affected.
--   * Ids do not change, so every product, expense line and recurring template
--     pointing at a category points at the same row afterwards.
--
-- IDEMPOTENT. Once renamed, a row no longer matches an English triple, so the
-- second and every later run updates nothing. It runs on every deploy (the
-- release command runs the whole folder) and costs one indexed scan.
--
-- THE LIST IS GENERATED FROM src/lib/category-seed.ts, and
-- tests/category-seed.test.ts fails if the two ever disagree.
-- ============================================================

WITH m(account, en_section, en_group, th_section, th_group) AS (
  VALUES
    ('COGS', 'Food', 'Meat', 'อาหาร', 'เนื้อสัตว์'),
    ('COGS', 'Food', 'Seafood', 'อาหาร', 'อาหารทะเล'),
    ('COGS', 'Food', 'Vegetables', 'อาหาร', 'ผักและผลไม้'),
    ('COGS', 'Food', 'Dry goods', 'อาหาร', 'ของแห้งและเครื่องปรุง'),
    ('COGS', 'Beverage', 'Coffee', 'เครื่องดื่ม', 'กาแฟและชา'),
    ('COGS', 'Beverage', 'Alcohol', 'เครื่องดื่ม', 'เครื่องดื่มแอลกอฮอล์'),
    ('COGS', 'Beverage', 'Soft drinks', 'เครื่องดื่ม', 'น้ำอัดลมและน้ำดื่ม'),
    ('COGS', 'Packaging', 'Single-use', 'บรรจุภัณฑ์', 'ภาชนะใช้ครั้งเดียว'),
    ('OpEx', 'Utilities', 'Electricity', 'สาธารณูปโภค', 'ค่าไฟฟ้า'),
    ('OpEx', 'Utilities', 'Water', 'สาธารณูปโภค', 'ค่าน้ำประปา'),
    ('OpEx', 'Utilities', 'Internet', 'สาธารณูปโภค', 'อินเทอร์เน็ตและโทรศัพท์'),
    ('OpEx', 'Rent', 'Building', 'ค่าเช่า', 'ค่าเช่าร้าน'),
    ('OpEx', 'Labor', 'Salary', 'ค่าแรง', 'เงินเดือน'),
    ('OpEx', 'Labor', 'Service charge', 'ค่าแรง', 'เซอร์วิสชาร์จพนักงาน'),
    ('OpEx', 'Marketing', 'Online ads', 'การตลาด', 'โฆษณาออนไลน์'),
    ('OpEx', 'Commission', 'Delivery apps', 'ค่าคอมมิชชัน', 'แอปเดลิเวอรี'),
    ('OpEx', 'Professional', 'Accounting', 'ค่าบริการวิชาชีพ', 'ค่าทำบัญชี'),
    ('COGS', 'Food', 'ไม่ระบุหมวด', 'อาหาร', 'ไม่ระบุหมวด')
)
UPDATE category c
SET accounting_section = m.th_section,
    "group" = m.th_group,
    updated_at = now()
FROM m
WHERE c.account = m.account
  AND c.accounting_section = m.en_section
  AND c."group" = m.en_group
  AND NOT EXISTS (
    SELECT 1 FROM category x
    WHERE x.tenant_id = c.tenant_id
      AND x.account = m.account
      AND x.accounting_section = m.th_section
      AND x."group" = m.th_group
  );

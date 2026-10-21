-- ============================================================
-- Mise — one name per unit: metric sizes in English (Kong 2026-10-21)
-- ============================================================
-- Part 35 added Thai spellings of the metric sizes (กรัม กก. มล. ลิตร) BESIDE
-- the English ones, so one shop could hold kg on one product and กก. on the
-- next, and screens translated some of them and not others. Kong decided the
-- other way round: metric is written g · kg · ml · l everywhere — fast to type,
-- read the same in either language — and every unit with no international
-- short form (ขีด ช้อนชา ฟอง ลูก ถุง …) stays Thai. system_reference_seed.sql
-- stops offering the Thai metric spellings; this renames the product units
-- that copied them, and the size inside pack names ("กระสอบ 10 กก." →
-- "กระสอบ 10 kg").
--
-- WHAT IT TOUCHES, AND WHAT IT NEVER DOES
--   * A unit named exactly กรัม / กก. / มล. / ลิตร, and a metric size written
--     right after a NUMBER inside a longer name (กก. กิโล กรัม ก. มล. ลิตร). "ถุงกรัม" with no number, or a
--     word that merely contains ลิตร, is left alone.
--   * Never a row whose new name already exists on the same product — the
--     unique (product_id, unit_name) would refuse, and the whole release would
--     stop on one shop's data. That row keeps its Thai name; two units of the
--     same size on one product are for a person to merge, not for a script.
--   * Ids do not change. Recipes, documents, supplier prices and par levels
--     point at units BY ID, so every quantity means what it meant before.
--     Documents keep the unit name they were printed with (order_unit_name,
--     received_unit_name …): those are records, not labels.
--
-- IDEMPOTENT. After one run nothing matches, so every later deploy updates
-- nothing.
-- ============================================================

WITH proposed AS (
  SELECT
    id,
    product_id,
    unit_name AS old_name,
    CASE unit_name
      WHEN 'กก.'  THEN 'kg'
      WHEN 'กรัม' THEN 'g'
      WHEN 'มล.'  THEN 'ml'
      WHEN 'ลิตร' THEN 'l'
      ELSE
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(unit_name, '([0-9])\s*(กิโลกรัม|กิโล|กก\.?)', '\1 kg', 'g'),
              '([0-9])\s*(กรัม|ก\.)', '\1 g', 'g'),
            '([0-9])\s*(มิลลิลิตร|มล\.?)', '\1 ml', 'g'),
          '([0-9])\s*ลิตร', '\1 l', 'g')
    END AS new_name
  FROM product_unit
),
chosen AS (
  -- Two old names on one product that become the SAME new name ("กก." and
  -- "กก"): rename one, leave the other, rather than abort the release.
  SELECT DISTINCT ON (p.product_id, p.new_name) p.id, p.new_name
  FROM proposed p
  WHERE p.new_name <> p.old_name
    AND NOT EXISTS (
      SELECT 1 FROM product_unit x
      WHERE x.product_id = p.product_id AND x.unit_name = p.new_name
    )
  ORDER BY p.product_id, p.new_name, p.id
)
UPDATE product_unit pu
SET unit_name = c.new_name
FROM chosen c
WHERE pu.id = c.id;

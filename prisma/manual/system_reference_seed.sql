-- ============================================================
-- Mise — system reference data (Sprint 7 Part 34, ADR 0033 Q6)
-- ============================================================
-- WHAT THIS IS AND WHY IT IS IN prisma/manual/ RATHER THAN A SEED SCRIPT.
--
-- `prisma migrate deploy` gives a fresh database its tables. The other files in
-- this directory give it the constraints Prisma cannot express. Neither gives
-- it a single ROW — and two tables here are not tenant data at all. They are
-- global reference data that every shop reads and no shop owns:
--
--     unit_template            g · kg · ขีด · ml · l · ชิ้น · ฟอง · ลูก · ใบ · แพ็ค · ถุง
--     liquid_density_template  น้ำเปล่า · นมสด · เบียร์ · น้ำมัน · น้ำเชื่อม
--
-- 🔴 WITHOUT THEM THE FIRST SHOP CANNOT ADD A PRODUCT. `tenant-init.ts` seeds
-- per-tenant rows (departments, expense categories) and cannot seed these,
-- because they are shared. So on a brand-new database the unit dropdown on the
-- product form is EMPTY — and adding a product is the first thing anyone does
-- after signing up. It fails silently: no error, no warning, just no options.
--
-- This used to live in `prisma/seed-system.ts`, run by hand with `tsx`. Two
-- things were wrong with that on the production path. `tsx` is a devDependency
-- and has no business in a production image, so the release command could not
-- call it. And a step somebody has to remember is a step that gets missed —
-- which is the whole argument of ADR 0033 Q6, and the reason the answer here is
-- a file in this directory rather than a third line in `pnpm release`.
--
-- Being here buys three things for free, none of them new machinery:
--   * `scripts/apply-manual-sql.mjs` applies it, and Fly runs that on EVERY
--     deploy before the new version goes live
--   * `tests/manual-sql-coverage.test.ts` M1 goes red if it is ever unlisted
--   * a wrong value is fixed by editing this file and deploying, like any other
--
-- Apply by hand:  pnpm db:seed:system    (or pnpm db:manual for all 19)
--
-- ── IDEMPOTENT, AND IT HAS TO BE UPDATE NOT NOTHING ────────────────────────
-- `ON CONFLICT ... DO UPDATE`, not `DO NOTHING`. The comment that used to sit
-- above the TypeScript version explains why, and it still holds: products link
-- to a density template by FK and read its CURRENT value at query time, with no
-- snapshot. So correcting a density here is meant to propagate to every product
-- already using it. `DO NOTHING` would silently make this file write-once, and
-- a corrected number would never reach the shops it was corrected for.
--
-- ⚠️ RENAMING AN ENTRY IS A BREAKING CHANGE. The conflict target is the NAME
-- (`unit_name`, `name`), so a rename does not rename the row — it inserts a new
-- one and orphans every FK pointing at the old. Add a new entry and migrate the
-- FKs deliberately. Removing an entry from this file does not delete its row
-- either, which is the safe direction: nothing dangles.
--
-- ⚠️ `gen_random_uuid()` IS REQUIRED, NOT DECORATION. `id` is `@default(uuid())`
-- in schema.prisma, which Prisma generates CLIENT-SIDE — the column carries no
-- database default (see the Sprint 1 migration). Raw SQL has no client, so it
-- must mint the id itself. Built into Postgres since 13; no extension needed.
-- ============================================================


-- ============================================================
-- 1. Units
-- ============================================================
-- `to_si_ratio` is grams for WEIGHT and millilitres for VOLUME. It is NULL for
-- COUNT on purpose: a ชิ้น has no size, and giving it a ratio would let the
-- system convert between ชิ้น and kg, which is exactly the arithmetic that
-- silently invents stock.
--
-- `display_order_th` / `display_order_en` differ because ขีด, ฟอง, ลูก, ใบ, แพ็ค
-- and ถุง have no English ordering to give — they are NULL there rather than
-- translated into something no kitchen says.

INSERT INTO unit_template (id, unit_name, unit_dimension, to_si_ratio, display_order_th, display_order_en)
VALUES
  -- WEIGHT — grams
  (gen_random_uuid(), 'g',     'WEIGHT',    1.0,  1,    1),
  (gen_random_uuid(), 'kg',    'WEIGHT', 1000.0,  2,    2),
  (gen_random_uuid(), 'ขีด',    'WEIGHT',  100.0,  3, NULL),
  -- VOLUME — millilitres
  (gen_random_uuid(), 'ml',    'VOLUME',    1.0,  1,    1),
  (gen_random_uuid(), 'l',     'VOLUME', 1000.0,  2,    2),
  -- COUNT — no ratio, deliberately
  (gen_random_uuid(), 'ชิ้น',   'COUNT',   NULL,  1, NULL),
  (gen_random_uuid(), 'ฟอง',   'COUNT',   NULL,  2, NULL),
  (gen_random_uuid(), 'ลูก',    'COUNT',   NULL,  3, NULL),
  (gen_random_uuid(), 'ใบ',     'COUNT',   NULL,  4, NULL),
  (gen_random_uuid(), 'แพ็ค',   'COUNT',   NULL,  5, NULL),
  (gen_random_uuid(), 'ถุง',    'COUNT',   NULL,  6, NULL)
ON CONFLICT (unit_name) DO UPDATE SET
  unit_dimension   = EXCLUDED.unit_dimension,
  to_si_ratio      = EXCLUDED.to_si_ratio,
  display_order_th = EXCLUDED.display_order_th,
  display_order_en = EXCLUDED.display_order_en;


-- ============================================================
-- 2. Liquid densities
-- ============================================================
-- Grams per millilitre. The column was called `ml_per_g` in Sprint 1 and
-- renamed in Part 7d — the name in this file is the one the database has now,
-- and getting it backwards would not fail, it would just make every litre
-- weigh the wrong amount.
--
-- These are the five a Thai kitchen actually buys by volume and counts by
-- weight. More can be added; they are not a closed set.

INSERT INTO liquid_density_template (id, name, g_per_ml, description, display_order)
VALUES
  (gen_random_uuid(), 'น้ำเปล่า',  1.000, 'Water',                  1),
  (gen_random_uuid(), 'นมสด',     1.030, 'Milk',                   2),
  (gen_random_uuid(), 'เบียร์',     1.010, 'Beer (light)',           3),
  (gen_random_uuid(), 'น้ำมัน',     0.910, 'Cooking oil (general)',  4),
  (gen_random_uuid(), 'น้ำเชื่อม',   1.300, 'Simple syrup',           5)
ON CONFLICT (name) DO UPDATE SET
  g_per_ml      = EXCLUDED.g_per_ml,
  description   = EXCLUDED.description,
  display_order = EXCLUDED.display_order;

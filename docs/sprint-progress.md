# Mise Sprint Progress

**Last updated:** 2026-06-07

## Current Sprint: Sprint 1 — Master Data

**Status:** ✅ COMPLETE (2026-06-07)
**Scope:** Suppliers, Products, Categories, Multi-unit system, Liquid density templates

### Sprint 1 Tables to Add
- supplier (with VAT/WHT defaults)
- category (with accounting_section field — renamed from dept_category)
- product (RAW + PREPPED, with yield_percent)
- product_unit (multi-unit per product)
- supplier_product_mapping (branch-aware pricing)
- unit_template (system seed — pre-loaded units)
- liquid_density_template (system seed — น้ำเปล่า, นมสด, etc.)

### Sprint 1 Acceptance Criteria
- [x] Schema migrated successfully — all Sprint 1 tables live on Neon (through Part 8)
- [ ] RLS policies applied for all new tenant-scoped tables — **deferred to Sprint 7** (app-layer isolation via `withTenantContext` is the active guard; RLS inert per ADR 0004)
- [x] 16 default categories seeded on tenant creation (H.1.2) — verified Part 6 E2E
- [x] CRUD pages for Supplier — Part 5 ✅
- [x] CRUD pages for Product — Part 7a ✅ (RAW + base unit), Part 7b ✅ (multi-unit), Part 7c ✅ (PREPPED), Part 7d ✅ (liquid density)
- [x] CRUD pages for Category (3-tier: account → accounting_section → group)
- [x] Supplier-Product mapping UI — Part 8 ✅ (product-centric CRUD + history) + Part 9 ✅ (supplier-centric read views)
- [x] All Sprint 0 features still work — auth/tenant/dashboard retrofit in Part 5; exercised by every part's headless E2E

---

## Sprint 1 Part 7a — Products CRUD (RAW + base unit): ✅ COMPLETE (2026-05-24)

Grill-with-docs first (6 Qs locked) → split agreed: **7a = RAW + single base unit**, **7b = multi-unit + PREPPED + liquid density**. Built on the supplier/category template.

### Design locked (grill)
| Q | Decision |
|---|----------|
| Q1 | **Base unit = user-picked** from `unit_template` (filtered by `primaryDimension`) → one ProductUnit `isBase=true, isDefaultBuyUnit=true, toBaseRatio=1`. NOT auto-derived to SI. → **ADR 0005** |
| Q2 | 7a = **RAW only** (`type="RAW"` fixed, no selector); PREPPED → 7b |
| Q3 | `sku` **auto-gen** `P-####` when blank (scans P-#### incl. soft-deleted, max+1), override allowed; P2002 → `ProductSkuConflictError` → Thai (full unique, Pitfall #22) |
| Q4 | Form = `name, nameEn, sku, primaryDimension, baseUnit, categoryId, isActive`. `targetMarketPrice`/image/density/parent **deferred** |
| Q5 | Shared create+edit form; **all fields editable** (incl. dimension → re-pick base unit); update writes Product + base ProductUnit atomically. Base-unit/dimension **guard → 7b/Sprint 2** (once downstream refs exist) |
| Q6/6b | List = **3-tier category tree** (account→section→group→product leaf) reusing CategoryTree; "ไม่มีหมวด" bucket; client search + active-only toggle |

### Files
- `src/lib/validations/product.ts` (`productInputSchema`, `PRIMARY_DIMENSION_VALUES` single-source, Thai labels)
- `src/server/product.ts` (5 `*Logic` + `getUnitTemplates()` + sku auto-gen + atomic Product+baseUnit tx + `ProductSkuConflictError`/`InvalidBaseUnitError`)
- `src/app/products/actions.ts` (`createProduct`/`updateProduct`/`deleteProduct`, `ProductActionState`)
- `src/app/products/{layout,page,new/page,[id]/page}.tsx` + `_components/{ProductTree,ProductForm,DeleteProductButton,product-view}.tsx`
- `src/app/dashboard/page.tsx` — added `→ สินค้า/วัตถุดิบ` nav link
- `docs/adr/0005-product-base-unit-model.md`; CONTEXT.md +`Base unit`/`Default buy unit`
- Tests: `tests/product-logic.test.ts` (9 slices), `tests/product-input-schema.test.ts` (4)

### Verified
- vitest **39 passed | 4 skipped** (+13 new); `tsc --noEmit` clean on all new files (only 2 pre-existing `auth.ts:24` errors). RouteImpl errors were Pitfall #21 (stale typedRoutes manifest) → cleared after one `pnpm dev` compile of /products.
- E2E via headless magic-link login (reused Part-6 throwaway tenant `12cad010-…`): `/products` 200 authenticated (empty state), `/products/new` form renders with cascade initial state, **create round-trip via progressive-enhancement POST** → product persisted with auto-gen `P-0001`, base unit `l` (VOLUME), under "ไม่มีหมวด", rendered in tree. (Thai name showed as `?` only in the curl harness — Git Bash mangles UTF-8 in args; real code path stores Thai fine, see vitest.) Test product cleaned up.

### 7a hardening (post-review, 2026-05-24)
Chat review of 7a flagged a cross-tenant FK hole (categoryId accepted from input without tenant check — RLS inert until Sprint 7). Fixed before 7b:
- `src/server/product.ts`: `CrossTenantReferenceError` + generic `assertRefBelongsToTenant(tx, tenantId, kind, id)` (null = no-op; reused by 7b for `parentProductId`). Called in create + update.
- `actions.ts`: maps it → field error on `categoryId` ("หมวดบัญชีที่เลือกไม่ถูกต้อง").
- Test: +slice 10 (cross-tenant categoryId throws on create+update; null/own ok). vitest **40 passed | 4 skipped**; tsc clean (2 pre-existing `auth.ts` errors only).
- Logged Pitfall **#24** (`rethrowSkuConflict` catches P2002 broadly — narrow via `meta.target` in 7b) + **#25** (`generateSku` race — advisory lock at scale).

### Next: Part 7b — multi-unit (design LOCKED below). PREPPED + liquid density split out to **Part 7c**.

---

## Sprint 1 Part 7b — Multi-unit: ✅ COMPLETE (2026-05-25)

Grill-with-docs (Q1–Q5). **Scope split again (Q1): 7b = multi-unit ONLY**; PREPPED (parentProductId + yieldPercent, Decision #59) + liquid density → **7c**.

### Verified (2026-05-25)
- vitest **51 passed | 4 skipped** (`product-logic.test.ts` = 16: 7a's 10-slice regression + 7b L1/L4–L8; `product-input-schema.test.ts` = 9 S1–S4). `tsc --noEmit` clean (only the 2 pre-existing `auth.ts:24` errors). Both `/products` + `/products/new` compile in the Next runtime (no RSC/typedRoutes error).
- **Full headless E2E** (throwaway tenant `12cad010-…`, magic-link login): created a RAW product `kg` base + 2 additional units via progressive-enhancement POST → DB rows correct — `kg`(base, ratio 1, source=system), `sack-e2e`(custom, ratio 25, **default-buy**), `g`(source=system, ratio 0.001), all WEIGHT (ADR 0006), one base + one default-buy. Tree leaf showed `P-0001 · kg (+2)`; edit page prefilled both rows + the default-buy radio. Test product hard-deleted (frees `P-0001`).

### Files (delta on `4dbf09c`)
- Logic: `src/lib/validations/product.ts` (`additionalUnits[]` coerced+`.positive()`, `defaultBuyUnitName`, `.superRefine` unique-names + default-in-set), `src/server/product.ts` (`ProductUnitNameConflictError`, `templateNamesForDimension` source-detect, create→base+N additional, update→base-in-place + additional diff-by-`unitName` hard-delete, `rethrowOnUniqueConflict` narrow via `meta.target`). Tests: `product-logic.test.ts` L1/L4–L8, `product-input-schema.test.ts` S1–S4. `docs/adr/0006-multi-unit-single-dimension.md`; CONTEXT.md +Additional unit/Unit source.
- UI: `actions.ts` (`rawFromFormData` zips `additional_unit_name`/`_ratio` + `default_buy_unit_name`; maps `ProductUnitNameConflictError`→Thai), `product-view.ts` (`units[]`, `toBaseRatio.toString()`), `ProductForm.tsx` (Option A dynamic rows + default-buy radio, id-tracked so renames don't break the link), `ProductTree.tsx` (leaf `(+N)`).

### Next: Part 7c — PREPPED (parentProductId + yieldPercent, Decision #59) + liquid density. Grill first.

---

## Sprint 1 Part 7c — Products PREPPED: ✅ COMPLETE (2026-05-28)

Grill-with-docs (Q1–Q7) finished previous session — design locked, committed in `7c09472` (Decision #58 amendment + Pitfalls #26/#27/#28). **Scope split again (Q1): 7c = PREPPED only**; liquid density → **7d**. No migration needed: `parentProductId`, `yieldPercent`, `expectedYieldG`, `type` columns already exist on `Product`. Implementation = app-layer logic + UI only.

### Design locked (Q1–Q7 — compact; full record in ADR 0007 + Drive changelog v5)
| Q | Decision (one-liner) |
|---|----------|
| Q1 | Split: **7c = PREPPED only**, density → 7d. |
| Q2 | `parentProductId` may point to RAW or PREPPED; required for PREPPED, null for RAW. → **ADR 0007** |
| Q3 | `yieldPercent` required for PREPPED, null for RAW. Range `0.01–999.99`; `>100` allowed (no clamp). `expectedYieldG` deferred. Math = Decision #59. |
| Q4 | Full live-only depth check at write-time: `ancestorDepth(P)+1+descendantHeight(X) ≤ 5`. → **ADR 0007** |
| Q5 | Delete = **BLOCK** with live children (`ProductHasChildrenError`, Thai lists child names). → **ADR 0007** |
| Q6 | Type selector = fixed `RAW`/`PREPPED` (new `PRODUCT_TYPE_VALUES`). Type-change allowed on edit; **deferred type-change guard** Sprint 2+ → **ADR 0007** + CONTEXT.md. `sku` stays `P-####`. |
| Q7 | No new `@@unique`. Soft-delete + dangling-parent traps closed by Q4/Q5. Race → Pitfall #28 (deferred). |

### Decisions/Pitfalls recorded (committed `7c09472`)
- **Decision #58 amended** (`docs/changelog-v5-summary.md`): depth limit enforced at BOTH product write-time (parentProductId ancestor-walk, 7c) AND recipe recursion (Sprint 5). See ADR 0007.
- **Pitfall #26** Neon free-tier compute-hours quota — confirmed account-level suspend (the Part 7b blocker).
- **Pitfall #27** `ml_per_g` terminology bug — DEFERRED to 7d.
- **Pitfall #28** depth/cycle traversal race — accepted for MVP; advisory-lock fix at scale.

### Docs delivered this session (2026-05-26)
- `docs/adr/0007-prepped-parent-graph.md` — PREPPED parent model: chains allowed, depth/cycle write-time, delete-block-with-live-children, deferred type-change guard.
- `CONTEXT.md` — PREPPED entry sharpened (chains + depth + write-time enforcement); deferred type-change guard recorded.
- This section.

### Implementation (5-layer slice, TDD — per 7a/7b pattern)
0. **Docs first** — `7c09472`, `78b5875` (ADR 0007 + CONTEXT.md + sprint-progress section).
1. **zod** (`src/lib/validations/product.ts`) — `ab3720d`: added `type` (enum via new `PRODUCT_TYPE_VALUES`), `parentProductId` (uuid nullable), `yieldPercent` (coerced, 0.01–999.99). `.superRefine`: PREPPED → parent+yield required; RAW → both null. Thai labels. 16/16 tests green.
2. **logic** (`src/server/product.ts`) — `b585430`: `assertParentValid` (tenant via `assertRefBelongsToTenant("product")`, self-ref, cycle+depth via live-only ancestor-walk + descendant-DFS + visited-set); `ProductHasChildrenError`/`ProductParentCycleError`/`ProductDepthExceededError`; `deleteProductLogic` pre-check live children; force `type`/parent/yield consistency server-side. ADR 0007 amended: depth = **5 NODES** (formula ≤ 4 edges). 9 new tests L9–L17 (25/25 green).
3. **actions** (`src/app/products/actions.ts`) — `0196263`: read `type`/`parent_product_id`/`yield_percent` in `rawFromFormData`; RAW cleanse before zod; map parent/depth/cycle errors to Thai field errors; `ProductHasChildrenError` → delete-path Thai message with truncated child names.
4. **UI** — `4bc4a2b`: `ProductForm` type selector + conditional "การผลิต" section (parent picker with soft-deleted fallback option + yield input with >300% non-blocking soft hint, default 100 on first PREPPED toggle); `product-view.ts` add `parentProductId`/`parent {name,sku}`/`yieldPercent` (Decimal→string, Pitfall #20); `ProductTree` PREPPED amber pill; pages wire `getProductParentOptionsLogic` (live-only projection, self filtered at page layer for edit).
5. **verify** — this commit: vitest 67/4 + tsc clean (only 2 pre-existing `auth.ts:24` Sprint-0 errors). Headless E2E on throwaway tenant `12cad010-…` — 6 cases all green: (a) create RAW happy path; (b) create PREPPED + parent + yield → DB exact; (c) edit toggle RAW↔PREPPED both directions, PREPPED→RAW clears parent/yield server-side; (d) cycle attempt (A.parent=B when B is PREPPED of A) rejected with Thai field error "สินค้าแม่ที่เลือกจะทำให้เกิดวงจรอ้างอิง", DB unchanged; (e) delete-block on RAW with live PREPPED child throws `ProductHasChildrenError(childNames=["E2E7C-B PREPPED Test"])` → Thai "ลบไม่ได้ — สินค้านี้ยังถูกใช้เป็นสินค้าแม่ของ: E2E7C-B PREPPED Test"; (f) `/products` HTML contains 1 "แปรรูป" amber pill on the PREPPED leaf, none on RAW. ProductView JSON in the HTML stream confirms Pitfall #20 holds — `yieldPercent: "75"` as string, `parent: {name, sku}` populated. Test products hard-deleted post-run.

### Next: Part 7d — liquid density + Pitfall #27 (`ml_per_g` terminology bug).

---

## Sprint 1 Part 7d — Products liquid density: ✅ DONE (2026-05-31)

**Done:** Data-capture liquid density (g/ml) on Product — standard-template FK **XOR** a custom override, gated off COUNT, with **3-layer defense** (rawFromFormData cleanse → zod superRefine → \*Logic write cleanse) backed by a Postgres CHECK. Resolves **Pitfall #27** (`ml_per_g` terminology) by column rename, values unchanged. No conversion math / cost-engine / inheritance (all Sprint 2+). Verified: tsc clean (only pre-existing `auth.ts:24`), vitest 76✓/4 skip, and 6-case action-stack E2E (a–f) green on throwaway tenant.

Grill-with-docs (Q1–Q8) finished this session — design locked, full record in Drive doc (Q1–Q8 + rationale + rejected alternatives) and codified in **ADR 0008**. **Scope = data-capture only** (per 7c Q1 split + 7d Q6 lock): schema + zod + UI + view serializer; **no WEIGHT↔VOLUME conversion math, no cost-engine consumer, no density inheritance** — all deferred to Sprint 2+. Resolves Pitfall #27 (`ml_per_g` terminology bug) by rename, not value-flip.

### Design locked (Q1–Q8 — compact; full record in ADR 0008 + Drive Q1–Q8 doc)

| Q | Decision (one-liner) |
|---|----------|
| Q1 | **Pitfall #27 fix = rename column** `ml_per_g → g_per_ml`, `densityMlPerGOverride → densityGPerMlOverride`; values stay (already correct standard density). → **ADR 0008** |
| Q2 | **XOR** — template OR override, never both. Enforced at zod `.superRefine` + server cleanse + Postgres CHECK. Resolver `template?.gPerMl ?? override` is single-path. |
| Q3 | Density gated to `primaryDimension !== "COUNT"` (WEIGHT or VOLUME). Server cleanse COUNT→both-null **before** zod (mirrors 7c PREPPED→RAW cleanse ordering). |
| Q4 | zod hard `(0, 2.5]` + UI soft hint outside `[0.5, 2.0]` (custom mode only — template values are trusted). Pattern matches 7c yield-soft-hint. |
| Q5 | Own section "ความหนาแน่น (ของเหลว)" after "หน่วยวัด"; vertical 3-state radio (ไม่ระบุ / ใช้ค่ามาตรฐาน / ใส่ค่าเอง) + conditional sub-field; dropdown label `{name} — {gPerMl} g/ml` orderBy `displayOrder`; initial mode resolved from DB state. |
| Q6 | **Scope = data-capture only.** Gray areas locked: G1 ProductTree density badge SKIP; G2 detail/edit page density display INCLUDE (symmetry with 7c parent/yield); G3 "1ml ≈ Xg" preview SKIP (would open Sprint 2 conversion math). |
| Q7 | `LiquidDensityTemplate` stays **global non-deletable** (no `deletedAt`, no tenant). Seed pattern changes from `findFirst+create` to **upsert-by-name** (couples to Q8). Admin value updates propagate via FK on next read. |
| Q8 | `LiquidDensityTemplate.name @unique` — **FULL unique safe** because no soft-delete on this table (Pitfall #22/#23 family does NOT apply). Schema comment names the partial-index swap required IF `deletedAt` is ever added later. |

### Decisions/Pitfalls to record (Layer 0)

- **ADR 0008** `0008-liquid-density-g-per-ml.md` — full decision record: g/ml direction + XOR + global non-deletable; 4 considered options (rename chosen / flip-values rejected / override-wins rejected / soft-delete rejected) + 7 consequences.
- **Pitfall #27** marked **RESOLVED in Part 7d** with pointer to ADR 0008; original bug history left intact for context.
- **CONTEXT.md** "Liquid density" entry rewritten: g/ml direction + XOR rule + COUNT gate + global non-deletable nature.
- **No new ADR for Q7** (global non-deletable reference table) — natural default with `UnitTemplate` precedent.
- **No new Decision in changelog-v5** — Pitfall #27 fix is a terminology correction, not a new product decision.

### Migration plan (single file — `part_7d_density_data_capture`)

```sql
-- Q1: rename columns (values unchanged)
ALTER TABLE liquid_density_template RENAME COLUMN ml_per_g TO g_per_ml;
ALTER TABLE product RENAME COLUMN density_ml_per_g_override TO density_g_per_ml_override;
-- Q8: unique on name (full unique safe — no soft-delete on this table)
CREATE UNIQUE INDEX liquid_density_template_name_key ON liquid_density_template(name);
-- Q2: XOR — template OR override, never both
ALTER TABLE product ADD CONSTRAINT product_density_xor
  CHECK (liquid_density_template_id IS NULL OR density_g_per_ml_override IS NULL);
```

**Pre-migration safety checks** (run before `prisma migrate dev`): (a) duplicate names — `SELECT name, COUNT(*) FROM liquid_density_template GROUP BY name HAVING COUNT(*) > 1` expect 0 rows; (b) existing FK+override combos — `SELECT id FROM product WHERE liquid_density_template_id IS NOT NULL AND density_g_per_ml_override IS NOT NULL` expect 0 rows. If either returns rows → halt, fix the data, **never skip the constraint**.

### Implementation (7-layer slice, TDD — per 7a/7b/7c pattern)

| L | Layer | Status | Commit | Files |
|---|---|---|---|---|
| **L0** | **Docs** | ✅ done | `54550bd` (+ cleanup `563ba38`) | `docs/adr/0008-liquid-density-g-per-ml.md` (NEW), `CONTEXT.md` Liquid density entry, `.claude/skills/known-pitfalls/SKILL.md` Pitfall #27 → resolved, this section |
| L1 | Schema + migration + seed | ✅ done | `279df1e` | `prisma/schema.prisma` (rename fields + `@unique` on `name` + comment), `prisma/seed-system.ts` (key rename + `upsert by name` + 2 admin-update comments), migration SQL above (**applied to Neon**) |
| L2 | zod validation | ✅ done | `ff28a63` | `src/lib/validations/product.ts` — `liquidDensityTemplateId`, `densityGPerMlOverride`, `.superRefine` XOR + COUNT gate + range `(0, 2.5]` |
| L3 | Server logic | ✅ done | `c1aa596` | `src/server/product.ts` — COUNT write cleanse; `liquidDensityTemplate { select }` include on all 4 read sites; `assertLiquidDensityTemplateExists` (global `findFirst` by id) + `LiquidDensityTemplateNotFoundError` |
| L4 | Actions | ✅ done | `6c41785` | `src/app/products/actions.ts` — `rawFromFormData` COUNT cleanse (layer 1); map `LiquidDensityTemplateNotFoundError` → Thai field error |
| L5 | UI | ✅ done | `e31a919` | `ProductForm.tsx` (density section per Q5), `product-view.ts` (Decimal → string, Pitfall #20), `getLiquidDensityTemplates()` + `/products/new` + `/products/[id]` fetch `availableTemplates`. ProductTree leaf NOT touched (G1 SKIP). |
| L6 | Verify | ✅ done | _(this commit)_ | Baseline tsc + vitest 76✓/4 skip; 6-case action-stack E2E (a–f) on throwaway tenant `12cad010-…` — CREATE template/override, EDIT template→custom, EDIT VOLUME→COUNT cleanse, unknown-FK reject, XOR reject — all green, no ghost rows, test data + throwaway spec cleaned. |

### Standing items (carry-forward)

- **Pitfall #19** git hook inert — push works, safety net off.
- **Pitfall #26** Neon free-tier compute-hours quota — heads-up before heavy work.
- **Pitfall #28** depth/cycle traversal race — accepted for MVP.
- **Pitfall #29** Neon IPv6 — hosts-file IPv4 pin still required on Windows + Neon + no-IPv6-route environments (Prisma Rust engine ignores `--dns-result-order`). Re-resolve proxy IPs if Neon rotates them. Full detail in `known-pitfalls` #29.
- **Deferred guards (Sprint 2+)**:
  - ProductUnit-referenced-by-mapping (Part 8, ADR 0005 family)
  - base-unit / dimension change once downstream refs land (ADR 0005)
  - type-change guard (ADR 0007 family, CONTEXT.md)
  - **density inheritance PREPPED → parent** (new — from 7d Q3 lock; user explicitly picks density on PREPPED, no pre-fill from parent in MVP)
  - **ADR 0005 base-unit-change ↔ density interaction** (new — from 7d Q6 OUT; decide in Sprint 2+ when context is present)
- **Pre-existing tsc errors** `auth.ts:24` (Sprint-0 leftover) — out of scope.
- **`expectedYieldG`** column on Product — remains deferred (batch-size concept, Sprint 2-3); NOT gated on end-of-7d.

### Next: Part 8 — ProductUnit ↔ supplier mapping (ADR 0005 family); decide at session start whether to start now or pause.

---

## Sprint 1 Part 8 — Supplier-Product Mapping: ✅ COMPLETE (L0–L6, 2026-05-31 → 2026-06-06)

Branch-aware supplier price list (`supplier_product_mapping`). Grill-with-docs (Q1–Q10) locked this session — full record in Drive doc **"Part 8 Grill Decisions"** (fileId: `15kzp0miM8QAR-BJRzQ23TVfIZ1gm0ji42NcYyp6CT8Y`) and codified in **ADR 0009**. **Scope = data-capture only** (Q9): mapping CRUD + append/supersede price history + branch override + guards; the PO / cost-engine **consumer is Sprint 2**.

### Design locked (Q1–Q10 — compact; full record in ADR 0009 + Drive doc)

| Q | Decision (one-liner) |
|---|----------|
| Q1 | `effectiveFrom` **NOT NULL** (migration + zod required), default = today if blank. Fixes spec drift (was nullable → unique-key hole). |
| Q2 | `effectiveFrom`/`effectiveTo` → **`@db.Date`** (Postgres `date`, not timestamp). Audit "when entered" = `createdAt`. Avoids tz off-by-one (Decision #60). |
| Q3 | Multi-supplier/product = **unbounded**; **`isPreferred` ≤ 1** per (product, branch-scope), app-enforced (mirror 7b `isDefaultBuyUnit`); branch-override + tenant-default **coexist**. |
| Q4 | **Time-series append + supersede**: new price closes old row's `effectiveTo` + inserts open row. Overlap **block**, future-dated **allow**, `effectiveTo=null`=current. Lookup `today BETWEEN from AND COALESCE(to,'infinity')`. |
| Q5 | (i) write-val `orderUnit ∈ product(live)` + (ii) **deletion guard** (block removing a ProductUnit referenced by a live mapping — ADR 0005/0006 guard, now active); (iii) dimension-change ↔ orderUnit → **defer Sprint 2**. |
| Q6 | **Cascade-with-user-control**: soft-delete supplier/product cascades to mappings, but UI shows **blast-radius count** + confirm first. Hide-not-destroy (ADR 0009). |
| Q7 | Branch override `branchId` set **wholly replaces** tenant default (`branchId` null) for that branch; resolve branch-first → fallback default. UI = **minimal branch selector**. |
| Q8 | price **optional ≥ 0**; minOrderQty `> 0`; leadTimeDays `0–365`; supplierItemCode max 64 / Name max 200; isPreferred default false. |
| Q9 | Scope **data-capture only**, **product-centric** UI, **price-history viewer IN**. OUT (Sprint 2): PO consumer, price auto-pick, cost engine, rich branch-diff UI, dim-change guard. |
| Q10 | Replace `@@unique` with manual **PARTIAL unique** (`prisma/manual/supplier_product_mapping_unique.sql`): `WHERE deleted_at IS NULL` + **`NULLS NOT DISTINCT`**; drop old full unique. Closes Pitfall #22/#23 trap + NULL-`branchId` duplicate-default hole. |

### Implementation (7-layer slice, TDD — per 7a–7d pattern)

| L | Layer | Status | Commit | Files |
|---|---|---|---|---|
| **L0** | Docs | ✅ done | `a2840c3` | `docs/adr/0009-supplier-product-mapping-time-series.md` (NEW), `CONTEXT.md` (Supplier-Product Mapping + Orphan mapping + Hide-not-delete + Branch override), this section |
| L1 | Schema + migration + manual SQL | ✅ done | `26894df` | `prisma/schema.prisma` (`effectiveFrom` NOT NULL + `@db.Date` + drop full `@@unique`), `prisma/manual/supplier_product_mapping_unique.sql` (partial + NULLS NOT DISTINCT, **applied**) |
| L2 | zod validation | ✅ done | `36a9870` | `src/lib/validations/supplier-product-mapping.ts` — fields + ranges (Q8), `effectiveTo > effectiveFrom` (Q4) |
| L3a | Server logic (greenfield) | ✅ done | `0decb1c` | `src/server/supplier-product-mapping.ts` — 7 `*Logic` + 3 typed errors (Overlap/OrderUnitMismatch/MappingNotFound); CRUD + supersede/overlap (Q4), orderUnit write-val (Q5i), isPreferred singleton (Q3b), history read. **15 slices M1–M15** |
| L3b | Server logic (cross-slice) | ✅ done | `b40642f` | ProductUnit deletion guard (Q5ii) + `delete*Logic` cascade with user-selected mapping ids (Q6) + widen `TenantScopedRef` (supplier/product/branch) |
| L4 | Actions | ✅ done | `e4b4306` | `src/app/supplier-product-mappings/actions.ts` (top-level, Q9 dual-nav) — 3 mapping actions + 5 Thai error paths; cascade array param wired into `products/actions.ts` `deleteProduct` + `suppliers/actions.ts` `deleteSupplier` (+2 Thai paths) |
| L5a-1 | Read UI | ✅ done | `fdd6cd8` | `_components/{MappingListSection,MappingHistoryViewer}.tsx` + `mapping-view.ts` serializer (Decimal→string, Pitfall #20) + product page integration |
| L5a-2 | Write UI | ✅ done | `66e623d` | `MappingForm.tsx` (shared create/edit, branch selector, edit-mode identity lock) + `mappings/new` & `mappings/[mappingId]/edit` routes + `DeleteMappingButton.tsx` + `src/server/branch.ts` (NEW `getBranchesLogic`) |
| L5b | Cascade delete dialog | ✅ done | `c1eb30d` | `src/components/ui/CascadeDeleteDialog.tsx` (NEW, generic, default-all + tri-state) + `DeleteProductButton`/`DeleteSupplierButton` wiring + product/supplier page cascadeItems build |
| **L5c** | Supplier-centric mapping views | ⏭️ **deferred → Part 9** | — | NOT a free mirror (product-name labels + re-opens cross-view revalidation). See "Deferred slices" below. |
| L6 | Verify | ✅ done | _(this commit)_ | Baseline **tsc clean** (only `auth.ts:24`) + **vitest 108✓/4 skip**; **12-case action-stack E2E** (E1–E12) on a throwaway tenant via throwaway spec+config — `createMappingAction` ×5 (happy+branch / neg-price→`currentUnitPrice` / orderUnit-mismatch→`orderUnitId` / cross-tenant→`supplierId` / overlap→`formError`), `updateMappingAction` ×2 (happy / bad-id→`formError`), `deleteMappingAction` ×2 (happy / bad-id), `deleteProduct` cascade ×2 (both soft-del / bad-mappingId→rollback), `deleteSupplier` cascade ×1 — all green, FK-order hard-delete cleanup, throwaway spec+config deleted (never committed). |

### Deferred slices (Part 9 / Sprint 2+ / Part 8.5)

- **L5c — Supplier-centric mapping views → Part 9**: read/write price list on the supplier detail page. NOT a free mirror of L5a — `MappingListSection`/`MappingHistoryViewer` are product-centric (label rows by supplier name); the supplier view needs product-name labels → component generalization is real design work. Also re-opens the `e4b4306` cross-view revalidation deferral (resolve when both views are designed together). Core Part 8 value (data capture + product-centric read/write + cross-slice cascade) is complete; push gate was L6, not L5c.
- **Part 8.5 — Restore-on-recreate**: un-soft-deleting a Product/Supplier bringing back its cascaded mappings. Product-layer lifecycle, not mapping-layer; MVP has no restore UI. (ADR 0009.)
- **Sprint 2 — PO consumer**: must **snapshot** mapping price/orderUnit at order time, NOT live FK lookup (preserve historical stock value). Price auto-pick, cost-engine read. (ADR 0009.)
- **Sprint 2 — dimension-change ↔ orderUnit guard** (Q5 iii); **rich branch-override diff UI** (Q7).

### Standing items (carry-forward)
- **Pitfall #29** Neon IPv6 — hosts-file IPv4 pin still required on Windows (see `known-pitfalls` #29).
- **Pitfall #20** Decimal across RSC — mapping `currentUnitPrice` / `minOrderQty` need the view serializer.
- **Pitfall #22/#23** FULL `@@unique` soft-delete trap — avoided via Q10 partial index.

### Known limitations (carried forward — NOT bugs)
- **`b40642f` stale double-submit**: valid live mappings of an already-deleted parent get soft-deleted while the parent `updateMany` matches 0 rows → returns false. Benign; not reachable from the normal L4/L5 flow.
- **`e4b4306` cross-view revalidation**: `deleteProduct`/`deleteSupplier` revalidate only their own list page; cascaded mappings on the OPPOSITE detail page stay stale until navigation. Bypassed while UI is product-centric only; **L5c (Part 9) resolves it** when the supplier-centric read view is wired.

### Next: Part 9 — Sprint 1 wrap-up (owns L5c supplier-centric views holistically). Part 8 L0–L6 ready for batch push (10 commits).

---

## Sprint 1 Part 9 — Wrap-up (L5c + final sweep + sign-off): ✅ COMPLETE (2026-06-07)

Sprint closing pass — owns the L5c slice deferred from Part 8, the final test sweep, and Sprint 1 sign-off. Not a grill slice; the 3 open L5c design decisions were resolved at session start (below).

### L5c design decisions (locked this session)
| # | Decision | Choice |
|---|----------|--------|
| (i) | Component strategy | **Generalize** — `MappingListSection` + `MappingHistoryViewer` gain a `perspective: "product" \| "supplier"` prop; the view layer (`mapping-view.ts`) now also carries the product side (`product`, `productDeleted`). DRY — only the labelled "other side", orphan flag, and edit-link base flip. |
| (ii) | Cross-view revalidation | **Aggressive** — the cascade `deleteProduct`/`deleteSupplier` actions now also revalidate the OPPOSITE detail page for each affected counterpart. (Mapping CRUD already dual-revalidated via `revalidateMappingViews`.) Closes the `e4b4306` known-limitation. |
| (iii) | Supplier-centric write surface | **View-only + edit link** — the supplier section is read-only; each row links to the existing product-centric edit route. No new routes/forms (write stays product-centric, Q9). |

### Changes
- `src/app/products/_components/mapping-view.ts` — `MappingView` + `PriceHistorySeries` carry `product` / `productDeleted`; `toMappingView` projects them; `seriesKeyOf` param generalized (primary id = supplier on a product page, product on a supplier page).
- `MappingListSection.tsx` / `MappingHistoryViewer.tsx` — `perspective` prop (default `"product"`, so the product page is unchanged); per-perspective copy / orphan flag / labels; create CTA shown on the product perspective only.
- `src/app/suppliers/[id]/page.tsx` — wires the read-only list + price-history (supplier perspective) with a per-(product, branch) history loop mirroring the product page; cascade-dialog items now derive from the serialized views (no raw Decimal).
- `src/app/products/actions.ts` + `src/app/suppliers/actions.ts` — cascade delete actions read the affected counterpart ids before the delete and revalidate those detail pages (decision ii).
- `src/lib/auth.ts` — cleared the 2 long-standing `auth.ts:24` tsc errors with a trivial inline param type annotation (no behavior change).
- `docs/adr/0001..0003` — added `status: accepted` frontmatter (were missing it; 0004-0009 already had it).

### Verified
- `pnpm tsc --noEmit` — **fully clean** (the `auth.ts:24` baseline is now gone).
- `pnpm vitest run` — **108 passed / 4 skipped** (unchanged; L5c is UI/serializer + revalidation glue — no new unit tests, per the actions-are-thin-glue convention).
- ADRs 0001-0009 all `status: accepted`; Pitfalls #19-#29 all captured in `known-pitfalls/SKILL.md`.

### Known limitations
- **`e4b4306` cross-view revalidation** — **RESOLVED** by decision (ii); the opposite detail page no longer stays stale after a cascade delete.
- **`b40642f` stale double-submit** — still carried forward (benign; not reachable from the normal flow).

### Sprint 1 — ✅ COMPLETE
9 parts shipped (5, 6, 7a–7d, 8, 9). All acceptance criteria met **except** RLS-policies-applied, intentionally deferred to Sprint 7 per ADR 0004 (app-layer isolation via `withTenantContext` is the active guard). Deferred to later: **Part 8.5** (restore-on-recreate), **Sprint 2** PO/cost-engine consumer + deferred guards (dimension-change↔orderUnit, base-unit↔density, density inheritance PREPPED→parent, type-change), **Prisma 5.22→7.x** upgrade.

### Next: Sprint 2 — Procurement (PO/GR allocation + mirror triggers). Part 8.5 (restore-on-recreate) is a candidate to fold in or run standalone first — user decides. **→ Run standalone first as a Sprint-2 pre-flight warm-up (see Part 8.5 below).**

---

## Sprint 1 Part 8.5 — Restore-on-recreate: ✅ COMPLETE (L0–L6, 2026-06-11 → 2026-06-18)

Warm-up slice run **standalone before Sprint 2 core** (Stock Movement + PO/GR + Cost Engine). Closes the Sprint 1 carry-forward (restore-on-recreate, deferred in ADR 0009) and lands the `Product.sku` partial-unique fix the transactional foundation would have hit anyway. Grill-with-docs (Q1–Q8) finished previous session — design locked in Drive doc `1DlVifFHjfP6D--6h_0ZgKEIffSjfN_CILtp6uoQzFk4`, captured in **ADR 0010**.

### Design locked (Q1–Q8 — compact; full record in ADR 0010 + Drive grill doc)
| Q | Decision (one-liner) |
|---|----------|
| Q1 | Fuzzy match `pg_trgm` **threshold 0.4**, top 10 (5 shown + "ดูเพิ่มอีก 5"), coarse badge (>0.7 ตรงกันมาก / 0.5–0.7 ใกล้เคียง / 0.4–0.5 อาจเกี่ยวข้อง — raw score hidden); scope = soft-deleted only (`deletedAt IS NOT NULL`). |
| Q2 | Search **name + sku** via `GREATEST(similarity(name), similarity(sku))`; `matched_on` tag ('name'\|'sku') per row. Two partial GIN indexes `WHERE deleted_at IS NOT NULL`. |
| Q3 | Typeahead triggers on **name only** (sku is auto-gen, not searched-via); min 3 chars, 400 ms debounce, no dropdown on empty. |
| Q4 | Restore = idempotent `UPDATE … SET deletedAt=null, updatedAt=NOW() WHERE id=$1 AND deletedAt IS NOT NULL`; **re-use existing ID**; all fields revert; kept-live orphan mappings auto-recover via unchanged FK. |
| Q5 | Live-product **sku collision** detected at search time (warning badge) → restore dialog shows `newSku` input (default `{sku}-restored`, user-editable), validated against the partial unique. |
| Q6 | **Orphan = kept-live mappings** (`productId=restored, deletedAt IS NULL`), **not** cascade-deleted ones. Restore doesn't touch mappings by default; recoverable-mappings preview (top 3 by isPreferred DESC, effectiveFrom DESC) in the suggestion row. |
| Q7 | **Force price review** (Option C, no threshold) when orphan mappings exist; radio per row (default ใช้ราคาเดิม / อัปเดต reveals price/min-qty/lead inputs, Sprint 1 zod). Same-day (`effectiveFrom=today`) **overwrite in-place** (Option ε); else ADR 0009 supersede. |
| Q8 | **No dedicated audit log** (Option A) — reuse `product.updatedAt`/`deletedAt`, mapping `updatedAt`, Part 8 history viewer. |

### Schema-consistency fix (bundled, L1)
- Remove `Product.sku` FULL `@@unique([tenantId, sku])` from `schema.prisma` → manual **PARTIAL** unique `WHERE deleted_at IS NULL` in `prisma/manual/product_sku_unique.sql` (mirrors `supplier_code_unique.sql` / `supplier_product_mapping_unique.sql`). **Closes Pitfall #23** (Product.sku FULL-unique soft-delete trap, the #22/#23 ghost-row family) as a bonus. **NOT** Pitfall #25 (generateSku concurrent-scan race) — that still needs an advisory lock / DB sequence (deferred).

### Implementation (L0–L6 — TDD vertical slices; 12 commits, batch-pushed at L6)

| L | Layer | Commit | Note |
|---|---|---|---|
| **L0** | Docs — ADR 0010 + this section + CONTEXT.md glossary | `47b2aac` | |
| L1 | Schema — `Product.sku` FULL→PARTIAL unique (`prisma/manual/product_sku_unique.sql`) + 2 `pg_trgm` partial GIN indexes | `4e30c80` | **closes Pitfall #23**; 108 tests stayed green |
| L2 | zod — `newSku` + mapping-update + fuzzy-search schemas (`src/lib/validations/product-restore.ts`) | `057df2a` | |
| L3a | Read logic — `fuzzySearchSoftDeletedProductsLogic` · `getOrphanMappingsForProductLogic` · `detectSkuConflictLogic` | `4a1a702` | |
| L3b | Write logic — `restoreProductLogic` + Bangkok-TZ same-day overwrite vs supersede + `ProductNotFoundError` | `acf75c0` | |
| L3b | refactor — return `affectedSupplierIds` (ALL live orphan suppliers, DISTINCT) for cross-view revalidation | `f33a657` | grill Amendment #2 |
| L4 | Actions — `restoreProductAction` + `searchSoftDeletedProductsAction` + inline Thai error mapping + cross-view revalidation | `3933e42` | |
| L5a | UI — `RestoreSuggestionTypeahead` (3-char/400 ms debounce, stale-guard) | `8ea0f17` | |
| L5b | `OrphanMappingRow` serializer + `getOrphanMappingsForProductAction` (Decimal→string, Pitfall #20) | `24b75ac` | |
| L5b | `RestoreDialog` — conditional sku-conflict + per-orphan price-review, FormData fanout (5 parallel arrays zipped by index) | `c4e0711` | |
| L5c | Integrate typeahead + dialog into `ProductForm` create flow | `ec88785` | dialog mounted OUTSIDE `<form>` (saved nested-form HTML bug) |
| **L6** | E2E throwaway action-stack + this COMPLETE flip | _(this commit)_ | 7-case throwaway (E1–E7), spec+config deleted (never committed) |

### Verified
- `pnpm tsc --noEmit` — **clean** (EXIT 0).
- `pnpm vitest run` — **154 passed / 4 skipped** (108 Sprint 1 + 18 L2 + 15 L3a + 13 L3b; the throwaway adds 0 to the committed suite).
- **7-case throwaway action-stack E2E** (E1–E7) green on the throwaway tenant — direct-return reads · Decimal→string serialization · FormData fanout zip → supersede · zod dotted-path field-errors · the 2-branch Thai sku-conflict fork (`newSku` field vs original-sku form) · `ProductNotFoundError` re-restore fork — then the throwaway spec + config were **deleted** (never committed; 7c/7d/8 L6 precedent).
- **Standing item — vitest real-Neon parallel flakiness**: on a red run, re-run ONCE before treating it as a regression; duplicate-key `prisma:error` lines are EXPECTED (tests assert the throw). Fix deferred post-Sprint 2.

### Risk surfaces (from grill)
1. `pg_trgm` permission on Neon — **verified OK before L1** (fallback `ILIKE` not needed). 2. SKU FULL→partial swap — 108 tests stayed green (verified L1). 3. Restore-dialog 0–2 conditional sections — component must handle all combos. 4. Same-day overwrite — Bangkok UTC+7 date handling (Decision #60).

### Standing items (carried in)
Pitfall #19 (git hook inert — push manual), #26 (Neon free-tier quota — `pg_trgm` heads-up), #28 (depth/cycle race — accepted MVP), #29 (Neon IPv6 hosts pin). #23 (Product.sku FULL-unique trap) → **CLOSED** by L1 partial unique; #25 (generateSku race) NOT addressed — advisory-lock fix still deferred. `b40642f` (stale double-submit) — benign; `e4b4306` (cross-view revalidation) — CLOSED in Part 9.

### Next: Sprint 2 — Stock Movement foundation (append-only ledger; then PO/GR allocation + mirror triggers, master-spec-v1.4.md §32). Part 8.5 warm-up closes the Sprint 1 restore carry-forward; HEAD on origin/main = the L6 commit.

---

## Sprint 1 Part 6 — Categories CRUD: ✅ COMPLETE (2026-05-23)

3-tier category (account COGS/OpEx → accountingSection → groupName), built on the supplier slice as template.

### Design (locked this session)
- `account` = fixed 2-value `<select>` (COGS/OpEx) — `ACCOUNT_VALUES` const is single source for the zod enum + the form. section/group = free text.
- List = **tree view** (account → section → leaf), default all-expanded, client search w/ auto-expand, counts per node. Leaf links to edit page; delete lives on edit page.
- Category `@@unique` is **full** (not partial like supplier) → soft-deleted triple still blocks re-create. MVP-accepted, see Pitfall #22; action maps P2002 → "หมวดบัญชีนี้มีอยู่แล้ว (หากเคยลบไปแล้ว จะยังสร้างซ้ำไม่ได้)".
- No `category-view.ts` serializer — Category has no Decimal (Pitfall #20 N/A).

### Files
- `src/lib/validations/category.ts` (`categoryInputSchema`, `ACCOUNT_VALUES`, `ACCOUNT_LABELS_TH` Thai-first, `CATEGORY_FIELD_LABELS_TH`)
- `src/server/category.ts` (5 `*Logic` + `CategoryConflictError`)
- `src/app/categories/actions.ts` (`createCategory`/`updateCategory`/`deleteCategory`, `CategoryActionState`)
- `src/app/categories/{layout,page,new/page,[id]/page}.tsx` + `_components/{CategoryTree,CategoryForm,DeleteCategoryButton}.tsx`
- `src/app/dashboard/page.tsx` — added `→ หมวดบัญชี` nav link
- Tests: `tests/category-logic.test.ts` (7 slices), `tests/category-input-schema.test.ts` (3)

### Verified
- vitest **26 passed | 4 skipped** (+10 new); tsc clean on all new files (only 2 pre-existing `auth.ts` errors).
- E2E via **fresh headless signup** → `createTenant` seeded **16** categories → tree rendered full COGS/OpEx structure (8 sections, 16 leaves, Thai-gloss headers). create→17, duplicate(COGS/Food/Meat)→Thai conflict, edit(account COGS→OpEx)→re-rendered, delete→back to 16.
- **Throwaway E2E tenant (for later cleanup):** `12cad010-f6f0-4746-8d9a-bb65782a453f` (name "ร้านทดสอบ Category E2E", user `cat-e2e-1779531021@test.local`). Harmless; remove with the Sprint-0 `asfsafas` cleanup later.

### Next: Part 7 — Products CRUD (RAW/PREPPED, multi-unit, yield_percent — has Decimal → needs a `product-view.ts` serializer, Pitfall #20).

---

## Sprint 1 Part 5 — Suppliers CRUD: ✅ COMPLETE (2026-05-23)

Grill-with-docs session finished. 8 decisions locked. All 7 steps implemented + verified.

### Step 7 (pages) — done 2026-05-23
- `suppliers/layout.tsx` (shared header) · `page.tsx` + `_components/SupplierList.tsx` (list + client search + active/inactive toggle) · `new/page.tsx` · `[id]/page.tsx` (edit) · `_components/SupplierForm.tsx` (shared create+edit form via `useActionState`) · `_components/DeleteSupplierButton.tsx` (confirm → soft-delete).
- **Deviation from plan:** Prisma `Decimal` can't cross the Server→Client boundary, so added `_components/supplier-view.ts` (`toSupplierView`) — serializes the two rate fields to strings before passing rows into client components (replaces the handoff's `?.toString()`-at-render note). `[id]/page.tsx` uses Next 15 async `params` (`await params`) to stay tsc-clean.
- **Verified:** `tsc --noEmit` clean for all new files (only the 2 pre-existing `auth.ts:24` errors remain); vitest 16 passed | 4 skipped; E2E via headless dev-login — create round-trips and shows in list, edit page pre-fills, soft-delete drops the row back to the empty state, auth-gate redirects unauthenticated to /login.

### Next: Part 6 — Categories CRUD (reuse the supplier slice as template).

---

## Sprint 1 Part 5 — Design Locked (grill complete 2026-05-21)

Grill-with-docs session finished. 8 decisions locked.

### Decisions (Q1–Q8)

| Q | Decision | Recorded |
|---|----------|----------|
| Q1 | All tenant-scoped reads/writes via `withTenantContext(tenantId, tx=>…)`, not bare prisma. Suppliers = first adopter. FORCE RLS deferred to Sprint 7. | ADR 0004 |
| Q2 | New `requireTenant()` helper (`src/lib/`) → `{session,user,membership,tenantId}`. Layer 1 = membership discovery by userId (bare prisma, cross-tenant by nature); layer 2 = scoped queries in wrapper after tenantId known. First-active-membership, no switcher. Permission check NOT in helper (SRP). | ADR 0004 |
| Q3 | Split pure logic + thin wrapper. `src/server/supplier.ts` = `create/update/delete/get/getById SupplierLogic` (`*Logic` suffix, tenantId = first arg, testable). `src/app/suppliers/actions.ts` = `"use server"` thin wrappers (requireTenant + zod → call *Logic). Read-Logic called directly by Server Components. | ADR 0004 |
| Q4 | Full 15-field form, 4 sections (basic/contact/tax/other), progressive disclosure. Tax section always visible. VAT toggle → rate prefill 7.00 from `tenant.defaultVatRatePercent`; WHT toggle → rate blank (user enters per service type). **VAT/WHT decoupling** confirmed (see CONTEXT.md). | CONTEXT.md |
| Q5a | `code` uniqueness = **DB partial unique index** via `prisma/manual/` (`CREATE UNIQUE INDEX … ON supplier (tenant_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL`). Prisma 5.22 can't express partial unique → lives in manual SQL only; add comment in schema pointing to it. Logic catches Prisma **P2002** → Thai error. | — |
| Q5b | Single `supplierInputSchema` (zod) for create + update. `nameFull` required (trim, max 200); optional strings empty→null; `contactEmail` `.email()` when present; `contactPhone` loose; `taxId` `/^\d{13}$/` when present; rates 0–100 (2dp), nullable. Conditional (superRefine): VAT-registered → VAT rate required; subject-to-WHT → WHT rate required. | — |
| Q6 | Soft-delete: set `deletedAt`; confirm dialog; list filters `deletedAt: null`; **no restore** in MVP. Delete allowed without blocking on SupplierProductMapping (soft-delete preserves row → FK intact). "linked-products" warning = deferred nice-to-have. | — |
| Q7 | List page (`page.tsx`, Server Component → `getSuppliersLogic`): columns = name(→edit) / code / contact / VAT-WHT badge / isActive / actions. Search = client island over rendered list. Active toggle (default: active only). Default sort `nameFull`. 2 empty states. **No pagination** in MVP. | — |
| Q8 | Nav: inline `/suppliers` link on dashboard (next to /settings) + minimal `suppliers/layout.tsx` (title + "← กลับหน้าหลัก" back link). Global shared nav deferred to a later slice (~Part 6 when Products/Categories land). | — |

### Implementation plan (7 steps, dependency order)

1. **`requireTenant()` helper** (`src/lib/`) — foundational.
2. **Retrofit chore** — dashboard + settings → `requireTenant()` + `withTenantContext` (Q2 prerequisite). Add `/suppliers` nav link to dashboard here (same file currently uses bare prisma + `memberships[0]`).
3. **Manual SQL** — partial unique index in `prisma/manual/` → apply to Neon via DIRECT_URL.
4. **zod** — `supplierInputSchema`.
5. **`src/server/supplier.ts`** — 5 `*Logic` fns. **TDD: RLS isolation test (tenant A vs B) first** = highest value, no auth mock needed → invoke `tdd` skill here.
6. **`src/app/suppliers/actions.ts`** — thin `"use server"` wrappers + P2002→Thai mapping.
7. **Pages** — `page.tsx` (+ search island) · `new/page.tsx` · `[id]/page.tsx` · `layout.tsx`.

### Open standing item
- **Pitfall #19 (git hook):** confirmed broken (jq missing → fails open). Deferred fix = rewrite hook with grep/sed, Tier 2 task. Until then `git push` must be done manually after each commit (it is NOT being blocked, but the safety net is off).

---

## Sprint 0 — Foundation ✅ COMPLETE

**Completed:** 2026-05-17

### What works
- Next.js 15 + TypeScript + Tailwind + Prisma + Neon Postgres
- Auth.js v5 email magic link (dev mode console-log)
- Tenant + Branch + Department + RLS
- Signup → Magic link → Dashboard flow tested end-to-end
- 7 Identity tables migrated
- RLS policies applied via Neon SQL Editor

### Known issues to revisit (deferred)
- Next.js 15.0.3 has CVE-2025-66478 → upgrade before production (Sprint 7)
- React 19 + Next 15.0.3 peer dep conflict → workaround: --legacy-peer-deps
- RLS test suite not yet run → do before Sprint 1 ends

---

## Future Sprints (per Master Spec section 32)

- Sprint 2 (W5-7): Procurement + PO/GR allocation + Mirror triggers
- Sprint 3 (W8-9): Stock + Expense + Yield-correct CONSUMPTION
- Sprint 4 (W10-11): POS Sync + Mirror + Diff queue
- Sprint 5 (W12-13): Recipe + Cost Engine + Cost cascade + **Menu Lab** (Pending Feature)
- Sprint 6 (W14): Dashboards + Matrix + Variance + **Price Volatility** (Pending Feature)
- Sprint 7 (W15-16): Polish + Beta + Test suite + Production deployment

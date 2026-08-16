# Mise Sprint Progress

**Last updated:** 2026-07-05

## Current Sprint: Sprint 2 — Transactional Systems 🚧 IN PROGRESS

**Status:** 🚧 Part 10 (Stock Movement) ✅ COMPLETE (2026-08-15) + post-completion review closed (1 fix, 3 items carried to Part 13 — **all three paid in Part 13 L1b**) · Part 11 (Purchase Order) ✅ COMPLETE (L0–L6, 2026-08-16) · Part 13 (Goods Receipt) ✅ COMPLETE (L0–L6, 2026-08-16) · Part 13.5 (carry-forward debt payoff) ✅ COMPLETE (L0–L3, 2026-08-16) → **next: Part 14 — Cost Engine** (Part 12 left unallocated, see the Part 11 section).
**Scope:** Stock Movement (append-only ledger) → PO → GR → Cost Engine per master-spec.md (Part IV — Sprint Plan). Part 10 is the **first proper Sprint 2 slice** (Part 8.5 was a Sprint 1 restore-on-recreate warm-up, run standalone before the Sprint 2 core). Sprint 1 completion history is retained under its own header below.

---

## Sprint 1 — Master Data: ✅ COMPLETE (2026-06-07)

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

### Next: Sprint 2 — Stock Movement foundation (append-only ledger; then PO/GR allocation + mirror triggers, master-spec.md Part IV — Sprint Plan). Part 8.5 warm-up closes the Sprint 1 restore carry-forward; HEAD on origin/main = the L6 commit.

---

## Sprint 2 Part 10 — Stock Movement: ✅ COMPLETE (L0–L6, 2026-07-05 → 2026-08-15)

First transactional Part of Sprint 2 — the **append-only stock ledger** every later Part (PO/GR/Cost Engine) sits on. Grill-with-docs (Q1–Q10) locked 2026-06-20 — full record in Drive doc **"Sprint 2 Part 10 GRILL DECISIONS"** (fileId `10aiHL24jMSmqHQ8gfl8bPOh5k0liPRtrmUCVJdX-eIs`), codified in **ADR 0011**. **Scope = ledger foundation + manual adjustment source**: `stock_movement` + `stock_adjustment` tables, base-unit-normalised signed ledger, balance/history reads, and the adjust / stock-levels / history UI. Part 13 (GR) + Part 14 (Cost Engine) are pure **consumers** of these primitives. Design philosophy: **financial integrity > convenience** — immutable ledger, compensating entries for corrections.

### Design locked (Q1–Q10 — compact; full record in ADR 0011 + Drive grill doc)
| Q | Decision (one-liner) |
|---|----------|
| Q1 | **Qty in base unit** (`product.primaryDimension`), normalised at the action layer via `ProductUnit.toBaseRatio` before INSERT; balance = `SUM(qty)` with no JOIN/ratio math; past rows immune to ratio edits. As-entered unit preserved on the source. |
| Q2 | **Signed qty** `Decimal(15,3)` (+ in / − out) + DB `CHECK` (`prisma/manual/stock_movement_sign_check.sql`) binding sign↔type. Balance = direct `SUM`. Standing item: new type ⇒ update CHECK + re-apply. |
| Q3 | **Polymorphic source** — `source_type` enum + `source_id` uuid, **no FK** (ledger outlives sources); app asserts source exists before INSERT. New source type = append-only enum `ALTER`. |
| Q4 | **`UNIQUE(source_type, source_id)` + 1:1** (one source row → one movement). Source+movement in the same TX; `P2002` retry = idempotent success. Movement layer **insert-only**; corrections = compensating source rows. |
| Q5 | **Two timestamps** — `occurred_at` (business time, backdatable, zod `[today−90d, today]`) + `created_at` (audit, immutable). Order by `(occurred_at, created_at)` for cost calc. Bangkok TZ via `computeBangkokToday()` (Part 8.5). |
| Q6 | **`branch_id` NOT NULL**, FK RESTRICT; Sprint 1 tenant/branch/deletedAt assertions reused. **L0 pre-task PASSED** — onboarding guarantees ≥1 branch (see below). No prep task. |
| Q7 | **Strict append-only** — no `deletedAt`, no update/delete logic. Audit = `tenant_id` + `created_by` FK + `notes`. Corrections compensate (Q4). AP discrepancy captured on GR line (Part 13), never by mutating a movement. |
| Q8 | **Realtime `SUM` + composite index** (`stock_movement_chronological_idx`, leftmost-prefix covers the balance SUM — `balance_idx` collapsed at L0 review); `asOf` time-travel; `Decimal`→string at view (Pitfall #20); no trigger (revalidatePath). Snapshot+delta migration deferred to Sprint 5+. |
| Q9 | **Negative balance allowed** — action never blocks, returns `{ movement, postBalance }`; L5 preview + red warning banner + explicit confirm; dashboard red "ต้องตรวจสอบ" badge. Per-tenant toggle Sprint 5+. |
| Q10 | **MVP scope** — 3 movement types (`PO_RECEIVE` / `ADJUST_GAIN` / `ADJUST_LOSS`) + 3 sources (`GR_LINE` / `ADJUSTMENT` / `SYSTEM_INITIAL` reserved) + 1 ledger table; **waste = `ADJUST_LOSS` + `reason` enum** (recount/spoilage/damage/other). Dedicated WASTE/TRANSFER/RECIPE_CONSUME → Sprint 3+/5+. |

### L0 pre-task (Q6) — Sprint 1 default-branch verify: **PASSED (guaranteed at onboarding)**
Both real tenant-creation paths create the first branch inside the **same atomic `$transaction`** as the tenant row, so no persisted tenant can exist without ≥1 branch:
- `createTenant` (`src/server/tenant-init.ts`) — called from `src/app/signup/page.tsx` — step 3 `tx.branch.create` (default name "สาขาหลัก", code "MAIN").
- `seed.ts` demo path — `prisma.branch.create` after the tenant + membership.

Greenfield production has no legacy rows. Test files (`product-logic`, `category-logic`, …) create bare tenants without branches, but those roll back inside their test transactions and never persist; the Part 10 E2E harness will create a branch explicitly (as `supplier-product-mapping-logic.test.ts` already does). **→ No prep task needed before L1.**

### Implementation plan (L0–L6 — TDD vertical slices; ~12–15 commits, batch-pushed at L6)
| L | Layer | Status | Note |
|---|---|---|---|
| **L0** | Docs — ADR 0011 + this section + CONTEXT.md glossary + Q6 verify | ✅ done (`434a389`) | sign CHECK moved inline into migration.sql (not `prisma/manual/`) — ADR 0011 Q2 correction |
| L1 | Schema migration — `stock_movement` + `stock_adjustment` + `MovementType`/`SourceType`/`AdjustmentReason` enums + indexes + inline sign/type CHECKs + RLS policies | ✅ done (`5202ffb`) | 4 indexes shipped (source_unique / chronological / branch_audit / tenant); `input_qty` locked at **Decimal(15,3)** to match `movement.qty` (no precision jump through `× toBaseRatio`) |
| L2 | zod — `createStockAdjustmentInputSchema` (product/branch/qty/unit/type/reason/notes/occurred_at) + balance/history query schemas + backdate range (Q5) | ✅ done (`844d9f4`) | `computeBangkokToday` lifted to `src/lib/bangkok-date.ts` (zod layer must not import `src/server/*` → Prisma in the browser bundle); 183✓/4 skip |
| L3a | Read logic — `getStockBalanceLogic` (+ByBranch/ByProduct) + `getStockMovementHistoryLogic` | ✅ done | `src/server/stock-movement.ts` (read-only file); 13 slices S1–S13, **196✓/4 skip**, tsc clean. Shapes locked below. |
| L3b | Write logic — `createStockMovementLogic` (internal primitive: atomic TX, idempotent by source, base-unit convert) + `createStockAdjustmentLogic` (adjustment + movement one TX; returns `{ movement, adjustment, postBalance }`) | ✅ done | 10 slices W1–W10, **206✓/4 skip**, tsc clean. **ADR 0011 Q4 mechanism corrected** (see below) |
| L4 | Actions — `createStockAdjustmentAction` + `getStockBalanceAction` + `getStockMovementHistoryAction`, Thai error mapping, `revalidatePath` | ✅ done | `src/app/stock/actions.ts` + `_components/stock-view.ts` serializer. tsc clean; no unit tests (thin-glue convention — coverage = L2 + L3 + L6 E2E) |
| L5a | Adjust form UI — product/branch picker, qty+unit, type radio, reason dropdown, notes, occurred_at picker (default today, 90-day backdate), balance preview + Q9 negative warning | ✅ done | `/stock/adjust` + `_components/StockAdjustForm.tsx` + `/stock` layout + dashboard nav. `next build` → **✓ Compiled successfully**; tsc clean. Q9 gate = banner + confirm checkbox, never a server refusal |
| L5b | Stock-levels dashboard — product \| branch \| balance \| last-movement; filters; negative red badge | ✅ done | `/stock` + `_components/StockLevelsTable.tsx`. Branch in the URL (`?branch=`) so `revalidatePath("/stock")` refreshes what the user is looking at. **"low-stock" filter dropped** — see below. `pnpm build` green (20 routes) |
| L5c | Movement history viewer — chronological per (product, branch); date/type/source filters; type badges, colored qty, source ref, notes, created_by | ✅ done | `/stock/history` + `_components/StockMovementHistory.tsx`. Filters = GET form (URL state); page 1 server-rendered, "โหลดเพิ่ม" pages via the L4 action replaying the same filters. `pnpm build` green (21 routes), 206✓/4 skip |
| L6 | E2E throwaway + sprint-progress flip + batch push | ✅ done | 8 cases E1–E8 green; throwaway spec + config **deleted** (never committed). Final sweep: tsc clean · `pnpm build` 21 routes · **206✓/4 skip** (unchanged — throwaway stayed out of discovery) |

### L3a read shapes (locked in code — `src/server/stock-movement.ts`)
Four choices the grill did not pre-decide; all local to the read layer + its L5 consumers:
1. **Inclusive upper bounds expand by day.** `asOf` / `dateTo` arrive as UTC-midnight day values (what `<input type="date">` + `computeBangkokToday` produce), so the query uses an EXCLUSIVE bound of `+24h` for a midnight value and `+1ms` for a value with a time component. Without this, "balance as of today" would silently drop today's rows — and Part 13 GR movements may carry real timestamps.
2. **Grid reads return a full grid, not just rows that moved.** `getStockBalancesByBranchLogic` / `...ByProductLogic` return the UNION of every live product/branch (balance 0 when never moved) and any **soft-deleted** product/branch that still holds stock, flagged `deleted: true`. Deleting a product must never make its remaining stock vanish from the stock-levels page.
3. **History ordering is TOTAL** — `(occurredAt, createdAt, id)` DESC (the cost engine walks the same tuple ASC in Part 14). `id` is what makes cursor pagination safe when two rows share an instant. Has-more is probed with `take: limit + 1` (no COUNT over the ledger); `nextCursor` = last row of the page.
4. **Polymorphic source resolved in one batched query** (Q3 — there is no FK to `include`): ADJUSTMENT rows get `{ reason, inputQty, inputUnitName }` attached; GR_LINE resolution is Part 13's. Reads do **not** assert ref ownership — the `tenantId` filter turns a foreign id into an empty ledger; ownership assertions belong to the write path (L3b), where accepting a foreign id would corrupt data.

### L3b write shapes (locked in code — `src/server/stock-movement.ts`)
1. **ADR 0011 Q4 idempotency mechanism CORRECTED — intent unchanged.** The grill's `try create / catch P2002 → treat as success` cannot work: Postgres aborts the WHOLE transaction on a constraint violation (`25P02`), and Q4 also requires source + movement in ONE transaction, so after the violation nothing can be read or committed on it (Prisma 5.22 has no SAVEPOINT). Caught by test W7. **Implemented instead:** lookup-before-insert (a replayed source returns the existing row, index never trips) + typed `MovementSourceConflictError` for the surviving concurrent-race window, thrown WITHOUT another query on the doomed tx; caller retries in a fresh tx or reads `findStockMovementBySourceLogic`. Same guarantee: one source → one movement, replay = no-op. Correction recorded in ADR 0011 Q4.
2. **The primitive takes `tx`, not `tenantId`** — the one *Logic in the codebase that breaks the tenantId-first convention, deliberately: Q4 requires the source row and its movement to commit together, so the caller must already own the transaction. Part 13's GR is the next caller.
3. **Unit conversion lives in `createStockAdjustmentLogic`, not the action layer** (Q1 said "action layer"): the ratio lookup is a DB read that must sit inside the same transaction as the write, and actions are thin glue by repo convention — putting it here is what makes W2/W6 unit-testable at all. Rounding is done in the app, `toDecimalPlaces(3, ROUND_HALF_UP)`, not left to Postgres — the returned number is then exactly the stored one. A positive input that rounds to `0.000` (e.g. 0.001 mg against a kg base) throws typed `QtyRoundsToZeroError`: the sign CHECK forbids a zero-qty row, and a raw constraint violation would be both unreadable and (per item 1) tx-fatal.
4. **`assertSourceExists` is a switch, and refuses what it cannot verify** — ADJUSTMENT resolves against `stock_adjustment`; GR_LINE / SYSTEM_INITIAL throw `UnsupportedSourceTypeError` until Part 13 adds the branch. With no FK (Q3) this assertion is the only thing keeping the ledger from pointing at nothing.
5. **Typed errors for L4 to map:** `StockUnitMismatchError`, `QtyRoundsToZeroError`, `MovementSignMismatchError`, `MovementSourceNotFoundError`, `MovementSourceConflictError`, `UnsupportedSourceTypeError` + the reused `CrossTenantReferenceError`.

### L4 action shapes (locked in code — `src/app/stock/actions.ts`)
1. **`createdBy` = `membership.userId`, not `session.user.id`** — same person, but the membership row is an FK-valid `app_user` id by construction, and `created_by` is the ledger's ONLY audit trail (Q7 leaves no `updatedAt`/`deletedAt` to trace a row by).
2. **Decimals leave as strings, never numbers** (`_components/stock-view.ts`) — `Decimal(15,3)` with a 12-digit integer part overflows JS float precision, so a `Number` round-trip would silently corrupt exactly the money-adjacent figures the ledger exists to protect (Pitfall #20 + a precision reason on top of the RSC one).
3. **Only 4 typed errors map to Thai** — cross-tenant, unit mismatch, rounds-to-zero, source conflict. `MovementSignMismatchError` / `MovementSourceNotFoundError` / `UnsupportedSourceTypeError` are unreachable from this action (it writes its own source and derives the sign from `type`), so they rethrow to the error boundary rather than being buried in a form message.
4. **Success returns `postBalance` + `negative`** so the form shows the new balance and the Q9 warning with no second round trip. The write already happened — `negative: true` is information, not a rejection.
5. **`revalidatePath("/stock")` is wired before the page exists** (L5b builds it) — a no-op today, complete the moment the page lands. `/reports` is deliberately NOT listed: nothing to invalidate until Sprint 3, and a stale entry outlives the reason for it.

### L5a form shapes (locked in code — `src/app/stock/_components/StockAdjustForm.tsx`)
1. **The Q9 negative gate is UI-only.** The server never refuses a negative balance — stock below zero is real information (a missed receive, a bad count) and hiding it is worse than showing it. The form shows a red preview + an explicit confirm checkbox that unlocks the submit button; the user can always proceed.
2. **Preview math runs in JS `Number`, and that is fine BECAUSE it is display-only** — the authoritative post-balance always comes back from the server as a string. This is the one place the L4 "never Number a Decimal" rule is relaxed, deliberately and locally.
3. **`todayBangkok` + the 90-day min are computed on the SERVER page**, not in the browser: the zod window is checked against Bangkok today, so a device in another timezone would otherwise be offered a date the server rejects (Decision #60).
4. **Success keeps the form open** (product/branch/date retained, qty + notes cleared, focus back on qty) instead of navigating away — counting stock is a batch job, ten items in a row.
5. **Unit defaults to the product's base unit** on every product change, and the picker lists base-first — it is the unit stock is counted in.

### L5b grid shapes (locked in code — `src/app/stock/page.tsx`)
1. **The plan's "low-stock" filter was DROPPED, not implemented.** `Product` has no reorder point / par level — nothing in the schema says what "low" means for an item, so any threshold would be invented by me rather than configured by the restaurant. The filters ship only facts the ledger actually knows: **ทั้งหมด / ติดลบ / หมด (0 แต่เคยเคลื่อนไหว) / ยังไม่เคยเคลื่อนไหว**. A real par level is a schema change → **carry-forward to Sprint 3+** (needs a grill: per-product? per-branch? per-season?).
2. **Branch lives in the URL** (`/stock?branch=<id>`), not component state — the view is linkable/shareable and the L4 `revalidatePath("/stock")` refreshes exactly what the user is looking at. An unknown or foreign branch id falls back to the first branch; it never reaches the query unvalidated.
3. **Dates are formatted on the server** (`Intl.DateTimeFormat` with `timeZone: "Asia/Bangkok"`), then passed down as a finished string. Formatting inside the client table would run once in Node during SSR and again in the browser after hydration, with different default locale/timezone → hydration mismatch.
4. **"หมด (0)" is distinct from "ยังไม่เคยเคลื่อนไหว"** — `movementCount` is what separates them, which is exactly why L3a returns it. Same number on screen, completely different meaning to whoever is counting.

### L5c history shapes (locked in code — `src/app/stock/history/page.tsx`)
1. **No edit/delete affordance anywhere in the viewer, ever.** Q7 immutability only holds if the UI never implies otherwise; a correction is a compensating adjustment that shows up as its OWN row. The page says so in Thai, because a user who cannot find "แก้ไข" will otherwise assume it is broken rather than intentional.
2. **Filters are a GET form, page 1 is server-rendered**, and "โหลดเพิ่ม" replays *the same filter object* with the cursor through the L4 action — otherwise page 2 silently widens the query the user filtered. Filter state in the URL also means a filtered view is linkable and the back button behaves.
3. **The URL is parsed, not trusted** — a malformed filter falls back to the unfiltered feed with an amber notice instead of erroring the page. A query string is navigation, not a form being filled in.
4. **`occurredAtLabel` is rendered server-side in the serializer** (not in the component): the list is appended to client-side, so component-side formatting would format page 1 in Node and page 2 in the browser — different locale/timezone defaults, plus a hydration mismatch on the SSR rows.
5. **Enum labels fall back to the raw value** (`map[key] ?? key`) so a movement type added in Sprint 3+ renders readably instead of blank. `MOVEMENT_TYPE_LABELS_TH` + `SOURCE_TYPE_LABELS_TH` were added to the L2 file, next to the value arrays they gloss.

### Pre-existing defect found at L5a — ✅ FIXED (own commit, outside the Part 10 layers)
`pnpm build` failed type-checking on `src/app/login/page.tsx` (Sprint 0, `6a2db97`): Next 15 made `searchParams` a **Promise**, and the page still typed it as a plain object. `next build` printed **✓ Compiled successfully** first — every route compiles — then died in the type-check pass. `pnpm tsc --noEmit` does NOT catch it (the generated `.next/types/**` route types are outside the tsconfig scope), and dev + vitest are unaffected, which is why 9 parts went by without noticing. Production builds were blocked repo-wide.
**Fixed** by typing `searchParams` as a Promise and awaiting it. `pnpm build` now completes end-to-end for the first time — 19 routes generated, `/stock/adjust` among them. **New standing rule: run `pnpm build`, not just `pnpm tsc`, at each L5+ UI layer** — tsc alone cannot see the route-type contract.

### Risk surfaces (from grill)
1. **Action-layer unit conversion** (Q1) — a base-unit conversion bug is silent stock corruption → dedicated unit-conversion helper + zod bounds + tests. 2. **Sign CHECK maintenance** (Q2) — every future movement type must extend + re-apply the manual SQL. 3. **No-FK source integrity** (Q3) — app-layer "source exists" assertion before INSERT is the only guard. 4. **Backdate tz correctness** (Q5) — Bangkok UTC+7 via `computeBangkokToday` (Decision #60). 5. **Index-collapse — RESOLVED at L0 review**: `balance_idx` dropped (leftmost-prefix of `chronological_idx`, which covers the balance SUM via index-only scan); ledger ships 4 indexes (source_unique / chronological / branch_audit / tenant). See ADR 0011 Consequences.

### Standing items (carried in)
Pitfall **#19** (git hook inert — push manual, batch at L6), **#20** (Decimal across RSC — `qty`/`postBalance` string at view layer), **#26** (Neon free-tier quota — heads-up), **#28** (depth/cycle race — accepted MVP, N/A here), **#29** (Neon IPv6 hosts pin — ACTIVE). **vitest real-Neon parallel flakiness** — re-run once on red before treating as a regression (fix deferred post-Sprint 2). #23 (Product.sku FULL-unique) CLOSED in Part 8.5; the ledger's `UNIQUE(source_type, source_id)` is a **plain full unique on purpose** — no soft-delete on the ledger, so the #22/#23 trap does not apply (ADR 0011).

### Carry-forward to later Parts
- **Part 13 (GR)** — builds `goods_received_line` (`ordered/received/invoiced/discrepancy_qty`, `discrepancy_reason`, `resolution_status`) and *calls* `createStockMovementLogic` (`received_qty` → `qty`, source `GR_LINE`); source-level idempotency (submit key) + "edit GR → compensating entries" UX are Part 13's.
- **Part 14 (Cost Engine)** — orders by `(occurred_at, created_at)`; weighted-avg vs FIFO ADR; AP discrepancy cost policy (A `invoice/received` recommended / B write-off / C provisional); retroactive recompute on backdated entries.

### Verified (L6, 2026-08-15)
- `pnpm tsc --noEmit` clean · `pnpm build` green (**21 routes**, `/stock`, `/stock/adjust`, `/stock/history` among them) · `pnpm vitest run` **206 passed / 4 skipped** (154 Sprint 1 baseline + 29 L2 schema + 13 L3a read + 10 L3b write).
- **8-case throwaway action-stack E2E (E1–E8)** on a throwaway tenant, mocking only `requireTenant` + `next/cache` — everything below the action real (zod → *Logic → Prisma → Neon → DB CHECKs): base-unit gain persisted with source+movement linked · `กระสอบ ×25` conversion · **negative balance SUCCEEDS and reports `negative: true`** (Q9) · 3 zod forks (neg qty / future date / >90d backdate) as Thai field errors · cross-product unit → Thai on `inputUnitId` with nothing written · rounds-to-zero naming both units with **no orphan source row** · balance serialized Decimal→string · history cursor paging with no repeats + source resolution + pre-formatted date. Spec + dedicated config then **deleted** (7c/7d/8/8.5 precedent).
- Ledger tables verified empty after the run (`stock_movement` 0, `stock_adjustment` 0) — no test residue on Neon.

### Part 10 — ✅ COMPLETE
The append-only ledger and its first producer are live: `stock_movement` + `stock_adjustment`, base-unit-normalised signed rows, realtime SUM balances with `asOf` time travel, and the three UI surfaces (`/stock`, `/stock/adjust`, `/stock/history`). Part 13 (GR) and Part 14 (Cost Engine) can now be built as pure consumers.

**Carried forward from this Part:**
- **Par level / reorder point** — the L5b "low-stock" filter was dropped for want of a schema field; needs its own grill (per-product? per-branch? seasonal?) → Sprint 3+.
- **ADR 0011 Q4 mechanism correction** (lookup-before-insert, not catch-P2002) — Part 13's GR must use `createStockMovementLogic` as-is and add its own `GR_LINE` branch to `assertSourceExists`, plus a client submit key for source-level idempotency.
- **Sign CHECK maintenance** — any new `MovementType` in Sprint 3+ (WASTE / TRANSFER_* / RECIPE_CONSUME) must DROP + re-declare `stock_movement_sign_check` in its own migration.
- **Pre-existing test residue on Neon** (NOT Part 10): 4 leftover tenants from Sprint 1 suites (`Product Test Tenant A/B/C`, the Part 6 throwaway `12cad010…`) — those suites drop their rows but not the tenant. Harmless; clean up in a maintenance pass.

### Post-completion review (/scrutinize, 2026-08-15)

Outsider pass over the whole slice before Part 13/14 build on it. One live bug fixed, four items carried forward.

**FIXED — `85b38a3`: zod rejected valid 3-decimal quantities.** `hasAtMostThreeDecimals` was `Number.isInteger(n * 1000)`, false for 1.005 and ~1.2% of all 3-decimal values (11,791 of the first 1,000,000) while the form's `step="0.001"` accepted them — a dead end the user could not act on. Now the `Number(n.toFixed(3)) === n` round-trip, the guard `supplier.ts:60` already used correctly in Sprint 1. +3 regression tests (**209✓/4 skip**), tsc clean, `pnpm build` green. The L2 test suite missed it because its happy-path value (`1.234`) happens to be one that works.

**MUST DECIDE BEFORE PART 13 (GR):**
1. **Day bucketing is UTC, not Bangkok.** `exclusiveUpperBound` (`stock-movement.ts:55`) and `computeBangkokToday` both work in UTC midnights, which is self-consistent *only* while every `occurred_at` is a date-only value. The moment GR writes real timestamps, anything occurring 00:00–06:59 Bangkok falls into the previous day, and "balance ณ วันนี้" reaches to Bangkok 07:00 tomorrow — Decision #60, and unfixable in place once real data exists. Options: (A) shift the query bounds by the Bangkok offset and let GR store true instants (**recommended** — Part 14 needs intra-day ordering, and option B parks every adjustment at 07:00); (B) force every source to store a business-date UTC midnight.
2. **Source-level idempotency does not cover a re-submitted form.** ADR 0011 Q4's guarantee is keyed on `(source_type, source_id)`, but `createStockAdjustmentLogic` mints a fresh `stock_adjustment` id per call — so a double POST (no-JS progressive enhancement, back-then-resubmit, network retry) writes a second adjustment + movement and doubles the stock, correctable only by a compensating entry. The `isPending` disable covers the ordinary double-click and nothing else. Fix = hidden per-form `submit_key` uuid used AS the adjustment id, which makes the existing pre-insert lookup do what the ADR claims. Part 13's GR needs the same key.
3. **The primitive returns an existing movement without checking it matches.** `stock-movement.ts:622` returns on `sourceId` alone, and `assertSourceExists` (`:559`) only proves the source row exists — not that its product/branch/qty agree with the movement being written. A Part 13 replay of a GR line with a corrected qty would report success while the ledger keeps the old number, silently. Fix (one site): compare `(productId, branchId, qty, type, occurredAt)` against `existing` and throw a typed `MovementSourceMismatchError`; have `assertSourceExists` select and check the source's own product/branch.

**Smaller items (not blocking):**
- `stock-movement.ts:622` is the only query on the write path not filtered by `tenantId` (every other one is, including `findStockMovementBySourceLogic`). Unreachable today (uuid source ids + assert runs first); still worth an explicit tenant check.
- `stock_adjustment.input_qty` has no `> 0` CHECK while the ledger has a full sign CHECK — asymmetric defense-in-depth.
- `getStockBalancesByBranchLogic` loads the entire live catalog per `/stock` render, unbounded.
- `withTenantContext` runs on `$transaction`'s default **5s timeout** — a multi-line GR write in one tx may need an explicit `{ timeout }` in Part 13.

**Traced and confirmed sound:** cursor pagination is a genuine total order (`occurredAt, createdAt, id` + `take: limit+1` + `skip: 1`) with no skip/duplicate at ties · the sign CHECK leaves no gap at `qty = 0` · no Decimal→Number leak anywhere in the serializer, and the form's preview math is display-only as documented · the grid union rule really does keep soft-deleted products holding stock visible · the Q9 negative gate is UI-only, the server never refuses.

### Next: Part 11 — Purchase Order (design locked, see below). Part 10 L0–L6 pushed as one batch (Part 8.5 pattern).

---

## Sprint 2 Part 11 — Purchase Order: ✅ COMPLETE (L0–L6, 2026-08-16)

The document a GR will later receive against. Grill-with-docs (Q1–Q9 + Q8b) locked this session, codified in **ADR 0012**. **Scope = the PO as a sent document**: create/edit while `DRAFT`, freeze-and-lock at `SENT`, cancel, plus the supplier-price resolver ADR 0009 deferred to "the Sprint 2 PO consumer".

**Part numbering reconciled:** ADR 0011 sketched "Part 11 auto-pick preferred supplier → Part 12 PO". Those merge into **one Part 11** — the price resolver is the PO form's read layer, not a feature of its own. **Part 12 is left unallocated**; Part 13 (GR) and Part 14 (Cost Engine) keep their numbers, which are already referenced across the docs.

### Design locked (Q1–Q9 — compact; full record in ADR 0012)
| Q | Decision (one-liner) |
|---|---|
| Q1 | **No PR layer** — `purchase_request` deferred to Sprint 3+. It exists to let a *department* request and a manager approve; `enableDepartments` is off by default and **there is no `/departments` route**, so nothing can create a second department to request on behalf of. |
| Q2 | `purchase_order_item_allocation` **ships now** (always 1 row = "Main"), but the H.2 **deferrable trigger pair does not** — `SUM(allocated) = qty_ordered` is enforced in-app inside the write transaction, matching every other guard in the repo. Triggers become a pure additive migration when multi-dept lands. |
| Q3 | A line **freezes** `unit_price` + unit name + `to_base_ratio`; `qty_ordered` is stored **in the ordered unit**. `supplier_product_mapping_id` survives as **provenance only** (nullable). Mirrors Part 10's `stock_adjustment` (as-entered) vs `stock_movement` (base). |
| Q4 | **`DRAFT` editable, `SENT` immutable.** Reachable here: `DRAFT → SENT`, `→ CANCELLED`. `PARTIALLY_RECEIVED`/`RECEIVED` are Part 13's to write. Amend = cancel + reissue. |
| Q5 | No mapping / no current price → **hand-typed price allowed**, snapshotted the same way, `mapping_id = null`. The first order from a new supplier is exactly this case. |
| Q6 | **VAT snapshotted** (`subtotal_excl_vat` / `vat_rate_percent` / `vat_amount` / `total_amount`). **WHT not captured** — it attaches to services and is deducted at payment; lands in Sprint 3 with expense/payment. |
| Q7 | **Send = status flip + `sent_at` + print-friendly page.** No PDF, no storage, no outbound mail (`pdf_url` stays null) — Thai SMEs send orders over LINE, and there is no real email transport yet. |
| Q8 | `po_number` = **`{BRANCH_CODE}-PO-####`**, counter per branch, never resets. Generator mirrors `generateSku` — **inherits Pitfall #25's race**, and the eventual advisory-lock fix covers both. |
| **Q8b** | 🛑 Schema change (approved): **`Branch.code` → NOT NULL + PARTIAL unique** `(tenant_id, code) WHERE deleted_at IS NULL` in `prisma/manual/`, per `supplier_code_unique.sql`. A FULL unique would be Pitfall #22/#23 again. Backfill trivial — every tenant has one branch, already `MAIN`. |
| Q9 | `DRAFT` **soft-delete**; `SENT` → `CANCELLED` only; **nothing hard-deleted**. `po_number` therefore also takes a **partial** unique. |

### Decided by existing convention (not grilled)
`branch_id` NOT NULL on `purchase_order` (spec §125) · Decimal→string at the view layer (Pitfall #20) · RLS policy appended for each new table (pre-publish checklist; inert until Sprint 7 per ADR 0004) · `purchase_order_item.qty_received` created here defaulted 0, **written only by Part 13** · `isPreferred` suggests a supplier, it does **not** resolve price (the header already pins the supplier).

### Implementation plan (L0–L6 — TDD vertical slices; ~12–15 commits, batch-pushed at L6)
| L | Layer | Status | Note |
|---|---|---|---|
| **L0** | Docs — ADR 0012 + this section + CONTEXT.md glossary | ✅ `ad5716e` | CONTEXT.md "Allocation" was **wrong** and got corrected: it defined allocation as GR↔PO line matching; it is **department attribution**. Also added Order unit + Line snapshot; PR/PO/Mirror-trigger entries sharpened. |
| L1 | Schema — 3 tables + `purchase_order_status` enum + `Branch.code` NOT NULL + 2 partial uniques + RLS | ✅ `355da92` | Pre-flight on Neon PASSED (2 branch rows, no NULL/dupe codes) before the NOT NULL. **5 CHECK constraints inline**, incl. two that put the status machine in the DB: a sent order must record `sent_at`, and only a DRAFT may be soft-deleted. Also closes the asymmetry the Part 10 review flagged — every qty/money column with a legal range declares it. |
| L2 | zod — header + lines + optional allocations | ✅ `7cb6689` | 25 tests. Allocation sum compared in **integer thousandths** (float addition would reject a valid 0.1+0.2=0.3 split). Decimal guards use the `toFixed` round-trip per **Pitfall #30**. |
| L3a | Read logic — **`resolveSupplierPriceLogic`** (the ADR 0009 consumer Part 8 owed) + list/detail/open-qty | ✅ `3dbf2e4` | 15 tests, fixtures built with the **real Part 8 write logic** so the resolver meets append+supersede series. Branch override → tenant default → live rows in today's window; `null` = the hand-typed path, not an error. |
| L3b | Write logic — create/update (DRAFT only) · send · cancel · soft-delete + allocation guard + `po_number` | ✅ `f075e99` | 16 tests. **W14 is the Part's keystone**: after send, "correcting" the sack 25→30 kg leaves the line reading 25. |
| L4 | Actions + Thai error mapping + view serializer | ✅ `61e498d` | Lines cross FormData as parallel arrays zipped by index (Part 8.5 fanout). Allocations deliberately not read from the form — no UI can produce a split yet. |
| L5a | List + layout + StatusBadge | ✅ `5fa0f23` | Filters in the URL; money formatted from the Decimal **string**, never a JS number. |
| L5b | Create/edit form with price autofill | ✅ `0d1e0c1` | VAT follows the supplier only on a user-made change (prefilling on mount would rewrite a saved draft's rate). Supplier/branch locked in edit mode. |
| L5c | Detail + print view + lifecycle buttons | ✅ `08ce691` | The page **is** the document (Q7). An "internal" section states the frozen ratio and the department split, where the snapshot could otherwise surprise someone. |
| L6 | E2E throwaway action-stack + verify | ✅ _(this commit)_ | 8 cases E1–E8 green; spec + dedicated config **deleted** (never committed). |

### Verified (L6, 2026-08-16)
- `pnpm tsc --noEmit` clean · `pnpm build` green (**24 routes**, the four `/purchase-orders` among them) · `pnpm vitest run` **265 passed / 4 skipped** (209 baseline + 25 L2 + 15 L3a + 16 L3b).
- **8-case throwaway action-stack E2E (E1–E8)** on a throwaway tenant, mocking only `requireTenant` + `next/cache` — everything below the action real (FormData → zod → *Logic → Prisma → Neon → DB CHECKs): fanout → `E2E-PO-0001` with snapshot + VAT totals · autofill resolving the **branch override** (275, not the 300 default) and recording provenance · zod fork with nothing written · update replacing lines and cascading their allocations · **send locking the order** (Thai refusal, DB unchanged) · **ProductUnit edited after send leaves the sent line at 25** · cancel recording who/why + refusing a second · discard hiding a draft while refusing a sent order.
- Ledger and PO tables verified **empty** after the run — no residue. (The 5 pre-existing Sprint-0/1 leftover tenants are unchanged and still awaiting the maintenance pass.)

### Part 11 — ✅ COMPLETE
The document Part 13 will receive against is live: `/purchase-orders` (list, create, edit, detail + print), a per-branch `{CODE}-PO-####`, a DRAFT→SENT→CANCELLED machine whose invariants are enforced in the app **and** the database, and the price resolver ADR 0009 had left as an IOU since Part 8.

**Carried forward from this Part:**
- **`po_number` inherits Pitfall #25's scan-then-insert race** — the partial unique catches the loser and the action returns a Thai "กดบันทึกอีกครั้ง". The advisory-lock fix now covers `sku` and `po_number` together.
- **H.2 trigger pair still unwritten** (Q2) — a pure additive migration whenever multi-department allocation becomes reachable. Needs `/departments` CRUD first, which does not exist.
- **Snapshot timing wording**: ADR 0012 says "frozen at send time"; the implementation writes it on every DRAFT save and freezes by immutability at SENT. Same guarantee, recorded in `src/server/purchase-order.ts` — reconcile the ADR's phrasing if it ever confuses anyone.
- **Part 13 (GR) must convert received qty with the LINE'S frozen `to_base_ratio`**, never a fresh `ProductUnit` lookup — plus the three ledger items in Part 10's post-completion review.

### Carried in from the Part 10 review (must be honoured here or by Part 13)
The three open items in "Post-completion review" above are **Part 13's**, not Part 11's — but Q3's frozen `to_base_ratio` is what makes item 1 (Bangkok/UTC bucketing) and the GR conversion path tractable: **Part 13 must convert received qty with the PO line's frozen ratio, never a fresh `ProductUnit` lookup.**

---

## Sprint 2 Part 13 — Goods Receipt: ✅ COMPLETE (L0–L6, 2026-08-16)

The slice that closes the loop **PO → รับของ → ledger**, and the first writer of `PO_RECEIVE`. Design locked this session (Q1–Q8), codified in **ADR 0013**. Also the last free moment to pay the three ledger defects Part 10's post-completion review deferred here.

### Design locked (Q1–Q8 — compact; full record in ADR 0013)
| Q | Decision (one-liner) |
|---|---|
| Q1 | **PO-based + standalone.** `purchase_order_id` nullable — the fresh-market run never had an order. A standalone line snapshots the **live ProductUnit** (no earlier document exists to drift from); a PO-based line inherits the PO line's **frozen** `to_base_ratio` (ADR 0012 Consequence 1). |
| Q2 | **`DRAFT` → `CONFIRMED`.** The ledger is written on confirm and only on confirm. Partiality lives on the **PO**, not the GR: `PARTIALLY_RECEIVED`/`RECEIVED` are **derived** from every line's `qty_received`, recomputed after each confirm/void/close. |
| Q3 | **Over-receipt allowed + flagged**, no tolerance band. Sets `has_discrepancy`, requires a line note. The goods are already in the kitchen — same reasoning as ADR 0011 Q9 at the other end. Spec H.3's 3-option excess UI **not built** (one department ⇒ all three produce the same row). |
| Q4 | **`received_at` is a true instant** → forces the Bangkok day-bucketing fix (Part 10 review item 1). A date-only query bound now expands to the **Bangkok** day (`day − 7h` … `+24h`); a bound with a time component stays a precise instant. `computeBangkokToday()` unchanged. |
| Q5 | **3 tables per master-spec §5.3** (`goods_receipt` + `_item` + `_item_allocation`), mirroring Part 11. ADR 0011's flat `goods_received_line` sketch predates "a GR is a document" — the `SourceType.GR_LINE` **comment** is corrected, the enum value is not (no ledger migration). `invoiced_qty` / `resolution_status` not built. |
| Q6 | **VOID, never edit.** `CONFIRMED → VOIDED` appends a **reversal line** per original line into the *same* document (negative qty, `reversal_of_item_id`), each producing a **`PO_RECEIVE_REVERSAL`** movement. Triggers the ADR 0011 Q2 standing item: `stock_movement_sign_check` is DROPped + re-declared. |
| Q7 | **`unit_price_actual` / `line_total_actual` on the line**, defaulted from the PO price and editable. `variance_qty` / `variance_price` **computed at read**, never stored. This is the number Part 14 costs stock at. |
| Q8 | **"ปิดรับ" is manual.** `RECEIVED` auto-sets only on full receipt; otherwise a button sets it and stamps `closed_short_at/by/reason` on `purchase_order` (3 nullable columns — not a 5th reachable status value). |

### Decided by existing convention (not grilled)
`gr_number` = `{BRANCH_CODE}-GR-####` per branch, generator mirrors `generatePoNumber` (inherits Pitfall #25) + **partial** unique `WHERE deleted_at IS NULL` · **no** `invoice_image_url` / `auto_created_expense_id` (no object storage, no expense module until Sprint 3 — ADR 0012 Q6's rule against permanently-null columns) · `tenant_id` on all 3 tables (ADR 0004) · RLS appended to `enable_rls.sql`, inert until Sprint 7 · Decimal→string at the view layer (Pitfall #20) · decimal guards via the `toFixed` round-trip (Pitfall #30) · allocation ships with one "Main" row, sum app-enforced, **no H.2 trigger pair** (ADR 0012 Q2) — but pro-rating is implemented properly (largest-remainder, tiebreak lowest id) so only the UI is missing when a 2nd department lands.

### Schema changes (approved with the plan)
1. 3 new tables + enum `GoodsReceiptStatus` (`DRAFT | CONFIRMED | VOIDED`)
2. `MovementType += PO_RECEIVE_REVERSAL` → **DROP + re-declare `stock_movement_sign_check`**
3. `purchase_order += closed_short_at / closed_short_by / closed_short_reason` (nullable)
4. `withTenantContext(tenantId, cb, options?)` — a 20-line confirm exceeds Prisma's default 5s `$transaction` timeout

### Implementation plan (L0–L6 — TDD vertical slices; batch-pushed at L6)
| L | Layer | Status | Note |
|---|---|---|---|
| **L0** | Docs — ADR 0013 + CONTEXT.md + this section | ✅ `cb5900a` | CONTEXT.md gains Standalone GR / GR void / ปิดรับ; the GR-shortage entry's **"Decision #46" citation was wrong** (#46–53 is the v1.3 doc pass) — the rule lives in H.3, unnumbered, and the bogus number is now gone |
| L1a | Schema + migration + manual SQL + RLS | ✅ `5c48cc1` | Pre-flight on Neon **PASSED** (ledger 0, PO 0, 2 branches, no missing/dupe codes). **Two migrations, deliberately**: Postgres refuses to *use* a new enum value in the transaction that added it (55P04), and the main file's tail re-declares the sign CHECK with it. 6 CHECKs inline, incl. the reversal sign rule |
| L1b | Ledger prerequisites — Bangkok day bounds · `GR_LINE` branch in `assertSourceExists` · replay-mismatch guard + `tenantId` on the idempotency lookup · extract `toBaseQty` · `withTenantContext` options | ✅ `7e94cd2` | Pays Part 10 review items 1–3 + the 5s-timeout note. +4 regression tests (S14, W11–W13); W10 retargeted to `SYSTEM_INITIAL` |
| L2 | zod — `src/lib/validations/goods-receipt.ts` | ✅ `ebfc4dc` | 19 tests. The over-receipt note rule is **NOT** here — it needs the PO line's outstanding qty, and enforcing it in zod would mean trusting a client-sent number |
| L3a/L3b | Read + write logic | ✅ `dd1f9a9` | 19 integration cases. `recalcPurchaseOrderReceiptStatus` + `closePurchaseOrderShortLogic` live in `purchase-order.ts` — a PO owns its own status machine |
| L4 | Actions + Thai errors + view serializer | ✅ `57fbc9f` | `submit_key` is read from the form, never minted here; confirm/void return post-write balances + a `negative` flag |
| L5a | List + layout + StatusBadge + dashboard nav | ✅ `ef30e7c` | |
| L5b/L5c | Receive form (2 modes) · detail + print · PO page integration | ✅ `59ed0d3` | Found and fixed a **silent drift guard**: `MOVEMENT_TYPE_VALUES` was missing `PO_RECEIVE_REVERSAL` and `tsc` stayed green, because a type alias resolving to `never` is not an error until something is assigned into it. It is now |
| L6 | E2E throwaway action-stack + verify + push | ✅ _(this commit)_ | 10 cases E1–E10 green; spec + dedicated config **deleted** (never committed) |

### L3b shapes (locked in code — `src/server/goods-receipt.ts`)
1. **The reversals of a void occur NOW, not at the original `received_at`.** The grill did not settle which instant a compensating movement carries. Backdating would silently change the balance "as of" last week and force Part 14 to re-cost a closed period; a general ledger reverses on the day the error is found. Recorded as an implementation clarification in ADR 0013 Q6.
2. **The receipt must be denominated in the unit the order was placed in.** A PO-based line whose `receivedUnitId` is not the order's `orderUnitId` is refused (`GoodsReceiptPoMismatchError`) rather than converted — converting through any other ratio is precisely the bug ADR 0012 Q3 closes.
3. **Two rows for the same PO line are rejected at the zod layer**, because each would be diffed against the same outstanding quantity and the second would read as an over-receipt that is not one. A split delivery is two receipts — that is what `PARTIALLY_RECEIVED` is for.
4. **`create` returns the existing document on a replayed `submitKey`, in whatever state it has since reached** — including CONFIRMED. That is the correct reading of "the same write twice is one write"; a second POST is not entitled to a second draft.
5. **Pro-rating is written properly even though it cannot matter yet** (largest-remainder, tiebreak lowest id, per H.3) and is unit-tested (R3) against a 3-way 1/3 split, so the day a second department exists only the UI is missing.

### Verified (L6, 2026-08-16)
- `pnpm tsc --noEmit` clean · `pnpm build` green (**27 routes**, the four `/goods-receipts` among them) · `pnpm vitest run` **307 passed / 4 skipped** (265 Part-11 baseline + 19 L2 + 19 L3 + 4 ledger regressions).
- **10-case throwaway action-stack E2E (E1–E10)** on a throwaway tenant, mocking only `requireTenant` + `next/cache` — everything below the action real (FormData → zod → *Logic → Prisma → Neon → DB CHECKs): fanout → `E2E13-GR-0001` and a DRAFT that posts nothing, then a confirm that posts 4 กระสอบ ×25 = **100 kg** and closes the order · two partial receipts walking `SENT → PARTIALLY_RECEIVED → RECEIVED` · **over-receipt refused without a note (nothing written), then accepted in full and flagged** · **void netting the balance to 0 with the original ledger row untouched and the order back at `SENT`** · double POST on one `submit_key` = one receipt, double confirm = one movement · **a ProductUnit edited 25→30 after send still converting at 25** · a standalone receipt touching no order · **a 23:30 Bangkok delivery counting on today** (the case the old UTC bucketing got wrong) · close-short stamping a reason and dropping out of `getOpenOrderQtyForProductLogic` · the receivable read + discard path.
- Ledger, GR and PO tables verified **empty** after the run — no residue. (The 5 pre-existing Sprint-0/1 leftover tenants are unchanged and still awaiting the maintenance pass.)

### Part 13 — ✅ COMPLETE
The loop is closed: **PO → รับของ → ledger**. `/goods-receipts` (list, receive form with PO-based and standalone modes, detail + print), a per-branch `{CODE}-GR-####`, a DRAFT→CONFIRMED→VOIDED machine enforced in the app **and** the database, `purchase_order.status` now derived from line quantities, and the three ledger defects Part 10's review deferred here all paid.

**Carried forward from this Part:**
- **Part 10's adjustment form is still exposed to the double-POST it warned about.** Part 13 fixed the pattern (a client `submit_key` used AS the source row id) but only for receipts; `createStockAdjustmentLogic` still mints its own id per call. A ~10-line fix, worth doing before the pilot.
- **`gr_number` inherits Pitfall #25's scan-then-insert race** — the partial unique catches the loser and the action returns a Thai "กดบันทึกอีกครั้ง". The advisory-lock fix now covers `sku`, `po_number` and `gr_number` together.
- **Sign-CHECK maintenance is now a two-migration dance** — any Sprint 3+ movement type (WASTE / TRANSFER_* / RECIPE_CONSUME) needs `ALTER TYPE … ADD VALUE` in its own migration before the CHECK can reference it.
- **No `resolution_status` per line** (ADR 0011 sketched one) — MVP flags the header and puts the reason in the line note. Revisit if a reviewer needs a workflow rather than a list.
- **Part 14 (Cost Engine)** now has real data to read: `unit_price_actual` per GR line, real instants on `occurred_at`, and `PO_RECEIVE_REVERSAL` rows it must not mistake for consumption.

### Baseline at start (2026-08-16)
`pnpm vitest run` — **265 passed / 4 skipped**, `tsc` clean, `pnpm build` 24 routes (Part 11 L6 state).

---

## Sprint 2 Part 13.5 — Carry-forward debt payoff: ✅ COMPLETE (L0–L3, 2026-08-16)

Maintenance slice run **standalone before the Part 14 grill**, on the Part 8.5 precedent. Not a grill slice — nothing here is a new product decision; it pays three debts the last three Parts each recorded and deferred, two of which sit directly under the code Part 14 will read.

### What it closes
| # | Debt | Recorded in |
|---|---|---|
| 1 | **`/stock/adjust` double-POST doubles the stock.** Part 13 fixed the pattern (a client `submit_key` used AS the source row id) but only for receipts; `createStockAdjustmentLogic` still minted its own `stock_adjustment` id per call, so ADR 0011 Q4's `(source_type, source_id)` idempotency never fired. | Part 13 carry-forward ("worth doing before the pilot"); Part 10 post-completion review item 2 |
| 2 | **Pitfall #25 scan-then-insert race**, now shared by `generateSku` / `generatePoNumber` / `generateGrNumber`. The partial unique index caught the loser and the user got a Thai "กดบันทึกอีกครั้ง". | Pitfall #25; Part 11 + Part 13 carry-forwards |
| 3 | **Neon test residue** — leftover tenants from the Sprint-0/1 suites. | Part 10 / 11 / 13 carry-forwards |

**No schema change, no migration, no new dependency.** `stock_adjustment.id` is already a uuid PK (supplying it is a value change, not a shape change) and `pg_advisory_xact_lock` is a built-in, not an extension.

### Implementation (L0–L3 — TDD; batch-pushed at L3)
| L | Layer | Status | Note |
|---|---|---|---|
| **L0** | Docs — Pitfall #25 → RESOLVED · ADR 0011 Q4 clarification · ADR 0012 wording nit · this section | ✅ _(this commit)_ | ADR 0011's Q4 note now says the part that was missing: the guarantee holds **only if the caller supplies the source id** |
| L1 | Adjustment `submit_key` — zod + logic replay + action + form (with **key rotation on success**) | ✅ `45e9c60` | The rotation is the non-obvious half: `/stock/adjust` stays open for successive entry, so a non-rotating key would swallow item #2 of a batch as a replay of item #1 |
| L2 | `acquireCounterLock` + the three generators | ✅ `299a9a7` | `pg_advisory_xact_lock(hashtextextended(key,0))`, keyed per counter scope; the partial uniques stay as backstop. **`$executeRaw`, not `$queryRaw`** — the function returns `void` and Prisma cannot deserialize a void column |
| L3 | Verify (tsc + vitest + build) + throwaway E2E + push | ✅ _(this commit)_ | |

### Verified (L3, 2026-08-16)
- `pnpm tsc --noEmit` clean · `pnpm build` green (same route set as Part 13) · `pnpm vitest run` **312 passed / 4 skipped** (307 Part-13 baseline + W14/W15 submit-key + L23/W17/C12 concurrency).
- **The concurrency test was falsified before it was trusted**: with the lock commented out of `generateSku`, L23 fails with `ProductSkuConflictError` — the exact symptom Pitfall #25 describes. A green-either-way test would have proved nothing.
- **3-case throwaway action-stack E2E (E1–E3)** on a throwaway tenant, mocking only `requireTenant` + `next/cache`: the same `submit_key` posted twice returns the same `movementId` and moves the balance **once** (one `stock_adjustment` row) · rotated keys move it **twice**, so batch entry still works · three parallel `createProduct` with a blank sku land `P-0001..P-0003` with no Thai conflict message. Spec + dedicated config **deleted** (never committed).
- Ledger, adjustment, PO and GR tables verified **empty** afterwards — no residue from this slice.

### Gated separately — Neon test-tenant cleanup 🛑 NOT DONE
Read-only listing taken (9 leftover tenants, all test residue, no real data, ledger tables empty):

| Created | Name | Contents |
|---|---|---|
| 2026-05-17 | `asfsafas` (`cc1a4fe7…`) | 1 branch, 1 member — the Sprint-0 signup test |
| 2026-05-23 | `ร้านทดสอบ Category E2E` (`12cad010…`) | 1 branch, 1 member, 17 categories — the Part 6 throwaway |
| 2026-06-04 | `Product Test Tenant A / B / C` | 1 category on A and B, nothing else |
| 2026-08-16 | `Product Test Tenant A / B / C / D` | 1 product (`DUP-1`) on A and B, 1 category, nothing referencing them |

Deleting these is a DELETE affecting many rows → waiting on Kong's explicit go, per id. Note the suites' `afterAll` does not always complete when the run itself is red (today's leftovers are from the L2 red run, before `$executeRaw`), which is why residue keeps accumulating — worth a fixture-teardown pass, not this slice's business.

### Next: Part 14 — Cost Engine. Opens with a grill-with-docs session; questions already banked by ADR 0011/0012/0013 — weighted-average vs FIFO · AP discrepancy cost policy (invoice/received vs write-off vs provisional) · retroactive recompute on a backdated movement · `PO_RECEIVE_REVERSAL` must not read as consumption · whether `product_cost_history` (master-spec §5.7) ships as-specced or per-branch.

---

## Sprint 2 Part 14 — Cost Engine: 🚧 GRILL IN PROGRESS (2026-08-16)

Last Part of Sprint 2. Grill running; decisions locked so far below. ADR 0014 to be written at L0 once the grill closes.

### Locked so far

| Q | Decision |
|---|---|
| **Q1** | **Scope = product cost layer only.** IN: cost per base unit per product (from GR), read of current + historical cost, a cost view. OUT → Sprint 5: `recipe_cost_snapshot`, `category_cost_snapshot`, recipe cost, cost confidence, cost cascade (H.9), yield-adjusted PREPPED cost. Everything in the OUT column needs `recipe` / `sales_transaction`, which have no table yet — shipping them now would mean permanently-null columns, the rule ADR 0012 Q6 set. |
| **Q2/Q3** | **FIFO, computed by ledger replay — no layer table** ("C2"). Walk `stock_movement` for a (product, branch) in `(occurred_at, created_at, id)` ASC: `PO_RECEIVE` pushes a layer at `unit_price_actual / to_base_ratio`, a negative qty pops from the front. Rejected: **WMA** (smoother, but the user wants true FIFO) and **a `cost_layer` table with mutable `qty_remaining`** — backdating (ADR 0011 Q5, 90 days) and GR void (ADR 0013 Q6) would each force a retroactive re-allocation of every layer after the touched point, and a mutable `qty_remaining` is a second source of truth that can drift from an append-only ledger (Q7). Replay makes all three problems vanish: nothing is stored, so nothing can be stale. Matches ADR 0011 Q8's precedent (balance is not stored, it is `SUM`) and Part 10 L3a note 3, which already said *"the cost engine walks the same tuple ASC in Part 14"*. |
| **Q3b** | **`costPerBaseUnit` = the FRONT LAYER's cost** — the cost of the next unit to be consumed, which is the number Sprint 5's recipe costing wants. Consequences: (a) `cost × qtyOnHand ≠ inventory value` — a stock-value screen must sum the layers, never multiply; (b) cost changes on **consumption** too, not only on purchase (exhausting a cheap layer raises the cost with nothing bought). |
| **Q4** | **`product_cost_history` is NOT built.** Under Q2/Q3 a stored cost row is falsified the moment someone backdates a receipt before it — reintroducing exactly the recompute problem replay was chosen to dissolve. Replaced by `getProductCostLogic(tenantId, { productId, branchId, asOf? })`; `asOf` gives "cost as of any date" for free by stopping the walk. master-spec §5.7 needs a superseded note, the way §5.5 got one for ADR 0011. Sprint 5's H.9 ("mark stale on write" via a trigger on `product_cost_history` INSERT) must be redesigned — but "stale" has no meaning once cost is computed fresh, so H.9 largely dissolves rather than needing a replacement. |

| **Q5** | **A recount gain is valued at the last purchase cost.** `stock_adjustment` carries no price (ADR 0011 Q10) but FIFO must put the found units in *some* layer. Resolution order: **an un-superseded declaration (Q6) → the most recent `PO_RECEIVE` cost at or before that instant → 0 with `hasUnpricedLayers: true`**. Rejected: the front layer's cost (right answer less often — found stock is usually a delivery nobody keyed, which came at the *newest* price, not the oldest surviving one, and "ตีราคาเท่ากับราคาซื้อครั้งล่าสุด" is a sentence an owner understands without first learning what a layer is); zero (drags menu cost down for a whole month, then snaps back — the owner sees profit that was never there). |
| **Q6** | 🛑 **Schema change (approved): `stock_cost_declaration`, append + supersede.** Cost for stock that arrived without a document must be correctable — both while typing and months later, when someone finds the invoice. One mechanism, two entry points: an optional cost on the adjust form writes a declaration in the same transaction; a later correction writes a new one and stamps `superseded_at` on the old. Columns: `tenant_id` · `movement_id` · `unit_cost` (per base unit) · `note` · `declared_at` · `declared_by` · `superseded_at` (null = live). Rejected: a mutable `unit_cost_override` column on `stock_adjustment` — one column instead of a table, but the previous value vanishes with no trace of who changed it or why, against ADR 0011 Q7 / ADR 0009 / ADR 0013 Q6 alike, and Kong's own words for the feature were *"declare กันเองภายใน"* — a declaration nobody signed is not a declaration. Reuses the append+supersede machinery already written in `supplier-product-mapping.ts`, and `stock_count` (Sprint 3) hits the identical problem and can share the table. **Scope: `ADJUST_GAIN` only** — a `PO_RECEIVE` price belongs to its document, and ADR 0013 Q6 already says a receipt is voided, never edited; allowing a declaration on top would create two ways to change a receipt's price that disagree. **A declaration applies regardless of `asOf`**: it corrects our *knowledge* of the past, not the *events* of the past (consistent with R4; deliberately unlike a Part 13 void, where the reversal is a real event and occurs now). |

| **Q7** | **A short-fall becomes a NEGATIVE layer at the last known cost.** ADR 0011 Q9 lets the balance go below zero and forbids the server refusing it, so FIFO needs a rule for popping an empty stack: push a layer of `−qty` at the most recently known cost. Keeps `inventoryValue = Σ(layer.qty × layer.cost)` true even when negative (the alternative — consume what exists and drop the rest — reports `qtyOnHand = −5` alongside `inventoryValue = 0`, which contradicts itself), keeps `costPerBaseUnit` answerable so Sprint 5 needs no null branch everywhere it costs a recipe, and it unwinds by itself when goods arrive. A negative inventory value is not a bug: stock was used that was never recorded as received. Accepted silently for MVP: netting a `−5 @ 180` debt against an arrival at 220 leaves a 200 ฿ price difference that a textbook would post as a variance — there is no accounting module to post it to until Sprint 3, and every figure the owner sees is still right. Carries `negativeStock: true` so the UI can warn as `/stock` already does. |
| **Q8** | **A reversal cuts the layer it reverses, not the head of the queue.** This is what "must not mistake `PO_RECEIVE_REVERSAL` for consumption" (ADR 0011 → Part 14) actually means: receive 10@180 then 10@220, void the second, and popping the head would leave 10@220 when the goods that went back to the supplier were the 220 ones. Part 13 already stores `reversal_of_item_id`, so the layer is identifiable. Walk rules: `PO_RECEIVE` pushes at `unit_price_actual / to_base_ratio` · `ADJUST_GAIN` pushes at the Q5 price · `PO_RECEIVE_REVERSAL` cuts its own layer · `ADJUST_LOSS` pops the head, underflowing per Q7. If the voided layer was already partly consumed, withdraw what remains and let the rest become a negative layer at that layer's cost — "you returned goods you had already used" is exactly the thing that should show up as negative stock to investigate, not be quietly smoothed over. |
| **Q9** | **`getProductCostLogic` requires `branchId` — there is no implicit business-wide cost.** Two branches are two physical piles; replaying them together would use one branch's stock to satisfy another's loss. Single-branch tenants pay nothing for this: the UI fills the only branch in, as `/stock?branch=` already does. |
| **Q9b** | **But management reads the business, not the branch** (Kong: *"เราเป็นแอพการจัดการร้านอาหาร ไม่ใช่แค่จัดการสาขา... ส่วนกลางก็บริหาร"*). So Part 14 also ships `getBranchCostSummaryLogic(tenantId, { period })` + **one** branch-comparison page. **Honest constraint stated up front: real P&L needs revenue, and revenue arrives with POS sync in Sprint 4** — `sales_transaction` and `recipe` have no table yet. What Sprint 2 data answers *today*, per branch: purchase spend · inventory value tied up · **waste and shrinkage valued in ฿, not kg** · **the same product bought at different prices across branches** · data-quality flags (negative stock, unpriced layers), because an executive report built on half-keyed data is a report that lies. The last three are money leaking in plain sight that no POS reports. The return shape carries `revenue: null` / `grossProfit: null` from day one so Sprint 4 fills fields instead of forcing a rewrite; the full Cost/Revenue/GP matrix stays with `department_branch_cost_view` in Sprint 6. Drill-down reuses `getProductCostLogic` unchanged. **This page is the first caller that can make replay slow** (every product × every branch) — if it exceeds ~1 s, invoke R2's snapshot immediately rather than waiting for another signal. |
| **Q9c** | **Known gap recorded, not solved here: central purchasing.** `purchase_order.branch_id` is NOT NULL — every order belongs to a branch — while the vision has HQ buying centrally and distributing. Closing it needs `TRANSFER_*` movements (ADR 0011 Q10 → Sprint 3+), and it lands on Part 14 as a cost question the day it exists: **stock transferred from branch A to branch B must arrive carrying A's FIFO cost**, or the receiving branch's cost is fiction. The replay design already accommodates it (a transfer-in is just another `push` whose price comes from the sending branch's walk) — but it must be designed deliberately, not discovered. |

| **Q10** | **One fallback rule for every "no front layer" case, and the read always says where its number came from.** Q5 (a gain with no price), Q7 (negative stock) and zero stock are the same hole, so: **front layer → last known purchase cost → 0**. Every cost read returns `costSource: FRONT_LAYER \| DECLARED \| LAST_KNOWN \| UNPRICED`. Not decoration: CONTEXT.md already defines **Cost confidence HIGH/MEDIUM/LOW** for Sprint 5, and `costSource` is exactly the raw material — returning it now means Sprint 5 computes confidence without reopening Part 14. |
| **Q11** | **Four surfaces ship; a fifth was cut.** (1) an optional, collapsed cost field on the adjust form — declaration entry point one; (2) a **per-product cost page** — layers, `costSource`, declare/supersede + history: entry point two, and the only place a user can *find* the rows the system guessed, without which "correct it when you find the invoice" is an empty promise; (3) the **branch-comparison page** (Q9b); (4) a **stock-value column on `/stock`**, because it rides the same batch read the branch page already needs and "how much is my stock worth" is the first question an owner asks — ⚠️ it must **sum the layers, never `costPerBaseUnit × qty`** (Q3b). Cut: cost on the product detail page — a duplicate of (2), which it can simply link to. |
| **Q12** | **Money is the stored quantity; cost per unit is derived.** A layer carries base-unit **qty (3 dp)** and the **money actually paid for it (2 dp, straight from `line_total_actual`)**, not a per-unit cost. Rejected: storing cost per unit at 4 dp and multiplying back — 1,000 ฿ ÷ 90 kg = 11.1111 × 90 = 999.999, so a fraction of a satang evaporates per layer and keeps evaporating. Consuming part of a layer splits its money proportionally, rounds to 2 dp, and **leaves the remainder in the layer**. This buys a checkable invariant — **`total inventory value = all money in − all money consumed`, exact to the satang** — which is what the Q9b executive view gets reconciled against; if that figure does not tie out, nobody trusts anything else on the page. `costPerBaseUnit` = front layer money ÷ front layer qty, computed at read, rounded only at the screen, and crossing the wire as a **string** (Pitfall #20). |

### UX guardrails for the declaration feature (Kong: "หาทางทำให้ user friendly เผื่อไว้ด้วย")

1. **The adjust form must not get slower.** It exists for batch entry — ten items in a row, qty and Enter (Part 10 L5a shape 4). The cost field is **collapsed by default** behind "ระบุต้นทุนเอง"; the resolved default is shown as plain text next to it (*"ระบบใช้ 180 ฿/kg — จากการซื้อครั้งล่าสุด 1 ส.ค."*) so the user can judge it without opening anything, and it never blocks submit.
2. **Declare in the unit the user thinks in.** A restaurant owner knows "กระสอบละ 4,500", not "kg ละ 180". The cost input carries the same unit picker as the qty field and converts to the base unit server-side with the existing `toBaseQty` path — storing per base unit while *typing* per base unit are different decisions, and only the first one is ours to make.
3. **Guessed costs must be findable later**, or "correct it when you find the invoice" is a promise the UI cannot keep. The product cost page lists rows the system priced by fallback with a badge (*"ระบบเดาต้นทุนให้"*), and `hasUnpricedLayers` surfaces as a visible caveat rather than a silent 0.
4. **Superseding shows its history**, mirroring `MappingHistoryViewer` — who declared what, when, and the note — so a corrected number can be defended to whoever asks.
5. **Thai UI never says "declaration"** — "ระบุต้นทุน" / "แก้ต้นทุน" / "ประวัติการระบุต้นทุน".
6. Deferred, not forgotten: declaring one found invoice across several gains at once (bulk). One at a time is enough for MVP.

### Risk register — the replay design (recorded at Kong's request, 2026-08-16)

Prepared responses for problems that may never happen. Each row: the risk · the signal that it is starting · what we do about it.

| # | Risk | Early signal | Prepared response |
|---|---|---|---|
| **R1** | **N+1 replay.** A caller loops per product — 200 products × one round trip to Neon Singapore (~30–60 ms) = 6–16 s. This is the one that will actually happen, and it is a coding mistake, not a design flaw. | A page that got slow after adding cost, while row counts stayed small. | **Prevent at the API shape:** the read layer's primitive takes `productIds[]` and returns a map; the single-product function is a thin wrapper over the batch one. There is deliberately **no** per-product query exported for a caller to loop. Assert it in a test that counts queries for a 3-product grid. |
| **R2** | **Growth makes the walk slow.** ~450 rows for a 3-year top-mover is nothing; ~50,000 (a central kitchen, hundreds of movements a day for years) is not. | Track `max(movements per product/branch)`; act at ~5,000 rows/product or when the cost read alone exceeds ~1 s. | **Snapshot + tail replay**, the same escape hatch ADR 0011 Q8 wrote for balance. **Design constraint adopted NOW so it stays a pure addition:** the replay function takes its opening layer stack as a *parameter* (`openingStack = []`), never assumes it starts empty. Adding a snapshot table later then changes one caller, not the algorithm. |
| **R3** | **Unbounded read on the grid.** `/stock` already loads the whole live catalog per render (flagged in Part 10's post-completion review); cost pulls the movement rows themselves rather than an aggregate. | Payload size / row count per grid render. | Same snapshot as R2, plus paginating the grid. Not urgent: one batched query of ~15,000 rows is ~150–300 ms, and the index (`stock_movement_chronological_idx`) returns them already ordered — no sort step. |
| **R4** | **A closed period's cost can still change** — someone backdates a receipt into last month and the cost "as of" a date that was already reported moves. | Only matters once Sprint 3 books expenses against those numbers. | Accept for MVP and state it plainly: cost is always *as recomputed*, never *as reported*. A period lock belongs with the expense/accounting module, not here. |
| **R5** | **Replay is read-only but could get wrapped in a write transaction**, holding a Neon connection while it walks. | Transaction timeouts under load. | The cost read never runs inside `withTenantContext`'s write path; if a writer needs cost, it computes it before opening the transaction. |
| **R6** | **Sprint 5 inherits a cascade design that no longer applies** (H.9's trigger on a table that will not exist). | — | Recorded here and in ADR 0014 rather than discovered in Sprint 5. |

### Grill CLOSED (Q1–Q12, 2026-08-16) — ADR 0014 to be written at L0

### Implementation plan (L0–L6 — TDD vertical slices; batch-pushed at L6)
| L | Layer | Note |
|---|---|---|
| **L0** | Docs — **ADR 0014** · CONTEXT.md cost entries · master-spec §5.7 superseded note · this section | ✅ _(this commit)_ · CONTEXT.md gained **Product cost / Cost layer / Cost declaration / Cost source**; `Recipe cost` was wrong twice over (*"uses latest product_cost_history"* — no such table, and "latest" read as *last purchase price*, which is neither FIFO nor what the field meant). The §5.7 note also records that **H.9's cascade trigger has nothing left to fire on** |
| L1 | Schema — `stock_cost_declaration` + RLS + **partial unique `(movement_id) WHERE superseded_at IS NULL`** + 3 inline CHECKs | ✅ `20260816163054_part_14_stock_cost_declaration` **applied to Neon**, partial unique + RLS applied. Only new table in the Part; the ledger is untouched. The row keeps the cost **as entered** (`input_unit_cost` + `input_unit_id` — an owner declares "กระสอบละ 4,500", never "180.0000 ฿/kg") alongside the derived per-base-unit rate, mirroring `stock_adjustment`. `unit_cost >= 0` allows **zero deliberately** — zero is the `UNPRICED` fallback's value. "The movement must be an `ADJUST_GAIN`" is **not** a CHECK: it reads a column on another table, which Postgres CHECKs cannot do → in-app, the same call ADR 0012 Q2 made for allocation sums. ⚠️ `enable_rls.sql` is not re-runnable as a whole (it fails on the first existing policy) — apply only the new block |
| L2 | zod — `src/lib/validations/stock-cost.ts` + the optional cost on the adjust form | ✅ 17 tests. The declaration body is **shared by both entry points** so "the cost you type today" and "the cost you type in November" cannot drift apart. **Zero is a legal cost** (a free sample; also the UNPRICED fallback's value) but negative is not. zod CAN enforce the GAIN-only rule where `type` sits in the same object — a cost typed against a LOSS is rejected rather than ignored, because a field that is silently ignored is a field that lies. `asOf` is deliberately **exempt** from the 90-day backdate window: asking what stock cost two years ago is reasonable, writing a movement there is not (Part 10 Q8's precedent) |
| L3a-1 | **The replay engine**, pure — `src/server/fifo-replay.ts` | ✅ 20 tests, no DB. Stack invariant: **either every layer is positive, or the stack is exactly one negative layer** — you cannot hold stock and owe it at once. Every test asserts the Q12 money invariant, and it **caught a real bug**: settling a debt was booking the arrival's full value as money-out, when the debt had already been booked out at the cost believed at the time and only the *correction* should move. `default:` in the movement switch draws FIFO for unknown outflow types, so a Sprint 3+ `WASTE` / `TRANSFER_OUT` costs correctly the day it lands rather than being silently skipped |
| L3a-2 | Read logic — `src/server/stock-cost.ts`: the batch primitive, `getProductCostLogic`, `getBranchCostSummaryLogic` | ✅ 11 integration cases. **Three round trips regardless of how many products are asked for** (ledger rows · the GR money behind them · live declarations); the single-product function is a wrapper over the batch one, so there is no cheap-looking per-product query for a loop to reach (R1). `occurredAtFilter` was **exported** from `stock-movement.ts` rather than reimplemented — a second copy of Bangkok day bounds is how Decision #60 gets re-broken. The GR money is read straight from `line_total_actual`, so a void nets itself out (Part 13 writes the reversal line with a negated total) |

### Finding at L3a-2 — ✅ FIXED: a same-day adjustment used to sort before a same-day receipt

Two locked decisions met and produced something neither intended. **ADR 0011 Q5 gives an adjustment a business DATE** (the `/stock/adjust` form submits Bangkok midnight) while **ADR 0013 Q4 gives a receipt a true INSTANT** — so ordering the ledger by the raw `occurred_at` put *every* adjustment before *every* receipt of the same day, regardless of what happened in the kitchen. Waste thrown out after the morning delivery was valued at **yesterday's** cost, and on a product's first day at **zero**, briefly driving the pile negative until the receipt settled it. Quantities and balances were never affected — only the valuation of same-day outflows.

Found by K9 failing on a fixture that looked obviously right, and pinned by **K11** before being fixed.

**Fixed with option C (Kong's call, 2026-08-17): `costSortKey` reads a date-only `occurred_at` as the END of its Bangkok day, for costing only.** Chosen over (A) documenting and living with it, and over (B) storing a real instant when the user picks *today* — B is the more fundamental fix but it rewrites Part 10's write path, flips its own W1/W2 assertions, and leaves existing rows inconsistent with new ones. C touches **no stored data, needs no migration, and has nothing to backfill**; the ledger still says exactly what it always said. "The day's counting happened after the day's deliveries" is also the truer default. The Part 10 history viewer still lists rows by the raw value — that is a display order, and changing it is Part 10's call.

Same helper now drives the branch summary's period filter, and the hand-rolled `+24h` bounds there were replaced with the ledger's own `occurredAtFilter`, so a Bangkok business day means one thing across the whole Part (Decision #60).

### UX guardrails for the declaration feature (Kong: "หาทางทำให้ user friendly เผื่อไว้ด้วย")

1. **The adjust form must not get slower.** It exists for batch entry — ten items in a row, qty and Enter (Part 10 L5a shape 4). The cost field is **collapsed by default** behind "ระบุต้นทุนเอง"; the resolved default is shown as plain text next to it (*"ระบบใช้ 180 ฿/kg — จากการซื้อครั้งล่าสุด 1 ส.ค."*) so the user can judge it without opening anything, and it never blocks submit.
2. **Declare in the unit the user thinks in.** A restaurant owner knows "กระสอบละ 4,500", not "kg ละ 180". The cost input carries the same unit picker as the qty field and converts to the base unit server-side with the existing `toBaseQty` path — storing per base unit while *typing* per base unit are different decisions, and only the first one is ours to make.
3. **Guessed costs must be findable later**, or "correct it when you find the invoice" is a promise the UI cannot keep. The product cost page lists rows the system priced by fallback with a badge (*"ระบบเดาต้นทุนให้"*), and `hasUnpricedLayers` surfaces as a visible caveat rather than a silent 0.
4. **Superseding shows its history**, mirroring `MappingHistoryViewer` — who declared what, when, and the note — so a corrected number can be defended to whoever asks.
5. **Thai UI never says "declaration"** — "ระบุต้นทุน" / "แก้ต้นทุน" / "ประวัติการระบุต้นทุน".
6. Deferred, not forgotten: declaring one found invoice across several gains at once (bulk). One at a time is enough for MVP.

### Risk register — the replay design (recorded at Kong's request, 2026-08-16)

Prepared responses for problems that may never happen. Each row: the risk · the signal that it is starting · what we do about it.

| # | Risk | Early signal | Prepared response |
|---|---|---|---|
| **R1** | **N+1 replay.** A caller loops per product — 200 products × one round trip to Neon Singapore (~30–60 ms) = 6–16 s. This is the one that will actually happen, and it is a coding mistake, not a design flaw. | A page that got slow after adding cost, while row counts stayed small. | **Prevent at the API shape:** the read layer's primitive takes `productIds[]` and returns a map; the single-product function is a thin wrapper over the batch one. There is deliberately **no** per-product query exported for a caller to loop. Assert it in a test that counts queries for a 3-product grid. |
| **R2** | **Growth makes the walk slow.** ~450 rows for a 3-year top-mover is nothing; ~50,000 (a central kitchen, hundreds of movements a day for years) is not. | Track `max(movements per product/branch)`; act at ~5,000 rows/product or when the cost read alone exceeds ~1 s. | **Snapshot + tail replay**, the same escape hatch ADR 0011 Q8 wrote for balance. **Design constraint adopted NOW so it stays a pure addition:** the replay function takes its opening layer stack as a *parameter* (`openingStack = []`), never assumes it starts empty. Adding a snapshot table later then changes one caller, not the algorithm. |
| **R3** | **Unbounded read on the grid.** `/stock` already loads the whole live catalog per render (flagged in Part 10's post-completion review); cost pulls the movement rows themselves rather than an aggregate. | Payload size / row count per grid render. | Same snapshot as R2, plus paginating the grid. Not urgent: one batched query of ~15,000 rows is ~150–300 ms, and the index (`stock_movement_chronological_idx`) returns them already ordered — no sort step. |
| **R4** | **A closed period's cost can still change** — someone backdates a receipt into last month and the cost "as of" a date that was already reported moves. | Only matters once Sprint 3 books expenses against those numbers. | Accept for MVP and state it plainly: cost is always *as recomputed*, never *as reported*. A period lock belongs with the expense/accounting module, not here. |
| **R5** | **Replay is read-only but could get wrapped in a write transaction**, holding a Neon connection while it walks. | Transaction timeouts under load. | The cost read never runs inside `withTenantContext`'s write path; if a writer needs cost, it computes it before opening the transaction. |
| **R6** | **Sprint 5 inherits a cascade design that no longer applies** (H.9's trigger on a table that will not exist). | — | Recorded here and in ADR 0014 rather than discovered in Sprint 5. |

### Grill CLOSED (Q1–Q12, 2026-08-16) — ADR 0014 to be written at L0

### Implementation plan (L0–L6 — TDD vertical slices; batch-pushed at L6)
| L | Layer | Note |
|---|---|---|
| **L0** | Docs — **ADR 0014** · CONTEXT.md cost entries · master-spec §5.7 superseded note · this section | ✅ _(this commit)_ · CONTEXT.md gained **Product cost / Cost layer / Cost declaration / Cost source**; `Recipe cost` was wrong twice over (*"uses latest product_cost_history"* — no such table, and "latest" read as *last purchase price*, which is neither FIFO nor what the field meant). The §5.7 note also records that **H.9's cascade trigger has nothing left to fire on** |
| L1 | Schema — `stock_cost_declaration` + RLS + **partial unique `(movement_id) WHERE superseded_at IS NULL`** + 3 inline CHECKs | ✅ `20260816163054_part_14_stock_cost_declaration` **applied to Neon**, partial unique + RLS applied. Only new table in the Part; the ledger is untouched. The row keeps the cost **as entered** (`input_unit_cost` + `input_unit_id` — an owner declares "กระสอบละ 4,500", never "180.0000 ฿/kg") alongside the derived per-base-unit rate, mirroring `stock_adjustment`. `unit_cost >= 0` allows **zero deliberately** — zero is the `UNPRICED` fallback's value. "The movement must be an `ADJUST_GAIN`" is **not** a CHECK: it reads a column on another table, which Postgres CHECKs cannot do → in-app, the same call ADR 0012 Q2 made for allocation sums. ⚠️ `enable_rls.sql` is not re-runnable as a whole (it fails on the first existing policy) — apply only the new block |
| L2 | zod — `src/lib/validations/stock-cost.ts` + the optional cost on the adjust form | ✅ 17 tests. The declaration body is **shared by both entry points** so "the cost you type today" and "the cost you type in November" cannot drift apart. **Zero is a legal cost** (a free sample; also the UNPRICED fallback's value) but negative is not. zod CAN enforce the GAIN-only rule where `type` sits in the same object — a cost typed against a LOSS is rejected rather than ignored, because a field that is silently ignored is a field that lies. `asOf` is deliberately **exempt** from the 90-day backdate window: asking what stock cost two years ago is reasonable, writing a movement there is not (Part 10 Q8's precedent) |
| L3a-1 | **The replay engine**, pure — `src/server/fifo-replay.ts` | ✅ 20 tests, no DB. Stack invariant: **either every layer is positive, or the stack is exactly one negative layer** — you cannot hold stock and owe it at once. Every test asserts the Q12 money invariant, and it **caught a real bug**: settling a debt was booking the arrival's full value as money-out, when the debt had already been booked out at the cost believed at the time and only the *correction* should move. `default:` in the movement switch draws FIFO for unknown outflow types, so a Sprint 3+ `WASTE` / `TRANSFER_OUT` costs correctly the day it lands rather than being silently skipped |
| L3a-2 | Read logic — `src/server/stock-cost.ts`: the batch primitive, `getProductCostLogic`, `getBranchCostSummaryLogic` | ✅ 11 integration cases. **Three round trips regardless of how many products are asked for** (ledger rows · the GR money behind them · live declarations); the single-product function is a wrapper over the batch one, so there is no cheap-looking per-product query for a loop to reach (R1). `occurredAtFilter` was **exported** from `stock-movement.ts` rather than reimplemented — a second copy of Bangkok day bounds is how Decision #60 gets re-broken. The GR money is read straight from `line_total_actual`, so a void nets itself out (Part 13 writes the reversal line with a negated total) |

### ⚠️ Finding at L3a-2 — a same-day adjustment always sorts before a same-day receipt

Two locked decisions meet here and produce something neither intended: **ADR 0011 Q5 gives an adjustment a business DATE** (the `/stock/adjust` form submits Bangkok midnight) while **ADR 0013 Q4 gives a receipt a true INSTANT**. The replay orders by `occurred_at`, so on any given day *every* adjustment precedes *every* receipt — regardless of what actually happened in the kitchen.

Effect on cost, bounded but real: waste thrown out **after** today's delivery is valued at **yesterday's** cost rather than today's, and on a product's first day — with no earlier cost to fall back on — at **zero**, briefly driving the pile negative until the receipt settles it. Quantities and balances stay correct throughout; only the valuation of same-day outflows is affected.

Pinned by **K11** in `tests/stock-cost-logic.test.ts` so the behaviour is documented rather than discovered later. **Not fixed in Part 14** — the fix belongs to Part 10's write path (store a real instant when the user picks *today*, keep the day value when backdating), it would flip Part 10's own W1/W2 assertions, and it is a deviation from an approved plan. 🛑 **Needs Kong's decision** — options: (A) leave it and document, (B) instant-for-today in `createStockAdjustmentLogic`, (C) treat a date-only `occurred_at` as end-of-Bangkok-day when ordering, which fixes the ordering without changing any stored data. I recommend **C**: it is a read-layer change, it touches no history, and "the day's counting happened after the day's deliveries" is the truer default.
| L3b | Write logic — `src/server/cost-declaration.ts` | ✅ +4 cases (K12–K15). Lives in its **own file importing neither `stock-movement.ts` nor `stock-cost.ts`**, because both need it — the adjust write path writes a declaration inside its own transaction, the cost read reads them back — and a one-way dependency is what keeps the three out of a cycle. `writeCostDeclaration(tx, …)` takes `tx` rather than `tenantId`, the same deliberate break with convention `createStockMovementLogic` makes and for the same reason: a form submission must never be able to record stock at a price nobody typed. The GAIN-only rule is enforced here and only here — a CHECK cannot read another table's column |
| L4 | Actions + Thai errors + view serializer | ✅ `src/app/cost/{actions.ts,_components/cost-view.ts}`. Every Decimal leaves as a **string** — Pitfall #20 plus a precision reason on top: a `Number` round-trip on a `Decimal(15,4)` corrupts exactly the money figures this Part exists to protect. Dates formatted server-side (Part 10 L5c). A declaration revalidates **both** `/cost` and `/stock`, because cost is derived on every read and therefore changes every surface that shows one, not just the page it was typed on. Only the two errors this action can actually produce map to Thai; the rest rethrow to the error boundary |
| L5a | `/cost` — the business-wide branch comparison + layout + dashboard nav | ✅ Entry point is the **business**, not a branch (the vision: Mise manages a restaurant business, and purchasing/accounting are run centrally) — per-branch detail is the drill-down. The two columns no POS reports are **waste in baht** and **paid-above-the-cheapest-branch**, both red when non-zero. Revenue/GP render as an explicit "รอเชื่อม POS", never 0 — a zero would be a lie and a blank invites "the number is broken". Period in the URL; a malformed range falls back to 30 days with a notice rather than erroring (Part 10 L5c rule) |
| L5b | Per-product cost page (layers · `costSource` · declare + history) | ⏳ |
| L5b | Adjust-form cost field (collapsed, default shown as text, never blocks submit) | |
| L5c | Branch-comparison page + `/stock` value column | ⚠️ sum layers, never multiply |
| L6 | Throwaway E2E + verify + push | Must cover: backdated receipt reorders the layers · void cuts its own layer · partial void → negative layer · declaration supersedes and changes an `asOf` answer · money invariant ties to the satang |

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

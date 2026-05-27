# Mise Sprint Progress

**Last updated:** 2026-05-28

## Current Sprint: Sprint 1 — Master Data

**Status:** 🚧 Starting
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
- [ ] Schema migrated successfully
- [ ] RLS policies applied for all new tenant-scoped tables
- [x] 16 default categories seeded on tenant creation (H.1.2) — verified Part 6 E2E
- [ ] CRUD pages for Supplier
- [~] CRUD pages for Product — Part 7a ✅ (RAW + base unit), Part 7b ✅ (multi-unit), Part 7c ✅ (PREPPED); density = Part 7d
- [x] CRUD pages for Category (3-tier: account → accounting_section → group)
- [ ] Supplier-Product mapping UI
- [ ] All Sprint 0 features still work

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

### Decisions (Q1–Q5)
| Q | Decision |
|---|----------|
| Q1 | Split: **7b = multi-unit only**, 7c = PREPPED + density (multi-unit is the heavy/core part everything downstream uses) |
| Q2 | **All ProductUnit rows share the Product's `primaryDimension`.** Cross-dimension (WEIGHT↔VOLUME) = density's job (7c), not units. zod/logic **rejects** any row with `unitDimension ≠ primaryDimension`. → **ADR 0006** |
| Q3 | **Base = unit_template only** (needs toSiRatio for density/SI math). **Additional units may be custom** (free-text packaging: กระสอบ/ลัง/ขวด — seed has none). `source` = `system` if name matches a template of that dimension else `custom`; **records name origin only — toBaseRatio is product-specific** (ขวด of brand A milk ≠ B). Additional `toBaseRatio` zod `.positive()`; base = 1 always. Unit-name uniqueness validated at **zod** (before DB → clean error vs P2002). |
| Q4 | Form **Option A**: top section = 7a's dimension + base-unit select (= the base row, ratio=1); below = "หน่วยเพิ่มเติม" dynamic rows `[name | toBaseRatio | ◯ default-buy | delete]` + "+ เพิ่มหน่วย". `isDefaultBuyUnit` = one radio across base + additional, default = base. |
| Q5 | Edit reconcile **Option C** (delete-all-recreate ruled OUT — `SupplierProductMapping.orderUnitId → ProductUnit.id` FK, Part 8 will reference unit ids): **base updated in-place** (`updateMany {productId, isBase:true}`, id stable per ADR 0005); **additional diffed by `unitName`** (create new / update existing / **hard-delete** removed). |
| Q5c | Additional removal = **hard delete** (not soft). Reason: `ProductUnit` has **no `deletedAt`** by design (ADR 0005) → soft-delete would need a migration + reintroduce P2002-after-delete (Pitfall #23 family). Safe in 7b (no FK refs to additional units yet). |

### Validation ruleset (zod + logic)
- base `toBaseRatio` = 1 (structural via Option A); additional `.positive()`.
- ALL unit names (base + additional) **unique within product** — checked at zod before DB.
- every row `unitDimension` = `primaryDimension` (reject otherwise — Q2).
- exactly one `isBase`, exactly one `isDefaultBuyUnit`; default-buy must be base or an existing additional.

### Must also do in 7b (Pitfall #24)
Narrow `rethrowSkuConflict` via `e.meta.target` → distinguish `sku` conflict vs `product_id+unit_name` conflict. Multi-unit makes the unit-name P2002 **reachable** (7a couldn't trigger it). Map unit-name P2002 → its own Thai message / field error.

### Serializer (Pitfall #20)
`product-view.ts`: extend `ProductView` with `units: { unitName, toBaseRatio (string), isBase, isDefaultBuyUnit, source }[]` — `toBaseRatio` is Decimal → `.toString()`. ProductTree leaf: show base unit + "(+N)" when additional exist.

### Deferred (carry-forward guard)
**Part 8 / Sprint 2:** add a guard "block rename/delete of a `ProductUnit` referenced by a supplier mapping / PO" (`orderUnitId`). Same family as ADR 0005's deferred base-unit-change guard. Until refs exist, hard-delete + rename-as-delete+create are safe.

### Plan (template chain, TDD)
zod (`productInputSchema` + units array) → `*Logic` (extend create to N units + update diff, TDD) → actions (Pitfall #24 narrowing) → `product-view` (+units) → ProductForm (dynamic rows) + ProductTree leaf → verify (headless). ADR **0006** written.

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

# Mise Sprint Progress

**Last updated:** 2026-05-23

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
- [~] CRUD pages for Product — Part 7a ✅ (RAW + single base unit); multi-unit/PREPPED/density = Part 7b
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

### Next: Part 7b — multi-unit (dynamic ProductUnit rows, one isBase/one isDefaultBuyUnit) + PREPPED (parentProductId + yieldPercent, Decision #59) + liquid density (VOLUME). Then Supplier⇄Product mapping UI.

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

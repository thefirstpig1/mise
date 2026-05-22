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
- [ ] 16 default categories seeded on tenant creation (H.1.2)
- [ ] CRUD pages for Supplier
- [ ] CRUD pages for Product (with multi-unit support)
- [ ] CRUD pages for Category (3-tier: account → accounting_section → group)
- [ ] Supplier-Product mapping UI
- [ ] All Sprint 0 features still work

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

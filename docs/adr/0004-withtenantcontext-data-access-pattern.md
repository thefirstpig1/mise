---
status: accepted
---

# Tenant-scoped data access via withTenantContext + requireTenant() helper

All tenant-scoped reads and writes go through `withTenantContext(tenantId, (tx) => ...)` (defined in `src/lib/db.ts`), not bare `prisma`. A shared `requireTenant()` helper in `src/lib/` performs auth + cross-tenant membership discovery and returns `{ session, user, membership, tenantId }`; callers then run their scoped queries inside `withTenantContext`. This makes Suppliers (Sprint 1 Part 5) the first feature to actually adopt the wrapper that `db.ts` already mandated, and sets the pattern for Part 5-8 and Sprint 2-7. Chosen over the Sprint 0 bare-`prisma` habit because forgetting a `WHERE tenant_id` is a silent cross-tenant leak, and the wrapper makes tenant scoping the default instead of a thing you must remember.

## Considered Options

- **withTenantContext for all scoped queries (chosen)** — defense-in-depth aligned with ADR 0001; forward-compatible with real RLS enforcement; one place to evolve.
- **Bare prisma + manual `WHERE tenantId`** — matches Sprint 0, simplest, but leak-prone and would need full retrofit once RLS is actually enforced.
- **Adopt wrapper AND enable FORCE RLS now** — would turn on real DB-level enforcement immediately, but bundles a risky DB change into UI work and would break Sprint 0 pages (bare prisma) at the DB layer. Deferred to its own slice (Sprint 7).

## Consequences

- **Two-layer access.** "Membership discovery" (find which tenant a user belongs to, filtered by `userId`) is inherently cross-tenant and MUST run as bare/admin prisma — it is the query that *discovers* the tenant. Only *after* `tenantId` is known do scoped reads/writes run inside `withTenantContext`. `requireTenant()` owns layer 1.
- **RLS is enabled but not yet enforced against the app role.** The app connects as the table-owner role (`neondb_owner`) and `enable_rls.sql` does not set `FORCE ROW LEVEL SECURITY`, so the owner bypasses RLS today. `withTenantContext`'s `SET LOCAL` is therefore currently harmless-but-inert — it protects nothing until FORCE RLS / a non-owner role lands. That enforcement work is deferred to Sprint 7 and will get its own ADR. Adopting the wrapper now means that change becomes flip-a-switch instead of a rewrite.
- **Retrofit scope.** Only `dashboard` and `settings` get retrofitted to this pattern (their scoped reads/writes). `login` and `signup` are pre-tenant (Auth.js tables / tenant bootstrap) and stay on bare prisma by necessity.
- **Permission checks are NOT in `requireTenant()`** (Single Responsibility) — composed separately by callers. Full PermissionService matrix activates in Sprint 2 when non-owner roles exist.
- **Active-tenant selection = first active membership** (no tenant switcher in Sprint 1).
- **Testability win.** Pure logic keyed by `tenantId` (not by an auth session) lets the high-value RLS isolation tests pass Tenant A vs Tenant B directly, without mocking auth (see tdd skill).

Related: ADR 0001 (multi-tenant via RLS), src/lib/db.ts, known-pitfalls (RLS), Sprint 1 Part 5

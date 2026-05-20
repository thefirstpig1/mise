# Multi-tenant via PostgreSQL RLS

Mise uses a single shared database with PostgreSQL Row-Level Security (RLS) policies for tenant isolation, rather than separate databases or schemas per tenant. Every tenant-scoped table has a tenant_isolation policy that filters by app.current_tenant_id session variable. Decision rationale: single DB is cheaper for SME scale, RLS provides defense-in-depth even if application code has bugs, and Postgres RLS is mature and well-supported.

## Considered Options

- **Database-per-tenant**: too expensive to operate at SME scale (1000s of tenants)
- **Schema-per-tenant**: harder to do schema migrations, expensive on Neon
- **Application-only filtering**: no defense if app code forgets WHERE clause
- **RLS (chosen)**: defense-in-depth, scales well, mature in Postgres

## Consequences

- All queries must run inside `withTenantContext(tenantId, ...)` wrapper
- Cannot easily run cross-tenant analytics without `withAdminContext` (BYPASSRLS role)
- New tenant-scoped tables MUST have RLS policy added (see prisma/manual/enable_rls.sql)
- Test tenant isolation explicitly for every new table

Related: Decision #55 (changelog-v5), Section H.10 (Master Spec)

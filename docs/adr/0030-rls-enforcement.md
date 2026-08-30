# ADR 0030 — เปิด RLS ให้ทำงานจริง: role ที่ข้ามไม่ได้ และสวิตช์ที่รู้ว่าตัวเองถูกเปิด

**Status:** accepted · **Date:** 2026-08-30 · **Grill:** Q1–Q6
**Part:** Sprint 7 Part 30 · **Pays** ADR 0004 Consequence 3 (deferred to Sprint 7 by name) · **Completes** ADR 0001 · **Second half of** ADR 0029 Consequence 3 — Sprint 6 kept people inside a shop apart, this keeps the shops apart

## Context

RLS is not missing. It has been **on** since Sprint 0 and has never filtered a single row.

Measured against the Neon dev database during the grill, not inferred:

```
role the application connects as : neondb_owner
   rolbypassrls                  : true      ← the BYPASSRLS attribute
   owns the tables               : true      ← an owner bypasses too
tables 54 · RLS enabled 47 · RLS FORCED 0 · policies present 47
tables carrying tenant_id 43 — every one of them has a policy
```

**This is not a discovery.** ADR 0004 Consequence 3 wrote it down precisely in Sprint 1: *"The app connects as the table-owner role (`neondb_owner`) and `enable_rls.sql` does not set `FORCE ROW LEVEL SECURITY`, so the owner bypasses RLS today. `withTenantContext`'s `SET LOCAL` is therefore currently harmless-but-inert."* The numbers above are the confirmation, and the point of this Part is to end the sentence.

Six facts from reading the code and the database shaped the answers.

1. **`FORCE ROW LEVEL SECURITY` alone would achieve nothing.** FORCE removes the *owner's* bypass. It does not touch the `BYPASSRLS` **attribute**, which `neondb_owner` also has (Neon grants it `neon_superuser`). A role with that attribute skips row security everywhere regardless of FORCE. Forty-seven `ALTER TABLE`s would have changed nothing measurable.

2. **`db.ts:279` describes a role that does not exist.** The comment reads `// No SET LOCAL → uses mise_admin role (BYPASSRLS)`, and `pg_roles` in this database has no `mise_admin` — it is a survivor of the Docker era that ADR 0003 left behind. `withAdminContext` and `withTenantContext` connect as the same role today; the only difference between them is whether a `SET LOCAL` nobody reads gets issued.

3. **`withAdminContext` has 0 call sites in `src/` and appears in 48 test files.** The RLS-bypassing door is, in practice, a fixtures door. Nothing in the application has ever used it.

4. **The line that will decide tenant isolation is built by string concatenation.** `db.ts:261`: `` tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`) ``. `tenantId` comes from a membership row so it is not injectable in practice, but Postgres provides `set_config('app.current_tenant_id', $1, true)` for exactly this and it takes a bind parameter.

5. **`createTenant` writes seven rows before the tenant exists.** `tenant-init.ts:31` opens a bare `prisma.$transaction` — correctly, since it is creating the tenant that scoping would key on — and inserts tenant → membership → branch → branch access → department → assignment → 17 categories.

6. **`require-tenant.ts:83` is cross-tenant BY NATURE**, keyed on `userId` because it is the query that *discovers* the tenant. Under a policy that keys on `app.current_tenant_id`, with nothing set, it would return zero rows and login would stop working entirely. `app_user` is not under RLS, so `membership.ts:279`'s upsert by email is unaffected.

## Decision

### Q1 — A role that cannot bypass, plus FORCE as the belt to the braces

A new database role — not the table owner, without `BYPASSRLS` — becomes the application's connection. A non-owner is subject to row security by default, so this is the change that makes the forty-seven policies start working.

`FORCE ROW LEVEL SECURITY` is applied as well, even though it is redundant while the app role is not the owner. It costs one line per table and it closes the failure this Part exists to end: ownership quietly moving, or a future role being granted more than intended, and everything going silent again with nothing to notice it.

*(Rejected: **FORCE alone.** It addresses the owner bypass and not the `BYPASSRLS` attribute, so it would have produced a forty-seven-line change with no measurable effect — the exact shape of the thing being fixed.)*

### Q2 — The bypass lives in its own module, and a test keeps it there

`src/lib/db.ts` exports only the RLS-subject client. The bypassing client moves to a module of its own, and `requireTenant` gets a **narrow function for membership discovery** rather than a general-purpose admin door.

A scan test refuses any import of the bypassing module from `src/app/**` or `src/server/**` outside a named allowlist — the same device as `permissions-gate-shape.test.ts` and `sweep-coverage.test.ts`. **The allowlist has exactly one entry** (`require-tenant.ts`), and keeping it at one is the point of splitting the module: an allowlist that grows is an allowlist that has stopped meaning anything.

`withAdminContext` is **renamed** to say what it does. Today the name is doubly false — no `mise_admin`, and nothing bypassed. Once it is real, somebody typing it into a page should be able to tell from the word alone that they are doing something dangerous.

*(Rejected: **naming and review alone** — that is what the last twenty-nine Parts did, and fact 2 is the result. Rejected: **the scan test without the module split** — the allowlist would grow, because a general `withAdminContext` is convenient.)*

### Q3 — Build the instrument that proves isolation BEFORE throwing the switch

Forty-seven pieces of SQL that have never filtered a row are forty-seven pieces of SQL that have never been tested. The 1,223-test suite proves the application still *works*; it says nothing about whether the database *isolates*. Those are different claims and only the second is what this Part is for — a policy written `tenant_id = tenant_id` would keep every existing test green.

So a schema-driven isolation harness lands first: for every table carrying `tenant_id`, write a row as tenant A and read it through the RLS-subject client in tenant B's context. It must return nothing.

**It has to be seen failing on all forty-three tables while RLS is still bypassed**, because that is the evidence it can detect the absence of isolation at all. Then the switch is thrown in one commit and the harness goes green.

A table added in a future Part without a policy makes it red, the way `sweep-coverage.test.ts` goes red for a table missing from the delete order.

*(Rejected: **flip and rely on the suite** (see above). Rejected: **flip in stages** — an intermediate state where some tables filter and others do not is harder to reason about than either end, and explains itself to nobody.)*

### Q4 — Signup mints the tenant id and sets the context, instead of bypassing

The `tenant` policy is `USING (id = current_setting(...)::uuid)`, and Postgres uses `USING` as `WITH CHECK` when no separate check is given. So inserting a tenant requires its id to equal a session value that cannot possibly be set yet — **turning RLS on today would make it impossible to create a shop**, and the six rows after it would fail for their own reasons.

`createTenant` therefore **generates the uuid in the application**, calls `set_config` with it, and inserts all seven rows through ordinary policies inside the one transaction it already opens.

This is chosen over letting signup use the bypass door, for a reason specific to that route: **`/signup` requires no login**, which would make it the only place in the product where an unauthenticated request touches the RLS-bypassing connection. Q2 spent the whole question keeping that door away from request paths. It also has a second benefit — the first seven rows of every new shop become a live proof that the policy set works.

*(Rejected: **a permissive `WITH CHECK (true)` on `tenant`** — it moves the reasoning into SQL where the people reading the signup code cannot see it, and does nothing for the other six inserts.)*

### Q5 — The policies stop being polite about a missing context

Every policy currently reads `current_setting('app.current_tenant_id', true)`. That `true` means *"return NULL instead of raising if it is unset"* — so a query that forgets its context does not fail. It returns **zero rows, silently**. The shop phones to say the data has disappeared, and the investigation starts at the data.

The flag is removed. A query with no tenant context now **errors**, loudly, in development, where it is a bug rather than a support call.

This is rule A8 one level up: ADR 0029 refused to let "you may not see this" render as `฿0` because absence and refusal are different facts. A silently-empty RLS is that same confusion applied to an entire screen.

The bypassing role is unaffected — policies are never evaluated for it.

⚠️ The exact error differs depending on whether the GUC has been set in that session before (`unrecognized configuration parameter` versus `invalid input syntax for type uuid: ""`), so a test pins the behaviour rather than the message.

### Q6 — RLS protects nothing that has no `tenant_id`, and four tables qualify

Seven tables carry no policy. Three are correct and uninteresting: `_prisma_migrations`, and the global reference data `unit_template` / `liquid_density_template` that every shop shares.

The other four are Auth.js's: `app_user`, `account`, `session`, `verification_token`. They stay open. Auth.js reads them without a tenant by nature — at login time there is no tenant yet — and `session`, `account` and `verification_token` are keyed by opaque tokens rather than anything enumerable.

`app_user` is the one that matters, because it holds every email address in the product and `prisma.user.findMany()` would return all of them. The compensating guard is a scan test forbidding unscoped `prisma.user` queries outside a named allowlist (the Auth.js adapter, `require-tenant`, `membership.ts`'s upsert).

*(Rejected: **RLS on `app_user` with the Auth.js adapter on the bypassing client.** It looks safer and is not: it would put the login path — public, unauthenticated, the most-hit route in the product — permanently on the connection that ignores row security, which is precisely what Q2 exists to prevent.)*

**Written down deliberately: turning RLS on does not make the database safe, it makes 43 tables isolated.** Knowing which four are not, and that they belong to Auth.js, is worth more than the comfortable summary.

## Schema

**No Prisma schema change and no migration.** Everything in this Part is a database role, grants, and policy SQL, which live in `prisma/manual/` outside `prisma/migrations/` by the Sprint 0 convention.

| Object | Change |
| --- | --- |
| role `mise_app` | new · LOGIN · **not** the table owner · **no** `BYPASSRLS` · `GRANT SELECT, INSERT, UPDATE, DELETE` on all current tables + `ALTER DEFAULT PRIVILEGES` so tables from future Parts are reachable |
| 47 tables | `FORCE ROW LEVEL SECURITY` (Q1) |
| 47 policies | `current_setting(..., true)` → `current_setting(...)` (Q5) |
| `tenant.id` | generated by the application rather than by `@default(uuid())` at insert time (Q4) — a call-site change, not a schema one |

🛑 **Requires Kong before any of it runs:** creating the role and its password, `DATABASE_URL` repointed at `mise_app`, and a new `ADMIN_DATABASE_URL` for the Q2 door. `DIRECT_URL` is unchanged — migrations keep running as the owner.

## Consequences

1. **The slow suite gets its reason back.** ADR 0023 Consequence 5 records that every read opens an interactive transaction so `SET LOCAL` has somewhere to live — four round trips to Singapore per row — *"and per ADR 0004 that `SET LOCAL` protects nothing until Sprint 7"*. After this Part it protects something. The cost does not change; the justification does.

2. **The whole test suite becomes an isolation test by construction.** Fixtures and teardown use the bypassing client, while every `*Logic` call under test goes through `withTenantContext` and therefore through real policies. That is a large amount of coverage bought with no new tests — and the reason the harness of Q3 is still needed on top: coverage that everything *works* is not evidence that anything is *separated*.

3. **`withAdminContext` becomes real for the first time**, in 48 test files at once. Its rename is not cosmetic: until this Part the word "bypass" in its doc comment described nothing.

4. **Nine of the forty-seven policies are `EXISTS` subqueries over a parent**, because those child tables carry no `tenant_id` (`product_unit` and friends). They are correct — a child whose parent is invisible should be invisible — and they will execute for the first time on the day the switch is thrown. If a read gets slow, that is the first place to look.

5. **Part 20b and production email remain blocked** on choosing an inbound-mail vendor, untouched by this Part. Worth restating because the invitation flow built in Part 29 depends on the magic link, which `auth.ts` still refuses to send outside development.

## Rules

ดู `docs/calculation-rules.md` §11.9 — **I1–I8**

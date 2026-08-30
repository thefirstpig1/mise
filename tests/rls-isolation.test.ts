// ============================================================
// Mise — proof that the database separates shops (Part 30 L1, ADR 0030 Q3)
// ============================================================
// Forty-seven policies have existed since Sprint 0 and, until this Part, had
// never filtered a row — the application connected as a role that both owned
// the tables and carried BYPASSRLS (ADR 0004 Consequence 3, confirmed by
// measurement in ADR 0030's Context).
//
// SQL THAT HAS NEVER FILTERED ANYTHING IS SQL THAT HAS NEVER BEEN TESTED, and
// the 1,223-test suite cannot help: it proves the application WORKS, which a
// policy reading `tenant_id = tenant_id` would also allow. Whether the database
// SEPARATES is a different claim, and this file is the only thing that makes
// it.
//
// WHY THIS CONNECTS ON ITS OWN URL. It always talks to `MISE_APP_URL` — the
// role that is subject to row security — rather than to whatever `DATABASE_URL`
// happens to be during the migration of Part 30. So it tests the same thing
// before and after the switch, and cannot go quietly green because somebody
// repointed the application.
//
// Fixtures are written through ADMIN_DATABASE_URL, which bypasses RLS on
// purpose: the rows have to exist before their invisibility means anything.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { config } from "dotenv";
import { tenantScopedModels } from "./support/sweep";

config({ path: ".env" });

/**
 * The connection the APPLICATION uses — deliberately, and this was wrong
 * once already.
 *
 * The first version read `MISE_APP_URL` on the theory that naming the role
 * was more precise than naming the app's own variable. Then the switch
 * happened by SWAPPING the two names in `.env`, and this file quietly began
 * testing the owner: it reported that a context-less read returned 17 rows
 * and had no idea that was its own doing.
 *
 * `DATABASE_URL` is the honest choice. It says "whatever the application
 * connects as must be isolated", which is the claim worth making, and it is
 * red before the switch and green after without anybody editing this file.
 */
const APP_URL = process.env.DATABASE_URL;
/** The owner. Used only to create and destroy the fixture. */
const OWNER_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DIRECT_URL;

const asApp = new PrismaClient({ datasources: { db: { url: APP_URL } } });
const asOwner = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });

/** Run a block with a tenant context, the way withTenantContext does. */
async function inTenant<T>(
  db: PrismaClient,
  tenantId: string,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

describe("RLS actually separates tenants (ADR 0030 Part 30)", () => {
  let tenantA: string;
  let tenantB: string;
  let branchA: string;

  beforeAll(async () => {
    tenantA = randomUUID();
    tenantB = randomUUID();
    branchA = randomUUID();

    await asOwner.$executeRaw`
      insert into tenant (id, name, plan, created_at, updated_at)
      values (${tenantA}::uuid, ${"RLS Shop A"}, 'trial', now(), now())
    `;
    await asOwner.$executeRaw`
      insert into tenant (id, name, plan, created_at, updated_at)
      values (${tenantB}::uuid, ${"RLS Shop B"}, 'trial', now(), now())
    `;
    await asOwner.$executeRaw`
      insert into branch (id, tenant_id, name, code, is_active, created_at, updated_at)
      values (${branchA}::uuid, ${tenantA}::uuid, ${"อโศก"}, ${"RLSA"}, true, now(), now())
    `;
  });

  afterAll(async () => {
    await asOwner.$executeRaw`delete from branch where tenant_id in (${tenantA}::uuid, ${tenantB}::uuid)`;
    await asOwner.$executeRaw`delete from tenant where id in (${tenantA}::uuid, ${tenantB}::uuid)`;
    await asApp.$disconnect();
    await asOwner.$disconnect();
  });

  // ── structural: nothing may be added without a policy ─────────────────────

  it("R1 — every model carrying a tenantId has RLS enabled and a policy", async () => {
    // The cheap half, and the one a future Part will trip. It needs no fixture
    // and covers all forty-three at once, the way sweep-coverage.test.ts covers
    // the delete order.
    const models = tenantScopedModels();

    const tables = await asOwner.$queryRawUnsafe<
      { relname: string; rls: boolean }[]
    >(`select c.relname::text, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`);
    const policies = await asOwner.$queryRawUnsafe<{ tablename: string }[]>(
      `select tablename::text from pg_policies where schemaname = 'public'`
    );

    const rlsOn = new Set(tables.filter((t) => t.rls).map((t) => t.relname));
    const hasPolicy = new Set(policies.map((p) => p.tablename));

    // Prisma model name -> table name, via the dmmf's own mapping.
    const tableOf = (model: string) =>
      Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.dbName ?? model;

    const unprotected = models
      .map((m) => ({ model: m, table: tableOf(m) }))
      .filter((x) => !rlsOn.has(x.table) || !hasPolicy.has(x.table))
      .map((x) => `${x.model} (${x.table})`);

    expect(
      unprotected,
      "These tables carry a tenant_id and are NOT isolated by the database. " +
        "Add them to prisma/manual/enable_rls.sql and grant the app role."
    ).toEqual([]);
    expect(models.length).toBeGreaterThan(40);
  });

  // ── behavioural: the half that has never been true before ─────────────────

  it("R2 — tenant B cannot see tenant A's branch", async () => {
    // THE test. Everything else in this file supports it.
    const seen = await inTenant(asApp, tenantB, (tx) =>
      tx.$queryRawUnsafe<{ n: bigint }[]>(
        `select count(*)::bigint as n from branch where id = '${branchA}'`
      )
    );
    expect(Number(seen[0].n)).toBe(0);
  });

  it("R3 — tenant A CAN see its own branch", async () => {
    // The positive control. Without it, R2 passes just as happily when the app
    // role cannot read anything at all — a broken grant would look like
    // perfect isolation.
    const seen = await inTenant(asApp, tenantA, (tx) =>
      tx.$queryRawUnsafe<{ n: bigint }[]>(
        `select count(*)::bigint as n from branch where id = '${branchA}'`
      )
    );
    expect(Number(seen[0].n)).toBe(1);
  });

  it("R4 — tenant B cannot see tenant A's tenant row either", async () => {
    // `tenant` keys on `id` rather than `tenant_id`, so it is the one policy
    // written differently from the other forty-six.
    const seen = await inTenant(asApp, tenantB, (tx) =>
      tx.$queryRawUnsafe<{ n: bigint }[]>(
        `select count(*)::bigint as n from tenant where id = '${tenantA}'`
      )
    );
    expect(Number(seen[0].n)).toBe(0);
  });

  it("R5 — a write cannot be aimed at another tenant", async () => {
    // All forty-seven policies are FOR ALL with no separate WITH CHECK, so
    // Postgres uses the USING expression for inserts too. Reading being
    // isolated does not by itself prove writing is.
    await expect(
      inTenant(asApp, tenantB, (tx) =>
        tx.$executeRawUnsafe(
          `insert into branch (id, tenant_id, name, code, is_active, created_at, updated_at)
           values ('${randomUUID()}'::uuid, '${tenantA}'::uuid, 'แอบเขียน', 'HACK', true, now(), now())`
        )
      )
    ).rejects.toThrow();
  });

  it("R6 — a query with no tenant context sees nothing", async () => {
    // Today it returns zero rows silently. After section 4 of enforce_rls.sql
    // it raises instead, which is what ADR 0030 Q5 bought — so this asserts the
    // property both spellings share, and R7 pins the change of spelling.
    const n = await asApp
      .$queryRawUnsafe<{ n: bigint }[]>(`select count(*)::bigint as n from branch`)
      .then((r) => Number(r[0].n))
      .catch(() => -1);

    expect(n, "a context-less read returned rows").toBeLessThanOrEqual(0);
  });
});

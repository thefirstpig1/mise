// ============================================================
// Mise — vitest global setup/teardown (Sprint 5 Part 23, ADR 0023 Q4/Q5)
// ============================================================
// Opens a time window at the start of the run and, at the end, deletes any
// tenant created inside it that is still standing.
//
// The window is the whole safety argument: a sweep can only ever remove rows
// this run is responsible for, so it cannot touch a tenant that was already
// there when the run began. That is why there is no marker column and no
// helper threaded through the 47 `tenant.create` sites — a test that forgets a
// marker is exactly the test whose residue you wanted caught (ADR 0023 Q4).
// ============================================================

import { config } from "dotenv";
import { prismaBypass } from "@/lib/db-admin";
import { sweepTestTenants, sweepOrphanUsers } from "./sweep";

config({ path: ".env" });

let runStartedAt: Date;

export async function setup() {
  // A second of slack: `createdAt` is the database's clock, not this process's.
  runStartedAt = new Date(Date.now() - 1_000);
}

export async function teardown() {
// The sweep deletes across EVERY tenant, which is cross-tenant by nature and
// therefore impossible under row security: a tenant-scoped connection can only
// ever see the shop it is currently in. It runs on the bypass (ADR 0030 Q2).
  const db = prismaBypass;
  try {
    const swept = await sweepTestTenants(db, { createdAfter: runStartedAt });
    // Users only become orphans once their tenant is gone, so this runs second.
    const users = await sweepOrphanUsers(db, { createdAfter: runStartedAt });
    if (swept.length === 0 && users.length === 0) return;

    // Deliberately loud. A tenant surviving its own `afterAll` is either a
    // worker that died or a teardown that does not delete everything it
    // creates — and the second is a real bug in the suite, which silence would
    // hide for as long as the sweep kept covering for it (ADR 0023 Q5).
    console.warn(
      `\n[mise-sweep] ${swept.length} test tenant(s) outlived their own teardown and were deleted:`
    );
    for (const t of swept) {
      console.warn(`[mise-sweep]   ${t.createdAt.toISOString()}  ${t.name}`);
    }
    console.warn(
      "[mise-sweep] If the run above was GREEN, this is a teardown bug — find the spec that creates a tenant by that name.\n"
    );
  } catch (e) {
    // The sweep is a safety net, never a gate: a failure here must not turn a
    // green run red (ADR 0023 Q5).
    console.warn(
      `[mise-sweep] sweep failed (harmless, run 'pnpm test:sweep' to clean up): ${
        (e as Error).message
      }`
    );
  } finally {
    // Not disconnected here: `prismaBypass` is shared, and the run is over.
  }
}

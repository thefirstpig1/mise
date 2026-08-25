// ============================================================
// Mise — `pnpm test:sweep` (Sprint 5 Part 23, ADR 0023 Q4)
// ============================================================
// The manual half of the sweep: same code as `globalTeardown`, no time window.
// Deletes EVERY tenant in the database it is pointed at, so it is for the dev
// branch that tests share — not for anything with real data in it.
// ============================================================

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { sweepTestTenants, sweepOrphanUsers } from "../tests/support/sweep";

config({ path: ".env" });

async function main() {
  const db = new PrismaClient();
  try {
    const swept = await sweepTestTenants(db);
    // Users only become orphans once their tenant is gone, so this runs second.
    const users = await sweepOrphanUsers(db);

    if (swept.length === 0 && users.length === 0) {
      console.log("[mise-sweep] nothing to sweep.");
      return;
    }
    if (swept.length > 0) {
      console.log(`[mise-sweep] deleted ${swept.length} tenant(s):`);
      for (const t of swept) {
        console.log(`[mise-sweep]   ${t.createdAt.toISOString()}  ${t.name}`);
      }
    }
    if (users.length > 0) {
      console.log(
        `[mise-sweep] deleted ${users.length} user(s) belonging to nobody.`
      );
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`[mise-sweep] failed: ${(e as Error).message}`);
  process.exit(1);
});

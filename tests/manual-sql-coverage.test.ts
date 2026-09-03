// ============================================================
// Mise — the manual SQL list cannot rot (Sprint 7 Part 34, ADR 0033 Q6)
// ============================================================
// Sibling of tests/sweep-coverage.test.ts, which solves the same shape of
// problem for the test sweep: a hand-maintained list goes stale the moment a
// Part adds a file, and it goes stale SILENTLY.
//
// The stakes here are higher than the sweep's. A file left out of the run order
// is never applied to production, and every one of these files fails quietly —
// a missing partial unique index does not raise, it lets a second row in. The
// shop finds out when a re-imported sales day doubles its revenue.
//
// No database: it reads the directory and the list.
// ============================================================

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  MANUAL_SQL_DIR,
  MANUAL_SQL_ORDER,
  ALLOWED_SQL_ENV,
} from "../scripts/manual-sql-order.mjs";

const DIR = path.resolve(process.cwd(), MANUAL_SQL_DIR);
const filesOnDisk = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("manual SQL coverage", () => {
  it("M1: every .sql file in prisma/manual/ is in the run order", () => {
    const listed = new Set(MANUAL_SQL_ORDER);
    const missing = filesOnDisk.filter((f) => !listed.has(f));

    expect(
      missing,
      `These files exist but would never be applied to a database: ` +
        `${missing.join(", ")}. A manual SQL file that does not run fails ` +
        `SILENTLY — the app starts and the constraint simply is not there. ` +
        `Add them to MANUAL_SQL_ORDER in scripts/manual-sql-order.mjs.`
    ).toEqual([]);
  });

  it("M2: the run order lists nothing that does not exist", () => {
    const present = new Set(filesOnDisk);
    const dangling = MANUAL_SQL_ORDER.filter((f) => !present.has(f));

    expect(
      dangling,
      `MANUAL_SQL_ORDER names files that are not in ${MANUAL_SQL_DIR}/: ` +
        `${dangling.join(", ")}. The release command would abort on the first ` +
        `one, cancelling the deploy.`
    ).toEqual([]);
  });

  it("M3: the run order lists nothing twice", () => {
    const seen = new Set<string>();
    const dupes = MANUAL_SQL_ORDER.filter((f) => {
      if (seen.has(f)) return true;
      seen.add(f);
      return false;
    });
    expect(dupes).toEqual([]);
  });

  it("M4: enforce_rls.sql runs last, after enable_rls.sql", () => {
    const enable = MANUAL_SQL_ORDER.indexOf("enable_rls.sql");
    const enforce = MANUAL_SQL_ORDER.indexOf("enforce_rls.sql");

    expect(enable, "enable_rls.sql must be in the run order").toBeGreaterThan(-1);
    expect(
      enforce,
      `enforce_rls.sql must run LAST: its section 4 ALTERs the 47 policies that ` +
        `enable_rls.sql creates, and its section 2 grants on ALL TABLES.`
    ).toBe(MANUAL_SQL_ORDER.length - 1);
    expect(
      enable,
      `enable_rls.sql must run BEFORE enforce_rls.sql — ALTER POLICY on a policy ` +
        `that does not exist yet is an error, and it would cancel the deploy.`
    ).toBeLessThan(enforce);
  });

  it("M5: every file is re-runnable, because the release command runs on every deploy", () => {
    // Two failure shapes, both of which used to be real in this directory:
    //   CREATE POLICY   — Postgres has no IF NOT EXISTS for it, so each one is
    //                     preceded by DROP POLICY IF EXISTS (enable_rls.sql).
    //   CREATE ROLE     — likewise, so it is wrapped in a DO block that checks
    //                     pg_roles (enforce_rls.sql).
    // Anything else creating an object needs an IF NOT EXISTS.
    const offenders: string[] = [];

    for (const file of MANUAL_SQL_ORDER) {
      const body = fs
        .readFileSync(path.join(DIR, file), "utf8")
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n");

      const creates = body.match(/^\s*CREATE\s+(?:UNIQUE\s+)?(\w+)[^;]*/gim) ?? [];
      for (const stmt of creates) {
        const flat = stmt.replace(/\s+/g, " ").trim();
        if (/IF NOT EXISTS/i.test(flat)) continue;

        // CREATE POLICY is allowed only when a DROP POLICY IF EXISTS for the
        // same table stands immediately before it.
        const policy = flat.match(/^CREATE POLICY (\w+) ON (\w+)/i);
        if (policy) {
          const guard = new RegExp(
            `DROP POLICY IF EXISTS ${policy[1]} ON ${policy[2]};\\s*\\n\\s*CREATE POLICY ${policy[1]} ON ${policy[2]}\\b`,
            "i"
          );
          if (guard.test(body)) continue;
        }

        // CREATE ROLE is allowed inside a DO block that checks pg_roles.
        if (/^CREATE ROLE/i.test(flat) && /pg_roles/i.test(body)) continue;

        offenders.push(`${file}: ${flat.slice(0, 90)}`);
      }
    }

    expect(
      offenders,
      `These statements would fail the SECOND time the release command runs, ` +
        `which cancels the deploy and leaves the shop on the old version with no ` +
        `obvious reason:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  it("M6: a file interpolates only allowlisted environment variables", () => {
    const found = new Map<string, string[]>();

    for (const file of MANUAL_SQL_ORDER) {
      const body = fs.readFileSync(path.join(DIR, file), "utf8");
      for (const m of body.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
        if (ALLOWED_SQL_ENV.includes(m[1])) continue;
        found.set(file, [...(found.get(file) ?? []), m[1]]);
      }
    }

    expect(
      [...found.entries()].map(([f, vars]) => `${f}: ${vars.join(", ")}`),
      `An expansion here becomes executable SQL text. A variable outside ` +
        `ALLOWED_SQL_ENV is either a typo — which would expand to nothing and ` +
        `report success — or a reach for a secret this file has no business ` +
        `reading.`
    ).toEqual([]);
  });
});

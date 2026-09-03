// ============================================================
// Mise — apply every file in prisma/manual/ (Part 34, ADR 0033 Q6/Q9)
// ============================================================
// WHAT THIS EXISTS TO PREVENT. A new database gets its tables from
// `prisma migrate deploy` and nothing else. Everything Prisma 5.22 cannot
// express in schema.prisma lives in prisma/manual/ — and every one of those
// files fails silently when it is missing. No error at deploy, no error on the
// screen: a re-imported sales day duplicates instead of replacing (ADR 0019), a
// merged menu loses its POS identity (ADR 0026), and row-level security is
// enabled but filtering nothing (ADR 0030 — which is exactly what happened here
// for twenty-nine Parts).
//
// The old answer was a "⚠️ Still owed" line in CLAUDE.md. It sat unpaid for two
// sprints, which is the evidence that the answer was wrong.
//
// Run by hand:              pnpm db:manual
// Run by Fly, every deploy: release_command = "pnpm release"
//
// Fly runs the release command in the new image BEFORE the new version goes
// live, and cancels the deploy on a non-zero exit. That is what makes
// forgetting structurally impossible rather than merely discouraged.
//
// PLAIN .mjs, NOT TypeScript — see the note at the top of manual-sql-order.mjs.
// ============================================================

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MANUAL_SQL_DIR,
  MANUAL_SQL_ORDER,
  ALLOWED_SQL_ENV,
} from "./manual-sql-order.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRISMA_CLI = path.join(ROOT, "node_modules", "prisma", "build", "index.js");

/** Anything a password may contain. Deliberately narrow — see expand(). */
const SAFE_VALUE = /^[A-Za-z0-9._~+-]{8,200}$/;

function fail(message) {
  console.error(`\n[manual-sql] ${message}\n`);
  process.exit(1);
}

/**
 * Replace `${NAME}` with the environment's value, for an allowlisted NAME only.
 *
 * The result is spliced into a SQL string literal, so this is the one place in
 * the project where an environment variable becomes executable text. Three
 * refusals rather than three escapes:
 *
 *   - a placeholder naming a variable outside ALLOWED_SQL_ENV
 *   - a variable that is unset or empty (an empty expansion would set a BLANK
 *     PASSWORD and report success, which is worse than any failure)
 *   - a value carrying a quote, a backslash or anything else exotic, which is
 *     the only way it could break out of the literal
 *
 * We generate this password ourselves, so a narrow charset costs nothing and
 * removes the whole class of problem.
 */
function expand(sql, file) {
  return sql.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => {
    if (!ALLOWED_SQL_ENV.includes(name)) {
      fail(
        `${file} interpolates \${${name}}, which is not in ALLOWED_SQL_ENV ` +
          `(scripts/manual-sql-order.mjs). Add it there deliberately, or fix the typo.`
      );
    }
    const value = process.env[name];
    if (!value) {
      fail(
        `${file} needs the environment variable ${name} and it is unset.\n` +
          `  On Fly:   fly secrets set ${name}=...\n` +
          `  Locally:  it belongs in .env alongside DATABASE_URL.`
      );
    }
    if (!SAFE_VALUE.test(value)) {
      fail(
        `${name} is not in the accepted character set. It goes into a SQL ` +
          `string literal, so it must be 8-200 characters of A-Z a-z 0-9 . _ ~ + - ` +
          `and nothing else. Generate one with:  openssl rand -base64 32 | tr -d '/=+'`
      );
    }
    return value;
  });
}

/**
 * Refuse a deploy that would lock the application out of its own database.
 *
 * `enforce_rls.sql` sets mise_app's password from MISE_APP_DB_PASSWORD on every
 * run. DATABASE_URL carries the password the app then connects with. They are
 * two separate secrets that must agree, and when they disagree nothing complains
 * until the first page load, by which time the new version is already live.
 *
 * Failing here instead means the deploy is cancelled and the old version keeps
 * serving — which is the entire reason the release command exists (ADR 0033 Q9).
 */
function assertPasswordsAgree() {
  const raw = process.env.DATABASE_URL;
  const expected = process.env.MISE_APP_DB_PASSWORD;
  if (!raw || !expected) return;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return; // not our business to validate the URL's shape
  }
  if (url.username !== "mise_app") return; // dev may point elsewhere

  if (decodeURIComponent(url.password) !== expected) {
    fail(
      `DATABASE_URL's password for mise_app does not match MISE_APP_DB_PASSWORD.\n` +
        `  enforce_rls.sql would set the role's password to one value and the app ` +
        `would connect with another, so every page would fail to reach the database.\n` +
        `  Set both secrets to the same value and deploy again.`
    );
  }
}

function main() {
  if (!fs.existsSync(PRISMA_CLI)) {
    fail(
      `The Prisma CLI is not at ${PRISMA_CLI}.\n` +
        `  In the production image it is copied in by the Dockerfile; if this is ` +
        `the image, that COPY is missing.`
    );
  }

  const dir = path.join(ROOT, MANUAL_SQL_DIR);
  const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const listed = new Set(MANUAL_SQL_ORDER);
  const unlisted = onDisk.filter((f) => !listed.has(f));

  // The test in tests/manual-sql-coverage.test.ts is the primary guard and
  // catches this at commit time. This is the second one, because the image
  // does not run tests and a file added on a branch that skipped them would
  // otherwise be applied nowhere.
  if (unlisted.length > 0) {
    fail(
      `These files are in ${MANUAL_SQL_DIR}/ but not in MANUAL_SQL_ORDER, so they ` +
        `would never be applied: ${unlisted.join(", ")}.\n` +
        `  Add them to scripts/manual-sql-order.mjs, in the right group.`
    );
  }

  assertPasswordsAgree();

  // `db execute --schema` reads the URL out of the schema's datasource, which
  // is DATABASE_URL — the mise_app role, which by design owns nothing and can
  // create nothing. Every statement in these files is DDL or a GRANT, so they
  // must run as the owner. Overriding the variable for the child process keeps
  // the credential out of the command line, where `--url` would put it and any
  // process listing could read it.
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    fail(
      `DIRECT_URL is unset. These files create roles, grants and policies, so ` +
        `they run as the database owner through the unpooled endpoint — never ` +
        `as the application role in DATABASE_URL.`
    );
  }
  const childEnv = { ...process.env, DATABASE_URL: directUrl };

  console.log(`[manual-sql] applying ${MANUAL_SQL_ORDER.length} files from ${MANUAL_SQL_DIR}/`);

  for (const file of MANUAL_SQL_ORDER) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) {
      fail(
        `MANUAL_SQL_ORDER lists ${file}, which does not exist. A file was renamed ` +
          `or deleted without updating scripts/manual-sql-order.mjs.`
      );
    }

    const sql = expand(fs.readFileSync(full, "utf8"), file);

    // --stdin rather than --file: the expanded text holds the mise_app password
    // and must not touch disk, not even as a temporary file.
    //
    // Prisma sends the whole script as ONE command, so Postgres runs it in an
    // implicit transaction: each file lands entirely or not at all. That is
    // what makes the DROP POLICY / CREATE POLICY pairs in enable_rls.sql safe
    // to run against a live database — no session ever observes the gap.
    const result = spawnSync(
      process.execPath,
      [PRISMA_CLI, "db", "execute", "--stdin", "--schema", path.join(ROOT, "prisma", "schema.prisma")],
      { input: sql, env: childEnv, cwd: ROOT, stdio: ["pipe", "inherit", "inherit"] }
    );

    if (result.status !== 0) {
      fail(
        `${file} failed (exit ${result.status}). Nothing in that file was applied, ` +
          `and the files after it were not attempted.`
      );
    }
    console.log(`[manual-sql]   ok  ${file}`);
  }

  console.log(`[manual-sql] all ${MANUAL_SQL_ORDER.length} files applied.`);
}

main();

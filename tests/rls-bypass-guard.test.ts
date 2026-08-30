// ============================================================
// Mise — the bypass door stays where it was put (Part 30 L1, ADR 0030 Q2)
// ============================================================
// `db-admin.ts` connects as the table owner, which carries BYPASSRLS. Row
// security is not applied to it at all — a query through it reads and writes
// every shop's data at once. That is not a bug; it is what discovering a
// person's memberships requires, and what test fixtures require.
//
// It is also, from this Part onward, THE ONLY WAY TO LEAK ONE SHOP'S DATA INTO
// ANOTHER'S SCREEN. Sprint 6 spent two Parts keeping people inside a shop
// apart; this one line of import is how all of that would be undone, and it
// would be undone by somebody being helpful.
//
// TypeScript cannot forbid an import across folders, so this does.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Files permitted to reach for the bypassing connection, and why.
 *
 * ONE entry. Keeping it at one was the reason `db-admin.ts` is a module rather
 * than a function in `db.ts` — a general-purpose door collects callers, and an
 * allowlist that grows is an allowlist that has stopped meaning anything.
 *
 * Before adding a second, answer this: why can the query not name its tenant?
 * Almost always it can, and the honest fix is `withTenantContext`.
 */
const ALLOWED: Record<string, string> = {
  "src/lib/require-tenant.ts":
    "membership discovery is keyed on userId because it is the query that FINDS the tenant; a policy keyed on the current tenant has nothing to match before that answer exists",
};

const ROOTS = ["src/app", "src/server", "src/lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function sourceFiles(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const root of ROOTS) {
    for (const full of walk(join(process.cwd(), ...root.split("/")))) {
      out.push({
        file: relative(process.cwd(), full).split(sep).join("/"),
        text: readFileSync(full, "utf8"),
      });
    }
  }
  return out;
}

describe("the RLS bypass stays out of request paths (ADR 0030 Q2)", () => {
  const files = sourceFiles();

  it("X1 — the scan sees the application at all", () => {
    // An empty list would make every assertion below vacuously true, which is
    // the failure that makes a suite feel green while proving nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.file === "src/lib/db-admin.ts")).toBe(true);
  });

  it("X2 — nothing imports db-admin except the one allowlisted file", () => {
    const offenders = files
      .filter((f) => f.file !== "src/lib/db-admin.ts")
      .filter((f) => /from ["'](?:@\/lib\/db-admin|\.\/db-admin|\.\.\/lib\/db-admin)["']/.test(f.text))
      .filter((f) => !ALLOWED[f.file])
      .map((f) => f.file);

    expect(
      offenders,
      "These reach the connection that ignores tenant isolation. If the query " +
        "can name its tenant — and it almost always can — use withTenantContext."
    ).toEqual([]);
  });

  it("X3 — every allowlisted file still exists and still uses it", () => {
    // An allowlist entry for a file that no longer imports the bypass is an
    // entry nobody will question later, and the next person adds theirs beside
    // it.
    for (const [file, why] of Object.entries(ALLOWED)) {
      const f = files.find((x) => x.file === file);
      expect(f, `${file} is allowlisted but does not exist`).toBeDefined();
      expect(
        /db-admin/.test(f!.text),
        `${file} no longer uses the bypass — remove it from ALLOWED`
      ).toBe(true);
      expect(why.length, `${file} needs a real reason`).toBeGreaterThan(40);
    }
    expect(
      Object.keys(ALLOWED).length,
      "the allowlist is growing — see the note above it"
    ).toBeLessThanOrEqual(2);
  });

  it("X4 — db.ts no longer offers a bypass of its own", () => {
    // The old `withAdminContext` lived in the module every page imports. Its
    // absence is the point of the split, and an absence nobody wrote down is
    // one somebody helpfully restores.
    const db = files.find((f) => f.file === "src/lib/db.ts");
    expect(db).toBeDefined();
    expect(/export\s+(async\s+)?function\s+withAdminContext/.test(db!.text)).toBe(false);
    expect(/export\s+const\s+prismaBypass/.test(db!.text)).toBe(false);
  });

  it("X5 — the tenant context is set with a bind parameter, never a template", () => {
    // The one line that decides tenant isolation. `$executeRawUnsafe` with an
    // interpolated id is how that line looked for twenty-nine Parts, while it
    // was inert and nobody had to care.
    const db = files.find((f) => f.file === "src/lib/db.ts")!;
    expect(db.text).toContain("set_config('app.current_tenant_id'");
    expect(
      /SET LOCAL app\.current_tenant_id = '\$\{/.test(db.text),
      "the tenant id is being interpolated into SQL"
    ).toBe(false);
  });
});

// ============================================================
// Mise — a page that prints money must say whose money it is (ADR 0038 Q2)
// ============================================================
// Once a shop can take `cost:view` away from a role, every screen that prints
// a price behind some OTHER capability is a leak waiting for the first shop to
// try. The audit (ADR 0038 Amendment) found one already live: the count sheet
// printed มูลค่าส่วนต่าง ฿ to cooks.
//
// So: every page under (app) whose files print money must EITHER be gated by a
// capability that is itself a money view, OR by one whose pair is a money view
// (`CAPABILITY_NEEDS`), OR consult the cost ticket / a money capability itself
// — OR be listed below with the reason it is not cost. A new page that prints
// ฿ and does none of these turns this test red.
//
// It reads source text, so it is a tripwire, not a proof: it catches the
// common shape (a ฿ or a money formatter in the page's own folder) and says
// where to look.
// ============================================================

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { CAPABILITY_NEEDS } from "@/lib/permissions/service";

const APP = join(process.cwd(), "src/app/(app)");
const MONEY_VIEWS = new Set(["cost:view", "sales:view", "expense:view"]);
const MONEY = /฿|formatMoney\(|formatBaht\(|\bbaht\(/;
const CONSULTS = /costAccess|can\("(cost|sales|expense):view"\)|seeMoney|canSeeCost/;

/** Pages that print ฿ which is not the shop's cost, and why. */
const NOT_COST: Record<string, string> = {
  "staff-meals": "selling prices and the shop's quota — what a dish sells for, not what it costs",
  "staff-meals/people": "the per-person quota the shop sets",
  "sales/import": "the file's total for the day the cashier just keyed (ADR 0038 Amendment, Kong 2026-10-26)",
  settings: "explanatory copy (the VAT threshold, a ฿0 sale)",
  suppliers: "explanatory copy on the supplier form (a shelf price example)",
  "recipes/substitute": "imports recipe-view.ts for the substitution plan, which carries no cost — the ฿ belongs to that file's other views",
  "my-advances": "the person's OWN claims — what they paid at the stall and typed in themselves, and what the shop owes them back (ADR 0037 Q6)",
};

function filesUnder(dir: string, depth: number): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // A sub-route has its own page.tsx and is checked on its own.
      if (depth === 0 || readdirSync(p).includes("page.tsx")) return [];
      return filesUnder(p, depth - 1);
    }
    return /\.(ts|tsx)$/.test(name) && name !== "page.tsx" ? [p] : [];
  });
}

/**
 * Files a page imports by relative path (`../_components/CountSheet`). The
 * count-sheet leak lived in exactly such a file, one folder up from its page.
 */
function relativeImports(file: string, src: string): string[] {
  return [...src.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)]
    .map((m) => resolve(dirname(file), m[1]))
    .flatMap((base) => [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx")].filter((f) => existsSync(f)).slice(0, 1));
}

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) return name === "page.tsx" ? [dir] : [];
    return pages(p);
  });
}

describe("pages that print money (ADR 0038 Q2)", () => {
  const rows = pages(APP).map((dir) => {
    const page = readFileSync(join(dir, "page.tsx"), "utf8");
    const files = new Set([...filesUnder(dir, 2), ...relativeImports(join(dir, "page.tsx"), page)]);
    const own = [page, ...[...files].map((f) => readFileSync(f, "utf8"))].join("\n");
    const gate = /requireTenant\("([^"]+)"/.exec(page)?.[1] ?? null;
    // A page that only forwards to another address renders nothing itself;
    // its folder's components belong to the sub-routes that use them.
    const forwards = gate === null && /\bredirect\(/.test(page);
    return {
      route: relative(APP, dir) || "(root)",
      gate,
      money: !forwards && MONEY.test(own),
      consults: CONSULTS.test(own),
    };
  });

  it("finds the pages at all (the scan is not silently empty)", () => {
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => r.money).length).toBeGreaterThan(10);
  });

  it("every page that prints money is gated by a money view, a paired capability, or checks one itself", () => {
    const unexplained = rows
      .filter((r) => r.money && !r.consults && !(r.route in NOT_COST))
      .filter((r) => !(r.gate && (MONEY_VIEWS.has(r.gate) || r.gate in CAPABILITY_NEEDS)))
      .map((r) => `${r.route} (gate: ${r.gate ?? "none"})`);
    expect(unexplained).toEqual([]);
  });

  it("every NOT_COST entry is still a page that prints money (no stale exemptions)", () => {
    const byRoute = new Map(rows.map((r) => [r.route, r]));
    for (const route of Object.keys(NOT_COST)) expect(byRoute.get(route)?.money, route).toBe(true);
  });
});

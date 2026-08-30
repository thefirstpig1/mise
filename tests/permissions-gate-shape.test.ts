// ============================================================
// Mise — the shape of the gate itself (Sprint 6 Part 28 L3, ADR 0029 Q6)
// ============================================================
// These read the source rather than run it, because what they protect is not a
// value — it is a CONVENTION that the type system cannot express.
//
// The required argument on `requireTenant` makes forgetting the gate a compile
// error. It does not make the gate WORK: refusal is a `redirect()`, which Next
// implements by throwing, so a call placed inside a try/catch that turns errors
// into form state would be swallowed and rendered as a puzzling Thai message
// while the person stayed on a page they may not use. Every one of the 145 call
// sites happens to sit outside its try today, because the glue layer has always
// been written `requireTenant → zod → *Logic → try`. This file is what stops
// that from being luck.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ALL_CAPABILITIES } from "@/lib/permissions/service";

const APP = join(process.cwd(), "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

interface Site {
  file: string;
  line: number;
  text: string;
  tryDepth: number;
}

/** Every `requireTenant(` in src/app, with the try depth it sits at. */
function callSites(): Site[] {
  const sites: Site[] = [];

  for (const full of walk(APP)) {
    const src = readFileSync(full, "utf8").replace(/\r\n/g, "\n").split("\n");
    const file = relative(process.cwd(), full).split(sep).join("/");

    let depth = 0;
    let inFunction = false;

    for (let i = 0; i < src.length; i++) {
      const code = src[i].replace(/\/\/.*$/, "");

      // A new top-level function resets the count: a `try` in the function
      // above is closed by then, and unbalanced braces in strings would
      // otherwise drift across the whole file.
      if (/^\s*(export\s+)?(default\s+)?async function /.test(code)) {
        depth = 0;
        inFunction = true;
      }

      if (inFunction) {
        depth += (code.match(/\btry\s*\{/g) ?? []).length;
        depth -= (code.match(/\}\s*catch\b/g) ?? []).length;
      }

      if (code.includes("requireTenant(")) {
        sites.push({ file, line: i + 1, text: code.trim(), tryDepth: depth });
      }
    }
  }
  return sites;
}

describe("the gate's shape (ADR 0029 Part 28 L3)", () => {
  const sites = callSites();

  it("G1 — there are call sites to check at all", () => {
    // Guards against the walker silently finding nothing and every assertion
    // below passing over an empty list — the failure that makes a suite feel
    // green while proving nothing.
    expect(sites.length).toBeGreaterThan(100);
  });

  it("G2 — no refusal can be swallowed: every call sits outside try/catch", () => {
    // `redirect()` throws. A call inside a try whose catch builds form state
    // turns "you may not do this" into a confusing error message, on a page the
    // person is still sitting on.
    const swallowed = sites
      .filter((s) => s.tryDepth > 0)
      .map((s) => `${s.file}:${s.line}`);
    expect(swallowed).toEqual([]);
  });

  it("G3 — every call names its capability as a literal", () => {
    // A variable would compile and would be invisible to `grep`. "Who may do
    // this?" must stay answerable by reading one line.
    const allowed = new Set<string>([...ALL_CAPABILITIES, "any:member"]);

    const bad: string[] = [];
    for (const s of sites) {
      const m = s.text.match(/requireTenant\(\s*("([^"]*)"|'([^']*)')/);
      if (!m) {
        bad.push(`${s.file}:${s.line} — not a string literal: ${s.text}`);
        continue;
      }
      const cap = m[2] ?? m[3];
      if (!allowed.has(cap)) {
        bad.push(`${s.file}:${s.line} — unknown capability ${cap}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("G5 — /choose-shop is the one page that must NOT call requireTenant", () => {
    // It is where requireTenant SENDS people when it cannot tell which shop
    // they mean, so calling it there is an infinite bounce. The absence is a
    // decision, and an absence nobody wrote down is an absence somebody
    // helpfully "fixes" (ADR 0029 Q3).
    const chooser = sites.filter((s) => s.file.includes("app/choose-shop/"));
    expect(chooser).toEqual([]);

    // ...and the file has to actually exist, or this passes by looking at
    // nothing at all.
    const page = join(process.cwd(), "src", "app", "choose-shop", "page.tsx");
    expect(readFileSync(page, "utf8")).toContain("auth()");
  });

  it("G4 — any:member is used sparingly and deliberately", () => {
    // The sentinel is honest for a dashboard and a stock level. If it starts
    // spreading it has stopped meaning "considered and open" and started
    // meaning "could not be bothered", and the 145 decisions were wasted.
    const open = sites.filter((s) => s.text.includes('"any:member"'));
    expect(open.length).toBeLessThan(sites.length / 4);
  });
});

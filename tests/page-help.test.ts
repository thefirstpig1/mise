// ============================================================
// คิดครัว — every data page carries its "?" (Kong 2026-11-05, review item 5)
// ============================================================
// The words live in src/lib/page-help.ts; the button is placed page by page
// (PageHeader's `help`, or <PageHelp page=…> beside a hand-written title). An
// entry nobody placed is a page that silently lost its "?".
// ============================================================

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PAGE_HELP } from "@/lib/page-help";
import { FIGURES } from "@/lib/data-needs";

const sources = execSync("git ls-files src", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("page help", () => {
  it("PH1 — every entry is placed on a page", () => {
    const missing = Object.keys(PAGE_HELP).filter((k) => !sources.includes(`page="${k}"`) && !sources.includes(`help="${k}"`));
    expect(missing).toEqual([]);
  });

  it("PH2 — every entry has all five parts", () => {
    for (const [k, h] of Object.entries(PAGE_HELP)) {
      expect(h.question.length, k).toBeGreaterThan(10);
      expect(h.pictureText.length, k).toBeGreaterThan(5);
      expect(h.uses.length, k).toBeGreaterThan(0);
      expect(h.outputs.length, k).toBeGreaterThan(0);
      expect(h.why.length, k).toBeGreaterThan(10);
      for (const f of h.pictures) expect(FIGURES[f], `${k}: ${f}`).toBeDefined();
    }
  });
});

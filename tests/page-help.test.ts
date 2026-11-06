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

  it("PH2 — every entry has all its parts", () => {
    for (const [k, h] of Object.entries(PAGE_HELP)) {
      expect(h.question.length, k).toBeGreaterThan(10);
      expect(h.uses.length, k).toBeGreaterThan(0);
      expect(h.why.length, k).toBeGreaterThan(10);
      for (const f of h.pictures) expect(FIGURES[f], `${k}: ${f}`).toBeDefined();
      if (h.sections) {
        // Round 2: the page's parts, a map that places every one, formulas, where the numbers go.
        expect(h.sections.length, k).toBeGreaterThan(1);
        expect(h.formulas?.length, k).toBeGreaterThan(0);
        expect(h.feeds?.length, k).toBeGreaterThan(0);
        expect(h.example?.rows.length, k).toBeGreaterThan(0);
        expect([...(h.layout ?? [])].flat().sort(), k).toEqual(h.sections.map((x) => x.id).sort());
      } else {
        expect(h.pictureText.length, k).toBeGreaterThan(5);
        expect(h.outputs.length, k).toBeGreaterThan(0);
      }
    }
  });

  // A part the guide points at must be marked on the page, or "ดูบนหน้า" finds nothing.
  it("PH3 — every round-2 part is marked data-help on some page", () => {
    // `help="id"` covers both an element's data-help and a component's help prop;
    // a part drawn in a loop names its id inside `data-help={…}` on that line.
    const computed = sources.split("\n").filter((l) => l.includes("data-help={"));
    const missing = Object.values(PAGE_HELP)
      .flatMap((h) => h.sections ?? [])
      .filter((x) => !sources.includes(`help="${x.id}"`) && !computed.some((l) => l.includes(`"${x.id}"`)))
      .map((x) => x.id);
    expect(missing).toEqual([]);
  });

  // Round 2.1: a number box says where its number sits; "ดูบนหน้า" rings that part.
  it("PH4 — every number box points at a part of its own page", () => {
    const wrong = Object.entries(PAGE_HELP).flatMap(([k, h]) =>
      (h.formulas ?? []).filter((f) => f.part && !(h.sections ?? []).some((x) => x.id === f.part)).map((f) => `${k}: ${f.name} → ${f.part}`)
    );
    expect(wrong).toEqual([]);
  });
});

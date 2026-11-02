// ============================================================
// คิดครัว — every page with an id in its URL reads it through uuidParams
// ============================================================
// Kong 2026-11-03: `/purchase-orders/zzz` showed the error page instead of
// "ไม่พบ" — 16 of 17 `[id]` pages handed a malformed id straight to Prisma.
// This fails for a new dynamic page that reads `params` some other way.
// ============================================================

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isUuid } from "@/lib/route-params";

function dynamicPages(dir: string, inDynamic = false): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return dynamicPages(full, inDynamic || /^\[[^.]/.test(name));
    return inDynamic && name === "page.tsx" ? [full] : [];
  });
}

describe("route params (Kong 2026-11-03)", () => {
  const pages = dynamicPages(join(process.cwd(), "src/app"));

  it("finds the dynamic pages at all", () => {
    expect(pages.length).toBeGreaterThanOrEqual(17);
  });

  it("every `[id]` page reads its params through uuidParams", () => {
    const missing = pages.filter((p) => {
      const s = readFileSync(p, "utf8");
      return !s.includes("await uuidParams(params)") || /await params\b/.test(s);
    });
    expect(missing).toEqual([]);
  });

  it("a uuid is a uuid; anything Postgres would refuse is not", () => {
    expect(isUuid("6efe6013-a7e6-4743-aa78-6336e131fc2b")).toBe(true);
    expect(isUuid("6EFE6013-A7E6-4743-AA78-6336E131FC2B")).toBe(true);
    for (const bad of ["zzz", "", "------------------------------------", "6efe6013-a7e6-4743-aa78-6336e131fc2", "6efe6013a7e64743aa786336e131fc2b-xxx", "6efe6013-a7e6-4743-aa78-6336e131fc2b/edit"]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

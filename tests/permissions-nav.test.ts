// ============================================================
// Mise — the menu must not offer a door that refuses (Part 28 L5, ADR 0029 Q13)
// ============================================================
// The sidebar IS the navigation (Part 35 L4 moved it there from the
// dashboard's grid of links): `src/components/layout/nav.ts` lists every door
// in the product, and the `(app)` layout filters it by capability. Filtering
// is what stops a cook seeing a menu of which fourteen entries bounce.
//
// But a filtered menu introduces its own failure, and it is a nasty one: if the
// capability beside a link ever stops matching the one its PAGE declares, the
// menu offers a door that refuses. The person cannot tell that from a bug —
// which is the whole reason /denied exists instead of a 404 — and worse, the
// opposite drift HIDES a page someone is allowed to use, silently, forever.
//
// So the two lists are held together here, by reading both.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_CAPABILITIES, ALL_ROLES, hasCapability } from "@/lib/permissions/service";
import { NAV_ITEMS } from "@/components/layout/nav";

interface NavRow {
  href: string;
  need: string;
}

/** The sidebar's table, as the app renders it. */
function navTable(): NavRow[] {
  return NAV_ITEMS.map((i) => ({ href: i.href, need: i.need }));
}

/** What the page behind an href actually asks requireTenant for. */
function pageRequirement(href: string): string | null {
  // "/menus/lab" -> src/app/(app)/menus/lab/page.tsx (or outside the group)
  const parts = href.split("/").filter(Boolean);
  for (const root of [["src", "app", "(app)"], ["src", "app"]]) {
    try {
      const src = readFileSync(join(process.cwd(), ...root, ...parts, "page.tsx"), "utf8");
      const m = src.match(/requireTenant\(\s*"([^"]+)"/);
      return m ? m[1] : null;
    } catch {
      // try the next root
    }
  }
  return null;
}

describe("the sidebar menu (ADR 0029 Part 28 L5, moved in Part 35 L4)", () => {
  const nav = navTable();

  it("N0 — every page the table names exists (a renamed route must not leave a dead link)", () => {
    expect(nav.filter((n) => pageRequirement(n.href) === null).map((n) => n.href)).toEqual([]);
  });

  it("N1 — every link in the product is in the table", () => {
    // 19 doors when this was written. The number is asserted rather than the
    // list, so adding a page is free but DELETING the filter is not.
    expect(nav.length).toBeGreaterThanOrEqual(19);
  });

  it("N2 — every link names a capability that exists", () => {
    const known = new Set<string>([...ALL_CAPABILITIES, "any:member"]);
    const unknown = nav.filter((n) => !known.has(n.need));
    expect(unknown).toEqual([]);
  });

  it("N3 — a link never offers a door that would refuse", () => {
    // The drift that matters. If the menu asks for less than the page does,
    // somebody is sent to /denied by their own dashboard.
    const mismatched: string[] = [];

    for (const item of nav) {
      const actual = pageRequirement(item.href);
      if (actual === null) continue; // dynamic segment or a page not read here
      if (actual !== item.need) {
        mismatched.push(`${item.href}: menu says ${item.need}, page requires ${actual}`);
      }
    }

    expect(mismatched).toEqual([]);
  });

  it("N4 — a viewer is offered only doors a viewer can open", () => {
    // The end-to-end statement, role by role: what the menu shows is exactly
    // what the person can reach.
    for (const role of ALL_ROLES) {
      const offered = nav.filter((n) => hasCapability(role, n.need as never));
      for (const item of offered) {
        expect(
          hasCapability(role, item.need as never),
          `${role} is offered ${item.href} but cannot open it`
        ).toBe(true);
      }
    }

    const viewerDoors = nav.filter((n) => hasCapability("viewer", n.need as never));
    // A viewer writes nothing, so every door they are offered is an open read.
    expect(viewerDoors.every((d) => d.need === "any:member")).toBe(true);
    // ...and they are not left with an empty screen either.
    expect(viewerDoors.length).toBeGreaterThan(3);
  });

  it("N5 — a cook is offered a short menu, not the whole product", () => {
    const cook = nav.filter((n) => hasCapability("kitchen_staff", n.need as never));
    const owner = nav.filter((n) => hasCapability("owner", n.need as never));

    expect(owner.length).toBe(nav.length);
    expect(cook.length).toBeLessThan(owner.length);
    // The three the kitchen actually uses are there.
    const hrefs = cook.map((c) => c.href);
    expect(hrefs).toContain("/stock");
    expect(hrefs).toContain("/staff-meals");
    expect(hrefs).toContain("/recipes");
    // And the money is not.
    expect(hrefs).not.toContain("/cost");
    expect(hrefs).not.toContain("/expenses");
    expect(hrefs).not.toContain("/sales");
  });
});

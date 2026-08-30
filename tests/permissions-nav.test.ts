// ============================================================
// Mise — the menu must not offer a door that refuses (Part 28 L5, ADR 0029 Q13)
// ============================================================
// The dashboard IS the navigation: `src/app/layout.tsx` renders bare children
// and `src/components/layout/` is empty, so nineteen links in one file are
// every door in the product. Filtering them by capability is what stops a cook
// seeing a menu of which fourteen entries bounce.
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

const DASHBOARD = join(process.cwd(), "src", "app", "dashboard", "page.tsx");

interface NavItem {
  href: string;
  need: string;
}

/** The NAV table as written, read out of the source. */
function navTable(): NavItem[] {
  const src = readFileSync(DASHBOARD, "utf8");
  const start = src.indexOf("const NAV:");
  expect(start, "NAV table not found on the dashboard").toBeGreaterThan(-1);
  const end = src.indexOf("];", start);
  const block = src.slice(start, end);

  const items: NavItem[] = [];
  const re = /\{\s*href:\s*"([^"]+)",\s*label:\s*"[^"]*",\s*need:\s*"([^"]+)"\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    items.push({ href: m[1], need: m[2] });
  }
  return items;
}

/** What the page behind an href actually asks requireTenant for. */
function pageRequirement(href: string): string | null {
  // "/menus/lab" -> src/app/menus/lab/page.tsx
  const file = join(process.cwd(), "src", "app", ...href.split("/").filter(Boolean), "page.tsx");
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const m = src.match(/requireTenant\(\s*"([^"]+)"/);
  return m ? m[1] : null;
}

describe("the dashboard menu (ADR 0029 Part 28 L5)", () => {
  const nav = navTable();

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

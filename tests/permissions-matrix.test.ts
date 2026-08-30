// ============================================================
// Mise — the role table itself (Sprint 6 Part 28 L2, ADR 0029 Q15)
// ============================================================
// The compiler already catches the failure mode that matters most: a page or an
// action that names no capability does not compile (Q6). So these tests are not
// here to check that the gate is *present*. They check the two things the
// compiler cannot see — that the SETS say what we meant, and that rule 4 holds.
//
// Rule 4 (Q10) is the load-bearing one. It says a person may only grant a role
// whose capabilities are a subset of their own, and it is what closes the real
// escalation path: invite your own second email address as `owner`, then sign
// in as it. Part 29 enforces it at the invite screen; this file pins that the
// table it will read is actually arranged so the roles people need to create
// CAN be created — otherwise rule 4 ships as a rule that blocks the job.
//
// No database. These are facts about a constant.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  ALL_CAPABILITIES,
  ALL_ROLES,
  ROLE_CAPABILITIES,
  capabilitiesOf,
  canAccessBranch,
  hasCapability,
  narrowBranches,
  type Capability,
  type Role,
} from "@/lib/permissions/service";

const isSubset = (a: ReadonlySet<Capability>, b: ReadonlySet<Capability>) =>
  [...a].every((c) => b.has(c));

const missingFrom = (a: ReadonlySet<Capability>, b: ReadonlySet<Capability>) =>
  [...a].filter((c) => !b.has(c));

describe("the role table (ADR 0029 Part 28 L2)", () => {
  it("A1 — every role in the union has a row, and every row is a known role", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_CAPABILITIES[role], role).toBeInstanceOf(Set);
    }
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...ALL_ROLES].sort());
  });

  it("A2 — every capability is held by at least one role", () => {
    // A capability nothing grants is a surface nobody can ever reach: the gate
    // is closed for all seven roles and the screen is dead. This is the check
    // that would have caught `purchase_request` in the Sprint 0 matrix.
    const held = new Set<Capability>();
    for (const role of ALL_ROLES) {
      for (const cap of ROLE_CAPABILITIES[role]) held.add(cap);
    }
    const orphaned = ALL_CAPABILITIES.filter((c) => !held.has(c));
    expect(orphaned).toEqual([]);
  });

  it("A3 — owner is a superset of every other role", () => {
    const owner = capabilitiesOf("owner");
    for (const role of ALL_ROLES) {
      expect(
        missingFrom(capabilitiesOf(role), owner),
        `${role} holds something owner does not`
      ).toEqual([]);
    }
  });

  it("A4 — viewer writes nothing at all", () => {
    const viewer = capabilitiesOf("viewer");
    const writes = [...viewer].filter((c) => c.endsWith(":write"));
    expect(writes).toEqual([]);
    expect([...viewer]).toEqual([]);
  });

  it("A5 — kitchen_staff may record a staff meal and may not see cost", () => {
    // ADR 0021 Q18's unfixable case, fixed. The cook needs the dish; the price
    // of the dish is not their business. One axis could not say this.
    expect(hasCapability("kitchen_staff", "staffmeal:write")).toBe(true);
    expect(hasCapability("kitchen_staff", "count:write")).toBe(true);
    expect(hasCapability("kitchen_staff", "cost:view")).toBe(false);
    expect(hasCapability("kitchen_staff", "expense:view")).toBe(false);
    expect(hasCapability("kitchen_staff", "sales:view")).toBe(false);
  });

  it("A6 — a purchaser sees cost but not the shop's overheads or revenue", () => {
    expect(hasCapability("purchaser", "cost:view")).toBe(true);
    expect(hasCapability("purchaser", "expense:view")).toBe(false);
    expect(hasCapability("purchaser", "sales:view")).toBe(false);
  });

  it("A7 — an accountant writes no stock and posts no consumption", () => {
    expect(hasCapability("accountant", "expense:write")).toBe(true);
    expect(hasCapability("accountant", "sales:import")).toBe(true);
    expect(hasCapability("accountant", "stock:write")).toBe(false);
    expect(hasCapability("accountant", "count:write")).toBe(false);
    expect(hasCapability("accountant", "consumption:post")).toBe(false);
  });

  it("A8 — settings belong to the account, not to a branch manager", () => {
    // enable_departments, VAT registration and gross_profit_method change what
    // every past figure MEANS. Only owner and admin.
    for (const role of ALL_ROLES) {
      expect(hasCapability(role, "settings:write"), role).toBe(
        role === "owner" || role === "admin"
      );
    }
  });

  // ── rule 4: the grant table ───────────────────────────────────────────────

  it("A9 — rule 4 lets every member-manager create the roles it must", () => {
    // Not decoration. If `manager` were missing one capability an `accountant`
    // holds, rule 4 would refuse a manager who tries to add the shop's
    // bookkeeper, and the rule would read as a bug rather than a defence.
    const mustBeAbleToCreate: Record<string, readonly Role[]> = {
      owner: ["admin", "manager", "purchaser", "kitchen_staff", "accountant", "viewer"],
      admin: ["manager", "purchaser", "kitchen_staff", "accountant", "viewer"],
      manager: ["purchaser", "kitchen_staff", "accountant", "viewer"],
    };

    for (const [granter, targets] of Object.entries(mustBeAbleToCreate)) {
      expect(
        hasCapability(granter, "member:manage"),
        `${granter} is listed as a granter but does not hold member:manage`
      ).toBe(true);

      for (const target of targets) {
        expect(
          missingFrom(capabilitiesOf(target), capabilitiesOf(granter)),
          `rule 4 would refuse ${granter} → ${target}`
        ).toEqual([]);
      }
    }
  });

  it("A10 — rule 4 refuses the escalation it exists for", () => {
    // The real path is not "promote myself". It is: invite my own second email
    // address as `owner`, then sign in as it. Rule 4 closes it without any
    // ordering between roles — `owner` simply holds something `manager` does
    // not, so the subset test fails.
    expect(isSubset(capabilitiesOf("owner"), capabilitiesOf("manager"))).toBe(false);
    expect(isSubset(capabilitiesOf("owner"), capabilitiesOf("admin"))).toBe(true);

    // ...which is why "only an owner may grant owner" is NOT written as a rule
    // of its own for admin: admin holds every capability, so rule 4 alone would
    // let an admin grant `owner`. That case is closed by rule 1 (an `owner` row
    // may only be touched by an owner), which Part 29 enforces at the screen.
    // Pinned here so the gap is remembered rather than rediscovered.
    expect(hasCapability("admin", "member:manage")).toBe(true);
  });

  it("A11 — nobody may grant what they do not hold, in either direction", () => {
    // A purchaser holds no member:manage at all, so the question never arises;
    // but if a future Part gives it to one, rule 4 must already stop them
    // reaching a role that sees revenue.
    expect(
      missingFrom(capabilitiesOf("accountant"), capabilitiesOf("purchaser"))
    ).not.toEqual([]);
    expect(
      missingFrom(capabilitiesOf("purchaser"), capabilitiesOf("kitchen_staff"))
    ).not.toEqual([]);
  });

  // ── where, not what ───────────────────────────────────────────────────────

  it("A12 — branch reach names no role, not even owner", () => {
    // The Sprint 0 version opened with `if (role === "owner") return true`.
    // An owner with allBranches:false must now be as narrow as anybody else,
    // because the flag is the only thing that answers "where".
    const asok = "b-asok";
    const silom = "b-silom";

    // The cast is the point of this assertion, not a shortcut around a type.
    // `BranchReach` has no `role`, so an honest object literal cannot carry one
    // — and a version of this test WITHOUT the extra property stays green even
    // when the bypass is put back, because `user.role` is simply undefined.
    // (Checked by restoring the bypass and watching this file stay green.) The
    // property is smuggled in at runtime so that any early return keyed on a
    // role fails here, which is the only thing that makes the claim in this
    // test's name true.
    const narrowOwner = {
      allBranches: false,
      allowedBranchIds: [asok],
      role: "owner",
    } as unknown as Parameters<typeof canAccessBranch>[0];
    expect(canAccessBranch(narrowOwner, asok)).toBe(true);
    expect(canAccessBranch(narrowOwner, silom)).toBe(false);

    const areaManager = { allBranches: true, allowedBranchIds: [] };
    expect(canAccessBranch(areaManager, silom)).toBe(true);
    expect(canAccessBranch(areaManager, "a-branch-that-opens-tomorrow")).toBe(true);
  });

  it("A13 — the branch list you see is the branch list you may act on", () => {
    const branches = [{ id: "b-asok" }, { id: "b-silom" }, { id: "b-thonglor" }];

    expect(
      narrowBranches({ allBranches: true, allowedBranchIds: [] }, branches)
    ).toHaveLength(3);

    const seen = narrowBranches(
      { allBranches: false, allowedBranchIds: ["b-silom"] },
      branches
    );
    expect(seen.map((b) => b.id)).toEqual(["b-silom"]);

    // The dropdown and the "every branch" loop on /cost narrow together,
    // because they are the same list (rule A5).
    expect(
      narrowBranches({ allBranches: false, allowedBranchIds: [] }, branches)
    ).toEqual([]);
  });

  // ── the sentinel ──────────────────────────────────────────────────────────

  it("A14 — any:member is satisfied by every role and held by none", () => {
    for (const role of ALL_ROLES) {
      expect(hasCapability(role, "any:member"), role).toBe(true);
      expect(
        (ROLE_CAPABILITIES[role] as ReadonlySet<string>).has("any:member"),
        role
      ).toBe(false);
    }
    // An unknown role string still satisfies it: the caller has already proved
    // an active membership, and that was the whole requirement.
    expect(hasCapability("something_a_future_part_added", "any:member")).toBe(true);
    expect(hasCapability("something_a_future_part_added", "stock:write")).toBe(false);
  });
});

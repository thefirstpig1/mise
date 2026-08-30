// ============================================================
// Mise — giving permissions away (Sprint 6 Part 29 L2, ADR 0029 Q10)
// ============================================================
// The hole these rules close is not "promote myself", which any review would
// catch. It is:
//
//     invite my own second email address as `owner`, then sign in as it.
//
// Q2 makes an invitation a single INSERT — no token, no acceptance step —
// which is right, and which makes that attack about thirty seconds long. Rule 4
// is what ends it, and it does so WITHOUT ranking the roles: a role is a set of
// capabilities (Q4), so "above you" is undefined and must stay that way.
//
// These are facts about pure functions. The fourth rule — at least one active
// owner — needs to count rows and is pinned in the write path instead.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  ALL_ROLES,
  canGrantReach,
  canGrantRole,
  canModifyMembershipOf,
  capabilitiesOf,
  hasCapability,
  type Role,
} from "@/lib/permissions/service";

const reach = (allBranches: boolean, ...ids: string[]) => ({
  allBranches,
  allowedBranchIds: ids,
});

describe("the four rules (ADR 0029 Part 29 L2)", () => {
  // ── rule 4: subset containment ────────────────────────────────────────────

  it("R4a — the escalation the rule exists for is refused", () => {
    // A manager holds member:manage. Without rule 4 this is a thirty-second
    // takeover of the account.
    expect(hasCapability("manager", "member:manage")).toBe(true);
    expect(canGrantRole("manager", "owner")).toBe(false);
    expect(canGrantRole("purchaser", "owner")).toBe(false);
    expect(canGrantRole("kitchen_staff", "manager")).toBe(false);
    expect(canGrantRole("viewer", "viewer")).toBe(true); // holds nothing, grants nothing
  });

  it("R4b — the rule does not block the job it was added around", () => {
    // If a manager could not create the roles a manager hires, rule 4 would
    // read as a bug rather than a defence — and somebody would delete it.
    for (const target of ["purchaser", "kitchen_staff", "accountant", "viewer"] as Role[]) {
      expect(canGrantRole("manager", target), `manager -> ${target}`).toBe(true);
    }
    for (const target of ALL_ROLES.filter((r) => r !== "owner")) {
      expect(canGrantRole("admin", target), `admin -> ${target}`).toBe(true);
    }
    for (const target of ALL_ROLES) {
      expect(canGrantRole("owner", target), `owner -> ${target}`).toBe(true);
    }
  });

  it("R4c — containment is a SET test, with no ordering anywhere", () => {
    // purchaser and accountant are not comparable in either direction, and the
    // rule must be fine with that rather than needing a tiebreak.
    expect(canGrantRole("purchaser", "accountant")).toBe(false);
    expect(canGrantRole("accountant", "purchaser")).toBe(false);
    // ...and neither is "above" the other in any sense the code can express.
    const p = capabilitiesOf("purchaser");
    const a = capabilitiesOf("accountant");
    expect([...p].some((c) => !a.has(c))).toBe(true);
    expect([...a].some((c) => !p.has(c))).toBe(true);
  });

  it("R4d — an unknown role grants nothing and can be granted by anyone", () => {
    // A role string from a future Part, or a typo in the database. It holds no
    // capabilities, so containment lets it be created — and it can do nothing,
    // which is the safe direction for both halves.
    expect(canGrantRole("owner", "role_from_the_future")).toBe(true);
    expect(canGrantRole("role_from_the_future", "viewer")).toBe(true);
    expect(canGrantRole("role_from_the_future", "manager")).toBe(false);
  });

  // ── rule 1: an owner row is the owner's business ──────────────────────────

  it("R1 — only an owner may touch an owner, and admin is why it exists", () => {
    // Rule 4 alone would let an admin demote the account's owner: an admin
    // holds every capability, so containment is satisfied. This is the one
    // asymmetry the product really has.
    expect(canGrantRole("admin", "owner")).toBe(true);
    expect(canModifyMembershipOf("admin", "owner")).toBe(false);
    expect(canModifyMembershipOf("manager", "owner")).toBe(false);
    expect(canModifyMembershipOf("owner", "owner")).toBe(true);

    // Everyone else's row is ordinary — rule 4 governs what it may become.
    for (const target of ALL_ROLES.filter((r) => r !== "owner")) {
      expect(canModifyMembershipOf("admin", target), target).toBe(true);
    }
  });

  it("R1b — the two rules together close the admin path completely", () => {
    // Grant `owner` to a new address: rule 4 permits it, rule 1 does not stop
    // it (there is no existing owner row being touched)... which is why the
    // write path must check BOTH, and the acceptance of that is pinned here so
    // the gap is remembered rather than rediscovered in Part 30.
    expect(canGrantRole("admin", "owner")).toBe(true);
    expect(canModifyMembershipOf("admin", "viewer")).toBe(true);
    // The write path's answer: creating an `owner` is treated as touching one.
    // See createMembershipLogic — this test names the requirement it satisfies.
  });

  // ── rule 2: reach you do not have, you cannot give ────────────────────────

  it("R2 — a branch manager cannot staff a branch they do not reach", () => {
    const asok = "b-asok";
    const silom = "b-silom";
    const branchManager = reach(false, asok);

    expect(canGrantReach(branchManager, reach(false, asok))).toBe(true);
    expect(canGrantReach(branchManager, reach(false, silom))).toBe(false);
    expect(canGrantReach(branchManager, reach(false, asok, silom))).toBe(false);

    // And may not hand out "every branch", which would be reach laundering:
    // one branch in, all branches out.
    expect(canGrantReach(branchManager, reach(true))).toBe(false);
  });

  it("R2b — an area manager staffs the region, straight out of Q5b", () => {
    // No new mechanism: the same tick box that made an area manager possible
    // makes them able to hire across it.
    const area = reach(true);
    expect(canGrantReach(area, reach(false, "b-asok", "b-silom"))).toBe(true);
    expect(canGrantReach(area, reach(true))).toBe(true);
  });

  it("R2c — granting nothing is always allowed", () => {
    // An invitation before any branch is ticked. It must not be refused, or
    // the only way to create a person is to grant them something first.
    expect(canGrantReach(reach(false), reach(false))).toBe(true);
    expect(canGrantReach(reach(false, "b-asok"), reach(false))).toBe(true);
  });
});

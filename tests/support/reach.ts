// ============================================================
// Mise — branch reach for fixtures (Sprint 6 Part 28, ADR 0029 Q5)
// ============================================================
// Reads that list branches take a `BranchReach` as a REQUIRED argument, because
// an optional narrowing is one somebody forgets and it fails open (rule A5).
// A logic test is not serving a person, so it has to say which reach it means —
// and saying it out loud is the point: `EVERY_BRANCH` in a fixture reads as a
// deliberate choice, where a missing argument would have read as nothing.
//
// This lives under tests/ ON PURPOSE. A constant meaning "narrow nothing" that
// application code could import would eventually be imported by a page, and
// that page would silently show every branch to a manager scoped to one.
// ============================================================

import type { BranchReach } from "@/lib/permissions/service";

/** What an owner or an area manager carries: every branch, including new ones. */
export const EVERY_BRANCH: BranchReach = {
  allBranches: true,
  allowedBranchIds: [],
};

/** A person scoped to named branches and nothing else. */
export function onlyBranches(...branchIds: string[]): BranchReach {
  return { allBranches: false, allowedBranchIds: branchIds };
}

/** Reach that reaches nothing — the shape an invite leaves before any grant. */
export const NO_BRANCH: BranchReach = {
  allBranches: false,
  allowedBranchIds: [],
};

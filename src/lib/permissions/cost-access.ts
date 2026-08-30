// ============================================================
// Mise — the ticket that lets a cost figure reach a screen (Part 28 L3, ADR 0029 Q12)
// ============================================================
// THE ONE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE:
//
//     computing a cost is not the same act as showing one.
//
// `stock-cost.ts` and `recipe-cost.ts` are called when the LEDGER MOVES, not
// only when a page renders. A cook posting a staff meal makes the system replay
// FIFO to price what left the shelf; a transfer freezes the sending branch's
// cost onto its line. So a cook must be able to compute cost while having no
// right whatsoever to see the number. Putting the gate on the seven cost-engine
// entry points would have broken writing, quietly, for the roles that do most
// of the writing.
//
// The gate therefore sits at the EXIT — on the reads that serialise a figure
// towards a screen. Those reads take `CostAccess | null` as a REQUIRED
// parameter, so adding a new one is a decision the compiler insists on.
//
// WHY NOT A BOOLEAN. A boolean is not a gate, it is a request: `includeCost:
// true` can be typed by anyone, anywhere, without proving anything. A
// `CostAccess` cannot be constructed by callers at all — the only value of this
// type in the program is minted below, and only after the role table has been
// asked. Passing one is therefore evidence that a check happened.
//
// This module deliberately imports nothing from `require-tenant` or `next/*`,
// so a pure logic module in `src/server/**` can take the ticket in its
// signature without dragging auth or navigation into its dependency graph.
// ============================================================

import { hasCapability } from "./service";

declare const costAccessBrand: unique symbol;

/**
 * Proof that the holder was allowed to see money. Opaque on purpose: the brand
 * is a `unique symbol` that nothing can name, so `{} as CostAccess` is the only
 * way to fake one and it is greppable in review.
 */
export interface CostAccess {
  readonly [costAccessBrand]: "cost:view";
}

/** The only instance in the program. Not exported. */
const TICKET = Object.freeze({}) as CostAccess;

/**
 * Mint a ticket if this role may see cost, otherwise `null`.
 *
 * This is the single door. `requireTenant` calls it once per request; tests
 * call it with a role name to get exactly what that role would get, which is
 * why they can pin the cook's blindness without going near a session.
 */
export function costAccessFor(role: string): CostAccess | null {
  return hasCapability(role, "cost:view") ? TICKET : null;
}

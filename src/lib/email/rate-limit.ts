// ============================================================
// Mise — layer 1 of the two that keep /login from being a cannon
// (Part 31 L2, ADR 0031 Q6)
// ============================================================
// `/login` is a public form: anyone may type any address and make Mise send
// mail to it, unmetered. That has been true since Sprint 0 and was harmless
// only because development merely logs the link. This Part loads the gun.
//
// What is at stake is NOT the cost of the mail. Unsolicited mail from our
// sending domain earns spam complaints, complaints cost deliverability, and a
// magic link is the ONLY way into Mise — there is no password. So the attacker
// never suffers; paying shops do, by being unable to log in. Domain reputation
// is slow to repair, which is the genuinely irreversible thing in ADR 0031.
//
// ── WHAT THIS LAYER DOES AND DOES NOT CATCH ────────────────────────────────
// Catches: one address hammered repeatedly, and a person pressing the button
// over and over because nothing seems to happen.
// Does NOT catch: 10,000 addresses hit once each — no single identifier ever
// passes the limit. That is layer 2 (per-IP), which needs either a new table
// (a stop-and-ask) or the host's edge, and the host is not chosen yet.
// 🔴 Layer 2 is owed BEFORE the sending domain is verified, not before deploy:
// the hole opens when we can reach strangers, not when we get a real URL.
//
// ── NO MIGRATION ───────────────────────────────────────────────────────────
// `verification_token` already records every request. It is not under RLS
// (it appears in neither enable_rls.sql nor enforce_rls.sql) and `mise_app`
// holds SELECT on it, so this counts without the Part 30 bypass door — whose
// allowlist stays at one entry.
//
// ⚠️ THE TABLE HAS NO `createdAt`, only `expires`. Because `maxAge` is a
// constant, `expires` orders identically to creation time, so "unexpired" is a
// faithful stand-in for "requested recently". If maxAge ever becomes dynamic
// this reasoning dies with it — hence this paragraph rather than silence.
//
// ⚠️ THE COUNT IS ±1 BY RACE, MEASURED FROM THE SOURCE, NOT ASSUMED.
// @auth/core's send-token.js starts sendVerificationRequest and
// createVerificationToken and then awaits BOTH together:
//     const sendRequest = provider.sendVerificationRequest({...})
//     const createToken = adapter.createVerificationToken?.({...})
//     await Promise.all([sendRequest, createToken])
// so the current request's own row may or may not be committed by the time
// this query runs. The threshold is therefore chosen loose enough that one row
// either way changes nobody's day, and the tests call this function directly
// rather than betting on the race (a boundary test built on it would be
// exactly the flake Part 23 spent a Part removing).
//
// A refused request still writes its token row, because createVerificationToken
// was already in flight when the send rejected. That is the wanted behaviour:
// hammering keeps the limit tripped rather than resetting it.
// ============================================================

import type { PrismaClient } from "@prisma/client";

/**
 * ⚠️ A STARTING VALUE, NOT A REASONED ONE — the same honesty ADR 0020 applies
 * to its own 1%/฿100 threshold. Five unused links for one address is already
 * odd: Auth.js deletes a token when it is used, so an outstanding pile means
 * nobody is clicking. Validate against real shops before Beta.
 */
export const MAX_OUTSTANDING_LINKS = 5;

type TokenCounter = Pick<PrismaClient, "verificationToken">;

/**
 * How many links this address has been sent that are still valid and still
 * unused. `identifier` is the normalised email Auth.js hands us.
 */
export async function outstandingLinkCount(
  db: TokenCounter,
  identifier: string,
  now: Date = new Date(),
): Promise<number> {
  return db.verificationToken.count({
    where: { identifier, expires: { gt: now } },
  });
}

export async function tooManyOutstandingLinks(
  db: TokenCounter,
  identifier: string,
  now: Date = new Date(),
): Promise<boolean> {
  const count = await outstandingLinkCount(db, identifier, now);
  return count >= MAX_OUTSTANDING_LINKS;
}

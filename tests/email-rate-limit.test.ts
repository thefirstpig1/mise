// ============================================================
// Mise — counting the links nobody clicked (Part 31 L2, ADR 0031 Q6)
// ============================================================
// Layer 1 of the two defences on /login. It counts rows in a table that
// already exists — no migration, and no Part 30 bypass door, because
// `verification_token` is not under RLS and `mise_app` holds SELECT on it.
//
// These tests call the counter DIRECTLY rather than through Auth.js, on
// purpose. In the real flow the current request's own row is written
// concurrently with the send (@auth/core send-token.js awaits both together),
// so the count is ±1 by race. A test that asserted the exact boundary through
// the real flow would be a flake, and Part 23 already spent a whole Part
// removing flakes of exactly that shape.
//
// `verification_token` carries no tenantId, so the suite sweep does not cover
// it — every row this file writes, it deletes.
// ============================================================

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  outstandingLinkCount,
  tooManyOutstandingLinks,
  MAX_OUTSTANDING_LINKS,
} from "@/lib/email/rate-limit";

const RUN = `part31-${Date.now()}`;
const ADDRESS = `${RUN}-somchai@example.com`;
const OTHER = `${RUN}-malee@example.com`;

const HOUR = 3600_000;

async function issue(identifier: string, expiresInMs: number, seq: number) {
  await prisma.verificationToken.create({
    data: {
      identifier,
      token: `${RUN}-${identifier}-${seq}`,
      expires: new Date(Date.now() + expiresInMs),
    },
  });
}

async function wipe() {
  await prisma.verificationToken.deleteMany({
    where: { identifier: { in: [ADDRESS, OTHER] } },
  });
}

beforeEach(wipe);
afterAll(wipe);

describe("outstanding sign-in links (ADR 0031 Q6)", () => {
  it("R1 — an address nobody has asked for has none", async () => {
    expect(await outstandingLinkCount(prisma, ADDRESS)).toBe(0);
    expect(await tooManyOutstandingLinks(prisma, ADDRESS)).toBe(false);
  });

  it("R2 — an expired link does not count against you", async () => {
    // Yesterday's unused links must not lock someone out today. This is the
    // only thing keeping the limit from being permanent.
    await issue(ADDRESS, -1 * HOUR, 1);
    await issue(ADDRESS, -48 * HOUR, 2);
    expect(await outstandingLinkCount(prisma, ADDRESS)).toBe(0);
  });

  it("R3 — the count is per address and cannot leak between people", async () => {
    // Otherwise one hammered address would lock out every other user, which
    // turns the defence into the outage it exists to prevent.
    for (let i = 0; i < MAX_OUTSTANDING_LINKS + 2; i++) {
      await issue(OTHER, 12 * HOUR, i);
    }
    expect(await outstandingLinkCount(prisma, ADDRESS)).toBe(0);
    expect(await tooManyOutstandingLinks(prisma, ADDRESS)).toBe(false);
    expect(await tooManyOutstandingLinks(prisma, OTHER)).toBe(true);
  });

  it("R4 — the threshold trips at MAX, not before it", async () => {
    for (let i = 0; i < MAX_OUTSTANDING_LINKS - 1; i++) {
      await issue(ADDRESS, 12 * HOUR, i);
    }
    // One short: a person who genuinely lost four emails still gets a fifth.
    expect(await tooManyOutstandingLinks(prisma, ADDRESS)).toBe(false);

    await issue(ADDRESS, 12 * HOUR, MAX_OUTSTANDING_LINKS - 1);
    expect(await tooManyOutstandingLinks(prisma, ADDRESS)).toBe(true);
  });

  it("R5 — `now` is a parameter, so expiry is judged against one instant", async () => {
    // The counter must not read the clock twice within one decision, and this
    // is also what lets R2's reasoning be tested without waiting 24 hours.
    await issue(ADDRESS, 2 * HOUR, 1);

    const beforeItDies = new Date(Date.now() + 1 * HOUR);
    const afterItDies = new Date(Date.now() + 3 * HOUR);

    expect(await outstandingLinkCount(prisma, ADDRESS, beforeItDies)).toBe(1);
    expect(await outstandingLinkCount(prisma, ADDRESS, afterItDies)).toBe(0);
  });

  it("R6 — using a link frees the slot, which is what makes the pile mean something", async () => {
    // Auth.js deletes the token when it is redeemed. A pile of outstanding
    // links therefore means nobody is clicking — which is the whole reason
    // this is a fair thing to limit on.
    for (let i = 0; i < MAX_OUTSTANDING_LINKS; i++) {
      await issue(ADDRESS, 12 * HOUR, i);
    }
    expect(await tooManyOutstandingLinks(prisma, ADDRESS)).toBe(true);

    await prisma.verificationToken.delete({
      where: { token: `${RUN}-${ADDRESS}-0` },
    });
    expect(await tooManyOutstandingLinks(prisma, ADDRESS)).toBe(false);
  });
});

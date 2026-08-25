// ============================================================
// Mise — the connection retry actually fires (Part 23.5, ADR 0024)
// ============================================================
// A retry that never fires looks exactly like a retry that works: green tests,
// no errors, no sign of anything wrong. The first version of this code tested
// `e.code === "P1001"` and matched NOTHING, because
// `PrismaClientInitializationError` carries no code at all — and that shipped,
// verified across 15 full runs, and looked merely like a fix that had not
// helped.
//
// So D2 builds a REAL Prisma connection failure rather than a hand-made stand-in
// with the properties the predicate expects. A fake error would have passed
// against the broken predicate too.
// ============================================================

import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  isRetryableConnectionError,
  retryOnConnectionFailure,
} from "@/lib/db";

/** Provoke a genuine connection failure: a port with nothing behind it. */
async function realConnectionError(): Promise<unknown> {
  const dead = new PrismaClient({
    datasources: {
      db: { url: "postgresql://u:p@127.0.0.1:59999/db?connect_timeout=1" },
    },
  });
  try {
    await dead.$queryRaw`SELECT 1`;
    throw new Error("expected the connection to fail");
  } catch (e) {
    return e;
  } finally {
    await dead.$disconnect().catch(() => undefined);
  }
}

describe("connection retry (ADR 0024)", () => {
  it("D1: retries until it succeeds, and calls again only on connection errors", async () => {
    let calls = 0;
    const err = await realConnectionError();

    const result = await retryOnConnectionFailure(async () => {
      calls++;
      if (calls < 3) throw err;
      return "ok";
    });

    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("D2: recognises a REAL Prisma connection failure, not just a shaped object", async () => {
    const err = await realConnectionError();

    // The assertion that would have caught the shipped bug.
    expect(isRetryableConnectionError(err)).toBe(true);
    expect((err as { name?: string }).name).toBe(
      "PrismaClientInitializationError"
    );
    // And the reason the first predicate failed: there is no code to match on.
    expect((err as { code?: unknown }).code).toBeUndefined();
  });

  it("D3: never repeats an error the database actually answered", async () => {
    let calls = 0;
    const business = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      name: "PrismaClientKnownRequestError",
    });

    await expect(
      retryOnConnectionFailure(async () => {
        calls++;
        throw business;
      })
    ).rejects.toThrow("Unique constraint failed");

    // Exactly once: a write that reached the server must never be sent twice.
    expect(calls).toBe(1);
    expect(isRetryableConnectionError(business)).toBe(false);
  });

  it("D4: gives up after the bounded number of attempts", async () => {
    let calls = 0;
    const err = await realConnectionError();

    await expect(
      retryOnConnectionFailure(async () => {
        calls++;
        throw err;
      }, 2)
    ).rejects.toBeTruthy();

    expect(calls).toBe(3); // the first attempt plus two retries
  });
});

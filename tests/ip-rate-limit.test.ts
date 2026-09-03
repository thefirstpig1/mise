// ============================================================
// Mise — layer 2 of the login rate limit (Part 34, ADR 0033 Q7)
// ============================================================
// No database and no clock: every function takes `now` as an argument, so the
// window can be crossed without waiting an hour and without a fake timer.
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

import {
  MAX_SENDS_PER_IP_PER_HOUR,
  MAX_TRACKED_IPS,
  IP_WINDOW_MS,
  clientIpFrom,
  resetIpRateLimit,
  sendsFromIp,
  singleInstanceWarning,
  tooManySendsFromIp,
  trackedIpCount,
} from "@/lib/email/ip-rate-limit";

/** A stand-in for the Headers object `next/headers` returns. */
function headersOf(entries: Record<string, string>) {
  const lower = new Map(
    Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

beforeEach(() => resetIpRateLimit());

describe("which address the limit is keyed on", () => {
  it("R1: reads Fly-Client-IP, which the edge sets and a client cannot", () => {
    expect(clientIpFrom(headersOf({ "Fly-Client-IP": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("R2: 🔴 never reads X-Forwarded-For, which the client chooses", () => {
    // The whole layer turns on this. X-Forwarded-For is appended to by any
    // proxy and forgeable by the caller, so a limit keyed on it is a limit
    // whose key the attacker picks — one line of curl and every request looks
    // like a new visitor.
    const forged = headersOf({
      "X-Forwarded-For": "203.0.113.7",
      "X-Real-IP": "203.0.113.7",
    });
    expect(clientIpFrom(forged)).toBeNull();
  });

  it("R3: no header passes, it does not block", () => {
    // Local development has no edge and therefore no header. A login form that
    // refused on a dev machine would be found at the worst possible moment.
    expect(tooManySendsFromIp(clientIpFrom(headersOf({})))).toBe(false);
  });
});

describe("counting", () => {
  const IP = "203.0.113.7";
  const T0 = 1_700_000_000_000;

  it("R4: the twentieth send passes and the twenty-first does not", () => {
    for (let i = 0; i < MAX_SENDS_PER_IP_PER_HOUR; i++) {
      expect(tooManySendsFromIp(IP, T0 + i), `send ${i + 1}`).toBe(false);
    }
    expect(tooManySendsFromIp(IP, T0 + MAX_SENDS_PER_IP_PER_HOUR)).toBe(true);
  });

  it("R5: a refused attempt still counts, so hammering does not reset the limit", () => {
    for (let i = 0; i <= MAX_SENDS_PER_IP_PER_HOUR; i++) {
      tooManySendsFromIp(IP, T0 + i);
    }
    const afterTripping = sendsFromIp(IP, T0 + 100);
    tooManySendsFromIp(IP, T0 + 101);
    expect(sendsFromIp(IP, T0 + 102)).toBe(afterTripping + 1);
  });

  it("R6: the window slides — an hour later the same address is clear again", () => {
    for (let i = 0; i <= MAX_SENDS_PER_IP_PER_HOUR; i++) {
      tooManySendsFromIp(IP, T0 + i);
    }
    expect(tooManySendsFromIp(IP, T0 + 1)).toBe(true);
    expect(tooManySendsFromIp(IP, T0 + IP_WINDOW_MS + 1)).toBe(false);
  });

  it("R7: addresses are counted apart from one another", () => {
    for (let i = 0; i <= MAX_SENDS_PER_IP_PER_HOUR; i++) {
      tooManySendsFromIp("203.0.113.7", T0 + i);
    }
    expect(tooManySendsFromIp("203.0.113.8", T0 + 50)).toBe(false);
  });
});

describe("the cap that stops the defence becoming the attack", () => {
  const T0 = 1_700_000_000_000;

  it("R8: 🔴 a million source addresses cannot grow the map without bound", () => {
    // An unbounded Map keyed by IP is a memory-shaped DoS, and ADR 0033 Q13
    // records what an OOM looks like from outside: the machine is killed and
    // restarted silently, which reads as "the app crashes randomly". This is
    // the same objection that made Q7 reject a table, applied to the fix.
    for (let i = 0; i < MAX_TRACKED_IPS * 2; i++) {
      tooManySendsFromIp(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, T0 + i);
    }
    expect(
      trackedIpCount(),
      `${MAX_TRACKED_IPS * 2} distinct addresses arrived; the map must not hold them all.`,
    ).toBeLessThanOrEqual(MAX_TRACKED_IPS + Math.floor(MAX_TRACKED_IPS / 10));
    // And the earliest arrivals are the ones that went.
    expect(sendsFromIp("10.0.0.0", T0)).toBe(0);
  });

  it("R9: eviction takes the least recently seen, so a live attack cannot pin a bucket", () => {
    const attacker = "198.51.100.1";
    tooManySendsFromIp(attacker, T0);

    // Far enough past SWEEP_AT that eviction has actually run — a loop that
    // stops short of it would pass without exercising anything.
    for (let i = 0; i < MAX_TRACKED_IPS * 2; i++) {
      const t = T0 + 1 + i;
      tooManySendsFromIp(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, t);
      // The attacker keeps being seen, so it stays the most recent, not the least.
      if (i % 100 === 0) tooManySendsFromIp(attacker, t);
    }

    expect(
      sendsFromIp(attacker, T0 + MAX_TRACKED_IPS * 2 + 20),
      "an address that keeps arriving must not be the one evicted",
    ).toBeGreaterThan(1);
  });

  it("R10: eviction fails OPEN for the evicted, never closed", () => {
    // The direction matters and is deliberate: a visitor pushed out of the map
    // stops being counted, which means they are not refused. Layer 1 (per
    // address) still stands underneath. The reverse — evicting into a refusal —
    // would let an attacker lock real shops out by spraying.
    const victim = "198.51.100.9";
    for (let i = 0; i <= MAX_SENDS_PER_IP_PER_HOUR; i++) {
      tooManySendsFromIp(victim, T0 + i);
    }
    expect(tooManySendsFromIp(victim, T0 + 100)).toBe(true);

    for (let i = 0; i < MAX_TRACKED_IPS * 2; i++) {
      const t = T0 + 200 + i;
      tooManySendsFromIp(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, t);
    }
    expect(tooManySendsFromIp(victim, T0 + 200 + MAX_TRACKED_IPS * 2)).toBe(false);
  });
});

describe("the assumption it announces", () => {
  it("R11: says nothing off Fly, where there is no edge and no header", () => {
    expect(singleInstanceWarning({})).toBeNull();
  });

  it("R12: on Fly, names the machine so two of them are visible in the log", () => {
    const notice = singleInstanceWarning({
      FLY_APP_NAME: "mise",
      FLY_MACHINE_ID: "148e213f7e1runw",
    });

    expect(notice).toContain("148e213f7e1runw");
    expect(notice).toContain("ONE instance");
    expect(notice).toContain(String(MAX_SENDS_PER_IP_PER_HOUR));
  });
});

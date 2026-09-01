// ============================================================
// Mise — when is email "configured" (Part 31 L1, ADR 0031 Q7)
// ============================================================
// Q7 moved the switch from NODE_ENV to whether credentials exist, which makes
// this predicate the thing that decides whether production sends or refuses.
// Everything it gets wrong, it gets wrong in production.
//
// The trap it exists for: Sprint 0 shipped .env.example with
//   EMAIL_SERVER_USER=""  EMAIL_SERVER_PASSWORD=""
// PRESENT but EMPTY. `process.env.X !== undefined` would call that configured
// and put production in the "send" cell with nothing to send through — the
// exact silent half-state Q7 point 3 refuses.
// ============================================================

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readEmailConfig, isEmailConfigured } from "@/lib/email/transport";

const KEYS = [
  "EMAIL_SERVER_HOST",
  "EMAIL_SERVER_PORT",
  "EMAIL_SERVER_USER",
  "EMAIL_SERVER_PASSWORD",
  "EMAIL_FROM",
] as const;

const original = new Map<string, string | undefined>(
  KEYS.map((k) => [k, process.env[k]]),
);

function clear() {
  for (const k of KEYS) delete process.env[k];
}

/** The complete, valid shape — each test spoils exactly one thing. */
function fill() {
  process.env.EMAIL_SERVER_HOST = "smtp.resend.com";
  process.env.EMAIL_SERVER_PORT = "587";
  process.env.EMAIL_SERVER_USER = "resend";
  process.env.EMAIL_SERVER_PASSWORD = "re_test_key";
  process.env.EMAIL_FROM = "Mise <onboarding@resend.dev>";
}

beforeEach(clear);

afterAll(() => {
  clear();
  for (const [k, v] of original) if (v !== undefined) process.env[k] = v;
});

describe("readEmailConfig (ADR 0031 Q7)", () => {
  it("C1 — a complete set reads back, port included", () => {
    fill();
    expect(readEmailConfig()).toEqual({
      host: "smtp.resend.com",
      port: 587,
      user: "resend",
      password: "re_test_key",
      from: "Mise <onboarding@resend.dev>",
    });
    expect(isEmailConfigured()).toBe(true);
  });

  it("C2 — nothing set at all is a legitimate no, not a throw", () => {
    // This is every dev machine and every fresh clone. It must be quiet.
    expect(readEmailConfig()).toBeNull();
    expect(isEmailConfigured()).toBe(false);
  });

  it("C3 — Sprint 0's empty strings are NOT configured", () => {
    fill();
    process.env.EMAIL_SERVER_USER = "";
    expect(isEmailConfigured()).toBe(false);

    fill();
    process.env.EMAIL_SERVER_PASSWORD = "   ";
    expect(isEmailConfigured()).toBe(false);
  });

  it("C4 — each of the four required values is genuinely required", () => {
    // Asserted one at a time rather than as a group: a check that only ever
    // fires for the first missing value is a check the other three do not have.
    for (const key of [
      "EMAIL_SERVER_HOST",
      "EMAIL_SERVER_USER",
      "EMAIL_SERVER_PASSWORD",
      "EMAIL_FROM",
    ] as const) {
      fill();
      delete process.env[key];
      expect(isEmailConfigured(), `${key} missing should not be configured`).toBe(
        false,
      );
    }
  });

  it("C5 — the port defaults to 587 when unset or left blank", () => {
    // Blank is "did not choose", which is different from "chose wrongly".
    fill();
    delete process.env.EMAIL_SERVER_PORT;
    expect(readEmailConfig()?.port).toBe(587);

    fill();
    process.env.EMAIL_SERVER_PORT = "";
    expect(readEmailConfig()?.port).toBe(587);
  });

  it("C6 — a port that is not a port refuses rather than falling back", () => {
    // Falling back to 587 would hide the typo, and the letter would leave from
    // a port the operator did not choose. "587x" is in this list on purpose:
    // Number.parseInt("587x", 10) is 587, so a lenient parse would ship it.
    for (const bad of ["abc", "0", "70000", "587x", "-1", "58 7"]) {
      fill();
      process.env.EMAIL_SERVER_PORT = bad;
      expect(isEmailConfigured(), `port ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

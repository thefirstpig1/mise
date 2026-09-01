// ============================================================
// Mise — all four cells, asserted separately (Part 31 L2, ADR 0031 Q7)
// ============================================================
// Part 29's lesson, paid for twice: a rule sitting behind another rule is a
// rule nothing tests. Two of these cells return the same word for opposite
// reasons, and one returns a word nothing else does — so each cell gets its
// own case rather than a table-driven loop that would let a wrong cell hide
// behind a right one.
//
// The cell that matters is production + unconfigured. It is the only REFUSAL
// in the Part, and it is a refusal on purpose: the alternative is a working
// credential in a server log plus a person watching an inbox forever.
// ============================================================

import { describe, it, expect } from "vitest";
import { decideEmailDelivery } from "@/lib/email/delivery";

describe("the Q7 table (ADR 0031)", () => {
  it("D1 — production with credentials sends", () => {
    expect(
      decideEmailDelivery({ isProduction: true, configured: true }),
    ).toBe("send");
  });

  it("D2 — production WITHOUT credentials refuses, and never logs the link", () => {
    // The whole point of the table. If this ever returns "console", a working
    // sign-in credential starts being written to production logs.
    expect(
      decideEmailDelivery({ isProduction: true, configured: false }),
    ).toBe("refuse");
  });

  it("D3 — development with credentials sends, which is how step A is proved", () => {
    // Before this Part, proving that email worked at all meant running the
    // whole app in production mode.
    expect(
      decideEmailDelivery({ isProduction: false, configured: true }),
    ).toBe("send");
  });

  it("D4 — development without credentials logs, so a fresh clone still runs", () => {
    expect(
      decideEmailDelivery({ isProduction: false, configured: false }),
    ).toBe("console");
  });

  it("D5 — credentials decide sending; the environment only decides the fallback", () => {
    // Stated as its own case because it is the shape of the table, and a
    // future edit that reintroduced an environment check on the sending side
    // would leave D1 and D3 green while breaking this.
    for (const isProduction of [true, false]) {
      expect(decideEmailDelivery({ isProduction, configured: true })).toBe(
        "send",
      );
    }
    expect(
      decideEmailDelivery({ isProduction: true, configured: false }),
    ).not.toBe(decideEmailDelivery({ isProduction: false, configured: false }));
  });
});

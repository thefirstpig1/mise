// ============================================================
// Mise — choosing a shop without trusting the browser (Part 29 L3c, Q3)
// ============================================================
// `pickActiveTenant` is four lines and it is the whole of rule A9. The cookie
// carries a tenant id, and a tenant id from a browser is an invitation to read
// somebody else's shop — so the only thing it may ever do is SELECT FROM a list
// the server built by userId.
//
// The signature is the safety property: you cannot get an id out without
// handing in the list it has to come from. These tests pin the behaviour that
// signature promises, including the case that matters most — a cookie naming a
// tenant the person does not belong to.
// ============================================================

import { describe, it, expect } from "vitest";
import { pickActiveTenant } from "@/lib/active-tenant";

const m = (tenantId: string, name = tenantId) => ({ tenantId, name });

describe("picking the active shop (ADR 0029 Part 29 L3c)", () => {
  it("T1 — one membership needs no cookie and cannot be steered by one", () => {
    // Every shop in Mise today. A stale or hostile cookie must not be able to
    // make this path ask a question, or answer it differently.
    const only = [m("t-thonglor")];
    expect(pickActiveTenant(only, null)?.tenantId).toBe("t-thonglor");
    expect(pickActiveTenant(only, "t-somebody-else")?.tenantId).toBe("t-thonglor");
    expect(pickActiveTenant(only, "")?.tenantId).toBe("t-thonglor");
  });

  it("T2 — a cookie naming a shop you do not belong to selects NOTHING", () => {
    // The attack, and the reason the function takes a list. Returning null
    // sends the person to the chooser; it must never fall back to "the first
    // one", which would quietly hand them a shop they did not ask for.
    const mine = [m("t-a"), m("t-b")];
    expect(pickActiveTenant(mine, "t-not-mine")).toBeNull();
    expect(pickActiveTenant(mine, "'; DROP TABLE tenant;--")).toBeNull();
  });

  it("T3 — with several shops and no cookie, it refuses to guess", () => {
    // This is the whole point of Part 29 Q3. Before it, `findFirst` +
    // `orderBy createdAt asc` picked the oldest and said nothing, and a
    // bookkeeper with three clients saw one of them for ever.
    expect(pickActiveTenant([m("t-a"), m("t-b")], null)).toBeNull();
  });

  it("T4 — a good cookie picks the shop it names, not the first", () => {
    const mine = [m("t-a"), m("t-b"), m("t-c")];
    expect(pickActiveTenant(mine, "t-c")?.tenantId).toBe("t-c");
    expect(pickActiveTenant(mine, "t-b")?.tenantId).toBe("t-b");
  });

  it("T5 — no memberships selects nothing", () => {
    expect(pickActiveTenant([], null)).toBeNull();
    expect(pickActiveTenant([], "t-a")).toBeNull();
  });
});

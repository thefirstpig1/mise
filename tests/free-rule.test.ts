// ============================================================
// คิดครัว — "one Free shop per owner account" is reported, not enforced (Kong 2026-11-02)
// ============================================================

import { describe, it, expect } from "vitest";
import { ownersOverFreeLimit } from "@/lib/free-rule";

const shop = (id: string, plan: string, ...owners: string[]) => ({ id, name: `ร้าน ${id}`, owners, plan });

describe("ownersOverFreeLimit", () => {
  it("FR1 — an owner with two Free shops is listed with both", () => {
    const r = ownersOverFreeLimit([shop("a", "trial", "x@t.com"), shop("b", "trial", "x@t.com")]);
    expect(r.get("x@t.com")?.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("FR2 — one Free shop plus a Standard shop is within the rule", () => {
    const r = ownersOverFreeLimit([shop("a", "trial", "x@t.com"), shop("b", "standard", "x@t.com")]);
    expect(r.size).toBe(0);
  });

  it("FR3 — different owners are counted apart, and email case does not split one owner", () => {
    const r = ownersOverFreeLimit([shop("a", "trial", "X@t.com"), shop("b", "trial", "x@t.com"), shop("c", "trial", "y@t.com")]);
    expect([...r.keys()]).toEqual(["x@t.com"]);
  });

  it("FR4 — a shop with two owners counts once for each", () => {
    const r = ownersOverFreeLimit([shop("a", "trial", "x@t.com", "y@t.com"), shop("b", "trial", "y@t.com")]);
    expect([...r.keys()]).toEqual(["y@t.com"]);
  });
});

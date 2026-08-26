// ============================================================
// Mise — menu merging, the wire shapes (Part 25 L2, ADR 0026)
// ============================================================
// Pure zod. No database, so what is pinned here is only what can be decided
// without one: the shape, the defaults, and the two refusals visible from the
// request alone.
//
// The rules that need a query — no chains, does this menu belong to this tenant,
// how many posted days a backdate would touch — are L3's, and this file
// deliberately does not pretend to cover them.
// ============================================================

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { computeBangkokToday, addDays } from "@/lib/bangkok-date";
import {
  DEFAULT_MERGE_CANDIDATES,
  MAX_MERGE_CANDIDATES,
  menuMergeListQuerySchema,
  mergeCandidatesQuerySchema,
  mergeMenusInputSchema,
  revokeMergeInputSchema,
} from "@/lib/validations/menu-merge";

const today = computeBangkokToday();

const merge = (over: Record<string, unknown> = {}) =>
  mergeMenusInputSchema.safeParse({
    submitKey: randomUUID(),
    losingMenuId: randomUUID(),
    winningMenuId: randomUUID(),
    ...over,
  });

const issueOn = (r: ReturnType<typeof merge>, field: string) =>
  r.success ? undefined : r.error.issues.find((i) => i.path.join(".") === field);

describe("mergeMenusInputSchema (ADR 0026 Q1/Q5)", () => {
  it("S1: two different menus and nothing else is a valid merge", () => {
    const r = merge();
    expect(r.success).toBe(true);
  });

  it("S2: effectiveFrom defaults to TODAY — the answer that moves no stock", () => {
    // Q5: reporting folds retroactively regardless, so today's default fixes
    // every report at once while the ledger stays exactly where it was.
    for (const absent of [undefined, null, ""]) {
      const r = merge({ effectiveFrom: absent });
      expect(r.success).toBe(true);
      if (!r.success) continue;
      expect(r.data.effectiveFrom.getTime()).toBe(today.getTime());
    }
  });

  it("S3: a past date is allowed — six split months is the reason to merge", () => {
    const r = merge({ effectiveFrom: addDays(today, -180) });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.effectiveFrom.getTime()).toBe(addDays(today, -180).getTime());
    // The acknowledgement is not zod's to demand: whether any posted day is
    // actually touched is a question for the database.
    expect(r.data.acknowledgeBackdate).toBe(false);
  });

  it("S4: a FUTURE date is refused, on its own field", () => {
    const r = merge({ effectiveFrom: addDays(today, 1) });
    expect(r.success).toBe(false);
    expect(issueOn(r, "effectiveFrom")?.message).toContain("อนาคต");
  });

  it("S5: a menu cannot be a spelling of itself", () => {
    const id = randomUUID();
    const r = merge({ losingMenuId: id, winningMenuId: id });
    expect(r.success).toBe(false);
    // On winningMenuId, because that is the field the person last chose.
    expect(issueOn(r, "winningMenuId")?.message).toContain("รวมกับตัวเองไม่ได้");
  });

  it("S6: the acknowledgement reads a checkbox and a typed caller alike", () => {
    for (const on of ["on", "true", true]) {
      const r = merge({ acknowledgeBackdate: on });
      expect(r.success && r.data.acknowledgeBackdate).toBe(true);
    }
    // Anything else is false — never "truthy string means yes".
    for (const off of [undefined, "", "off", "false", false, "1"]) {
      const r = merge({ acknowledgeBackdate: off });
      expect(r.success && r.data.acknowledgeBackdate).toBe(false);
    }
  });

  it("S7: ids must be uuids, and each names its own field", () => {
    expect(issueOn(merge({ losingMenuId: "nope" }), "losingMenuId")).toBeDefined();
    expect(issueOn(merge({ winningMenuId: "nope" }), "winningMenuId")).toBeDefined();
    expect(issueOn(merge({ submitKey: "nope" }), "submitKey")).toBeDefined();
  });
});

describe("revokeMergeInputSchema", () => {
  it("S8: a merge id is enough; the acknowledgement defaults to false", () => {
    const r = revokeMergeInputSchema.safeParse({ mergeId: randomUUID() });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.acknowledgePosted).toBe(false);
  });

  it("S9: no submitKey — revoking is idempotent by what it does", () => {
    const r = revokeMergeInputSchema.safeParse({
      mergeId: randomUUID(),
      submitKey: randomUUID(),
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect("submitKey" in r.data).toBe(false);
  });
});

describe("the read shapes", () => {
  it("S10: candidates default to a short list and exclude merged menus", () => {
    const r = mergeCandidatesQuerySchema.safeParse({ menuId: randomUUID() });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.limit).toBe(DEFAULT_MERGE_CANDIDATES);
    // Q4: a menu already folded into something cannot be a candidate, or the
    // chain the ADR forbids becomes one click away.
    expect(r.data.includeMerged).toBe(false);
  });

  it("S11: the candidate list is capped", () => {
    const over = mergeCandidatesQuerySchema.safeParse({
      menuId: randomUUID(),
      limit: MAX_MERGE_CANDIDATES + 1,
    });
    expect(over.success).toBe(false);
    const at = mergeCandidatesQuerySchema.safeParse({
      menuId: randomUUID(),
      limit: MAX_MERGE_CANDIDATES,
    });
    expect(at.success).toBe(true);
  });

  it("S12: the merge list narrows to one dish, and revoked rows are opt-in", () => {
    const blank = menuMergeListQuerySchema.safeParse({ winningMenuId: "" });
    expect(blank.success).toBe(true);
    if (!blank.success) return;
    // Blank is ABSENT, not null — "every merge in the tenant".
    expect(blank.data.winningMenuId).toBeUndefined();
    expect(blank.data.includeRevoked).toBe(false);

    const one = menuMergeListQuerySchema.safeParse({
      winningMenuId: randomUUID(),
      includeRevoked: "on",
    });
    expect(one.success && one.data.includeRevoked).toBe(true);
  });
});

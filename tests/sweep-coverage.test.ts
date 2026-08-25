// ============================================================
// Mise — the sweep list cannot rot (Sprint 5 Part 23, ADR 0023 Q4)
// ============================================================
// A hand-maintained delete order goes stale the moment a Part adds a table, and
// it goes stale SILENTLY: the new rows simply survive, holding their tenant
// alive, and nothing says so. This test is what makes that loud.
//
// No database — it reads the generated client's schema metadata.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  TENANT_SCOPED_DELETE_ORDER,
  tenantScopedModels,
} from "./support/sweep";

describe("test tenant sweep coverage", () => {
  it("S1: every model carrying a tenantId is in the delete order", () => {
    const listed = new Set<string>(TENANT_SCOPED_DELETE_ORDER);
    const missing = tenantScopedModels().filter((m) => !listed.has(m));

    expect(
      missing,
      `These models carry a tenantId but the sweep would leave them behind, ` +
        `which keeps their tenant alive: ${missing.join(", ")}. ` +
        `Add them to TENANT_SCOPED_DELETE_ORDER in tests/support/sweep.ts, ` +
        `children BEFORE parents.`
    ).toEqual([]);
  });

  it("S2: the delete order lists nothing twice", () => {
    const seen = new Set<string>();
    const dupes = TENANT_SCOPED_DELETE_ORDER.filter((m) => {
      if (seen.has(m)) return true;
      seen.add(m);
      return false;
    });
    expect(dupes).toEqual([]);
  });
});

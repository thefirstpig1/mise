// ============================================================
// คิดครัว — the version a recipe line serves on a day (src/lib/recipe-version.ts)
// ============================================================
// Kong 2026-11-06: "ใช้ใน N สูตร" counted a recipe whose CURRENT version had
// dropped the product, because the older version stays live for its own days.
// ============================================================

import { describe, it, expect } from "vitest";
import { currentVersionIds } from "@/lib/recipe-version";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("currentVersionIds", () => {
  const rows = [
    { id: "v1", lineId: "kaphrao", effectiveFrom: d("2026-09-01"), createdAt: d("2026-09-01") },
    { id: "v2", lineId: "kaphrao", effectiveFrom: d("2026-10-15"), createdAt: d("2026-10-14") },
    { id: "v3", lineId: "kaphrao", effectiveFrom: d("2026-12-01"), createdAt: d("2026-11-01") }, // not yet
    { id: "t1", lineId: "tomyum", effectiveFrom: d("2026-09-01"), createdAt: d("2026-09-01") },
  ];

  it("one version per line: the latest that has started", () => {
    expect([...currentVersionIds(rows, d("2026-11-06"))].sort()).toEqual(["t1", "v2"]);
  });

  it("an earlier day is served by the version true then", () => {
    expect([...currentVersionIds(rows, d("2026-10-01"))].sort()).toEqual(["t1", "v1"]);
  });

  it("two versions from the same day: the one written later", () => {
    const same = [
      { id: "a", lineId: "x", effectiveFrom: d("2026-10-01"), createdAt: d("2026-10-01") },
      { id: "b", lineId: "x", effectiveFrom: d("2026-10-01"), createdAt: d("2026-10-02") },
    ];
    expect([...currentVersionIds(same, d("2026-10-05"))]).toEqual(["b"]);
  });
});

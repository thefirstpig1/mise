import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // Part 23 (ADR 0023 Q4): deletes any tenant created during this run that
    // outlived its own afterAll — a dead worker leaves residue that no spec can
    // clean up after itself.
    globalSetup: ["./tests/support/global-sweep.ts"],
    // 60 s since 2026-10-30 (Kong: "เอาตามแนะนำ"): the production re-posting
    // specs take ~31 s each from the Mac at ~70 ms a round trip.
    testTimeout: 60_000,
    // A beforeAll seeds and an afterAll sweeps a whole tenant — as many round
    // trips to Neon as the tests themselves — yet ran on vitest's 10 s default.
    // Under a full parallel run they ran out first (2026-10-30: production-count's
    // sweep, after three sibling specs had each been given 180_000 by hand).
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

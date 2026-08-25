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
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

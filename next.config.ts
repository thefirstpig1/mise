import type { NextConfig } from "next";

/**
 * Emit a self-contained server at `.next/standalone` — IN THE CONTAINER ONLY.
 * (Sprint 7 Part 34, ADR 0033 Q3.)
 *
 * Standalone output is what lets the production image carry a traced subset of
 * node_modules instead of the whole install, and it is half of what makes the
 * host choice reversible: what gets pushed is an ordinary container, so moving
 * provider is changing a destination.
 *
 * 🔴 IT CANNOT BE ON BY DEFAULT, AND THE REASON IS WINDOWS. To build the
 * standalone tree Next recreates pnpm's symlink farm, and creating a symlink on
 * Windows needs Developer Mode or an elevated shell. Without it `next build`
 * dies with `EPERM: operation not permitted, symlink` — AFTER compiling and
 * type-checking successfully, which makes it read like a code failure when it
 * is a filesystem permission.
 *
 * That matters more than it looks: CLAUDE.md requires `pnpm build` for any work
 * touching a page, because tsc cannot see Next's generated route types. Turning
 * this on unconditionally would have taken that check away from every future
 * Part on this machine, to buy an artefact only the Dockerfile ever reads.
 *
 * The Dockerfile sets BUILD_STANDALONE=1. Nothing else does.
 */
const standalone = process.env.BUILD_STANDALONE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(standalone ? { output: "standalone" as const } : {}),
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;

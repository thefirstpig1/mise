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

/**
 * 🔴 THE SALES IMPORT HAS BEEN CAPPED AT 1 MB SINCE PART 19 AND NOBODY KNEW.
 *
 * Read from the framework's source, not its docs — `action-handler.js:434`:
 *
 *     const defaultBodySizeLimit = '1 MB'
 *     ...
 *     if (size > bodySizeLimitBytes) callback(new ApiError(413, ...))
 *
 * Part 19 declares `MAX_SALES_FILE_BYTES = 15 * 1024 * 1024` and checks it in
 * `readUploadedFile`, with a Thai message naming 15 MB. That check has never
 * been reachable for a file over 1 MB: Next rejects the Server Action first,
 * with an English 413, so a shop uploading a real month of per-bill POS data
 * sees a generic failure and the sentence we wrote for exactly this case is
 * dead code.
 *
 * ADR 0033 fact 3 lists "must accept requests up to 15 MB" as a property of
 * the deployment, which is what surfaced it.
 *
 * ABOVE the app's own limit, deliberately. If the two were equal, the file that
 * is a byte too big would be refused by the framework in English rather than by
 * `readUploadedFile` in Thai. The app owns the refusal; this only stops the
 * framework owning it first. `tests/upload-limits.test.ts` pins the ordering.
 */
const SERVER_ACTION_BODY_LIMIT = "16mb";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(standalone ? { output: "standalone" as const } : {}),
  experimental: {
    typedRoutes: true,
    serverActions: {
      bodySizeLimit: SERVER_ACTION_BODY_LIMIT,
    },
  },
};

export default nextConfig;

# syntax=docker/dockerfile:1

# ============================================================
# Mise — production image  (Sprint 7 Part 34, ADR 0033)
# ============================================================
# WHY THIS FILE EXISTS AT ALL, AND IT IS NOT A TECHNICAL REASON.
#
# The host choice sat blocked for months because it felt irreversible. Building
# an ordinary container makes changing provider a matter of changing where the
# push goes, so a wrong choice costs an hour instead of a rewrite (ADR 0033 Q3).
# Everything else here is in service of that.
#
# It also closes two holes the grill found: there is no `postinstall` and no
# `prisma generate` script in package.json, so today's working client is an
# accident of `allowBuilds` in pnpm-workspace.yaml letting @prisma/client run
# its own postinstall. A host on another pnpm, or one passing --ignore-scripts,
# would get a STALE client with no error. This file calls `prisma generate`
# explicitly. And `engines` in package.json now pins the Node major.
# ============================================================

# Matches the version this project is developed and tested on. One place to
# change it; `engines` in package.json is the guard that the host agrees.
ARG NODE_VERSION=24.15.0


# ------------------------------------------------------------
# base — Debian, not Alpine, and that is a Prisma constraint
# ------------------------------------------------------------
# Prisma ships a different query engine binary per libc. Alpine is musl,
# Debian is glibc, and picking the wrong one fails at RUNTIME on the first
# query — not at build — which is the worst place to find out.
#
# node:*-slim does NOT include openssl, and Prisma's engine needs libssl to
# start. Without it the failure is again at runtime, and it reads as a
# database problem rather than a missing package.
FROM node:${NODE_VERSION}-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app


# ------------------------------------------------------------
# deps — install with a FLAT node_modules, deliberately
# ------------------------------------------------------------
# pnpm's default symlink layout puts the generated Prisma client inside
# node_modules/.pnpm/@prisma+client@.../node_modules/.prisma — a path that
# carries a version in it. Every later COPY would have to know that string,
# and would break silently on a Prisma bump.
#
# `--node-linker=hoisted` gives the npm-style flat tree for the IMAGE ONLY.
# The lockfile is linker-agnostic, so this changes nothing about which
# versions are installed, and nothing at all about local development.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --node-linker=hoisted


# ------------------------------------------------------------
# builder — generate the client, then build
# ------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Explicit, for the reason in the header. Runs on this image, so the engine
# binary it downloads is the one the runtime image will actually load.
RUN pnpm exec prisma generate

# `next build` imports src/lib/db.ts through the page graph, which constructs
# a PrismaClient at module scope. That construction wants a URL to be present;
# it never opens a connection during a build. This placeholder satisfies the
# parser and is overwritten at runtime by `fly secrets`.
#
# 🔴 If a real URL ever ends up here it would be baked into a layer. It must
#    stay obviously fake.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?sslmode=disable"
ENV DIRECT_URL="postgresql://build:build@127.0.0.1:5432/build?sslmode=disable"
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
RUN pnpm build


# ------------------------------------------------------------
# runner — what actually ships
# ------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The `node` user exists in the base image already. Running as root would let
# a code-execution bug write to the image; there is no reason to.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# --- the app -------------------------------------------------
# `output: 'standalone'` produces a server plus the traced subset of
# node_modules it needs. static/ and public/ are NOT traced and must be
# copied separately — a missing static/ is a site with no CSS and no error.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 🔴 The trace misses Prisma's engine. It is a .node binary loaded by a path
#    computed at runtime, which static analysis cannot follow, and the failure
#    is "Query engine library for current platform could not be found" on the
#    first request. Copy it in by hand.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# --- what `release_command` needs (ADR 0033 Q9) --------------
# Fly runs the release command IN THIS IMAGE, before the new version goes
# live, and cancels the deploy on a non-zero exit. That is what makes
# forgetting the manual SQL structurally impossible — but only if the tools
# are actually here.
#
# `prisma` is the CLI (migrate deploy, db execute); @prisma/engines carries
# the schema/migration engine binaries, which are separate from the query
# engine above. The scripts are plain .mjs on purpose: tsx is a
# devDependency and does not belong in a production image, and the ordered
# file list must be ONE list shared by the script and its test.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts/apply-manual-sql.mjs ./scripts/apply-manual-sql.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/manual-sql-order.mjs ./scripts/manual-sql-order.mjs

USER nextjs
EXPOSE 3000

# server.js is what standalone emits. Not `next start` — that needs the full
# next CLI, which standalone deliberately does not ship.
CMD ["node", "server.js"]

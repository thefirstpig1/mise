# Mocking Guidelines

## Default: Don't Mock

Most tests should hit real implementations. Mocking is a last resort.

## When mocking is OK

- **External services** (Stripe, email providers, POS APIs)
- **Time** (Date.now, setTimeout) — use Vitest's fake timers
- **Random** (crypto.randomUUID) — for deterministic tests

## When mocking is NOT OK

- Database — use a test database instead (Neon branch or local Postgres)
- Internal functions — refactor instead
- Prisma — use real Prisma against test DB
- Auth — use a test user, not mocked session

## Mise-specific

For Mise, mock:
- Email sending (Auth.js magic link — log to console in dev)
- POS API calls (Sprint 4+) — use recorded responses
- External price feeds (if added later)

For Mise, DON'T mock:
- Prisma queries (use real Neon test branch)
- withTenantContext (use real tenant IDs)
- RLS policies (test against real DB to verify)

The whole point of Mise's RLS architecture is that it works at DB level — mocking Prisma would test imagination, not reality.

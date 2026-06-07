---
status: accepted
---

# Neon requires both pooled and direct connection URLs

Mise's .env declares both DATABASE_URL (pooled, ends with -pooler) and DIRECT_URL (direct, no -pooler). schema.prisma datasource declares both `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`. Prisma uses pooled for runtime queries (faster, recommended for serverless) but switches to direct for migrations (pooled doesn't support advisory locks or prepared statements). Discovered after ~1 hour of P1001 debugging in Sprint 1.

## Consequences

- Two URLs to maintain in .env (slight friction)
- Migrations work; runtime queries are fast
- If we ever move off Neon, may not need this pattern

Related: known-pitfalls #18, Sprint 1 Part 3a debugging

---
status: accepted
---

# User.id uses cuid, all other IDs use uuid

The User model uses `id String @id @default(cuid())` while all other models use `id String @id @default(uuid()) @db.Uuid`. Foreign keys referencing User must use String type without @db.Uuid. This is because Auth.js v5 Prisma Adapter hardcodes its tables (Account, Session) to use cuid String for userId — using uuid would cause foreign key type mismatch.

## Considered Options

- **All uuid**: fails because Auth.js tables expect cuid String userId
- **All cuid**: works but loses uuid benefits for non-auth tables (better for distributed systems, indexable)
- **Hybrid (chosen)**: User=cuid (Auth.js compat), others=uuid (Mise standard)

## Consequences

- Visual inconsistency in IDs (cuid vs uuid)
- FK to User must use plain String (no @db.Uuid)
- All FK validation must remember this exception
- If we ever switch off Auth.js, can migrate User to uuid

Related: Sprint 0 debugging session, known-pitfalls #5

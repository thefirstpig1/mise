# When to consult Mise spec

Read this skill when working on schema changes, business logic, or
implementation patterns. The spec is authoritative — when in doubt, check it.

## Spec locations
- Main spec: docs/master-spec.md (consolidated; Parts I-V)
- Quick ref: docs/master-spec-summary.md (schema inventory + section index)
- Decision history: docs/changelog-v5-summary.md (60 locked decisions #1-60)

**Precedence:** where the spec conflicts with an ADR in docs/adr/, the ADR wins —
see CLAUDE.md → "Source-of-truth precedence".
- Pending features: docs/pending-features-v1.5.md (Price Volatility + Menu Lab)

## When to read each section
- Section 5 (Schema): Before adding/modifying any table
- Section H.1 (Tenant Init): When working on signup/onboarding
- Section H.2 (PO/GR triggers): Sprint 2 procurement work
- Section H.3 (GR shortage): Sprint 2-3 procurement work
- Section H.4 (PermissionService): Any authorization logic
- Section H.5 (CONSUMPTION + Yield): Sprint 3+ stock movement
- Section H.6 (Dept lifecycle): Department CRUD
- Section H.7 (Mat view freshness): Sprint 6 dashboards
- Section H.8 (Variance view): Sprint 6 dashboards
- Section H.9 (Cost cascade): Sprint 5 recipe/cost
- Section H.10 (RLS): EVERY new tenant-scoped table

## Key sprint scope
- Sprint 1: Section 5.2 (Master Data) + 5.13 (Units/Density) + H.1.2 (Categories seed)
- Sprint 2: Section 5.3 (Procurement)
- Sprint 3: Section 5.4 (Expense) + 5.5 (Inventory)
- Sprint 4: Section 5.6 (Sales sync)
- Sprint 5: Section 5.7 (Cost engine) + H.9
- Sprint 6: Section 5.14 (Matrix) + H.7 + H.8
- Sprint 7: Polish + tests

# Mise Master Spec — Summary

**Full spec:** `docs/master-spec.md` (in-repo, consolidated — Parts I–V).
This file is a navigation aid only; the full spec is authoritative over it,
and an ADR in `docs/adr/` is authoritative over both (see CLAUDE.md →
"Source-of-truth precedence").

## Schema Inventory

Per master-spec.md §4 — designed: **41 tables + 2 reference tables + 3 materialized views.**

Built so far (`prisma/schema.prisma`, 19 models): the 2 reference tables, all 7
Identity, all 5 Master Data, `stock_movement` + `stock_adjustment`, plus 3 Auth.js
infrastructure tables (`account`, `session`, `verification_token`) that the spec
inventory does not count. No materialized view exists yet.

### Reference (2, read-only seed)
- unit_template, liquid_density_template

### Identity (7) — Sprint 0 COMPLETE
- tenant, branch, app_user, tenant_membership
- user_branch_access, department, user_department_assignment

(`app_user` is the DB table; the Prisma model is `User` / `prisma.user` via
`@@map("app_user")` — never `prisma.appUser`. Auth.js requires the model name.)

### Master Data (5) — Sprint 1 COMPLETE
- supplier, category, product, product_unit, supplier_product_mapping

### Menu & Recipe (6) — Sprint 4-5
- menu, menu_branch_override, recipe, recipe_branch_override
- recipe_ingredient, recipe_change_diff

### Procurement (8) — Sprint 2
- purchase_request, purchase_request_item
- purchase_order, purchase_order_item, purchase_order_item_allocation
- goods_receipt, goods_receipt_item, goods_receipt_item_allocation

### Expense (2) — Sprint 3
- expense, expense_item

### Inventory (5) — Sprint 2-3
- stock_count, stock_count_item, stock_count_entry, stock_movement, stock_adjustment

⚠️ **stock_movement: follow ADR 0011, not spec §5.5.** The spec's
`movement_type` / `qty_delta` shape is the Sprint 1 legacy design.
ADR 0011 (Append-Only Ledger) is authoritative for Sprint 2+: signed `qty`
with DB CHECK by type, polymorphic source ref, unique(source_type, source_id)
idempotency, insert-only with compensating entries, realtime SUM balance.
MVP types: `PO_RECEIVE` / `ADJUST_GAIN` / `ADJUST_LOSS`.
**`stock_adjustment`** came from Part 10 L1 and has no Section 5 definition yet.
Reconciling §5.5, H.5, H.8 and Section F to the ledger model is Sprint 2+ work.

### Sales Sync (3) — Sprint 4
- pos_integration, sales_import_batch, sales_transaction

### Cost Engine (3) — Sprint 5
- recipe_cost_snapshot, product_cost_history, category_cost_snapshot

### Audit / meta (2)
- audit_log, materialized_view_meta

### Materialized views (3)
- recipe_coverage_view, department_branch_cost_view, department_procurement_view

## Key architectural sections

- **Section A:** Hybrid branching (tenant default + per-branch override)
- **Section B:** Diff-and-resolve POS sync
- **Section C:** Cost confidence tiers (HIGH/MEDIUM/LOW)
- **Section D:** 6 anti-patterns to avoid
- **Section E:** Multi-unit system (g/kg/ml/l/count + density)
- **Section F:** Department × Branch matrix reporting
- **Section G:** VAT/WHT support (Thai-specific)
- **Section H.1:** Tenant initialization (Main dept + 16 categories)
- **Section H.2:** PO/GR allocation triggers
- **Section H.3:** GR shortage = pro-rate, excess = flag for review
- **Section H.4:** PermissionService (role × branch × dept)
- **Section H.5:** Auto-tag CONSUMPTION via menu.primary_department_id
- **Section H.6:** Department lifecycle (soft delete + remap UI)
- **Section H.7:** Hybrid mat view freshness (materialized + live UNION)
- **Section H.8:** Theoretical vs Actual variance view
- **Section H.9:** Cost cascade (mark stale + recompute on read)
- **Section H.10:** Tenant isolation via RLS (defense-in-depth)

⚠️ **H.5, H.8 and Section F assume the legacy consumption model.** They rely on
movement types (`RECIPE_CONSUME`, `WASTE`, `TRANSFER_*`) that ADR 0011 defers to
Sprint 3+/5+. They get reconciled to the ledger when their sprints land.

## 60 Decisions Locked

See docs/changelog-v5-summary.md for the full list.

Critical recent ones:
- #59: Yield math = qty × (100 / yield_percent), NOT qty × (1 + loss%)
- #60: DATE_TRUNC uses tenant timezone
- #55: RLS on every tenant-scoped table
- #54: Cost cascade = mark stale + recompute on read

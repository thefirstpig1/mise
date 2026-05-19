# Mise Master Spec v1.4 — Summary

**Full spec:** Google Drive ID 110FrOwFwzPbXsxDHUC_f-oqK8ld8a6utAKnrs5KLbfc

## Schema Inventory (44 tables total)

### Reference (3)
- unit_template, liquid_density_template, materialized_view_meta

### Identity (7) — Sprint 0 COMPLETE
- tenant, branch, app_user, tenant_membership
- user_branch_access, department, user_department_assignment

### Master Data (5) — Sprint 1
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

### Inventory (4) — Sprint 3
- stock_count, stock_count_item, stock_count_entry, stock_movement

### Sales Sync (3) — Sprint 4
- pos_integration, sales_import_batch, sales_transaction

### Cost Engine (3) — Sprint 5
- recipe_cost_snapshot, product_cost_history, category_cost_snapshot

### Audit (1)
- audit_log

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

## 60 Decisions Locked

See docs/changelog-v5.md for full list.

Critical recent ones:
- #59: Yield math = qty × (100 / yield_percent), NOT qty × (1 + loss%)
- #60: DATE_TRUNC uses tenant timezone
- #55: RLS on every tenant-scoped table
- #54: Cost cascade = mark stale + recompute on read

# Mise — Master Spec (Consolidated, current)

**Status:** Single source of truth. Consolidates the full version chain into one self-contained document.
**Reflects:** v1.0 (base) + v1.1 (departments) + v1.2 (VAT/WHT + dept opt-in) + v1.4 (functional correctness + RLS).
**Product:** Restaurant Back-Office Platform for Thailand SMEs — Architecture & Schema.

> **Source-of-truth precedence (read first):** When this spec conflicts with an ADR in `docs/adr/`, **the ADR wins** — ADRs come from grill decisions and are the more solid, more recent authority. Treat any divergence as the spec being stale, and reconcile the spec toward the ADR. This file is the broad architectural reference and may lag behind; ADRs are binding on the specifics they cover.

> Consolidation note: earlier Google Docs versions each stored only their *delta* (v1.4 was a 7 KB patch that referenced content living in v1.2/v1.1/v1.0). This file merges all four into current truth so nothing has to be cross-read. Section-by-section version lineage is summarized under "Version history" at the end.

---

## Table of Contents

- Part I: Foundations — Vision, Personas, Module Architecture, Schema Inventory
- Part II: Core Design — Database Schema, Permission Model, POS Integration, Onboarding
- Part III: Architectural Sections — A Branching · B Sync Conflict · C Cost Confidence · D Anti-patterns · E Units · F Dept×Branch Matrix · G Tax (VAT/WHT)
- Part IV: Operations — Decisions Log, Open Questions, Sprint Plan, Pre-publish Checklist
- Part V: Implementation Specifications — H.1–H.10

---

# Part I: Foundations

## 1. Vision & Positioning

**One-liner:** "MarketMan-for-Thailand-SME, but 90% cheaper, 90x faster to set up, and works even if you don't have recipes yet."

**Core principles:**
1. POS = source of truth for "menu list + sales" — Mise never pushes back to POS.
2. Recipe = optional enrichment — system delivers value at any recipe completeness.
3. Customers benefit from Day 1 — no recipe blocker required.
4. Trust through transparency — show confidence levels, never hide uncertainty.
5. Self-serve everything — no contract lock-in, cancel via UI, data export on exit.
6. Complexity is opt-in — single-store users never see department UI unless they enable it.

**Not competing with:** FoodStory, Wongnai POS, Ocha (front-of-house POS).
**Competing with:** Excel + manual + paper + confusion.
**Comparable to:** MarketMan, MarginEdge (US — no Thai equivalent exists).

**Value by recipe completeness:**

| Recipe coverage | What user gets |
| --- | --- |
| 0% (no recipe) | Procurement, expense, stock count, supplier price intel, category-level COGS% |
| Partial (top menus) | Above + per-menu cost for top sellers |
| Full (all menus) | Above + joint allocation, theoretical vs actual variance, ingredient-level alerts |

## 2. User Personas & Roles

```
TENANT (1 ร้าน หรือ 1 chain)
├─ BRANCH (สาขา)
├─ ROLES (system permissions):
│   ├─ Owner        → ดู dashboard, อนุมัติ PO ใหญ่
│   ├─ Manager      → จัดการทุกอย่าง, approve PO
│   ├─ Purchaser    → audit + ออก PO ไป supplier
│   ├─ Kitchen Staff→ request วัตถุดิบ, รับของ
│   ├─ Accountant   → ดู report, export
│   └─ Viewer       → ดูได้อย่างเดียว
└─ DEPARTMENTS (opt-in via tenant.enable_departments):
    ├─ If disabled: auto-default "Main" dept, hidden from UI
    └─ If enabled: Bar, Kitchen Hot, Kitchen Cold, Bakery, Service/FOH, ... (custom)
```

**Critical distinction:**
- **Role** = what you can DO (CRUD permissions). 1 user has exactly 1 role per tenant_membership.
- **Department** = what part of the business you BELONG TO (cost-center attribution). 1 user can belong to many departments (M:N).

## 3. Module Architecture

External POS layer feeds Mise Core; Mise Core feeds Output.

- **POS layer (external):** POS w/ recipe (FoodStory, Wongnai) → menu + recipe + sales; POS w/o recipe (Square, Loyverse) → menu + sales only.
- **Mise Core:** Identity & Tenant (+ Departments) · Master Data (Suppliers, Products, Categories, Units) · Menu (unified) · Recipe (optional) · Procurement (per dept) · Expense (per dept) · Stock Count · Sales Sync · Cost Engine (multi-tier fallback).
- **Output:** Dashboards (Dept × Branch matrix) · Alerts · Recipe Coverage Nudge.

Module MVP index: Identity, Master Data, Sales Sync, Menu, Recipe (optional), Procurement, Expense, Inventory, Cost Engine, Reports, Audit — all MVP.

## 4. Schema Inventory

**Total: 42 tables + 2 reference tables + 3 materialized views.**

**System reference (read-only seed):** `unit_template`, `liquid_density_template`.

**Identity:** `tenant`, `branch`, `user`, `tenant_membership`, `user_branch_access`, `department`, `user_department_assignment`.

**Master data:** `supplier`, `category`, `product`, `product_unit`, `supplier_product_mapping`.

**Menu & recipe:** `menu`, `menu_branch_override`, `recipe`, `recipe_branch_override`, `recipe_ingredient`, `recipe_change_diff`.

**Procurement:** `purchase_request` (+ `_item`), `purchase_order` (+ `_item`), `purchase_order_item_allocation`, `goods_receipt` (+ `_item`), `goods_receipt_item_allocation`.

**Expense:** `expense`, `expense_item`.

**Inventory:** `stock_count`, `stock_count_item`, `stock_count_entry`, `stock_movement`.

**Sales sync:** `pos_integration`, `sales_import_batch`, `sales_transaction`.

**Cost engine:** `recipe_cost_snapshot`, `product_cost_history`, `category_cost_snapshot`.

**Audit / meta:** `audit_log`, `materialized_view_meta`.

**Materialized views:** `recipe_coverage_view`, `department_branch_cost_view`, `department_procurement_view`.

---

# Part II: Core Design

## 5. Database Schema

### Naming conventions
- Every table: `id`, `created_at`, `updated_at`, `deleted_at` (soft delete).
- Tenant-scoped: `tenant_id` + index. Branch-scoped: `branch_id` + index (NOT NULL on operational tables).
- Department-aware: `department_id` (see 5.0).
- Money: `Decimal(15,4)`. Quantity: `Decimal(15,6)`. Date: `timestamptz`.

### 5.0 Schema constraints (DB-level)
- **`branch_id` NOT NULL** on: `purchase_request`, `purchase_order`, `goods_receipt`, `stock_count`, `stock_movement`, `sales_transaction`, `expense`.
- **`department_id` NOT NULL** on: `purchase_request` (when `enable_departments=true`, else defaults to "Main").
- **`department_id` NULLABLE** on: `expense_item` (null = shared/overhead), `stock_movement` (per movement_type), `purchase_order_item_allocation` / `goods_receipt_item_allocation` (always set in allocation rows).

### 5.1 Identity

**tenant** — `id` PK · `name` · `legal_name` · `tax_id` · `timezone` ("Asia/Bangkok") · `currency` ("THB") · `fiscal_year_start_month` int · `plan` enum(trial/basic/pro/enterprise) · `settings` jsonb · `enable_departments` bool default false · `is_vat_registered` bool default false · `vat_registration_no` string nullable · `default_vat_rate_percent` Decimal(5,2) default 7.00.

- `enable_departments` false → system auto-creates one "Main" dept on tenant creation, dept selectors hidden, all records default to Main. true → Section F unlocked. Toggle ON later → migration assigns existing users/records to Main; new depts addable. Toggle OFF after enabling → NOT recommended (warning modal).
- `is_vat_registered` false → VAT fields hidden, all VAT = 0. true → VAT fields visible, defaults applied (ภพ.30 in Phase 2).

**branch** — `id` · `tenant_id` FK · `name` · `code` · `address` · `is_active`.

**user** — `id` · `email` unique · `name` · `phone` · `auth_provider` enum(email/google/line).

**tenant_membership** — `id` · `tenant_id` · `user_id` · `role` enum(owner/manager/purchaser/kitchen_staff/accountant/viewer) · `is_active`.

**user_branch_access** — `id` · `tenant_membership_id` · `branch_id` · (unique pair).

### 5.2 Master data

**unit_template** (seed) — `id` · `unit_name` · `unit_dimension` enum(WEIGHT/VOLUME/COUNT) · `to_si_ratio` Decimal (g for WEIGHT, ml for VOLUME, null for COUNT) · `display_order_th/en` · (unique: unit_name). Pre-loaded: g(1), kg(1000), ขีด(100), oz(28.35), lb(453.59); ml(1), l(1000), cup(240), tbsp(15), tsp(5); ชิ้น/ฟอง/ใบ(count, null). Custom units (ถัง/ถุง/แพ็ค/ลัง/กล่อง/ขวด/กระป๋อง) are user-defined, not in template.

**liquid_density_template** (seed) — `id` · `name` · `ml_per_g` Decimal · `description` · `display_order`. Pre-loaded: น้ำเปล่า 1.00 (default), นมสด 0.97, เบียร์ 0.99, น้ำมันพืช 1.10, น้ำเชื่อม 0.77, ครีม 0.97, Alcohol 40% 1.07, น้ำตาลทรายเหลว 0.78, ซอสมะเขือเทศ 0.91, น้ำปลา 0.83. Default when unset: น้ำเปล่า (1.00, ~80% of cases).

**supplier** — `id` · `tenant_id` · `code` · `name_full` · `name_short` · `contact_name/phone/email` · `line_id` · `address` · `tax_id` · `payment_terms` · `is_active` · `is_vat_registered` bool default false · `default_vat_rate_percent` Decimal(5,2) nullable · `default_subject_to_wht` bool default false · `default_wht_rate_percent` Decimal(5,2) nullable. (VAT/WHT defaults auto-suggest at expense creation.)

**category** (3-tier) — `id` · `tenant_id` · `account` ("COGS") · `accounting_section` ("ครัวร้อน" — accounting categorization, distinct from the department entity; renamed from `dept_category`) · `group` ("เนื้อสัตว์") · (unique: tenant_id, account, accounting_section, group).

**product** — `id` · `tenant_id` · `sku` · `name` · `name_en` · `type` enum(RAW/PREPPED) · `primary_dimension` enum(WEIGHT/VOLUME/COUNT) · `category_id`. Liquids: `liquid_density_template_id` FK nullable, `density_ml_per_g_override` nullable. RAW only: `yield_percent` Decimal(5,2) (% usable after trim). PREPPED only (joint allocation): `parent_product_id` FK, `expected_yield_g`, `target_market_price`. Plus `image_url`, `is_active`, (unique: tenant_id, sku). Units live in `product_unit`, not here.

**product_unit** — `id` · `product_id` · `unit_name` · `unit_dimension` · `to_base_ratio` Decimal(15,6) · `is_base` bool · `is_default_buy_unit` bool · `source` enum(SYSTEM_TEMPLATE/USER_DEFINED) · `display_order` · (unique: product_id, unit_name). Constraints: exactly 1 base row and 1 default-buy row per product; base row ratio = 1.0; all rows of a product share one dimension.

**supplier_product_mapping** — `id` · `tenant_id` · `supplier_id` · `product_id` · `branch_id` NULLABLE (null = tenant default, set = branch override) · `supplier_item_code` · `supplier_item_name` · `order_unit_id` FK→product_unit · `current_unit_price` · `min_order_qty` · `lead_time_days` · `is_preferred` · `effective_from` · `effective_to` nullable · (unique: tenant_id, supplier_id, product_id, branch_id, effective_from). Branch-specific row wins over tenant default (ORDER BY branch_id NULLS LAST).

### 5.3 Procurement

**purchase_request** — `id` · `tenant_id` · `branch_id` NOT NULL · `department_id` NOT NULL (requesting dept) · `pr_number` · `status` enum(DRAFT/PENDING_APPROVAL/APPROVED/REJECTED/CONVERTED) · `requested_by_user_id` · `requested_at` · `needed_by_date` · `approved_by_user_id` · `approved_at` · `rejected_reason` · `converted_to_po_ids` UUID[] · `notes`. Validation: requester needs `user_department_assignment` for this dept with `can_request_for=true`.

**purchase_request_item** — `id` · `purchase_request_id` · `product_id` · `qty_requested` · `qty_approved` · `product_unit_id` · `suggested_supplier_id` · `notes`.

**purchase_order** — `id` · `tenant_id` · `branch_id` NOT NULL · `supplier_id` · `po_number` · `status` enum(DRAFT/SENT/PARTIALLY_RECEIVED/RECEIVED/CANCELLED) · `from_pr_ids` UUID[] (may span depts) · `created_by_user_id` · `sent_at` · `expected_delivery_date` · `subtotal_excl_vat` · `vat_rate_percent` nullable · `vat_amount` · `total_amount` (= subtotal + vat) · `wht_expected_amount` nullable · `net_payment_expected` (= total − wht_expected) · `pdf_url` · `notes`. PO header has no `department_id` — attribution lives at line allocation.

**purchase_order_item** — `id` · `purchase_order_id` · `product_id` · `supplier_product_mapping_id` · `qty_ordered` (total across depts) · `product_unit_id` · `unit_price` (excl VAT) · `line_total` · `qty_received`.

**purchase_order_item_allocation** — `id` · `purchase_order_item_id` · `department_id` NOT NULL · `qty_allocated` · `source_pr_id` nullable. Constraint: SUM(qty_allocated per po_item) MUST equal po_item.qty_ordered (enforced by deferrable trigger pair — see H.2).

**goods_receipt** — `id` · `branch_id` NOT NULL (denormalized from PO) · `purchase_order_id` · `gr_number` · `status` enum(DRAFT/CONFIRMED) · `received_by_user_id` · `received_at` · `invoice_image_url` · `invoice_no` · `has_discrepancy` · `notes` · `auto_created_expense_id`.

**goods_receipt_item** — `id` · `goods_receipt_id` · `purchase_order_item_id` · `qty_received_actual` · `product_unit_id` · `unit_price_actual` · `line_total_actual` · `variance_qty` (computed) · `variance_price` (computed) · `notes`.

**goods_receipt_item_allocation** — `id` · `goods_receipt_item_id` · `department_id` NOT NULL · `qty_allocated_actual` (renamed from `qty_received_actual` to avoid parent-table collision) · `source_po_allocation_id` FK→purchase_order_item_allocation. Shortage → pro-rate or manual adjust at GR time (H.3); excess → flag for manager review (H.3).

### 5.4 Expense

**expense** — `id` · `tenant_id` · `branch_id` NOT NULL · `supplier_id` nullable · `source` enum(MANUAL/FROM_GOODS_RECEIPT) · `source_gr_id` · `bill_date` · `bill_no` · `vat_invoice_no` nullable · `subtotal_excl_vat` · `vat_rate_percent` nullable (7/0/null) · `vat_amount` default 0 · `is_price_vat_inclusive` bool default true · `total_amount` · `subject_to_wht` bool default false · `wht_rate_percent` nullable · `wht_amount` nullable · `wht_certificate_no` nullable (50 ทวิ) · `net_payment_amount` (= total − wht) · `allocation_method` enum(MANUAL/SHARED_BY_REVENUE_RATIO/SHARED_EQUALLY) · `payment_method` · `payment_status` enum(UNPAID/PARTIAL/PAID) · `paid_at` · `bill_image_url` · `slip_image_url` · `notes`.

- VAT: if inclusive, `subtotal = total / (1 + rate)`; if exclusive, `total = subtotal × (1 + rate)`; null rate → no VAT.
- WHT: `wht_amount = total × rate/100`; `net_payment = total − wht` (tenant remits WHT via ภงด.53).
- allocation_method: MANUAL (split at item level); SHARED_BY_REVENUE_RATIO / SHARED_EQUALLY auto-create `expense_item`s per active dept **at creation time** (audit-friendly).

**expense_item** — `id` · `expense_id` · `category_id` · `department_id` NULLABLE (null = shared) · `product_id` nullable · `description` · `qty` · `product_unit_id` nullable · `unit_price` · `total_price` (excl VAT).

### 5.5 Inventory

**stock_count** — `id` · `tenant_id` · `branch_id` NOT NULL · `count_date` · `status` enum(DRAFT/COUNTING/REVIEW/CLOSED) · `started_by_user_id` · `closed_by_user_id` · `closed_at`. Per branch, not per department (physical inventory in shared storage).

**stock_count_item** — `id` · `stock_count_id` · `product_id` · `qty_in_base` (computed) · `unit_cost_at_count` · `total_value` · `counted_by_user_id` · `notes`.

**stock_count_entry** (multi-unit input) — `id` · `stock_count_item_id` · `product_unit_id` · `qty_in_unit` (what user typed) · `display_order`.

**stock_movement** — `id` · `tenant_id` · `branch_id` NOT NULL · `department_id` NULLABLE (logic below) · `product_id` · `movement_type` enum(RECEIPT/CONSUMPTION/ADJUSTMENT/TRANSFER/INTERDEPARTMENT_TRANSFER/WASTE) · `qty_delta` Decimal(15,6) (+in/−out) · `unit_cost` · `source_type` · `source_id` · `occurred_at` · `created_by_user_id` · `notes`.
- department_id logic: RECEIPT null (enters shared inventory); CONSUMPTION/WASTE required; INTERDEPARTMENT_TRANSFER → 2 rows (−qty dept A, +qty dept B); ADJUSTMENT null; TRANSFER (between branches) null on dept.
- Indexes (v1.4): `idx_stock_movement_pos_idempotent` UNIQUE ON (source_type, source_id, product_id) WHERE source_type='sales_transaction' — partial so manual ADJUSTMENT/WASTE may repeat.

> ⚠️ **ADR 0011 is authoritative for stock_movement — the shape above is superseded.** The `movement_type` / `qty_delta` definition above is the Sprint 1 legacy shape kept for historical reference only. For all Sprint 2+ implementation, follow **ADR 0011 (Stock Movement — Append-Only Ledger)**: signed `qty` + DB CHECK constraint by type, polymorphic source ref (`source_type` + `source_id`, no FK), unique(source_type, source_id) idempotency, occurred_at + created_at, strict insert-only with compensating-entry corrections, realtime SUM balance, and negative-balance-allowed-with-confirm. MVP types are `PO_RECEIVE` / `ADJUST_GAIN` / `ADJUST_LOSS`.
>
> Because of this, downstream sections that assume the legacy consumption model — H.5 (CONSUMPTION auto-tagging), H.8 (variance from CONSUMPTION+WASTE), and Section F inter-dept transfers — describe movement types that ADR 0011 defers to Sprint 3+/5+ (`RECIPE_CONSUME`, `WASTE`, `TRANSFER_*`). Those sections will be reconciled to the ledger model when their sprints land; until then, ADR 0011 governs the ledger's core shape and any conflict resolves in the ADR's favor.

### 5.6 Sales sync

**pos_integration** — `id` · `tenant_id` · `branch_id` · `pos_type` enum(foodstory/wongnai/ocha/storehub/loyverse/custom) · `name` · `config` jsonb · `api_credentials` jsonb (encrypted) · `last_sync_at` · `is_active`.

**sales_import_batch** — `id` · `pos_integration_id` · `imported_at` · `row_count` · `status` enum(PROCESSING/SUCCESS/PARTIAL/FAILED) · `raw_file_url` · `error_log` jsonb.

**sales_transaction** — `id` · `tenant_id` · `branch_id` NOT NULL · `import_batch_id` · `pos_transaction_id` · `pos_bill_id` · `transaction_at` · `channel` enum(dine_in/takeaway/delivery_lineman/delivery_grab/online_order/other) · `table_no` · `staff_id_at_pos` · `pos_menu_id` · `pos_menu_name` · `menu_id` FK (mapped) · `qty` · `unit_price` · `discount_amount` · `net_amount` · `bill_subtotal` · `bill_discount` · `bill_service_charge` · `bill_vat` · `bill_total` · `payment_method` · `raw_data` jsonb. Indexes: `idx_sales_transaction_pos_idempotent` UNIQUE ON (pos_integration_id, pos_transaction_id). Service charge distribution to staff is recorded as a Labor expense (Decision #39).

### 5.7 Cost engine

**recipe_cost_snapshot** — `id` · `recipe_id` · `computed_at` · `ingredient_cost` · `labor_cost` · `total_cost` · `cost_per_yield_unit` · `breakdown` jsonb · `is_stale` bool default false · `stale_reason` varchar(100) · `stale_at` timestamp. Index `idx_recipe_cost_snapshot_stale` WHERE is_stale=true. (Stale-on-write, recompute-on-read — see H.9.)

**product_cost_history** — `id` · `product_id` · `effective_date` · `cost_per_base_unit` · `source` ("from_purchase"/"computed_from_recipe") · `source_id`.

**category_cost_snapshot** — `id` · `tenant_id` · `branch_id` nullable (null = tenant aggregate) · `category_id` · `price_tier` enum(LOW/MID/HIGH/ALL) · `window_start/end` · `sample_size` · `total_purchase` · `total_sales` · `avg_cost_ratio` · `std_dev_cost_ratio` · `confidence_level` enum(HIGH/MEDIUM/LOW/INSUFFICIENT_DATA) · `confidence_reason` · `computed_at` · (unique: tenant_id, branch_id, category_id, price_tier, window_end).

### 5.8 Audit / meta

**audit_log** — `id` · `tenant_id` · `user_id` · `entity_type` · `entity_id` · `action` enum(CREATE/UPDATE/DELETE/APPROVE/REJECT/…) · `changes` jsonb {before, after} · `ip_address` · `occurred_at`.

**materialized_view_meta** (v1.4) — `view_name` varchar(100) PK · `computed_at` NOT NULL · `refresh_duration_ms` int · `last_refresh_status` varchar(20) default 'success'. Seeded for recipe_coverage_view, department_branch_cost_view, department_procurement_view. (No RLS needed — reference table.)

### 5.9 Menu & recipe

**menu** — `id` · `tenant_id` · `source` enum(POS/MISE) · `pos_integration_id` nullable · `pos_menu_id` nullable · `name` · `name_en` · `sku` · `category_id` nullable (fallback for no-recipe cost) · `pos_category_name` · `sale_price` · `recipe_status` enum(NO_RECIPE/HAS_RECIPE/RECIPE_STALE) · `recipe_id` nullable (active version) · `primary_department_id` FK nullable (which dept earns revenue) · `is_pos_stub` bool default false (v1.4, auto-created for unknown POS menu) · Layer-1 POS mirror: `pos_raw_snapshot` jsonb, `pos_sync_source`, `last_pos_synced_at` · `is_active` · `pos_image_url` · (unique: pos_integration_id, pos_menu_id WHERE source=POS).
- primary_department_id: auto-suggested from category → most common dept; user can override. When `enable_departments=false` all menus default to "Main", field hidden.
- pos_raw_snapshot holds the full raw POS payload at last sync — the "before" state for sync-conflict diff (Section B).

**recipe** — `id` · `tenant_id` · `menu_id` nullable · `output_product_id` nullable (prepped) · `version` · `is_active` (1 active per menu/product) · `source` enum(POS_SYNCED/MISE_BUILDER/BULK_IMPORT) · `yield_qty` · `yield_unit` ("serving"/"g") · `labor_minutes` · `notes` · `created_by_user_id`. Constraint: (menu_id IS NOT NULL) XOR (output_product_id IS NOT NULL). Concurrency: partial unique index UNIQUE(menu_id) WHERE is_active=true + advisory lock on version swap.

**recipe_ingredient** — `id` · `recipe_id` · `product_id` nullable · `ref_recipe_id` nullable (recursive, for prepped) · POS fallback: `pos_ingredient_name`, `pos_ingredient_code`, `match_status` enum(MATCHED/UNMATCHED/AMBIGUOUS) · qty: `qty_in_unit` (typed), `product_unit_id` nullable, `qty_in_base` (computed) · override tracking: `pos_original_qty` (null if MISE_BUILDER), `last_user_edit_at` · `yield_override_percent` nullable · `notes`. is_user_modified = (pos_original_qty IS NOT NULL AND qty_in_unit != pos_original_qty) OR last_user_edit_at IS NOT NULL.

### 5.10 Branch overrides

**menu_branch_override** — `id` · `menu_id` · `branch_id` · `sale_price_override` nullable · `is_available_override` nullable · `recipe_id_override` nullable · `created_by_user_id` · (unique: menu_id, branch_id).

**recipe_branch_override** — `id` · `recipe_id` · `branch_id` · `ingredient_overrides` jsonb · `created_by_user_id`.

### 5.11 category_cost_snapshot
See 5.7 (grouped with cost engine).

### 5.12 recipe_change_diff (sync conflict)
`id` · `menu_id` · `triggered_by` enum(POS_SYNC/USER_EDIT) · `triggered_at` · `diff_type` enum(INGREDIENT_ADDED/INGREDIENT_REMOVED/QTY_CHANGED/UNIT_CHANGED) · `ingredient_pos_name` · `before_state` jsonb · `after_state` jsonb · `status` enum(PENDING/APPLIED/IGNORED/MERGED) · `resolved_by_user_id` · `resolved_at` · `resolution_notes`.

### 5.13 recipe_coverage_view (materialized)
Revenue-weighted (primary) + count-based (secondary) coverage per tenant/branch, over active menus with a rolling-30-day sales join. Display: "Recipe covers 78% of revenue (12/50 menus)". Refresh hourly.

### 5.14 Department tables

**department** — `id` · `tenant_id` · `name` ("Bar"/"Kitchen Hot") · `code` ("BAR"/"KH") · `description` · `parent_dept_id` FK nullable (nested: "Kitchen" → "Kitchen Hot/Cold") · `is_active` · `display_order` · (unique: tenant_id, code). Belongs to TENANT, not branch — all branches share the dept list; "Bar at ทองหล่อ" = dept_id=BAR + branch_id=thonglor in operational tables.

**user_department_assignment** — `id` · `tenant_membership_id` · `department_id` · `is_primary` · `can_request_for` · `can_approve_for` · `can_receive_for` · (unique: tenant_membership_id, department_id).

**department_branch_cost_view** (materialized, revenue-enabled) — FULL OUTER JOIN of expense-by-dept-branch (from expense/expense_item) and revenue-by-dept-branch (from sales_transaction → menu.primary_department_id), giving `total_expense`, `total_revenue`, `gross_profit` per tenant/branch/department/period_month. Enables the Cost / Revenue / GP matrix per cell.

**department_procurement_view** (materialized) — PO-based attribution: per tenant/branch/department/product/period, `qty_ordered`, `amount_ordered`, `po_count` from purchase_order → item → allocation.

## 6. Permission Model

| Role | PR (own dept) | PR (other dept) | PO | GR (own dept) | Expense | Stock | Master | Recipe | Reports |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Owner | RW | RW | RW | RW | RW | RW | RW | RW | RW (all) |
| Manager | RW | R + approve (assigned depts) | RW | RW | RW | RW | RW | RW | RW (assigned) |
| Purchaser | R + approve | R + approve | RW | R | R | R | R | R | R |
| Kitchen Staff | RW (own) | — | — | RW (own dept) | — | RW | — | — | — |
| Accountant | R | R | R | R | RW | R | R | — | RW |
| Viewer | R | R | R | R | R | R | R | — | R |

- Department-scoped: Kitchen Staff sees only their assigned depts; Manager per `can_approve_for`.
- Branch-scoped via `user_branch_access` (independent). Both filters AND together: visible = branch access AND dept assignment.
- Full authorization algorithm + `role_permission` matrix + scope_filter → see H.4. Enforced defense-in-depth by RLS → see H.10.

## 7. POS Integration Strategy

| Tier | Examples | Pulls | Mode |
| --- | --- | --- | --- |
| High | FoodStory, Wongnai POS | menu + recipe + sales | Mode 1 (POS-driven) |
| Mid | Loyverse, Ocha, StoreHub | menu + sales | Mode 2 (Mise builds recipe) |
| Low | Square, simple POS | sales only | Mode 3 (aggregate, no recipe) |

MVP adapters: FoodStory (CSV + future API), Wongnai POS (CSV), Generic/Custom (visual mapper). MVP sync = CSV upload; API in Phase 2. Sync rules: menu upsert by pos_menu_id (store pos_raw_snapshot); recipe replace mirror (enrichment protected, mark STALE if differ); sales insert idempotent on pos_transaction_id; inventory read-only display. **Mise never writes back to POS.**

## 8. Onboarding Strategy

Promise: setup in ~30 min, value immediately even without recipes.

Setup wizard: (1) account + company info incl. VAT-registration question; (2) connect POS; (3) auto-import 30 days sales/menu/recipes; (4) top-10 suppliers incl. VAT/WHT defaults; (5) departments OPT-IN — "Does your business have multiple kitchens/departments?" — NO → silent "Main" dept, dept selectors never shown; YES → pick from suggestions (Bar/Kitchen/Bakery/…) or custom. Time: simple single-store ~25 min; multi-dept ~35 min. Stress-test benchmark (D.3): 3 branches × 200 menus × 30 suppliers must complete < 60 min. Adaptive quick wins surface insight based on what data exists (sales-only → top sellers; +PO → top spend; +recipes → margins; +stock count → variance).

---

# Part III: Architectural Sections

## Section A: Branching Model — Hybrid (Decision #16)
Master data at tenant level (menu, recipe, product, supplier); operational data at branch level (stock, sales, expense, PR/PO/GR); overrides per-branch + per-field; defaults work with zero overrides. Query with COALESCE(override, base). Supplier price override via nullable `branch_id` (branch-specific wins, NULLS LAST). Trade-off: extra override tables + LEFT JOINs, in exchange for single-store→chain flexibility.

## Section B: Sync Conflict Resolution — Diff & user resolves (Decision #18)
Three layers: L1 POS raw mirror (`menu.pos_raw_snapshot` JSONB, overwritten by sync); L2 Mise enrichment (protected, never auto-overwritten); L3 diff resolution (`recipe_change_diff` PENDING queue). Smart defaults: ingredient added → "add as RAW" + fuzzy-match; removed → remove; qty changed with no user override → auto-apply; qty changed with user override → prompt; unit changed → always prompt. Bulk resolution UI for migrations. Every resolution audit-logged.

## Section C: Cost Estimation Confidence Model — Range + confidence label (Decision #17)
Three-tier display: HAS_RECIPE → precise "฿18.50" (HIGH); NO_RECIPE + data → range "฿35–65"; NO_RECIPE + insufficient → "Unknown, add recipe". Rolling window default 30 days (7/30/90 configurable). Price tiers: LOW < ฿80, MID ฿80–150, HIGH > ฿150 (auto-derive from quantiles in Sprint 5 — O9). Confidence: HIGH (≥20 menus, ≥100 txns, σ≤0.10, ≥14 days), MEDIUM (≥10, ≥30, σ≤0.20), LOW (≥3, σ≤0.40), else INSUFFICIENT_DATA. Range = sale_price × (avg_cost_ratio ± std_dev). Pilot-validate thresholds before Beta.

## Section D: Anti-patterns to Avoid
D.1 Friction-free cancellation (month-to-month, self-serve, data export, 30-day grace). D.2 Clear support SLA (trial best-effort, paid <24h, enterprise <4h; Thai-first). D.3 30-min onboarding stress-tested (3×200×30 benchmark). D.4 No unauthorized auto-creation (sync = preview first; bulk needs confirm; 24h undo). D.5 No glitchy core features (ship at 95%+, show confidence, manual fallback, beta-flag). D.6 Pricing transparency (public pricing, no hidden fees, 14–30 day free trial no card).

## Section E: Unit & Conversion System — Multi-unit per product with templates (Decision #22)
Three layers: L1 system `unit_template` (WEIGHT g/kg/ขีด/oz/lb; VOLUME ml/l/cup/tbsp/tsp; COUNT ชิ้น/ฟอง/ใบ); L2 `liquid_density_template` (kg↔l for liquids, default น้ำเปล่า 1.0); L3 per-product `product_unit`. Product creation auto-creates dimension-appropriate units (WEIGHT → g base, kg buy; VOLUME → ml base, l buy + optional density; COUNT → ชิ้น). Custom units force ratio + preview. Cross-dimension example: 1.2 kg นมสด × (1/0.97) → 1,237 ml. Container examples: ถัง เบียร์ 19.5 l (ratio 19500), แพ็ค โค้ก 24 (COUNT 24), ลัง 12 แพ็ค (288). Validation: same dimension across a product's units; exactly one base (ratio 1.0) and one default-buy; custom units previewed before save.

## Section F: Department & Branch Matrix Reporting
Four aggregation slices: (1) dept X in branch Y (cell); (2) dept X across all branches (row); (3) all depts in branch Y (column); (4) grand total. Matrix UI shows Cost / Revenue / Gross Profit per cell, drill-down to bills/products, toggle Dept×Branch / Dept-only / Branch-only, filter by date/category/product. Default view permissions: Owner/Manager full matrix; Branch Manager their column; Department Head their row; Kitchen Staff their single cell. Cost attribution: GR auto-expense → split per `goods_receipt_item_allocation`; manual expense → user picks dept or NULL; utilities → typically NULL (shared); stock consumption/waste → `stock_movement.department_id`; inter-dept transfer → 2 movement rows (FROM/TO, manager-approved). Shared costs (dept NULL) show as "Shared (−)" row; MVP manual review, Phase 2 optional allocation rules.

## Section G: Tax Handling — VAT & WHT
**VAT** (7% standard; 0% zero-rated; exempt; register if turnover > ฿1.8M/yr): optional per tenant (`is_vat_registered`), tracked at expense-header level, supports inclusive & exclusive pricing. Captured: subtotal_excl_vat, vat_rate_percent, vat_amount, is_price_vat_inclusive, total_amount, vat_invoice_no. Output VAT from `sales_transaction.bill_vat`. MVP tracks data; Phase 2 generates ภพ.30.
**WHT** (withhold on certain services, remit monthly via ภงด.53, issue 50 ทวิ): per-expense (subject_to_wht + rate + amount + certificate_no + net_payment_amount). Common rates: general service 3%, rent 5%, advertising 2%, transport 1%, freelance 3–5%. Supplier defaults auto-apply, user can override. WHT independent of VAT registration.
**e-Tax invoice:** deferred to Phase 2 entirely, no MVP schema (Decision #38). **Service charge:** distributed to staff as a Labor expense with period notes, no separate fields (Decision #39).

---

# Part IV: Operations

## Decisions Log (1–60)

| # | Decision |
| --- | --- |
| 1 | Multi-tenant: row-level (tenant_id everywhere) |
| 2 | Neon Postgres (Singapore) over Supabase |
| 3 | Soft delete (deleted_at) all tables |
| 4 | Decimal for money + qty |
| 5 | Procurement 3-step (PR→PO→GR) |
| 6 | Joint allocation by market value |
| 7 | Recipe versioning (prepped + menu) |
| 8 | POS adapter pattern |
| 9 | Stock movement audit trail |
| 10 | Generated PO PDF |
| 11 | POS = SoT for menu/recipe; Mise = enrichment |
| 12 | Recipe is OPTIONAL — system works without it |
| 13 | Cost Engine multi-tier fallback |
| 14 | Unified menu table |
| 15 | Recipe Coverage prominent in UI |
| 16 | Branch model: Hybrid (tenant default + per-branch override) |
| 17 | Cost fallback: range + confidence + sub-grouping |
| 18 | Sync conflict: diff & user resolves |
| 19 | Recipe coverage: revenue-weighted primary + count secondary |
| 20 | Cost cascade: lazy MVP → async queue Phase 2 (see #54) |
| 21 | MarketMan anti-patterns built into core principles |
| 22 | Multi-unit per product with templates + liquid density defaults |
| 23 | Layer-1 mirror via JSONB on menu.pos_raw_snapshot (G1) |
| 24 | Supplier price branch override via nullable branch_id (G2) |
| 25 | branch_id NOT NULL on operational tables (G3) |
| 26 | User override tracking via pos_original_qty + last_user_edit_at (G4) |
| 27 | Department concept separate from Role (org unit vs permission) |
| 28 | User ↔ Department = many-to-many via user_department_assignment |
| 29 | PO line allocation via separate purchase_order_item_allocation table |
| 30 | Department × Branch matrix views (all 4 slices) |
| 31 | Shared expenses: department_id NULLABLE = shared (MVP); auto-alloc Phase 2 |
| 32 | Inter-department transfer = 2 stock_movement rows (INTERDEPARTMENT_TRANSFER) |
| 33 | Department belongs to TENANT (not branch) |
| 34 | VAT optional per tenant via is_vat_registered |
| 35 | VAT tracked at expense header level (not per-item) |
| 36 | VAT inclusive/exclusive flag at expense level |
| 37 | WHT schema in MVP; ภงด.53 generation Phase 2 |
| 38 | e-Tax invoice deferred to Phase 2 (no schema prep) |
| 39 | Service charge distribution = labor expense (no separate field) |
| 40 | Supplier VAT+WHT defaults auto-suggest at expense creation |
| 41 | Department feature opt-in via enable_departments (default false) |
| 42 | Menu revenue attribution via menu.primary_department_id |
| 43 | Shared expense allocation enum (MANUAL/REVENUE_RATIO/EQUALLY), items created at creation |
| 44 | Renamed category.dept_category → accounting_section |
| 45 | Renamed gr_item_allocation.qty_received_actual → qty_allocated_actual |
| 46–53 | v1.3 documentation pass: PermissionService API spec, sales-sync auto-tagging, department lifecycle (soft delete), materialized-view freshness, variance reporting view (detailed specs now in Part V H.4–H.8; original wording in Changelog & Decision History) |
| 54 | Cost cascade = mark stale via trigger + recompute on read; Phase 2 async queue |
| 55 | Tenant isolation via PostgreSQL RLS + app middleware SET LOCAL |
| 56 | GR excess receipt = flag for manager review (not auto-allocate) |
| 57 | Unknown POS menu = auto-create stub with is_pos_stub flag |
| 58 | Recipe recursion depth limit = 5 with circular detection |
| 59 | Yield math: raw_qty_needed = recipe_qty_in_base × (100 / yield_percent) |
| 60 | All DATE_TRUNC on user dates uses tenant timezone |

## Open Questions

| # | Question | Path |
| --- | --- | --- |
| O1 | Fuzzy-match confidence schema | MVP simple (MATCHED/UNMATCHED/AMBIGUOUS), add scoring later |
| O2 | Active recipe version concurrency | Advisory lock at code time |
| O3 | Mobile native app | Web-responsive first |
| O4 | OCR for invoices | Phase 2, ship at 95%+ |
| O5 | Accounting integration (FlowAccount/PEAK) | Phase 2 (Excel export covers MVP) |
| O6 | Vendor catalog (Makro/Lotus) | Phase 3 |
| O7 | AI recipe from photo | Phase 3 |
| O8 | LINE OA integration | Phase 2 |
| O9 | Price-tier auto-derive vs hardcoded ฿80/฿150 | Sprint 5 (quantiles) |
| O10 | category_cost_snapshot scaling at 1000+ tenants | Monitor; incremental if needed |
| O11 | Hybrid branch query perf at scale | Monitor; denormalize via mat view if slow |
| O12 | Sales revenue → department attribution | Resolved direction: sales → menu.primary_department_id |
| O13 | Auto-allocation rules for shared expenses | Phase 2 allocation_rule table |
| O14 | Cross-tenant department benchmarking | Phase 3 |
| O15 | Stock count location granularity | Phase 2 (pilot feedback) |
| O16 | Theoretical vs actual variance view | Sprint 6 (schema supports) — see H.8 |
| O17 | Service charge reconciliation report | Phase 2 |
| O18 | ภพ.30 generation | Phase 2 |
| O19 | ภงด.53 + 50 ทวิ generation | Phase 2 |
| O20 | Multi-currency support | Phase 2 (MVP = THB only) |
| O21 | Data retention / table partitioning | Monitor; partition when single-tenant rows > 1M |

## Sprint Plan (16 weeks, current / v1.4)

| Sprint | Weeks | Focus |
| --- | --- | --- |
| 0 | 1–2 | Foundation + Auth + Tenant + Branch + Dept opt-in + RLS (H.10) + PermissionService skeleton |
| 1 | 3–4 | Master Data + Units + Density + Categories |
| 2 | 5–7 | Procurement + PO/GR allocation + mirror triggers (H.2) + excess-receipt flag UI |
| 3 | 8–9 | Stock + Expense + yield-correct CONSUMPTION (H.5) + recursion guard + unknown-menu stub |
| 4 | 10–11 | POS Sync + mirror + diff queue + stub handling |
| 5 | 12–13 | Recipe + Cost Engine + cost cascade (H.9) + is_stale trigger |
| 6 | 14 | Dashboards + Matrix (tz-correct) + Variance (dept-sliced) + atomic mat-view refresh |
| 7 | 15–16 | Polish + Beta + stress-test + Permission/RLS/cross-tenant-leak test suites |

## Pre-publish Checklist (before any future spec version)
Every referenced table has a Section 5 definition; Schema Inventory count matches; flows/decisions reference valid names; prior decisions still apply or are explicitly superseded; no section contradicts another; open questions still open or resolved with a decision entry; Section D anti-patterns not violated; Section A/B/C/E/F/G considered where relevant; branch_id NOT NULL on new operational tables; opt-in features respect tenant flags; yield math uses corrected formula; DATE_TRUNC on user dates uses tenant tz; new tenant-scoped tables have an RLS policy; constraint triggers cover child AND parent updates; recursive refs have depth limit + cycle detection; mat views have a materialized_view_meta entry; ON CONFLICT clauses have a matching unique index.

---

# Part V: Implementation Specifications (Section H)

## H.1 Tenant Initialization & Seed Data
Sequence: (1) create tenant with defaults (enable_departments=false, is_vat_registered=false, default_vat_rate_percent=7.00, plan='trial'); (2) create tenant_membership (Owner); (3) auto-seed "Main" department; (4) auto-assign Owner to Main (all flags true); (5) auto-seed 16 default categories. No product_unit auto-seed (no products at tenant creation). Default categories: COGS/Food/{Meat, Seafood, Vegetables, Dry goods}; COGS/Beverage/{Coffee, Alcohol, Soft drinks}; COGS/Packaging/Single-use; OpEx/Utilities/{Electricity, Water, Internet}; OpEx/Rent/Building; OpEx/Labor/{Salary, Service charge}; OpEx/Marketing/Online ads; OpEx/Professional/Accounting (WHT 3%). Onboarding state in `tenant.settings.onboarding_state` (jsonb). enable_departments toggle: false→true keeps existing "Main" dept_id, new records use new depts; true→false not recommended (warning modal).

## H.2 PO/GR Allocation Constraint Enforcement
Constraint: SUM(allocation.qty) = parent.qty_ordered per po_item/gr_item. Two-trigger pattern: Trigger 1 on allocation table (INSERT/UPDATE/DELETE); Trigger 2 (v1.4) on parent po_item (UPDATE of qty_ordered). Both DEFERRABLE INITIALLY DEFERRED — checked at COMMIT. Mirror pair for GR. App pattern: update parent + delete + re-insert allocations in one transaction; both triggers validate together at COMMIT.

## H.3 GR Shortage & Excess Allocation
Default shortage: pro-rate by ratio — `gr_alloc.qty = po_alloc.qty / po_item.qty_ordered × gr_item.qty_received_actual`. Rounding tiebreaker: add remainder to the largest allocation; tiebreak by lowest id. Excess (received > ordered): FLAG FOR MANAGER REVIEW (not auto-allocate). UI offers: accept all + allocate proportionally / accept only PO amount (reject excess) / custom split (manager approval). Audit-log the choice + reason. Rationale: excess signals supplier error/substitution → needs human judgment.

## H.4 PermissionService API
```
interface PermissionService {
  canAccessResource(userId, resourceType, resourceId, action): Promise<boolean>;
  getListFilter(userId, resourceType, action): Promise<SQL>;   // Drizzle SQL fragment, NOT raw string
  canAccessResources(userId, resourceType, resourceIds, action): Promise<Record<UUID, boolean>>;
}
type Action = 'view' | 'create' | 'update' | 'delete' | 'approve' | 'receive';
```
Filters must be parameterized (no string interpolation) — use `and(eq(...), inArray(...), isNull(deleted_at))`. Authorization algorithm (8 steps): fetch user context → fetch resource → tenant match → role×resource×action (role_permission matrix) → branch access → department access with action-specific flag (create+PR → can_request_for; approve → can_approve_for; receive+GR → can_receive_for) → apply scope_filter → ALLOW. `role_permission` = (role, resource_type, action, is_allowed, scope_filter ∈ {NULL, own_dept, own_branch, own_record}). Test matrix: 50+ cases mandatory before Sprint 0 ends.

## H.5 Auto-tagging CONSUMPTION + Yield Math
**Yield math (critical fix):** yield is output/input. Raw needed = `recipe_qty_in_base × (100 / product.yield_percent)`. E.g. recipe needs 80 g cooked beef at 80% yield → 80 / 0.80 = 100 g raw (NOT 96 g). Algorithm per new sales_transaction: find menu → active recipe (no recipe → skip; unknown menu → stub per H, is_pos_stub); for each recipe_ingredient (with recursion guard): `raw_qty_per_serving = ri.qty_in_base / (product.yield_percent/100)`, `consumed_qty = raw_qty_per_serving × (st.qty / recipe.yield_qty)`; create stock_movement (CONSUMPTION, dept from menu.primary_department_id). Recursion depth limit = 5 with cycle detection. Idempotency: `INSERT ... ON CONFLICT (source_type, source_id, product_id) DO NOTHING` (uses partial unique index from 5.5).

## H.6 Department Lifecycle (Soft Delete)
Pre-delete validations: cannot delete "Main" (system-protected); active user assignments → manual unassign UI (explicit confirmation list, no silent cascade); pending PRs → resolve first; primary dept of active menus → bulk remap UI ("apply same to all" + transactional save). Two states: `is_active=false, deleted_at=NULL` (temporarily disabled, easy reactivate) vs `deleted_at=TIMESTAMP` (soft-deleted, requires restore). Historical records preserved; reports badge "{name} (inactive)".

## H.7 Materialized View Freshness
Use `GREATEST(created_at, updated_at)` to catch UPDATEs. Live view unions materialized data + live expense (last hour incl. updates) + live revenue. All DATE_TRUNC uses tenant timezone via `AT TIME ZONE (SELECT timezone FROM tenant WHERE id = ...)`. Atomic refresh via `refresh_mat_view_atomic(view_name)`: mark in_progress → REFRESH MATERIALIZED VIEW CONCURRENTLY → update materialized_view_meta → exception handling.

## H.8 Theoretical vs Actual Variance View
Theoretical (sales × recipes, combining yield + recipe.yield_qty): `SUM(st.qty × (ri.qty_in_base / r.yield_qty) × (100.0 / COALESCE(p.yield_percent, 100)))`. Actual from stock_movement CONSUMPTION+WASTE. Both CTEs carry department_id (theoretical via menu.primary_department_id, actual via stock_movement.department_id); FULL OUTER JOIN uses IS NOT DISTINCT FROM for NULL-safe dept matching. Dashboard sliceable by branch/department/period.

## H.9 Cost Cascade Strategy (mark stale on write, recompute on read)
Problem: a new product_cost_history row makes which recipe_cost_snapshots stale? Schema: recipe_cost_snapshot gains is_stale/stale_reason/stale_at + partial index WHERE is_stale=true. Trigger on product_cost_history INSERT marks snapshots stale for recipes using that product (direct or via ref_recipe, 2 levels); app marks deeper recursion on recipe save. getRecipeCost() checks is_stale → if stale, recompute + upsert (is_stale=false) → cache warm for next reads. Phase 2: async queue prioritized by usage frequency.

## H.10 Tenant Isolation via RLS (security-critical)
Defense-in-depth: PostgreSQL Row-Level Security on every tenant-scoped table (38 tables). Reference tables (unit_template, liquid_density_template, materialized_view_meta) need no RLS. Direct tenant_id policy:
```
CREATE POLICY tenant_isolation ON purchase_request
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```
Child tables (no tenant_id) use an EXISTS check against the parent. App middleware sets the context per request inside a transaction:
```
await db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL app.current_tenant_id = ${userTenantId}`);
  return handler(tx);
});
```
Admin bypass role `mise_admin BYPASSRLS` for migrations/support/monitoring only — never for normal requests. Mandatory tests: user from Tenant A cannot read Tenant B; missing app.current_tenant_id returns 0 rows (deny all). Perf: ~5–10% per-query overhead, mitigated by the required tenant_id index.

---

## Version history (lineage)
- **v1.0** — base: 38 tables, Sections A–E, decisions 1–26, units/density seed, cost confidence, sync conflict, branching.
- **v1.1** — Department system (department, user_department_assignment, PO/GR allocation tables), department_id on operational tables, Section F, permission model dept-scoping, decisions 27–33.
- **v1.2** — Department opt-in (enable_departments), VAT/WHT (Section G + tenant/supplier/PO/expense fields), menu.primary_department_id, expense.allocation_method, category.accounting_section rename, gr allocation rename, revenue in department_branch_cost_view, decisions 34–45.
- **v1.3** — documentation pass (Section H.4–H.8 specs), decisions 46–53, no schema change.
- **v1.4** — functional correctness: yield math fix, mirror triggers, mat-view freshness, cost cascade (H.9), RLS (H.10), materialized_view_meta, stock_movement/sales_transaction unique indexes, menu.is_pos_stub, recipe_cost_snapshot stale columns, decisions 54–60, O20–O21.

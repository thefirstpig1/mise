# Mise Project Glossary (CONTEXT.md)

Single source of truth for Mise-specific terminology. When a term is used in
chat, code, or docs, it MUST match the definition here. New terms get added
on resolution during /grill-with-docs sessions.

## Domain (Restaurant Operations)

- **Tenant** — a restaurant business that uses Mise (one customer = one tenant). Has at least 1 Branch.
- **Branch** — a physical restaurant location of a Tenant. A Tenant has 1+ branches.
- **Department** — internal grouping within a Tenant (e.g., Bar, Kitchen, Bakery). Optional feature — opt-in via tenant.enable_departments.
- **Main department** — default department auto-created on tenant signup (H.1.2). Used when departments are disabled.
- **Owner** — top-level role on a Tenant. Has all permissions including billing.
- **Manager** — full operational role, no billing access.
- **Purchaser** — can create PRs/POs/GRs and manage suppliers.
- **Kitchen staff** — can create PRs, count stock, confirm GRs.
- **Accountant** — view-only on operations + edit on financial.

## Master Data

- **Supplier** — vendor that sells products to a Tenant. Has VAT/WHT defaults.
- **Category** — 3-tier classification: account (COGS/OpEx) → accounting_section (Food/Beverage/etc) → group (Meat/Seafood/etc).
- **Product** — a purchasable or producible item. Two types:
  - **RAW** — bought as-is from supplier (e.g., whole salmon).
  - **PREPPED** — produced from a parent product via prep, with a yield (e.g., portioned salmon fillets). Has `parentProductId` pointing to a RAW **or** another PREPPED — chains are allowed up to depth 5 (Decision #58), enforced at product write-time by `assertParentValid` (live-only ancestor-walk + descendant-DFS + visited-set; rejects self-ref + cycles); see ADR 0007. Delete is blocked while live children exist.
- **Yield** — output/input ratio for PREPPED products (e.g., 80% yield = 1kg raw → 800g prepped). NOT loss percent.
- **Yield math** (Decision #59): `raw_qty = recipe_qty × (100 / yield_percent)` — NEVER `qty × (1 + loss%)`.
- **Type-change guard (deferred, Sprint 2+)** — `Product.type` is freely editable in Sprint 1 because no downstream feature references it yet (Sprint 1 Part 7c, Q6). Once procurement / recipe / stock start consuming `type`, add a write-time guard on changing it — same family as ADR 0005's base-unit-change guard and ADR 0006's multi-unit-referenced-by-mapping guard.
- **Unit** — measurement (g, kg, ml, l, ชิ้น, ฟอง, etc.). Pre-loaded as unit_template.
- **Base unit** — the single canonical unit a Product's stock is internally tracked in. Every Product has exactly one (a ProductUnit with isBase=true, toBaseRatio=1). User-picked from unit_template, not normalized to SI — cross-dimension math uses unit_template.toSiRatio instead.
- **Default buy unit** — the unit a Product is ordered/purchased in by default (ProductUnit.isDefaultBuyUnit). For a single-unit Product it equals the base unit.
- **Liquid density** — g/ml standard density for liquids (water=1.000, milk=1.030, cooking oil=0.910). Used to convert between WEIGHT and VOLUME for the same product; the math itself lives in the Sprint 2+ cost engine — **Part 7d is data-capture only**. Stored as either a foreign key to `liquid_density_template` **OR** a per-product `densityGPerMlOverride`, never both — XOR is enforced at zod (`.superRefine`), at the action-layer cleanse, AND by a Postgres CHECK constraint. Templates are **system-global, non-deletable, no tenant scope**; admin updates propagate via FK to all linked products on next read (no snapshot, no re-link needed). Density is only meaningful when `primaryDimension !== "COUNT"`; the UI hides the section, zod rejects, and the server cleanses density to null for COUNT-primary products (mirrors ADR 0007's PREPPED/RAW cleanse-before-validate ordering). See ADR 0008.
- **Multi-unit** — a product can have multiple units (e.g., milk in ml AND l AND ขวด).
- **Additional unit** — any non-base ProductUnit on a Product. Converts to the base unit via a product-specific `toBaseRatio` and shares the Product's dimension (same dimension as the base — cross-dimension is handled by Liquid density, not units). May use a custom packaging name not in unit_template (e.g. กระสอบ, ลัง, ขวด); the base unit, by contrast, must come from unit_template.
- **Unit source** — provenance of a ProductUnit's *name*: `system` (name matches a unit_template entry) or `custom` (free-text packaging name). Records where the name came from only; the `toBaseRatio` is always product-specific (1 ขวด of brand A milk ≠ brand B).
- **Supplier-Product Mapping** — a price-list entry linking a Supplier to a Product: the supplier's own item code/name, the unit it is ordered in (`orderUnit`, a ProductUnit of that product), current price, and procurement terms (min-order qty, lead-time, preferred flag), effective from a **calendar date** (`effectiveFrom`; the "when entered" timestamp lives separately in `createdAt`). Append-only **time-series**: entering a new price *supersedes* the previous one (the old row's `effectiveTo` closes; a new open row opens with `effectiveTo = null` = current). Overlapping date ranges are rejected; future-dated prices are allowed. Scoped either **tenant-default** (`branchId` null) or **branch override** (`branchId` set). **Preferred** = the default source for a product — at most one per product per branch-scope (app-enforced like Default buy unit). The PO / cost-engine consumer is Sprint 2; Part 8 is data-capture only. See ADR 0009.
- **Orphan mapping** — a Supplier-Product Mapping whose parent Supplier or Product has been soft-deleted. Tolerated by design (the data layer does not enforce referential *liveness*); surfaced via an "All" list filter, never crashes a read. In Part 8.5 the term narrows in the restore context to **kept-live orphans** — mappings the user chose to *keep* (`deletedAt IS NULL`) during the Part 8 cascade-with-control delete, as opposed to the cascade-soft-deleted ones; only kept-live orphans participate in restore (see Orphan-mapping reactivation).
- **Hide-not-delete** — in Part 8, "ลบ" a mapping (or soft-deleting its parent Supplier/Product, which cascades to the mappings after a blast-radius confirm) is a **soft-delete: hidden from active lists + the Sprint-2 PO consumer, but retained for audit/history** — financial records are never destroyed. **Part 8.5 adds the inverse** — Restore-on-recreate (see below). See ADR 0009.
- **Restore-on-recreate** — Part 8.5: a soft-deleted Product is **un-deleted at product-create time**, not via a separate trash screen. Typing a name (3+ chars, 400 ms debounce) runs a server-side Fuzzy match over the tenant's soft-deleted products; selecting a candidate re-uses its existing **ID** (idempotent `UPDATE … SET deletedAt=null` guarded by `deletedAt IS NOT NULL`), so every field reverts as-is and kept-live orphan mappings recover meaning through the unchanged FK. Resolves a Same-day overwrite and an optional `newSku` on SKU collision. No new audit surface (reuses `updatedAt` + the Part 8 history viewer). See ADR 0010.
- **Fuzzy match** — `pg_trgm` trigram similarity search used by Restore-on-recreate over soft-deleted products, scored `GREATEST(similarity(name), similarity(sku))` at **threshold 0.4**, top 10 (5 shown + "ดูเพิ่มอีก 5"). Each result carries a coarse badge (>0.7 ตรงกันมาก / 0.5–0.7 ใกล้เคียง / 0.4–0.5 อาจเกี่ยวข้อง — the raw decimal score is never shown) and a `matched_on` tag (name vs sku). Backed by two partial GIN indexes (`gin_trgm_ops`) `WHERE deleted_at IS NOT NULL`.
- **Orphan-mapping reactivation** — Part 8.5: when a Product is restored, its **kept-live** orphan mappings regain operational meaning automatically (the FK never changed — no separate write). Cascade-soft-deleted mappings stay deleted (respecting the earlier Part 8 cascade choice; reviving them = manual re-creation). If kept-live orphans exist, restore **forces a price-review step** (Option C, no threshold): per-mapping radio defaulting to ใช้ราคาเดิม, or อัปเดต to supersede price/min-qty/lead-time. See ADR 0010.
- **Same-day overwrite** — Part 8.5 (Option ε): when a restore-time mapping price update targets a row whose `effectiveFrom = today` (Bangkok UTC+7, Decision #60), the row is **updated in place** rather than superseded — a zero-duration price that never backed a real transaction has no audit value. Older rows (`effectiveFrom < today`) follow the ADR 0009 supersede pattern (close old `effectiveTo`, insert new open row). A deliberate narrow exception to the append-only time-series rule. See ADR 0010.

## Procurement

- **PR (Purchase Request)** — internal request to buy something. Pre-purchase document.
- **PO (Purchase Order)** — formal order sent to supplier. PR can become PO after approval.
- **GR (Goods Receipt)** — record of actual goods received. Compared against PO for shortage/excess.
- **GR shortage** — received less than PO. Resolution: pro-rate cost across received qty (Decision #46).
- **GR excess** — received more than PO. Resolution: flag for manager review (Decision #56).
- **Allocation** — which PR/PO line each GR line satisfies (many-to-many via allocation tables).
- **Mirror trigger** — DB trigger that updates dependent rows when PR/PO/GR confirmed (H.2).

## Inventory

- **Stock count** — physical count of inventory at a point in time.
- **Stock movement** — log of all stock changes (CONSUMPTION, GR, WASTE, TRANSFER, ADJUSTMENT).
- **CONSUMPTION** — stock decrement from a sale (auto-generated when POS sales tag a menu).
- **Yield-correct consumption** — CONSUMPTION uses parent (RAW) qty when menu uses PREPPED ingredient (H.5).

## Sales & POS

- **POS Sync** — pulling sales transactions from POS systems (Square, Foodify, Wongnai, etc.).
- **Diff-and-resolve** — sync strategy where Mise compares POS data against local DB and resolves differences (Section B).
- **Mirror** — Mise's local copy of POS data, kept in sync via Diff-and-resolve.
- **Stub menu** — auto-created menu when POS sends an item Mise doesn't recognize (Decision #57).

## Cost Engine

- **Recipe** — formula for a menu (list of products + quantities).
- **Recipe cost** — sum of ingredient costs (uses latest product_cost_history).
- **Cost confidence** — HIGH/MEDIUM/LOW marker on recipe cost (Section C):
  - HIGH = all ingredients have recent GR price
  - MEDIUM = some ingredients have old GR price
  - LOW = some ingredients have no GR price (uses target_market_price as fallback)
- **Cost cascade** — when a RAW product's cost changes, all PREPPED + recipes using it are marked stale and recomputed on read (H.9, Decision #54).
- **Recipe recursion depth** — max 5 levels of PREPPED-from-PREPPED (Decision #58).

## Architecture

- **RLS (Row-Level Security)** — Postgres feature enforcing tenant_id filter at DB layer. Defense-in-depth (H.10, Decision #55).
- **withTenantContext** — Prisma helper that sets `app.current_tenant_id` for RLS to use.
- **Tenant isolation** — guarantee that Tenant A cannot read/write Tenant B's data, even with bugged app code.
- **Branch override** — pattern where tenant-default settings can be overridden per-branch (Section A). First concrete use: **Supplier-Product Mapping** — `branchId` null = tenant default, `branchId` set = branch override; the branch-specific row **wholly replaces** the default for that branch (lookup tries branch-specific first, then falls back to the tenant default), not a field-level merge. See ADR 0009.
- **Permission triple-filter** — role × user_branch_access × user_department_assignment (H.4).
- **Materialized view freshness** — H.7: combine pre-computed mat view with live UNION for fresh + fast.

## Localization

- **Thai-first** — UI strings prefer Thai; code/comments in English.
- **THB** — Thai Baht (฿). Default currency.
- **VAT** — Value Added Tax (Thailand: 7%). Charged *by* a supplier *to* the tenant on a purchase. Tenant can reclaim it only if VAT-registered (is_vat_registered); the supplier's VAT is recorded regardless.
- **WHT** — Withholding Tax (Thailand-specific). Withheld *by* the tenant *from* its payment *to* a supplier (rate varies by type: service 3%, rent 5%). Opposite direction to VAT.
- **VAT/WHT decoupling** — VAT and WHT are independent: different directions, and neither is gated on tenant.is_vat_registered. A non-VAT-registered tenant still withholds WHT from supplier payments.
- **Tax invoice (ใบกำกับภาษี)** — required when VAT registered.

## Decisions

For full list see docs/changelog-v5-summary.md (60 decisions).

Most-referenced:
- **Decision #54** — Cost cascade strategy
- **Decision #55** — RLS tenant isolation
- **Decision #59** — Yield math formula
- **Decision #60** — DATE_TRUNC uses tenant timezone

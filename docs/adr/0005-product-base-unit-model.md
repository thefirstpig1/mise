---
status: accepted
---

# Every Product owns one user-picked base unit (not SI-normalized)

Every `Product` has exactly one **base unit** — a `ProductUnit` row with `isBase=true` and `toBaseRatio=1` — that defines the canonical unit its stock is internally tracked in. The base unit is **chosen by the user** from `unit_template` (filtered to the product's `primaryDimension`), NOT auto-derived to the SI base (g for WEIGHT, ml for VOLUME). Sprint 1 Part 7a creates this single base unit atomically with the product (same transaction); Part 7b adds additional units that convert to it via `toBaseRatio`. Chosen because a restaurant SME thinks in the unit it buys/uses (flour in `kg`, eggs in `ฟอง`), so forcing an SI base would make a single-unit product unusable (you'd record flour in grams) until multi-unit lands — and cross-dimension math doesn't need an SI base anyway, because each `unit_template` row already carries its own `toSiRatio`.

## Considered Options

- **User-picked base unit (chosen)** — base unit = whatever unit the user selects; `toBaseRatio=1` for it, other units relative to it. Natural data entry; forward-compatible with 7b without backfill. Cost: base units are not normalized across products, so any cross-dimension (WEIGHT↔VOLUME via density) or cross-product reasoning must go through `unit_template.toSiRatio` rather than assuming a common base.
- **Auto-derive SI base (g/ml/—)** — every WEIGHT product based in g, VOLUME in ml. Uniform internal base simplifies cross-product math, but in 7a (single unit, no multi-unit yet) it forces awful entry (flour as `25000 g`, not `1 กระสอบ`/`25 kg`). Rejected for UX.
- **Free-text base unit** — no `unit_template` link. Rejected: loses unit consistency and 7b's multi-unit converter wants template-backed units with known `toSiRatio`.

## Consequences

- **Invariant: every Product has ≥1 ProductUnit (exactly one `isBase`).** Establishes a contract that procurement, stock, recipe, and cost (Sprint 2+) all rely on. `createProductLogic` enforces it by writing Product + base ProductUnit in one transaction.
- **For single-unit products, base unit = default buy unit** (`isDefaultBuyUnit=true` on the same row). 7b decouples them when multiple units exist.
- **Cross-dimension/cross-product math must use `unit_template.toSiRatio`,** never an assumed common base — because bases differ per product. This is the deliberate trade-off for the UX win.
- **Changing the base unit later is structural.** Safe in 7a (single unit, no dependents, no downstream usage), so editing is allowed. Once a product has multiple units or is referenced by procurement/stock, base-unit/dimension changes get guarded — that guard lands in 7b/Sprint 2, not now.
- **`ProductUnit` has no `deletedAt`.** Soft-deleting a Product stamps `Product.deletedAt` only; its base unit row rides along (invisible because lists filter on the Product).

Related: ADR 0004 (data-access pattern), CONTEXT.md (Base unit, Default buy unit), Section E (multi-unit), Decision #59 (yield math, relevant in 7b), Sprint 1 Part 7

---
status: accepted
---

# A Product's units all share one dimension; cross-dimension conversion is density's job

Every `ProductUnit` of a `Product` shares the Product's `primaryDimension` (all WEIGHT, or all VOLUME, or all COUNT). Additional units convert to the base unit via a product-specific `toBaseRatio` (a plain scalar), and converting between WEIGHT and VOLUME for the same product goes through **Liquid density** (`liquidDensityTemplateId` / `densityMlPerGOverride`), NOT through a `ProductUnit` row. The schema's per-row `ProductUnit.unitDimension` column *could* differ from the Product's dimension, but Sprint 1 Part 7b deliberately forbids that — the logic/zod layer rejects any unit whose dimension ≠ `primaryDimension`. Chosen because `toBaseRatio` is a single constant that only makes sense within one dimension (kg→g = 1000 is fixed; l→g is not — it depends on the product's density), so allowing cross-dimension units would force a density to be baked into a "ratio" field and break its meaning. Keeping units single-dimension makes multi-unit purely "the same physical quantity at a different scale/packaging" (ml, ขวด, ลัง), and isolates the WEIGHT↔VOLUME concern in one place (density), which the Sprint 2+ cost/consumption engine relies on.

## Consequences

- **You cannot add, say, a `kg` unit to a product whose base is `l`.** A future reader will hit this and wonder why — the answer is here: express that conversion with density, not a unit row. This is the surprising part the ADR exists to explain.
- **Base unit must come from `unit_template`** (it carries `toSiRatio`, needed for density / cross-product SI math); additional units may be custom packaging names (`source="custom"`) with no template entry. See ADR 0005 (base-unit model).
- **`toBaseRatio` is product-specific even for template-named units** — 1 ขวด of brand-A milk ≠ brand-B. `source` records only where the *name* came from, never binds the ratio.
- **If a genuine cross-dimension unit need appears later**, that is a new decision (likely revisiting this ADR), not a quiet schema tweak — the column already permits it, so the guardrail lives in app logic on purpose.

Related: ADR 0005 (Product base unit model), CONTEXT.md (Multi-unit, Additional unit, Unit source, Liquid density), Decision #59 (yield math — relevant in 7c/PREPPED), Sprint 1 Part 7b.

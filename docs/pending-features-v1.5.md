# Pending Features for v1.5 Spec Update

**Status:** NOTED — implement during Sprint 5-6
**Schema impact:** Minimal (4 fields total)

## Feature 1: Price Volatility (revised concept)

### Changed from original concept
- ❌ OLD: Track price change over time (% from last purchase)
- ✅ NEW: Track price vs "desired price" set by user

### How it works
User sets target price per product (from recipe costing or master).
System tracks GR prices vs target.
Alert when actual exceeds threshold (e.g., ±10%).

Example:
- Salmon Grade A — Target: ฿450/1000g, Threshold ±10%
- GR price ฿520/1000g → +15.5% → ALERT 🔔

### Schema additions (Sprint 6)
product (add 3 fields):

target_price_per_base_unit  Decimal(15,4)
price_alert_threshold_pct   Decimal(5,2) default 10.00
price_alert_enabled         Boolean default false


### Implementation (Sprint 6)
- Trigger on GR confirm → check unit_price_actual vs target
- If exceed threshold + alert enabled → INSERT notification
- View: price_volatility_view (current, target, variance%, status)

---

## Feature 2: Menu Lab / Recipe Development Page

### Concept
On-boarding wow factor — page where user develops new menu recipes
with real-time cost calc, what-if pricing, sensitivity analysis.

### Use cases
- New menu experimentation (try recipe before commit)
- Onboarding: re-track existing menu costs in our app
- "Should I price this at ฿89 or ฿99?" decision support

### UI mockup (Sprint 5)
- Recipe builder with live cost
- Sale price input → COGS% + margin shown
- Sensitivity: "If pork rises 20%, COGS becomes 32%"
- Pricing suggestion: "For 30% COGS target, price = ฿83"
- Save to Recipe Card

### Schema additions (Sprint 5)
recipe (add 1 field):

is_draft  Boolean default false


### Implementation (Sprint 5)
- Route: /menu/lab or /recipe/new
- Real-time cost via product_cost_history latest
- Compare with similar menus (category + price tier)
- Save as draft / Save as recipe

---

## Open Questions for v1.5

- O22: Target price scope (per product vs per product×supplier×branch)?
  → Start simple in Sprint 6
- O23: Sensitivity analysis — top N ingredients to show?
  → Default top 3 by cost contribution
- O24: "Compare similar menus" matching criteria?
  → By category + price tier (±20%)

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

## Feature 3: Sales Plan (จองล่วงหน้า / ปิดเลี้ยง) — captured 2026-08-17, NOT designed

### Concept
A restaurant takes a booking — a party, a closed-house event, a customer ordering ahead — and needs to answer, **before** accepting or before shopping: *do I have enough, what must I buy, and will I still have enough left for tomorrow's normal trade?*

Raised by Kong during the Part 17 grill (2026-08-17). **No design decisions are made here** — this is a placeholder so the idea is not lost, per the house rule that a future-sprint decision without its context is worse than no decision.

### What it would need to answer
1. **Will stock cover this booking?** Explode the pre-ordered menus through their recipes (H.5's maths, with yield), compare against current stock.
2. **What must be bought, and how much?** The shortfall per product, in buying units.
3. **What must be left over?** The booking must not eat the stock normal trade needs the next day — which requires a **usage trend** per product, i.e. statistics over past consumption.

### Hard dependencies (why it cannot be built yet)
- `sales_transaction` — **Sprint 4** (POS sync). Without sales there is no consumption history and no trend.
- `recipe` — **Sprint 5**. Without recipes a menu cannot be exploded into ingredients.
- H.5 auto-tagging CONSUMPTION — the same maths, already specced, lands with the two above.

Until all three exist, a sales plan could only ever guess, and a stock answer that is a guess is worse than no answer at the moment someone accepts a booking on the strength of it.

### Relationship to Part 17's par level
Different questions, and neither replaces the other: **par** asks *"am I below my normal level right now?"*; **sales plan** asks *"can I survive a specific known event on a specific future date?"*. Par is a standing floor; a sales plan is a one-off spike. Sprint 4+ can feed both from the same consumption history.

### Open questions (for the grill, when it happens)
- O25: Is a sales plan a document (bookings with lines) or a scratch calculator that stores nothing?
- O26: Does confirming one **reserve** stock (a soft allocation the par list respects), or only report?
- O27: What statistic backs "leave enough for tomorrow" — trailing average, same-weekday average, or a number the owner sets?

---

## Open Questions for v1.5

- O22: Target price scope (per product vs per product×supplier×branch)?
  → Start simple in Sprint 6
- O23: Sensitivity analysis — top N ingredients to show?
  → Default top 3 by cost contribution
- O24: "Compare similar menus" matching criteria?
  → By category + price tier (±20%)

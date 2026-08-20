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


### Implementation (**Part 23**, corrected 2026-08-21 by ADR 0021)
- Route: /menu/lab or /recipe/new
- ~~Real-time cost via product_cost_history latest~~ → **`getProductCostsLogic(tenantId, { productIds, branchIds })`**. `product_cost_history` was never built (ADR 0014 Q4). Note the consequence Menu Lab has to answer: **cost requires a branch** (ADR 0014 Q9), so a what-if on an unbuilt dish must say which branch's prices it is using, or pick one and label it.
- **The typed selling price lives here and nowhere else.** ADR 0021 Q10 takes the selling price from actual sales (`net_amount ÷ qty`) rather than a `menu.sale_price` field, precisely because a typed number goes stale the day the POS price changes. A dish that has never been sold has no such number, which is Menu Lab's whole subject — *"should I price this at ฿89 or ฿99?"*. **Undecided, and to be grilled with the screen in front of us:** whether that price is stored on the menu, stored on the draft recipe, or exists only inside the calculator and is never persisted.
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

## Feature 4: Staff meal / welfare costing — captured 2026-08-17, NOT designed

### Concept
Food eaten by staff is **not waste**, and Part 17 deliberately refuses to let it be logged as such. Kong's framing, recorded verbatim in intent: *it is a sale that collected no money, so its cost belongs on the labour / welfare side of the accounts.*

That makes it a real feature owed to a later sprint, not merely an exclusion — which is why it is written here and not left as a glossary line saying what it *isn't*.

### Why it matters that it is not waste
If staff meals land in the food-waste figure, the one number Part 17 exists to produce — *what did this branch throw away* — becomes a mixture of a problem (spoilage) and a policy (feeding the team). A manager cannot act on a number like that, and the waste trend would rise every time the shop hired someone.

### Hard dependencies
- `sales_transaction` — **Sprint 4**. A staff meal is recorded like a sale, at zero revenue.
- `recipe` — **Sprint 5**. Its cost is the recipe's cost, so it cannot be valued before recipes exist.

### Open questions (for the grill, when it happens)
- O28: How is a staff meal captured — a POS ticket at ฿0 / a discount type / a button in Mise?
- O29: Which side does the cost land on: an OpEx expense line under Labour (welfare), or a separate report line that never touches the expense table?
- O30: Does it count inside food cost %, outside it, or shown both ways? (It changes the headline number every restaurant runs on.)

---

## Feature 5: Attachments — evidence photos and slips (object storage) — captured 2026-08-18, NOT designed

### Concept
A single place to attach a **photograph** to a document: the supplier's invoice on a goods receipt, the bill or payment slip on an expense, the handover evidence on an inter-branch transfer. One mechanism, one upload path, one access rule — used by every document that needs to prove something happened.

### Why it is a Part of its own, rather than a column on whichever document asks next
By 2026-08-18 **three separate Parts had wanted a photo and none could have one**, each recording the same reason in the schema:

| document | what the photo proves | where the refusal is recorded |
|---|---|---|
| Goods receipt (Part 13) | the supplier's invoice / delivery note | `schema.prisma:1008` — *"no `invoice_image_url` (no object storage)"* |
| Expense (Part 16) | the bill, the payment slip | `schema.prisma:1190` — *"NOT built: `bill_image_url` / `slip_image_url` (no object storage)"* |
| Transfer (Part 18) | the handover, when the driver is **not** a company employee and will therefore never have a login | ADR 0018 Q3 |
| Payment (future) | the bank transfer slip — Kong, 2026-08-18: *"เดี๋ยวมันต้องมีสลิปหลักฐานการโอนเงินอะไรต่างๆอีก คิดเผื่อไว้เลย"* | this entry |

The decisive argument for building it once: **the vendor choice determines what the column even holds.** A bucket key, a full URL and a signed path are three different columns, so a `photo_url` added before the decision is a guess that a migration pays for later — in four tables instead of one.

### Hard dependencies (why it cannot be built yet)
- **An object-storage vendor and its credentials in `.env`** — a new dependency *and* an `.env` edit, both of which CLAUDE.md makes stop-and-ask items.
- **An access rule that RLS cannot provide.** Tenant isolation is enforced in Postgres; a file in a bucket is outside it, so tenant scoping for attachments has to be designed rather than inherited.

### Open questions (for the grill, when it happens)
- O31: Which vendor, and does the answer change if the deployment target is not Vercel?
- O32: Does an attachment belong to the **document** or to a **line**? (A delivery note covers a receipt; a photo of one damaged crate does not.)
- O33: **Is an attachment evidence or a working file?** If it is evidence, it is append-only like the ledger — replacing it is a new attachment plus a superseded marker, never an overwrite. This is the question that decides the table's shape.
- O34: What happens to attachments when their document is voided or soft-deleted — kept (the evidence is still true), or removed?
- O35: Size and count limits, and whether the phone-camera path needs client-side compression before upload (SME phones on Thai mobile data).

## Feature 6: Delivery apps commission — estimate vs statement — captured 2026-08-19, NOT designed

**Decided in the Sprint 4 grill; only the *build* is deferred, not the shape.**

A delivery platform keeps 25–32% of an order (Grab ~30–32%; LINE MAN 0% normally, 30% on the free-delivery programme). The trade calls this "GP" — see the ⚠️ in CONTEXT.md, it is not this project's GP.

**What is already settled and needs no further decision**
- The *real* number arrives as a **monthly statement** and is recorded as an ordinary expense. Part 16 handles this today with no new code, into the seeded category `OpEx/Commission/Delivery apps` (added in Part 19's L1).
- The user is **never asked what percentage a platform charges**. The answer is on the paper they are already holding, and it is more reliable than their memory — shops get pulled into promotional programmes and the rate changes without them noticing.
- Revenue stays the **price recorded on the bill**; the commission is an expense, never a deduction from revenue (rule P16).

**What is deferred to Sprint 6 (dashboards)**
- An **optional** commission rate per branch × platform, used only to show an in-month *estimate* of what will be deducted.
- The estimate is **computed at read and never written as an expense row** (rule V4 / P17) — writing it would double-count against the statement — and every screen showing it says it is an estimate (rule C10).
- The **estimate-versus-statement comparison**, which is the actual product value: a large gap is a real signal (prices set wrong on the app, or the shop was enrolled in a programme it did not choose).

**Depends on:** `channel` on the sales row (Part 19, rule P18). Without it there is no way to tell which revenue a platform's cut applies to — the shop learns that profit shrank, not where.

### Open questions (for the grill, when it happens)
- O36: Is the rate per **branch × platform**, or per **branch × platform × menu**? (Some platforms charge differently by item type.)
- O37: Does the rate need effective-dating like a supplier price (ADR 0009), given that programme changes are exactly what makes the estimate wrong?
- O38: Where does the statement's *other* deductions go — delivery subsidies, promotional co-payments, adjustment credits — all of which sit on the same monthly document as the commission?


---

## Feature 7: Joint products — one input, several valuable outputs — captured 2026-08-21, NOT designed

**Where it came from:** the Sprint 5 grill, from a question about beef. It is the case ADR 0021 Q2 deliberately closed the door on, and the reason the door was closed is worth keeping in full — Decision #6 has sat in the spec as the single line *"Joint allocation by market value"* since v1.0, and this is the detail it lost.

**The case, in full:**

> A 1 kg beef primal costing 500 ฿ is broken down into:
> - **0.8 kg** steak cuts → the สเต็กเนื้อ menu
> - **0.1 kg** beef fat → ข้าวผัดมันเนื้อ, a dish the shop sells
> - **0.1 kg** discarded

**Why the existing model cannot hold it.** ADR 0007 gives a PREPPED product one parent and one `yield_percent`, and ADR 0021 Q1 adds a production recipe with many inputs and **one** output. Neither describes one input with several valuable outputs, and no single yield percent is honest about it:

- **80%** pretends the fat is rubbish, when it is sold in a dish on the menu.
- **90%** pretends fat and steak are the same product at the same price per kilo.

**The real problem is not weight, it is money.** The 500 ฿ has to divide between the steak and the fat, and **there is no factual answer** — only a policy. That is why Decision #6 says "by market value" and why `product.target_market_price` and `product.expected_yield_g` were reserved in Sprint 1. Both columns still have **zero readers and zero writers**, and no screen offers either.

**Candidate policies, none chosen:**
- **By market value** (Decision #6's intent) — steak 600 ฿/kg × 0.8 = 480, fat 100 ฿/kg × 0.1 = 10, total 490 → steak takes 500 × 480/490 = 489.80, fat takes 10.20.
- **By weight** — 500 × 0.8/0.9 = 444 vs 55.60. Wrong on its face: it prices fat like steak.
- **By-product at net realisable value** — value the fat at what it is worth (0.1 × 100 = 10 ฿) and give the whole remainder to the steak. Simpler, and how accounting normally treats a genuine by-product.

**Why it must not be folded into yield.** Fold the fat into the steak's yield and ข้าวผัดมันเนื้อ costs nothing to make. Its margin looks superb, the shop pushes it, and the profit was never there — the same failure ADR 0014 Q5 rejected when it refused to value found stock at zero.

**Depends on:** a screen that can capture a market price at all (`target_market_price` has never had one), and a decision about whether the breakdown is a document (a production event, Q11's missing Part) or a property of the product graph.

### Open questions (for the grill, when it happens)
- O39: Which allocation policy — market value, by-product NRV, or the shop's choice per product?
- O40: Where does the market price come from — typed by the user, or the shop's own selling data for that product?
- O41: Does a joint breakdown post to the ledger (consume 1 kg primal, produce two outputs), which makes it the same document as Q11's production, or is it purely a costing rule?

---

## Feature 8: Branch recipe change notifications — captured 2026-08-21, NOT designed

**Where it came from:** the Sprint 5 grill. ADR 0021 Q9 built the pull half of this (a comparison view) and deferred the push half.

**The case:** สาขา C copied its recipes from สาขา A and has changed nothing since. สาขา A then changes a recipe. Under ADR 0021 Q8, C does not follow — deliberately, because a recipe change is a change to how a kitchen works and C's cooks may not have been retrained. But **C is never told**, and has to go and look.

**What exists after Part 21:** a comparison view grouped by recipe variant with a branch count, and a "make this branch match ___" action. Someone who looks can see everything and act on it.

**What is missing:** the system noticing and saying so. That needs lineage (which branch a recipe was copied from), change detection against the source since the copy, and a pending list with accept / decline.

⚠️ **This is `recipe_change_diff` reborn with a different customer.** The spec's Section B table was built for POS → Mise, which does not exist; branch → branch is a real one. The mechanism was never wrong, only aimed at the wrong party — worth remembering the next time a spec table looks dead.

**Why deferred rather than built:** the comparison view is its first layer regardless, so nothing is thrown away by waiting. And no shop has used the comparison view yet — a queue nobody acts on fills with PENDING rows and teaches everyone to ignore it, and we would not be able to tell whether that meant nobody cared or the notification was in the wrong place.

### Open questions (for the grill, when it happens)
- O42: Does a branch that has diverged on its own still get offered the source's change, flagged, or is it dropped from the queue?
- O43: Is the notification per recipe, or batched per source branch per day? (One head-office edit session should not produce forty notifications.)
- O44: Who at the branch may accept — and does that reuse the permission Part that ADR 0021 Q18 says is owed anyway?

---

## Open Questions for v1.5

- O22: Target price scope (per product vs per product×supplier×branch)?
  → Start simple in Sprint 6
- O23: Sensitivity analysis — top N ingredients to show?
  → Default top 3 by cost contribution
- O24: "Compare similar menus" matching criteria?
  → By category + price tier (±20%)

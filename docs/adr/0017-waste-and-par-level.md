---
status: accepted
---

# Waste, and knowing before you run out

Part 15 taught the ledger to be corrected by counting. Part 16 taught the system what leaves the bank. Part 17 covers the two everyday things a kitchen does that neither reached: **throwing something away**, and **noticing that something is about to run out.** Both already half-exist — spoilage is recorded today as a generic stock adjustment, and "par level" appears in the sprint plan and nowhere else in the spec — and the grill's main work was deciding what each of them *is* before building either. Decisions locked in the grill of 2026-08-17 (Q1–Q7).

## Context

Three facts about the existing system shaped every answer:

1. **Waste is already recorded, badly.** `/stock/adjust` writes an `ADJUST_LOSS` movement with `AdjustmentReason.SPOILAGE | DAMAGE`. The reason is stored but nothing reads it: `/cost`'s "ของเสีย (ทิ้ง)" column counts **every** non-count `ADJUST_LOSS`, including `RECOUNT` and `OTHER`. The column has therefore been mislabelled since Part 14 — it means "stock that left without a document", not "food that was thrown away".
2. **Adding a `MovementType` is expensive.** Part 13 had to DROP and re-declare `stock_movement_sign_check` in a second migration to add `PO_RECEIVE_REVERSAL`, and every drift guard, the FIFO replay and `/cost` switch on the type.
3. **Par level has no spec at all.** It is named once, in the Sprint 3 plan line. There is no table, no column, and no statement of what it compares against.

## Decision

### Q1 — Waste is a new SOURCE, not a new movement type

`waste_log` becomes a document with `SourceType.WASTE_LOG`; the movement it posts stays an ordinary **`ADJUST_LOSS`**.

This is ADR 0015 Q1's pattern exactly — a stock count added `SourceType.STOCK_COUNT` and no movement type — and it buys the same three things: `stock_movement_sign_check` is untouched (no two-migration dance), `UNIQUE(source_type, source_id)` makes posting idempotent for free, and `/cost` can split the column by `sourceType`, which it already does for count variance.

*(Rejected: `MovementType.WASTE` as the master spec lists. It would match the spec's §stock_movement line and prepare H.8's theoretical-vs-actual variance in Sprint 5 — but the sign check, the replay, the drift guards and a second migration are a large bill for information the source type already carries. The spec gets a superseded note.)*

### Q2 — A waste entry is a single dated event, posted immediately

One row is **one thing thrown away**: product, quantity, unit, reason, when, who. No `DRAFT`, no shift sheet, no close step. Recording waste has to fit in the thirty seconds between the bin and the next order or nobody will do it, and an unposted draft would leave the ledger claiming stock that is already in the bin.

Correcting one is a **void** — a compensating `ADJUST_GAIN` appended, the original left standing — because the ledger is append-only (ADR 0011 Q7) and because "this was keyed wrong" is itself worth being able to see.

*(Rejected: a per-shift waste sheet with lines and a close, mirroring the count. A stock take is a session that genuinely spans hours; throwing away a tray of prawns is not. The lifecycle would add a state to supervise and leave real losses sitting in `DRAFT`, invisible to stock.)*

### Q3 — Yield covers the knife; the waste log covers the fridge

The sharpest question of the grill, because both were being used for the same thing.

**`yield_percent` measures conversion loss only** — what trimming and cooking take between RAW and PREPPED. It is a property of the product and the method, the same on a good week and a bad one.

**Everything else is waste**, with a date, a quantity and a reason. Food that went off in the fridge is not yield.

The reason it matters: a shop that lowers its yield to "cover" spoilage buries a recurring, fixable loss inside a constant. Nothing then reports it, nobody is accountable for it, and in Sprint 5 the theoretical-vs-actual variance comes out looking healthy precisely because the loss was baked into the theory. The same instinct as ADR 0015 Q5 — *a figure that cannot tell a manager who to talk to is worth less than one that can.*

`WasteReason` = **`SPOILED`** (went off, expired) · **`DAMAGED`** (dropped, crushed) · **`COOKING_ERROR`** (burnt, made wrong) · **`CUSTOMER_RETURN`** (sent back) · **`OTHER`**. Each names a different person to talk to: the buyer, the storeman, the kitchen, the front of house.

Two values deliberately absent:
- **`PREP_LOSS`** — `yield_percent` owns it (Decision #59), and the production movement that would record it does not exist until Sprint 5.
- **`STAFF_MEAL`** — a staff meal is **not waste**. It is a sale that collected no money, and its cost belongs on the labour/welfare side of the accounts. Costing one needs `sales_transaction` and `recipe`; putting it in the food-waste figure now would make the one number this Part exists to produce wrong.

### Q4 — One door per kind of loss

`SPOILAGE` and `DAMAGE` are **removed from the adjustment form** (the enum values stay, so history keeps reading correctly). An adjustment is now `RECOUNT` or `OTHER` — a correction, not an event.

`/cost` keeps its eight columns (ADR 0016 Q4's rule: replace, do not append) and the two loss columns finally mean what they say:
- **ของเสีย (ทิ้ง)** = `WASTE_LOG` outflows only.
- **ส่วนต่าง/ปรับปรุง** = `STOCK_COUNT` **and** `ADJUSTMENT` outflows — a shortage found by counting and a shortage typed in by hand are the same conversation with the same person.

### Q5 — Par level is per (product, branch), and it only ever tells you

A `par_level` row is scoped to **product × branch**: a branch that is out of pork is out of pork whatever the business holds elsewhere, and the whole premise of Mise is that a business is not a branch (ADR 0014 Q9b).

Entered in **any unit the user picks**, stored in the **base unit** — the rule every quantity in this system follows since Part 10.

It **suggests nothing and orders nothing**. Auto-drafting a purchase order needs a preferred supplier, a lead time and someone with authority to approve it; ADR 0012 Q1 already dropped the purchase-request layer for the last of those, and inventing it here through the side door would be the same mistake.

### Q6 — The alert compares par with what is IN THE BUILDING, and then explains

A product is listed the moment **on-hand < par**. Stock already on order does **not** suppress the row.

That is deliberate, and it is the user's own reason: an order that was placed and never arrived is exactly the failure nobody notices until service. Subtracting on-order quantities would silence the list precisely when it is most needed.

Instead the row carries its context, in three states:

| State | What it means | What it shows |
|---|---|---|
| **ต้องสั่ง** | below par, nothing on order | the gap (`par − on-hand`) |
| **สั่งแล้ว รอของ** | below par, an open order is due | supplier, quantity, expected date |
| **ตามของ** | below par, an open order is **past** its expected date | the same, flagged — this is the case that has no home today |

"On order" means an open purchase order (`SENT` / `PARTIALLY_RECEIVED`) with quantity still outstanding.

### Q6b — Every row carries how FRESH its number is

Raised after Q6 was locked, and it changes what the list must show.

**The system has no stock prediction, and until Sprint 4–5 the ledger balance only ever rises.** Stock decreases only when a human says so — a count, an adjustment, or (from this Part) a waste entry — because nothing deducts what was sold: `MovementType` has no `CONSUMPTION`, and H.5's auto-tagging needs `sales_transaction` (Sprint 4) and `recipe` (Sprint 5). A shop that receives 50 kg of pork and sells it all still reads 50 kg until someone counts.

A par alert reading that number alone would therefore stay silent in exactly the shops that need it most. So each row states **when its figure was last confirmed by a physical count** — "นับล่าสุด 9 วันก่อน", or "ยังไม่เคยนับ" — and a product that is both below par and stale sorts to the top, with a link to open a count sheet for that branch. The below-par list doubles as the prompt to go and look.

**This survives H.5 unchanged.** When consumption lands, the same list gets a better input — the balance starts falling by itself — and freshness becomes *more* useful, not less: a number that moves constantly drifts from the shelf silently (unlogged waste, over-portioning, theft), which is why counting exists at all. The three layers answer different questions and do not overlap: **par** = what to buy today · **H.5** = the quality of the number par reads · **H.8** = how far theory and reality diverged over a month (Sprint 6).

*(The forward-looking version Kong described — "trending to fall below par in N days" — needs consumption history and is therefore Sprint 4+. The related **Sales Plan** idea (a booking, will stock cover it, what to buy, what to leave for tomorrow) is recorded in `docs/pending-features-v1.5.md` Feature 3, undesigned, with its dependencies.)*

### Q7 — `/waste` is its own surface, and it records who by name

A route of its own rather than a corner of `/stock/adjust`: waste is entered from the kitchen, often on a phone, and it should be two taps from the dashboard.

Attribution follows ADR 0015 Q2: **`wasted_by` (the login) plus `wasted_by_name` (free text)**. In a Thai SME the owner holds the only account and the staff do the work, so the FK alone would record "the owner threw everything away" — tidy and false.

## Consequences

1. **`/cost`'s waste column changes meaning, and old rows move.** Existing `SPOILAGE`/`DAMAGE` adjustments stay adjustments, so they land in the variance column from now on. Nothing is rewritten — the past is relabelled by a rule, not by a migration — and the number was wrong before rather than after.
2. **Waste and yield now have a boundary someone can be taught.** It is written in CONTEXT.md, and Sprint 5's variance report depends on it holding.
3. **A fourth thing now writes to the ledger** (receipts, adjustments, counts, waste) and every one of them goes through `createStockMovementLogic`. That primitive is now the single narrow gate ADR 0011 intended, and the next writer — Part 18's transfer — should not be the first exception.
4. **The par list is only as good as `par_level` being filled in**, and nothing fills it in automatically. A products page that never mentions par will leave the feature unused; the list must be reachable from where people already are.
5. **The par list is honest about a weak input, rather than pretending.** Until Sprint 4–5 its stock figure is only as good as the last count, and the list says so on every row. Removing that line once H.5 lands would be a mistake: a moving number drifts quietly, and freshness is what tells a reader whether to trust the row.
6. **`ตามของ` is a promise about expected delivery dates.** They are optional on a PO today, so a shop that never fills them in gets the two-state version of the list. Worth saying on screen rather than leaving the third state mysteriously empty.

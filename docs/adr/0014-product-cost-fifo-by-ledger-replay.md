---
status: accepted
---

# Product cost: FIFO computed by replaying the ledger, stored nowhere

Part 10 built a ledger that records *how much* stock moved; Part 13 made it record *what was paid* for it. Part 14 turns those two facts into the number every later feature needs — **what one base unit of this product costs** — using **FIFO**, and it computes that number by **walking the ledger on every read instead of storing it**. There is no `cost_layer` table with a mutable `qty_remaining`, and — reversing what master-spec §5.7 specifies — there is no `product_cost_history` either. Both would have to be rewritten every time someone backdates a receipt or voids one, which are ordinary Tuesday events in this product, not edge cases. Costs that the documents cannot supply — stock found during a recount — are resolved by a fallback chain and can be corrected by an **append + supersede** declaration that is signed and dated. Decisions locked in the grill of 2026-08-16 (Q1–Q12).

## Context

Sprint 2's arc was procurement: the ledger (Part 10), the order (Part 11), the receipt (Part 13). Every one of them deferred the same question, in writing:

- **ADR 0011** carried forward to this Part: *"orders by `(occurred_at, created_at)`; **weighted-avg vs FIFO ADR**; AP discrepancy cost policy; retroactive recompute on backdated entries"*, and that `PO_RECEIVE_REVERSAL` rows *"must not be mistaken for consumption"*.
- **ADR 0012 Q3** froze `unit_price` and `to_base_ratio` onto a sent PO line so a later master-data edit could not rewrite history.
- **ADR 0013 Q7** put `unit_price_actual` on the GR line — *"this is the number Part 14 will cost stock at"* — and Q4 made `received_at` a true instant so intra-day ordering is real.
- **Part 10 L3a note 3** already wrote the access path down: *"history ordering is TOTAL — `(occurredAt, createdAt, id)`; the cost engine walks the same tuple ASC in Part 14."*

So the inputs exist and are trustworthy. What was never decided is the **method**, and — as it turned out — whether the answer should be stored at all.

Two constraints from earlier ADRs do most of the shaping:

1. **Backdating is a supported feature.** `occurred_at` is backdatable 90 days (ADR 0011 Q5). A receipt keyed on the 20th can belong to the 28th of the previous month, landing *before* stock that has already been consumed.
2. **Corrections are appended, never applied in place.** The ledger has no `UPDATE` (ADR 0011 Q7) and a receipt is voided rather than edited (ADR 0013 Q6).

Any design that stores a derived cost has to answer both of those with a retroactive recompute. A design that stores nothing does not have to answer them at all.

## Decision

### Q1 — Scope is the product cost layer, and nothing above it

IN: cost per base unit for a (product, branch), the layers behind it, cost as of any past date, a business-wide roll-up, and the surfaces that expose them. OUT, to Sprint 5: `recipe_cost_snapshot`, `category_cost_snapshot`, recipe cost, cost confidence, the H.9 cost cascade, yield-adjusted PREPPED cost. Everything in the OUT column needs `recipe` or `sales_transaction`, neither of which has a table yet; building them now would ship permanently-null columns, which is the rule ADR 0012 Q6 set for itself and ADR 0013 kept.

### Q2/Q3 — FIFO, by replaying the ledger; no layer table

Walk `stock_movement` for one (product, branch) in `(occurred_at, created_at, id)` ASC and maintain a layer stack in memory. That tuple is a genuine total order (Part 10 L3a note 3), and `stock_movement_chronological_idx` returns the rows already in it — the walk is an index range scan with no sort step.

*(Rejected: **weighted moving average** — smoother against a one-off emergency purchase, and cheaper on every count below, but the business wants true FIFO and perishables are the case FIFO is actually for. Rejected: **a `cost_layer` table** with a mutable `qty_remaining` — the textbook implementation, and the one that has to be un-done by hand every time constraint 1 or 2 above fires: a backdated receipt re-orders every allocation after it, and a void un-receives stock that may already be gone. A mutable table is also a second source of truth sitting next to an append-only ledger, free to drift from it with nothing to detect that it has.)*

The replay design mirrors the decision ADR 0011 Q8 already made one level down: **balance is not stored either** — it is `SUM(qty)`, with a snapshot+delta migration deferred until volume demands it. Cost now sits on the same footing, with the same escape hatch.

### Q3b — `costPerBaseUnit` is the FRONT layer's cost

The cost of the next unit to be consumed — the number Sprint 5 wants when it asks what the next serving will cost. Two consequences follow and both are easy to get wrong:

- **`costPerBaseUnit × qtyOnHand` is NOT the inventory value.** 10 kg @ 180 plus 10 kg @ 220 is worth 4,000, not 3,600. A stock-value figure must sum the layers.
- **Cost changes on consumption, not only on purchase.** Exhausting a cheap layer raises the cost with nothing bought. Under weighted average this could not happen.

### Q4 — `product_cost_history` is not built

master-spec §5.7 specifies it; this ADR supersedes that. Under Q2 a stored cost row is falsified by the next backdated receipt: write *"1 Aug — cost 180"*, then key a genuine 28 Jul delivery at 150 three weeks later, and the stored row is now wrong about a date that has already passed. Correcting it is exactly the retroactive recompute that replay was chosen to eliminate — reintroduced one layer higher up.

Replaced by `getProductCostLogic(tenantId, { productId, branchId, asOf? })`. `asOf` costs nothing to support: the walk simply stops early, the same way `getStockBalanceLogic` already time-travels.

*(Rejected: **the table as a cache** — same falsification, plus an invalidation rule to maintain. Rejected: **the table as an audit trail of what the system once displayed** — a real thing to want, but not the same thing as cost, and nobody has asked for it.)*

### Q5 — A recount gain is valued at the last purchase cost

`stock_adjustment` carries no price (ADR 0011 Q10), yet FIFO must put the found units *somewhere*. Resolution order: **a live declaration (Q6) → the most recent `PO_RECEIVE` cost at or before that instant → 0, flagged**.

*(Rejected: **the front layer's cost** — wrong more often, because found stock is usually a delivery nobody keyed, which arrived at the newest price, not the oldest surviving one; and "ตีราคาเท่ากับราคาซื้อครั้งล่าสุด" is a sentence an owner understands without first being taught what a layer is. Rejected: **zero** — it drags menu cost down for as long as the free stock lasts and snaps back when it runs out, showing the owner profit that was never there.)*

### Q6 — `stock_cost_declaration`: append + supersede, signed and dated

Stock that arrives without a document needs its cost to be correctable — while typing, and months later when the invoice turns up. One mechanism serves both: the adjust form's optional cost writes a declaration inside the same transaction; a later correction writes a new one and stamps `superseded_at` on the old.

Scope is **`ADJUST_GAIN` only**. A `PO_RECEIVE` price belongs to its document, and ADR 0013 Q6 already decided a receipt is voided rather than edited; allowing a declaration on top would create two ways to change a receipt's price that can disagree.

A declaration applies **regardless of `asOf`**. It corrects our *knowledge* of the past, not the *events* of the past — deliberately unlike a Part 13 void, where the reversal is itself an event and therefore occurs now (ADR 0013 L3b shape 1).

*(Rejected: **a mutable `unit_cost_override` column on `stock_adjustment`** — one column instead of a table, but the previous value disappears with no record of who changed it or why. That is against the grain of every neighbouring decision — the append-only ledger, ADR 0009's append+supersede price series, ADR 0013's void-never-edit — and the feature was asked for in the words "declare กันเองภายใน". A declaration nobody signed is not a declaration.)*

### Q7 — A short-fall becomes a negative layer at the last known cost

The balance may go below zero and the server must not refuse it (ADR 0011 Q9), so popping an empty stack has to mean something: push a layer of `−qty` at the most recently known cost.

This keeps `inventoryValue = Σ(layer.qty × layer.cost)` true even when negative — the alternative reports `qtyOnHand = −5` next to `inventoryValue = 0`, which contradicts itself on screen — and keeps `costPerBaseUnit` answerable, so Sprint 5 needs no null branch at every site that costs a recipe. It also unwinds by itself: the next receipt cancels the debt before adding stock. A negative inventory value is not a bug; it is the true statement that stock was used which was never recorded as received.

Accepted silently for MVP: netting a `−5 @ 180` debt against an arrival at 220 leaves a 200 ฿ price difference that accounting would post as a variance. There is no module to post it to before Sprint 3, and every figure the owner sees remains correct.

### Q8 — A reversal cuts the layer it reverses, not the head of the queue

This is what "must not mistake `PO_RECEIVE_REVERSAL` for consumption" concretely means. Receive 10 @ 180, then 10 @ 220, then void the second: popping the head would leave 10 @ 220, when the goods that went back to the supplier were the 220 ones and what should remain is the 180. Part 13 stores `reversal_of_item_id`, so the layer is identifiable.

Walk rules, complete:

| movement | effect on the stack |
|---|---|
| `PO_RECEIVE` | push a layer: base-unit qty, and **the money from `line_total_actual`** |
| `ADJUST_GAIN` | push a layer priced by the Q5 chain |
| `PO_RECEIVE_REVERSAL` | cut **its own** layer (`reversal_of_item_id`), not the head |
| `ADJUST_LOSS` | pop from the head; underflow per Q7 |

If the voided layer was already partly consumed, withdraw what remains and let the rest become a negative layer at that layer's cost. "You returned goods you had already used" is precisely the thing that should surface as negative stock to investigate, rather than being quietly smoothed away.

### Q9 — Cost is measured per branch; the business is what gets managed

`getProductCostLogic` **requires `branchId`**. Two branches are two physical piles bought on different days at different prices; replaying them together would use one branch's stock to satisfy another's loss. Single-branch tenants pay nothing: the UI fills in the only branch, as `/stock?branch=` already does.

But measuring per branch and *managing* per branch are different things. Mise manages a restaurant **business**, and purchasing and accounting are ultimately run centrally, so Part 14 also ships `getBranchCostSummaryLogic(tenantId, { period })` and one branch-comparison page. The honest constraint is stated rather than designed around: **real profit and loss needs revenue, and revenue arrives with POS sync in Sprint 4.** What Sprint 2 data answers today, per branch — purchase spend, inventory value tied up, **waste and shrinkage valued in ฿ rather than kg**, **the same product bought at different prices across branches**, and data-quality flags — is money leaking in plain sight that no POS reports. `revenue` and `grossProfit` are carried as `null` from day one so Sprint 4 fills fields instead of forcing a rewrite; the full Cost/Revenue/GP matrix remains with `department_branch_cost_view` in Sprint 6.

**Recorded, not solved: central purchasing.** `purchase_order.branch_id` is NOT NULL — every order belongs to a branch — while the vision has HQ buying centrally and distributing. Closing that needs `TRANSFER_*` movements (ADR 0011 Q10 → Sprint 3+), and it returns here as a cost question the day it exists: **stock transferred from branch A to branch B must arrive carrying A's FIFO cost**, or the receiving branch's cost is fiction. The replay accommodates it — a transfer-in is another `push` whose price comes from the sending branch's walk — but it must be designed, not discovered.

### Q10 — One fallback rule, and the read always says where its number came from

"No front layer" arises three ways — a gain with no price (Q5), negative stock (Q7), and stock at exactly zero — and all three take the same answer: **front layer → last known purchase cost → 0**.

Every cost read returns `costSource: FRONT_LAYER | DECLARED | LAST_KNOWN | UNPRICED`. This is not decoration: CONTEXT.md already defines **Cost confidence HIGH/MEDIUM/LOW** for Sprint 5, and `costSource` is exactly the raw material. Returning it now means Sprint 5 computes confidence without reopening Part 14.

### Q11 — Four surfaces

(1) an optional, collapsed cost field on the adjust form; (2) a per-product cost page — layers, `costSource`, declare/supersede with history; (3) the branch-comparison page; (4) a stock-value column on `/stock`. Surface (2) is not optional polish: it is the only place a user can *find* the rows the system priced by guesswork, and without it "correct it when you find the invoice" is a promise the UI cannot keep. Cut: cost on the product detail page, a duplicate of (2) that can simply link to it.

### Q12 — Money is the stored quantity; cost per unit is derived

A layer carries base-unit **qty (3 dp)** and **the money actually paid for it (2 dp, straight from `line_total_actual`)** — not a per-unit cost. Consuming part of a layer splits its money proportionally, rounds to 2 dp, and leaves the remainder in the layer.

*(Rejected: **storing cost per unit at 4 dp and multiplying back.** 1,000 ฿ ÷ 90 kg = 11.1111, and 11.1111 × 90 = 999.999 — a fraction of a satang evaporates per layer, and keeps evaporating.)*

What this buys is a checkable invariant: **total inventory value = all money in − all money consumed, exact to the satang.** That is the figure the Q9 executive view gets reconciled against a bank statement; if it does not tie out, nothing else on the page will be believed either. `costPerBaseUnit` is front-layer money ÷ front-layer qty, computed at read, rounded only at the screen, and crossing the wire as a **string** (Pitfall #20).

## Consequences

1. **Nothing about cost can ever be stale**, because nothing about cost is stored. Backdating a receipt, voiding one, or declaring a price months later all take effect on the next read with no invalidation step, no migration, and no rows to repair. This is the entire reason the design was chosen.
2. **The read layer's shape is load-bearing, not stylistic.** The batch primitive takes `productIds[]` and the walk takes its opening stack as a parameter (`openingStack = []`). The first prevents an N+1 replay — 200 products × one round trip to Neon Singapore is 6–16 seconds; the second is what keeps the eventual snapshot a pure addition rather than a rewrite. Both are cheap now and expensive to retrofit.
3. **Sprint 5's H.9 no longer applies as written.** It marks `recipe_cost_snapshot` rows stale via a trigger on `product_cost_history` INSERT — a table that will not exist. This mostly dissolves rather than needing a replacement: "stale" has no meaning once cost is computed fresh on every read. Sprint 5 should confirm that before designing around it.
4. **The branch-comparison page is the first caller that can make replay slow** (every product × every branch). The threshold is written down: if it exceeds ~1 s, build the snapshot immediately rather than waiting for another signal.
5. **A GR line's money is now load-bearing beyond the receipt.** `line_total_actual` was a display total in Part 13; it is the layer's value here. Anything that changes how it is computed changes historical costs.
6. **`stock_cost_declaration` generalises past this Part.** Sprint 3's `stock_count` hits the identical problem — stock found with no document and no price — and can share the table rather than inventing a parallel one.

---
status: accepted
---

# Goods Receipt: the moment stock becomes real

A Purchase Order is a promise (ADR 0012); a Goods Receipt is **the moment that promise becomes physical stock**, and it is the only thing in Sprint 2 that turns a purchase into a ledger row. Part 13 models it as a **two-state document** — `DRAFT` while the person at the back door is still counting, `CONFIRMED` the instant it posts to the append-only ledger (ADR 0011) — plus a third terminal state, `VOIDED`, because a receipt that posted the wrong number cannot be edited: the ledger forbids it, so a void appends **compensating reversal lines** instead. A GR may receive against a sent PO **or stand alone** (the cash purchase from the market that never had an order). Every quantity it converts to base units uses **the PO line's frozen `to_base_ratio`**, never a live `ProductUnit` lookup — the requirement ADR 0012 Consequence 1 imposed on this Part. Receiving **more** than was ordered is allowed and flagged, never blocked, because the goods are already in the kitchen. Decisions locked in the grill of 2026-08-16 (Q1–Q8).

## Context

Sprint 2 is the transactional core. Part 10 shipped the ledger and its manual producer (`stock_adjustment`); Part 11 shipped the PO. Between them sits a gap that makes both incomplete: **nothing writes `PO_RECEIVE`**. `MovementType.PO_RECEIVE` and `SourceType.GR_LINE` have existed in the enum since Part 10, but `assertSourceExists` still throws `UnsupportedSourceTypeError` for `GR_LINE`, and `purchase_order_item.qty_received` has been sitting at its default `0` since Part 11 with no writer. Part 13 closes both.

Four pieces of prior art bind this Part:

- **ADR 0011 Q1/Q4/Q7** — the ledger stores base-unit signed quantities, one movement per source row (`UNIQUE(source_type, source_id)`), and is **strictly append-only**. A GR that needs correcting cannot mutate what it posted.
- **ADR 0012 Q3/Q4 + Consequence 1** — a sent PO line cannot move beneath a GR, and it carries its own `to_base_ratio`. A GR **must** convert with that frozen ratio, or it reintroduces the bug Q3 closed.
- **master-spec §5.3 / H.3 / Decision #56** — the three-table GR shape, and "excess receipt = flag for manager review, not auto-allocate".
- **Part 10's post-completion review** (`docs/sprint-progress.md:459-468`) — three ledger defects explicitly deferred *to this Part*, all of which become unfixable once real receipt data exists. Part 13 pays them (see Consequence 4).

## Decision

### Q1 — A GR may reference a PO, or stand alone

`goods_receipt.purchase_order_id` is **nullable**. The PO-based path is the primary one: pick a sent order, the lines prefill with their outstanding quantities, prices and frozen ratios. The standalone path exists because a Thai SME restaurant buys from the fresh market in the morning without raising an order first, and the alternative — forcing a back-dated PO before the ingredients can enter stock — is exactly the "detour through master data" ADR 0012 Q5 already rejected once.

A standalone line has no frozen snapshot to inherit, so it snapshots the **live `ProductUnit`** at receipt time. That is not a weakening of Q3's rule: there is no earlier document whose meaning could drift, and the receipt *is* the originating record. *(Rejected: PO-only, and route no-PO purchases through `/stock/adjust` — an `ADJUST_GAIN` records that stock appeared, but not from whom, at what price, or against which invoice, so Part 14 would be blind to a real purchase cost. Also rejected: auto-create a hidden PO behind a standalone receipt — a document nobody sent, that would then need a status machine and a number.)*

### Q2 — `DRAFT` → `CONFIRMED`; the ledger is written on confirm and only on confirm

Two states, per master-spec §5.3. A `DRAFT` is freely editable and posts nothing; `CONFIRMED` is the atomic event that writes every movement, increments `purchase_order_item.qty_received`, recomputes the PO status, and locks the document. The split exists because counting a delivery is interruptible — twelve boxes, a phone call, a missing crate — and a half-counted receipt must not be able to move stock.

Partiality lives on the **PO**, not on the GR: a GR is always a complete record of one delivery, and a PO accumulates several of them. `purchase_order.status` therefore becomes `PARTIALLY_RECEIVED` / `RECEIVED` (the values ADR 0012 Q4 reserved for this Part) as a derived function of every line's `qty_received`, recomputed after each confirm and each void — never set by hand. *(Rejected: confirm-on-create — fewer clicks, but every mis-key becomes a compensating entry, and there is no safe point to review a delivery against its invoice.)*

### Q3 — Receiving more than was ordered is allowed, flagged, and never blocked

There is **no tolerance band** — any excess sets `goods_receipt.has_discrepancy` and requires a note on the offending line before the form will submit. The goods are physically in the kitchen; refusing to record them would make the ledger disagree with the shelf, which is the one failure mode a stock system may not have. This is the same reasoning as ADR 0011 Q9 (a negative balance is information, not an error to suppress), applied at the other end.

The `has_discrepancy` flag is also set by a **price** variance (invoice price ≠ PO price, Q7). Both are computed at confirm time and surfaced as a badge in the list, so a manager reviews by exception rather than by reading every receipt. Spec H.3's three-way UI (accept all / accept only PO amount / custom split) is **not** built: with a single department every one of those options produces the same allocation row, so it would be a choice with no consequence. *(Rejected: block over-receipt — the data would be wrong and the user would work around it with an adjustment. Also rejected: silent acceptance — an over-delivery is a real signal of supplier error or substitution, Decision #56.)*

### Q4 — `received_at` is a true instant, and the ledger's day boundaries move to Bangkok

A GR stores when the delivery actually arrived, to the minute, backdatable within the ledger's existing 90-day window. That makes Part 13 the **first writer of `occurred_at` values with a time component**, which forces the fix Part 10's review flagged: `exclusiveUpperBound` and the balance/history date filters bucketed days in **UTC**, self-consistent only while every `occurred_at` was a date-only value. Left alone, a delivery at 06:00 Bangkok would count against the previous business day, and "balance ณ วันนี้" would reach to 07:00 tomorrow.

So a date-only query bound is now expanded to the **Bangkok** day it names (`day − 7h` to `+24h`), while a bound carrying a time component is still treated as a precise instant. `computeBangkokToday()` is unchanged — it is the *business-date label*, and it was always right. Decision #60. *(Rejected: force every source to store a business-date UTC midnight — cheaper today, but it parks every receipt at 07:00, and Part 14's cost engine needs genuine intra-day ordering to walk `(occurred_at, created_at)` in the sequence things really happened.)*

### Q5 — Three tables, per the spec — not ADR 0011's `goods_received_line`

`goods_receipt` (header) + `goods_receipt_item` (line) + `goods_receipt_item_allocation`, mirroring Part 11's shape exactly. ADR 0011's Context sketched a single flat `goods_received_line` carrying `ordered/received/invoiced/discrepancy_qty` and a `resolution_status`; that sketch predates the decision that a GR is a *document*. Q2's `DRAFT` state, the GR number, the invoice number, the received-at instant and the void audit all belong to a header, and a flat line table has nowhere to put them.

Per the source-of-truth rule in CLAUDE.md an ADR beats the spec, but **this ADR is the more recent one**, and it agrees with the spec here. The schema comment on `SourceType.GR_LINE` — which pointed at `goods_received_line` — is corrected to `goods_receipt_item`; the enum **value** is unchanged, so nothing in the ledger migrates. `invoiced_qty` and `resolution_status` are not built: three-way invoice matching has no AP module to serve, and `has_discrepancy` + a line note is what a single reviewer actually acts on. *(Rejected: the flat table — it would have needed a header added back in the same sprint.)*

### Q6 — A confirmed GR is voided, never edited; the void appends reversal lines

`CONFIRMED` → `VOIDED` is the only transition out. Voiding inserts, into **the same document**, one **reversal line** per original line: negative `qty_received_actual`, `reversal_of_item_id` pointing at what it undoes. Each reversal line is its own ledger source, so it produces its own movement — of a new type, **`PO_RECEIVE_REVERSAL`**, which is negative. `purchase_order_item.qty_received` is decremented back, any manual short-close is cleared, and the PO status is recomputed. The original movements are not touched, because they cannot be: this is ADR 0011's compensating-entry doctrine applied literally.

Adding a movement type triggers the standing item ADR 0011 Q2 recorded — `stock_movement_sign_check` is **dropped and re-declared** in this Part's migration, with `PO_RECEIVE_REVERSAL` on the negative side. Reversal lines also need their own sign rule, so `goods_receipt_item` carries a `CHECK` binding `qty_received_actual > 0` to a normal line and `< 0` to a reversal.

Keeping the reversals inside the original document (rather than issuing a separate "credit GR") means the detail page shows the mistake and its correction side by side, which is what someone auditing a month later needs to see. *(Rejected: no void in MVP, correct with a manual `/stock/adjust` — the quantity would be right and the story would be lost: `qty_received` on the PO line would stay permanently wrong, and Part 14 would cost a purchase that never happened. Also rejected: a separate reversal GR document — two numbers, two headers, one event.)*

**Implementation clarification (L3b): the reversals occur NOW, not at the original `received_at`.** The grill did not settle which instant a compensating movement carries. Backdating it to the delivery would silently change the balance "as of" a week ago and force Part 14 to re-cost a period it may already have closed; a general ledger reverses on the day the error is found, and both entries stay visible with their own true instants. Recorded here rather than left to the reader of `voidGoodsReceiptLogic`.

### Q7 — The GR line records the price actually invoiced

`unit_price_actual` and `line_total_actual` live on the line, defaulted from the PO line's frozen `unit_price` and freely editable — the receipt is the moment the invoice is in someone's hand, and it is the last moment the real number is cheap to capture. `variance_qty` and `variance_price` are **computed at read**, not stored: they are pure functions of values already on the row, and a stored copy is one more thing that can disagree with itself. A standalone line has no PO price, so the typed price is simply the price.

This is the number Part 14 will cost stock at, which is why capturing it here rather than deferring is worth a column. *(Rejected: inherit the PO price silently — a standalone GR would then have no price at all, and every genuine price difference on an invoice would be invisible until someone reconciled a bank statement.)*

### Q8 — A short-delivered PO is closed by hand

Nothing infers that a supplier has given up. `RECEIVED` is set automatically only when every line's `qty_received` reaches its `qty_ordered`; otherwise the PO stays `PARTIALLY_RECEIVED` until someone presses **"ปิดรับ"**, which sets `RECEIVED` and stamps `closed_short_at` / `closed_short_by` / `closed_short_reason` on the header. Three nullable columns on `purchase_order` (an additive migration on a Part 11 table) rather than a new status value, so every existing filter, badge and label keeps working and the reason is still on the record.

Without this, a PO short by 2 kg would sit in the open-orders read forever, and `getOpenOrderQtyForProductLogic` would keep telling the stock page that goods are on the way. *(Rejected: auto-close after N days — invents a deadline the supplier never agreed to. Also rejected: a `CLOSED_SHORT` status — more honest in the list, but every consumer of `PurchaseOrderStatus` would have to learn a fifth reachable value to express something the timestamp already says.)*

## Consequences

1. **Part 14 (Cost Engine) gets everything it needs and nothing it must guess.** Each `PO_RECEIVE` movement resolves to a GR line carrying the price actually invoiced (Q7), in a document with a real instant (Q4), against a PO line whose numbers were frozen when it was sent. Weighted-average vs FIFO, and the AP discrepancy cost policy, remain Part 14's own ADR.
2. **The ledger gains its second and third movement types in one Part.** `PO_RECEIVE` finally has a writer, and `PO_RECEIVE_REVERSAL` is created alongside it. Any Sprint 3+ type (WASTE / TRANSFER_* / RECIPE_CONSUME) still has to drop and re-declare the sign CHECK; this Part is the precedent for how.
3. **`purchase_order.status` is now a derived value.** Part 11 wrote it directly on send and cancel; from here `PARTIALLY_RECEIVED` / `RECEIVED` are recomputed from line quantities by `recalcPurchaseOrderReceiptStatus` after every confirm, void and manual close. `cancelPurchaseOrderLogic`'s existing refusal ("ยกเลิกไม่ได้ — มีการรับของเข้าคลังแล้ว") becomes reachable for the first time.
4. **Three ledger defects deferred by Part 10's review are paid here, because this Part is the last moment they are free:** Bangkok day bucketing (Q4); source-level idempotency, via a client-generated `submit_key` used *as* the `goods_receipt.id`, so a double POST resolves to the same document instead of a second one; and `createStockMovementLogic` returning a replayed movement without checking it matches — now compared on `(productId, branchId, qty, type, occurredAt)` and rejected with `MovementSourceMismatchError`. The idempotency lookup also gains the `tenantId` filter it was missing.
5. **`withTenantContext` grows an options argument.** Confirming a twenty-line receipt writes twenty movements, twenty PO-line updates and a status recompute in one transaction, against Neon in Singapore; Prisma's default 5s `$transaction` timeout is not enough. The parameter is optional, so every existing caller is unchanged.
6. **The spec is stale in three further places, all reconciled toward this ADR:** §5.3's `goods_receipt.invoice_image_url` and `auto_created_expense_id` (no object storage; no expense module until Sprint 3 — the ADR 0012 Q6 rule against permanently-null columns applies), §5.3's `goods_receipt_item.product_unit_id` as a live FK (same correction Q3 of ADR 0012 made for the PO line), and H.3's three-option excess UI (Q3 above).
7. **The H.2 GR mirror trigger pair is not built either.** Same reasoning as ADR 0012 Q2: the allocation sum is enforced in the write transaction, and with one department the invariant can only ever be "one row = the whole line". Pro-rating is implemented properly anyway (largest-remainder, tiebreak by lowest id, per H.3) so that the day a second department exists, only the UI is missing.

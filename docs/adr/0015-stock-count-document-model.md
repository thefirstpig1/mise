---
status: accepted
---

# Stock Count: the document that makes the ledger true

The ledger is *consistent* — every movement is accounted for — but consistency is not truth. Stock walks out of a kitchen: it spoils unrecorded, it is over-portioned, it is taken home, a delivery is signed for and never keyed. **A physical count is the only thing that reconciles the ledger with the shelf**, and Part 15 models it as a document that observes, then posts the difference. A count records what was found, per line, by whoever found it; closing it writes the variance into the append-only ledger as ordinary gains and losses. It stores **no money at all** — Part 14 already values everything, and a stored valuation would be falsified by the next cost declaration — but it **does** store the expected quantity, because "what did we find that day" is a past event that must not move. Decisions locked in the grill of 2026-08-17 (Q1–Q8).

## Context

Sprint 2 built the ledger (ADR 0011), the two documents that feed it (ADR 0012/0013), and a cost engine that values it FIFO by replay (ADR 0014). What none of them can do is notice that the ledger is *wrong*. `stock_adjustment` exists for a one-off correction typed into a form, but a stock-take is a different animal: dozens of lines, several people, a deliberate moment in time, and a number that management reconciles against.

Three pieces of prior art bind this Part:

- **ADR 0011 Q4/Q7** — one movement per source row, and the ledger is strictly append-only. A closed count cannot be edited, only compensated.
- **ADR 0013** — the shape of a document that posts to the ledger: draft is free, the confirm is the event, the void appends reversal lines into the same document.
- **ADR 0014 Q6/Q12** — cost is computed, never stored; and stock that arrives without a document is priced by the declaration chain, a mechanism explicitly designed to be shared with this Part.

The master spec §5.5 supplies the table shapes and is followed except where noted below.

## Decision

### Q1 — A count item is the ledger source: `SourceType.STOCK_COUNT`

Closing a count writes one movement per line whose variance is non-zero, with `source_type = STOCK_COUNT` and `source_id = stock_count_item.id`. The movement's **type stays `ADJUST_GAIN` / `ADJUST_LOSS`** — a variance *is* stock going up or down, not a new kind of event — so `stock_movement_sign_check` is untouched and the two-migration dance Part 13 needed does not apply here. `assertSourceExists` grows one branch, exactly as it did for `GR_LINE`.

`UNIQUE(source_type, source_id)` then makes closing idempotent for free: a second close finds each line's movement already there. Part 13 had to invent a `submit_key` for this; a count line already has an identity.

A line whose variance is zero writes **nothing** — the sign CHECK forbids a zero-qty movement, and nothing moved.

*(Rejected: reusing `stock_adjustment` with `reason = RECOUNT`. It looks cheaper, but answering "which count produced this?" would force a `stock_count_item_id` column onto `stock_adjustment` anyway — a schema change either way — and it would leave that table with two identities, so every future query over it has to know which kind of row it is holding.)*

### Q2 — Who counted is per LINE, and the draft is a working sheet

`stock_count` carries `started_by` / `closed_by` / `closed_at`; `stock_count_item` carries `counted_by` + `counted_at`. Per line, not per document, because two people split a count — one does the freezer, one does dry goods — and "who wrote this number" is the question asked when a number looks wrong.

A line may be re-counted while the document is open, **overwriting** the previous entry. The draft is a working sheet; forcing it to preserve every erasure would make people reluctant to correct it, which is the opposite of the goal. Permanence begins at close, and from there the ledger — which cannot be edited at all — is the record.

**`counted_by_name`, a free-text field, sits beside the `counted_by` FK.** In a Thai SME the owner holds the only login and the staff do the walking; an FK alone would record "the owner counted everything", which is tidy and false. The FK answers *who is accountable for the entry*, the text answers *who actually counted* — and without the field that fact ends up in the notes column unstructured anyway.

### Q3 — `qty_expected` IS stored, snapshotted when the line is saved

This looks like a contradiction of ADR 0014 and is not. The two numbers answer different kinds of question:

| | the question | so |
|---|---|---|
| `qty_expected` | *"what did the system say when you stood at the shelf?"* — a past observation, investigated and closed | must **not** move → store it |
| cost | *"what is this worth?"* — a valuation | should **improve** as we learn → compute it |

If expected were recomputed, a receipt backdated a month later would silently change the variance on a count that was already investigated and acted on.

The snapshot is taken **when the line is saved, not when the document is closed**. Counting the freezer at 10:00, receiving into it at 14:00 and closing at 18:00 would otherwise report a shortage exactly the size of the delivery. It also means the expected figure is captured whether or not it is displayed, which is what makes Q7's blind-count toggle a pure UI concern.

### Q4 — The count stores no money

§5.5's `unit_cost_at_count` and `total_value` are **not built**; this ADR supersedes them, as ADR 0014 superseded `product_cost_history`. A declaration made later applies at every date including ones already reported (ADR 0014 Q6), so a stored valuation would become a wrong number sitting in the database — the exact failure the replay design exists to prevent.

Nothing is lost: `replayFifoLayers` already records `outflows[]`, so the money a variance cost is known, and `getProductCostsLogic` values what was counted. The count screen shows totals in baht; they are simply computed, from the same source as every other money figure in the product.

### Q5 — Count variance is its own column in the branch summary

A count shortage posts as `ADJUST_LOSS` and would therefore flow into `/cost`'s existing "ของเสีย/ของหาย" column. It is split out instead, because the two numbers demand different actions: spoilage is a purchasing and storage problem to raise with the kitchen; an unexplained count variance is theft, mis-keying, or bad receiving, to raise with the branch manager. A figure that cannot tell a manager who to talk to is worth less than one that can. The split is free — `outflows[]` already carries `sourceType`.

### Q6 — `DRAFT → CLOSED → VOIDED`

`COUNTING` is dropped: it differs from `DRAFT` only in whether lines exist, and nothing behaves differently between them. `REVIEW` is dropped for the reason ADR 0012 Q1 dropped the PR layer — it needs a second actor to approve, and there is no role or approval machinery for one to exist in.

`VOIDED` is **added**, though §5.5 has no such state. A count closed in error cannot be edited (ADR 0011 Q7), and without a void the user's only recourse is a hand-typed adjustment, which breaks the audit trail at precisely the point it matters. The void appends reversal lines into the same document (`reversal_of_item_id`), each producing the opposite movement — and since reversing an `ADJUST_LOSS` is an `ADJUST_GAIN`, no new movement type and no sign-CHECK migration are needed.

### Q7 — A line means "counted"; blind counting is a per-count switch

**A line in the count means the product was counted; no line means it was not touched.** `qty_counted = 0` is a real observation — *"I looked, there is none"* — and posts a loss down to zero. Conflating the two would let a count of one shelf wipe the whole store. The close screen reports how many products hold stock but were not counted, as information rather than an obstacle.

Whether the counter sees the expected figure is a **per-count toggle chosen when the sheet is opened, defaulting to showing it**. Textbook inventory control hides it, but in the MVP the person counting is usually the owner, for whom hiding it is friction that controls nothing. The toggle exists so a shop that has grown into staff-run counts can turn it on without waiting for a feature.

### Q8 — Variance occurs when the line was counted; one open count per branch

`occurred_at` on a variance movement is **that line's `counted_at`**, a true instant — not the close, and not `count_date`. Both choices reach the same final balance, but dating the variance at close makes the ledger claim stock was on the shelf for the eight hours after it had already been counted short, and makes FIFO draw from the wrong layers. The header's `count_date` remains the document's human name ("the count of 20 Aug"), not an accounting date.

**At most one `DRAFT` count per branch**, enforced by a partial unique index (`WHERE status = 'DRAFT' AND deleted_at IS NULL`, the pattern of `product_sku_unique`). Without it, two people counting the same shelf both see the same expected figure, both find the same shortage, and both post it — halving the stock silently. This restricts nothing real: two people counting different sections share **one** sheet and enter their own lines, which is what per-line `counted_by` was designed for. One count event, several counters.

### Decided by existing convention (not grilled)

`sc_number` = `{BRANCH_CODE}-SC-####` per branch via `acquireCounterLock` (Pitfall #25 already closed) · `tenant_id` on all three tables (ADR 0004) + RLS appended, inert until Sprint 7 · Decimal→string at the view layer (Pitfall #20) · decimal guards via the `toFixed` round-trip (Pitfall #30) · soft-delete for `DRAFT` only, `CLOSED` goes to `VOIDED`.

## Consequences

1. **The ledger gains its first non-document source of truth about physical reality.** Everything before this Part described intentions and deliveries; a count describes the shelf. Sprint 5's variance analysis (theoretical vs actual) has an "actual" to compare against because of this Part.
2. **`SourceType` gains a value, `MovementType` does not.** That asymmetry is the whole reason this Part avoids the migration dance Part 13 needed, and it is worth preserving: future sources of gains and losses should reuse the existing types rather than minting new ones unless the *sign rule* differs.
3. **A count's own numbers are frozen; their valuation is not.** The variance in kilograms is history; the same variance in baht will improve if someone later declares what the stock cost. Both are correct, and the distinction is now precedent for anything else that records an observation.
4. **`/cost` grows an eighth column.** The branch summary is approaching the width where a table stops being readable; the next figure added should probably replace one rather than join it.
5. **One open count per branch is a DB constraint, not a convention.** If a legitimate need for concurrent counts of one branch ever appears — two warehouses under one branch id, say — the index has to be reconsidered deliberately, which is the point.

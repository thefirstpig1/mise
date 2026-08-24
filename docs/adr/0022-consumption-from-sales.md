---
status: accepted
date: 2026-08-24
---

# Posting `CONSUMPTION` from imported sales

Part 21 taught the system what a dish is made of, at a branch, on a given day.
Part 19 already knows what was sold. **Nothing joined the two**, so the ledger
still believed stock only ever rises between counts. Part 22 is the join: twelve
plates of กะเพรา take 1.2 kg of minced pork out of the ledger.

Grilled 2026-08-24, Q1–Q11. This ADR is authoritative over `docs/master-spec.md`
§H.5, whose algorithm is superseded in four ways the spec already records.

## Context

The prior art this builds on, and the constraints it inherits:

- **ADR 0011** — the ledger is append-only, keyed `(source_type, source_id)`, and
  a correction is a compensating row. Negative stock never blocks (Q9).
- **ADR 0013 Q6** — a confirmed document is voided by appending **reversal lines
  to the same document**, and the compensating movement occurs **now**, not at
  the original date.
- **ADR 0014 Q8** — a reversal cuts **the layer it reverses**, not the head of
  the queue.
- **ADR 0019** — sales arrive as a file; re-importing **replaces a day**, and the
  replaced rows are kept marked superseded *precisely so* this Part's movements
  keep a document to point at. Consequence 2 left a standing instruction.
- **ADR 0021** — a recipe is append + supersede with an effective date, resolved
  per branch per day; ingredients may point at a menu; `CONSUMPTION` is the name
  (Q12), created in the migration that first writes it.

## Decision

### Q1 — The source is a document of its own, at the grain **product × branch × day**

`stock_movement` is uniquely keyed on the **pair** `(source_type, source_id)`, and
one `sales_line` explodes into N raw products — so the sales line cannot be the
source. Part 18's trick of two source types over one row id does not generalise
to an unbounded N.

`sales_consumption_run` (branch × business date) + `sales_consumption_item`
(one per product), the **item id being `source_id`**. It is the shape every
posting document in this system already has, and it gives the reversal somewhere
to point.

The item aggregates every menu sold that day. *(Rejected: an item per
`sales_line` × product — it answers "which dish ate what", which nothing asks:
H.8's variance (Sprint 6) compares at the **product** level and the coverage
report names menus without needing a movement per menu. It also multiplies the
ledger ~50× and `/cost` replays every row of it.)*

### Q2 — Posting is an explicit step, not part of the import

A shop that imports before writing its recipes must be able to post later
without re-uploading; and **a recipe problem must not sink a good file**. A
cycle, or a PREPPED product missing its yield, throws — inside the import
transaction that would roll back an import with nothing wrong with it, undoing
the one thing ADR 0019 built a whole Part to make a database fact.

The button lives on the import result, so it is one click and not a hunt. It
mirrors the shape the import already has: see what will happen, then do it.

### Q2b — Posting a day again voids the previous run and posts a fresh one

Not a top-up. Q5 needs "void the whole day" anyway, so reusing it here leaves
**one mechanism instead of two** — and a top-up would silently miss a recipe
that was *edited* rather than added, because that menu already counts as posted.

### Q3 — What a cancelled order does to stock is **the shop's decision, not ours**

A negative sales row is a bill that was cancelled. The file cannot say whether
it was cancelled at the till before anyone cooked, or sent back after — the
first returns nothing to stock, the second consumed the ingredients and the loss
is real. Both are common; neither dominates.

`tenant.cancelled_sale_policy`:

| value | negative rows | ขาย 12 ยกเลิก 1 | what a count then shows |
| --- | --- | --- | --- |
| **`TREAT_AS_COOKED`** (default) | ignored | consumes 12 | a **surplus**, which is itself the signal that orders were cancelled |
| `TREAT_AS_NOT_COOKED` | subtracted | consumes 11 | correct if truly uncooked; a **shortfall** if it was cooked |

Because most of the day's negatives cancel positives of the same menu, this is
usually arithmetic on `qty` rather than a movement of its own.

**The principle this establishes, and which outlives this Part:** when the
ambiguity comes from *the nature of the shop* rather than from our own
indecision, it becomes a setting, presented with its consequence and a worked
example, and the owner decides. It does **not** license a switch for every
ambiguity — one that has a right answer must still be answered here, or the
settings page becomes where decisions go to be avoided.

*(Rejected: netting silently, as the plan first proposed on the grounds that
till-side voids are more common. That is the system guessing on the shop's
behalf about its own operation — the failure ADR 0019 was organised against.)*

### Q3b / Q3c — Default `TREAT_AS_COOKED`, tagged **แนะนำ** with its reason, and shown twice

The default is the conservative one: the error surfaces as a countable surplus
rather than as a shortfall indistinguishable from theft.

A consequential default must not sit hidden. It appears in a **"การคำนวณ"**
group in `/settings` — which `gross_profit_method` joins, it having had the same
problem since Sprint 4 — with every switch carrying its recommendation, its
reason and an example; **and again inline the first time it actually bites**, on
the first consumption post, where the shop has a real sales file in front of it
and the question finally means something.

*(Rejected: asking at signup. The owner has then never imported a sale nor
written a recipe, and R13 already records what happens to a default answered
without context — it is the value people click past.)*

### Q4 — A menu posts whole or not at all; coverage is reported; nothing is blocked

Three things stop a menu from being posted, and the third is the dangerous one:

1. **no recipe** — including every POS stub the import created;
2. **a recipe that cannot be exploded** — a PREPPED input with no yield, a cycle,
   a chain over five deep;
3. **a recipe whose component menu has no recipe** — `explodeToRaw` returns
   nothing for that branch of the walk and carries on, so the dish would post
   **too little, silently**.

The third is rule R16 in stock's clothing — *"a component menu with no recipe is
UNKNOWN, not free"* — and at posting time there is no confidence field to demote,
only a wrong quantity. Hence **all or nothing per menu**: anything unresolved
below it puts the whole dish in the not-posted list with its reason.

The day still posts what it can, and the report says how much of it that was.
**Coverage is measured as a share of `net_amount`**, not of dish count, because
the question behind it is "how wrong is my cost of goods sold" and a ฿20 water
is not a ฿300 steak. Warn, never block — the same discipline as Part 20a's
pulse.

### Q5 — A re-import voids the day's posting automatically, inside the commit

Superseding the sales lines makes the posted movements refer to sales that no
longer stand: the ledger is wrong and the system knows it. Waiting for a user to
notice is not an option ADR 0019 Consequence 2 left open — it says a re-import
**must** append compensating movements.

The void is safe to put inside the import transaction for the exact reason the
*post* is not: **voiding needs no recipe**. It reads the movements already
posted and appends their negation, so it cannot fail on a cycle or a missing
yield. Re-posting stays the user's explicit step (Q2).

Per Part 17's rule, a reversal is valued from **the original movement**, never
recomputed from today's recipe or today's unit ratios.

### Q6 — `CONSUMPTION_REVERSAL` is its own type, and it gives back what it took

The sign CHECK binds one sign per type, so a compensating inbound movement needs
either its own type or `ADJUST_GAIN` + a source type, which is what waste does.
Waste can afford it; this Part cannot. Voiding a month of sales at *last known*
cost inflates inventory by the spread: 10 kg that left at ฿180 returning at ฿220
adds ฿400 to stock value **for the act of importing a file twice** — and gross
profit by สูตรอาหาร, the thing this Part exists to deliver, is what that
corrupts.

So the reversal restores the layers the original movement consumed, with the
values it consumed them at — ADR 0014 Q8's rule pointed the other way round.
`reverseOwnLayer` is already its mirror image for inbound reversals, and
`CostMovement` already carries `reversalOfItemId`, so the engine has both the
shape and the pointer; the replay records what each outflow took in `outflows`.
**No cost is stored**, so ADR 0014 keeps its single exception (the transfer).

**Implementation clarification (flagged, not grilled):** under
`TREAT_AS_NOT_COOKED` a day's net for a product can come out **positive** —
yesterday's cancellation exported into today's file. That is a return, not a
reversal of any particular movement, so it posts `CONSUMPTION_REVERSAL` with a
null `reversal_of_item_id` and is valued at last-known cost, the engine's
ordinary inbound rule. Rare, and it appears in the run's report.

### Q7 — A recipe changed after a day was posted: say so, do not re-post

Part 21 allows a version effective from a past date, which falsifies days already
posted. Re-posting automatically would rewrite a period the shop may have
closed, with nobody asking for it — and Part 21 stands on the principle that
editing a recipe never reaches back and touches something quietly.

The signal turns out to be **the same one** as "I have written more recipes, let
me post that day again": *a recipe that covers that day was created after the day
was posted*. `sales_consumption_run.posted_at` against `recipe.created_at`, over
the menus actually sold that day — **no new table, nothing stored**.

### Q8 — The set menu's department split is **not this Part's** and is deferred

`stock_movement` has no `department_id` at all — the master spec §5.5 says it
does, ADR 0011 built it without, and the ADR wins. `menu.primary_department_id`
is written by the menus screen and read by no report. `/cost` is per branch, and
so is this Part's gross profit.

The reason the question was routed here — *"`/cost` is being touched anyway"* —
does not survive contact with the code. Deciding it now yields a calculation rule
no line enforces, which is what ADR 0019 Q6 calls debt, taken without the screen
in front of us that ADR 0021 said such decisions need. The watchlist row moves to
whoever builds revenue by department.

### Q9 — Gross profit by สูตรอาหาร prints with its coverage, not as "—"

`cogsSold` is the FIFO value of the period's `CONSUMPTION` outflows net of
`CONSUMPTION_REVERSAL`, which the replay computes already.

A period may be posted only in part. The plan proposed "—" with a reason; **this
reverses that.** ADR 0019 already requires every gross-profit row to carry when
its branch last closed a count, and W4 requires every par row to state its own
freshness: the house rule for an imperfect figure is to **print it with its
freshness attached**, not to withhold it. A shop that posted 29 of 30 days learns
nothing from a dash.

The "—" that ADR 0019 does mandate is a different thing: it forbids computing by
one method and printing it under the other's name. It does not forbid a figure
that says how much it covers.

One case stays "—": **no day in the period posted at all**, because `0.00` reads
as "cost of goods sold was nothing", which is not what is being said.

### Q10 — Sales older than the backdate window cannot be posted, and say so

The movement carries the **business date**, not the moment the button was
pressed; otherwise thirty imported days pile onto today, FIFO cuts in the wrong
order, and every `asOf` read lies about the past.

That collides with `MAX_BACKDATE_DAYS = 90`, which every document in the system
respects, and which `createStockMovementLogic` deliberately does **not** enforce
— `stock-movement.ts:823` hands it to the caller. Part 22 enforces it rather
than being the one writer that slips underneath a rule everything else keeps.

Sales beyond the window import normally and simply do not post; the day joins the
coverage report with "เกินหน้าต่างย้อนหลัง 90 วัน" as its reason — one mechanism,
already built for Q4. *(Rejected: making the window a tenant setting so a new
shop can backfill a year. That is a change to a rule the whole ledger shares and
belongs to a Part of its own, not to this one's margin.)*

### Q11 — The document is named for what it is today

`sales_consumption_run` / `sales_consumption_item`, `SourceType.SALES_CONSUMPTION`.
CONTEXT.md already records that a staff meal (Part 23) posts `CONSUMPTION` "like
a sale does, distinguished by its own `source_type`" — so Part 23 brings its own
document, exactly as waste, transfer and stock count each brought theirs.

*(Rejected: a generic `consumption_run` with an origin column. The column would
hold one value for the whole Part, which is `SourceType.SYSTEM_INITIAL` again —
reserved in Part 10, still unwritten eight Parts later, and the standing warning
ADR 0019 quotes.)*

## Schema

| Table | Grain | Notes |
| --- | --- | --- |
| `sales_consumption_run` | **branch × business_date** | `posted_at`/`posted_by`, `voided_at`/`voided_by`/`void_reason`, and the coverage the report reads back: covered vs total `net_amount`, menus posted, and the not-posted list with each menu's reason. Not unique on (branch, date) — a voided run and its replacement both stand |
| `sales_consumption_item` | run × **product** | `qty` signed in the product's base unit · `reversal_of_item_id` · **this row is the ledger's source**: `source_type = SALES_CONSUMPTION`, `source_id = this id` |

Also: `MovementType += CONSUMPTION, CONSUMPTION_REVERSAL` · `SourceType +=
SALES_CONSUMPTION` · `tenant.cancelled_sale_policy` · `stock_movement_sign_check`
dropped and re-declared with `CONSUMPTION` on the negative side and
`CONSUMPTION_REVERSAL` on the positive.

**Two migrations** (ADR 0011 Q2, Part 13a/18a precedent): the enum values alone
first, because Postgres refuses to use a new enum value in the transaction that
added it; the CHECK re-declared in the next.

## Consequences

1. **The ledger finally falls as well as rises**, which retires the standing
   optimism note on periodic-inventory gross profit (P25 × P26) and on par levels
   (W4 × U4) — for the days a shop actually posts.
2. **`fifo-replay.ts` gains one case**, its first change since Part 18. It is the
   most delicate file in the system and the one place this Part touches it.
3. **A shop can be honestly told how wrong its cost is**, in one number, for the
   first time: coverage is a share of revenue and it appears on `/cost`.
4. **Part 23 inherits a pattern, not a table.** A staff meal brings its own
   document and its own source type; the movement type and the explosion are
   shared.
5. **Production movements are still owed** — nothing raises a PREPPED balance, so
   the walk still goes straight through to RAW (ADR 0021 Q11) and counting a
   prepped item still reports a gain. Unchanged by this Part, still on screen.
6. **The rules are registered** in `docs/calculation-rules.md` §10 (N1–N12 — `S` was already the stock-count prefix) as
   they were decided, and the ★ items seed the user manual.

## References

ADR 0011 (ledger) · 0013 Q6 (void by reversal lines) · 0014 Q8 (a reversal cuts
its own layer) · 0017 Q1 (source vs type) · 0018 Q4 (why transfers needed types)
· 0019 (sales import; Consequences 2 and 3) · 0021 Q4/Q11/Q12/Q16 (recipe
resolution by day, PREPPED walk-through, the name, servings).

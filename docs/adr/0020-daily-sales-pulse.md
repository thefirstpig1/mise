---
status: accepted
---

# One number a day, and the only thing that can catch a half-exported file

Part 19 made sales arrive as a file, and a file arrives when somebody fetches it — weekly, monthly, whenever the back office gets opened. Between those moments Mise has nothing to say about how the shop is doing, and an owner who opens it to find figures twelve days stale stops opening it. Part 20 is the answer, and it is deliberately small: **one number, per branch, per day.**

It turns out to buy something the whole of Part 19 could not. Decisions locked in the grill of 2026-08-20 (Q1–Q4).

## Context

1. **Gross profit can never be real-time**, because the cost side is not: invoices arrive days late, counts are periodic, and waste is recorded when somebody remembers. Chasing a live margin is chasing a number that does not exist.
2. **The owner is not actually blind** — the POS app shows today's takings. What Mise uniquely cannot show between imports is *all branches together, against what was spent*, and that is not a question anybody asks hourly.
3. **The end-of-shift email POS platforms send is a summary** — a day's total, no per-menu detail (ADR 0019 Context 4). That limitation, which made it useless for Part 19, makes it exactly right here.
4. **`sales_day` already exists** at the grain this needs, and its `current_batch_id` was made nullable in Part 19 precisely so a day could exist before any detail file did.
5. **Part 19 built five defences and none of them can see a half-exported file.** A file whose date range stopped at 6pm parses cleanly, passes the header signature, has no blank cells, resolves every menu and commits without a murmur. Every row in it is true. It is only *incomplete*, and nothing inside the file says so.

## Decision

### Q1 — The pulse is what the customer paid, and the reconciliation compares like with like

The number a POS reports at close is the till total: after discount, **including** VAT and service charge. Revenue in Mise is deliberately none of those (ADR 0019 Q10) — after discount, excluding both. The two differ by up to about 17%.

Comparing them directly would raise a mismatch warning every single day, and a warning that fires every day is a warning nobody reads — worse than no warning, because it also teaches people to ignore the ones that matter.

So the pulse stores **what the customer paid**, and reconciliation compares it against `net + vat + service_charge` summed from the day's live sales lines. Both sides are then the same kind of number.

The dashboard shows the pulse as "ยอดขายวันนี้", which is the figure the owner also sees in the POS app. Anything else and the two screens disagree on day one, and rule P14's problem returns: a number that contradicts the POS is a number that discredits every other number beside it.

**No "does this include VAT?" flag.** That question belongs to a *file*, whose shape varies by vendor (rule P10). A till total read off a screen and typed in has one meaning already, and asking every day would be friction that buys nothing.

### Q2 — Optional, entered by whoever is closing up, and locked once the detail arrives

**Optional.** A shop that only ever imports files gets every figure it had before; it simply has nothing between imports. The pulse is a bonus, never a precondition — the same rule that kept par levels from becoming a chore.

**Entered by the cashier at close**, in one box on the dashboard, not by the owner. Five seconds inside a task they are already doing. That is a different thing from "log into the POS back office and export a file", which is the owner's job and takes real time — the chore Part 19 Q3 designed away.

**Backdatable and editable — until the detail lands.** Forgot Saturday, enter it Monday. Typed 4,000 for 40,000, fix it.

But once a detail file has been committed for that day, **the pulse freezes**. Its job has changed: it is no longer the figure anyone is reading, it is the evidence the file gets checked against. If it stayed editable, the obvious way to clear a mismatch warning would be to edit the pulse until it agreed — which destroys the only reason to keep it.

### Q3 — Warn at the preview, never overwrite, never block

**Where matters more than whether.** The warning belongs on the import preview, *before* commit, because that is the only moment somebody is holding the file and can still do something: re-export it, widen the date range, ask the cashier. A warning shown afterwards is a warning nobody acts on.

This is what the pulse buys that nothing else in the system can:

> A file exported for part of a day is **valid in every way Part 19 knows how to check.** Every row is real, the header matches, no cell is blank, every menu resolves. It is simply missing the evening. The pulse is the only witness.

**Threshold: 1% or ฿100, whichever is larger** — so a ฿40,000 day warns above ฿400 and a ฿3,000 day above ฿100, rather than small days crying wolf. ⚠️ This number is a guess. Like Section C's confidence thresholds it is written down as a starting value to be validated against real shops before Beta, not as something that was reasoned to.

**Never blocks the commit.** If a mismatch blocked, the fastest way past it would be to delete the pulse — and then both the warning and the evidence are gone. The detail always wins as the *figure*; the pulse remains as the *record*, and the difference is shown beside them from then on.

### Q4 — Three surfaces, and no chart on the dashboard

1. **The dashboard**: one row per branch — today, yesterday, last 7 days — plus a box to enter today's pulse for any branch missing one. Where a day has detail, the detail is used (converted to customer-paid so the columns compare); where it does not, the pulse is. **Every figure says which it came from**, because a number that hides its own provenance gets trusted past the point it has earned (rules C10, W4).
2. **`/sales` daily list**: a pulse column and the difference, shown side by side permanently.
3. **The import preview**: the Q3 warning.

Multi-branch shops see **each branch, then an explicit roll-up line** — never a silent total that could be mistaken for one branch, per CONTEXT.md's definition of Tenant.

**No chart on the dashboard.** The dashboard answers "how is today"; `/sales` answers "how is this month" and already does it well. Putting a chart on both leaves two pages answering the same question and neither answering it best.

## Schema

`sales_day` gains five columns and nothing else is touched:

| Column | Why |
| --- | --- |
| `pulse_amount` | What the customer paid, 2 dp |
| `pulse_source` | `MANUAL` today; `EMAIL` is added by the Part that writes it, not reserved now |
| `pulse_recorded_by` | Who typed it — a figure used as evidence needs a name on it |
| `pulse_recorded_at` | When |
| `pulse_note` | "ตู้เย็นเสีย ปิดเร็ว" — why a day looks odd, from the person who was there |

Two CHECKs: the five move together (all set or all null), and `pulse_amount >= 0`.

That sign check is the opposite of the decision `sales_line` took, and deliberately. `sales_line` mirrors the POS, where a refund really is negative and Mise is not the authority (ADR 0019 Q14). The pulse is **typed by a person**, where a leading minus is a slip and Mise is the only check there is.

**Reconciliation is computed at read and stored nowhere** — the rule ADR 0016 Q5 set for recurring costs and ADR 0014 set for cost itself. A stored difference is a difference that goes stale the moment a day is re-imported.

## Consequences

1. **A half-exported file becomes visible**, which no defence built in Part 19 could manage.
2. **`EMAIL` intake is NOT built** (Part 20b). It needs an inbound-mail vendor and an `.env` edit, both stop-and-ask items — and the enum deliberately carries only the value that has a writer today, following ADR 0019's own reasoning about `SYSTEM_INITIAL`.
3. **The threshold needs real shops.** Until then it is a guess with a comment saying so.
4. **A day can now exist with a pulse and no lines.** Every reader of `sales_day` must treat "no detail yet" as ordinary rather than as missing data.

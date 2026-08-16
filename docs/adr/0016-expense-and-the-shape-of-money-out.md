---
status: accepted
---

# Expense: every baht that leaves, in one place

Sprint 2 taught the system what materials cost. It never learned about rent, electricity, wages, or the accountant's fee — so `/cost` could show what a branch **bought** but not what it **spent**. Part 16 closes that: `expense` + `expense_item` capture every non-stock outgoing, a confirmed goods receipt **creates its own expense** so purchases and overheads live in one table, and Thai VAT and withholding tax are recorded properly for the first time. Two corrections fall out of it — **stock cost has been understating itself by the VAT amount for every tenant that is not VAT-registered**, which is most of them; and the spec's withholding-tax formula computes on the wrong base. Recurring costs are handled by *computing what is due* rather than by generating rows nobody asked for. Decisions locked in the grill of 2026-08-17 (Q1–Q7).

## Context

`/cost` (ADR 0014 Q9b) exists to tell an owner where the money goes, and it has been answering with one column: what was received against purchase orders. Everything else a restaurant pays for was invisible. Meanwhile three earlier Parts left explicit IOUs here:

- **ADR 0012 Q6** — *"WHT is deducted at payment, and there is no payment or expense module until Sprint 3; it lands there, with the accounts that need it."*
- **ADR 0013** — no `auto_created_expense_id` on the receipt, for the same reason.
- **ADR 0014 R4** — a closed period's cost can still change, and *"only matters once Sprint 3 books expenses against those numbers."*

Two facts about the existing data shaped the whole grill:

1. **A goods receipt records no VAT at all.** `line_total_actual` is `qty × unit_price_actual`; the PO puts VAT at the header (ADR 0012 Q6) and the GR does not carry it forward. So every FIFO layer is valued **net of VAT**.
2. **`tenant.is_vat_registered` defaults to `false`**, and most Thai SMEs are under the ฿1.8M threshold. For them, input VAT is not reclaimable — it is money gone.

Together those mean the common case has been valued about 7% low.

## Decision

### Q1 — Scope

IN: `expense` + `expense_item`; VAT (inclusive and exclusive entry) and WHT; the goods-receipt → expense link; recurring expense templates; and the `/cost` rework that follows from having all money-out.

OUT, with reasons rather than silence: `bill_image_url` / `slip_image_url` (no object storage — ADR 0012 Q6's rule against permanently-null columns) · `allocation_method`'s `SHARED_BY_REVENUE_RATIO` and `SHARED_EQUALLY` (they need departments *and* revenue, and neither is reachable) · a payments module beyond a status · ภพ.30 / ภงด.53 generation (Decisions #37/#38 already put those in Phase 2).

### Q2 — Stock cost includes VAT when the tenant cannot reclaim it

The accounting is not ambiguous: for a VAT-registered buyer input VAT is a receivable, and for an unregistered one it is part of what the goods cost. The system has been doing the first unconditionally.

`goods_receipt` gains **`vat_rate_percent`**, **`vat_amount`** (header level, following Decision #35's rule for expenses) and **`vat_reclaimable`** — a boolean **snapshotted at receipt time from `tenant.is_vat_registered`**.

The snapshot is the load-bearing part. A shop that crosses the ฿1.8M threshold in October and registers must not have the whole year's stock silently re-valued: it *did* pay that VAT, and nobody is refunding it. This is the same rule ADR 0012 Q3 applied to `to_base_ratio` — **what was true when the transaction happened must not move when the present changes.**

Part 14's layer value becomes `line_total_actual + (vat_reclaimable ? 0 : that line's share of vat_amount)`, computed at replay as everything else is. Receipts written before this Part carry no VAT and contribute 0, which is exactly today's behaviour — **no backfill, no migration of history.**

*(Rejected: making `unit_price_actual` gross for unregistered tenants. Fewer columns, but "unit price" would then mean different things in two shops, and ADR 0012 Q3 froze it meaning *the price on the invoice line*.)*

### Q3 — A confirmed receipt creates its own expense

`/cost`'s spend column now reads **expenses only**. That is only safe if every purchase becomes an expense, so confirming a goods receipt writes one, with `source = FROM_GOODS_RECEIPT` and `source_gr_id`.

Four conditions keep it from being magic:

1. **Written in the same transaction as the confirm.** If the expense cannot be written the confirm fails — there is no path where stock arrives and the money vanishes.
2. **`source_gr_id` is unique**, so a replayed confirm yields one expense (the mechanism used throughout Sprint 2).
3. **Voiding the receipt voids the expense**, in the same transaction.
4. **Fields that came from the receipt are not editable** — amounts, supplier, branch. Editable: the tax-invoice number, WHT, payment status, and anything else the receipt never knew. Line categories come from each product's own category.

*(Rejected: leaving purchases out of `expense` — a VAT-registered shop's biggest input-VAT category would be missing, and "expense" would not mean what it says. Also rejected: letting the user decide per receipt — some receipts counted and some not makes the executive figure unreliable in a way no one can see.)*

**Recorded limitation:** suppliers commonly issue **one invoice covering several deliveries** (the 5th, the 12th, the 20th, billed at month end). This Part ships **one receipt → one expense**, which is right for cash or per-delivery payment and wrong for monthly billing. Consolidating several receipts onto one bill is Sprint 3+ work, and it is written down here rather than discovered later.

### Q4 — `/cost` splits COGS from OpEx, and loses a column to stay readable

ADR 0014 Consequence 4 warned that the branch table was reaching the width where a table stops being read. Rather than append, this Part restructures:

- **Split "ซื้อของ" into ต้นทุนวัตถุดิบ (COGS) and ค่าใช้จ่ายอื่น (OpEx).** The 3-tier category tree has carried `account = COGS | OpEx` since Sprint 1, so the split costs nothing — and *"materials 60,000, everything else 40,000"* is a sentence an owner acts on, where a single total is not. When revenue lands in Sprint 4 this becomes **food cost %**, the number restaurants actually run on.
- **Move "ทุนจมในสต๊อก" to the per-branch drill-down.** It is a balance-sheet figure sitting among cash-flow figures, inviting the reader to add it to columns it does not belong with, and it is the least actionable number on the page.

Net: still eight columns, and every one of them answers the same question.

### Q5 — Recurring costs are COMPUTED as due, never pre-generated

A template records what recurs; **nothing is written until a human confirms it**. What is due is derived: for each active template, a month with no expense carrying that template's id is a month that is due.

*(Rejected: creating the expense in advance in a "pending" state. It would need a status the spec does not have, and an unconfirmed month would leave a half-real row in the expense table that every report thereafter has to know about and filter out. The same instinct as ADR 0014's "do not store what you can derive" and ADR 0015 Q7's "no line means not counted".)*

`recurring_expense` holds branch, supplier, category, description, a **default amount**, VAT/WHT settings, the day of month, and an active window. `expense` gains `recurring_expense_id` + `period` with a **unique on the pair**, so confirming twice yields one expense.

The default amount is a starting point, not a value: an electricity bill differs every month, which is exactly why the user asked for confirm-don't-auto.

**Recorded limitation:** nothing runs in the background — there is no scheduler in this stack. "Reminder" means *visible when someone opens the page*, not a LINE message. Adequate for the MVP; a real notification needs infrastructure this project does not have.

### Q6 — Two corrections

**Withholding tax is computed on the pre-VAT amount.** master-spec §5.4 gives `wht_amount = total × rate/100` where `total` includes VAT, which over-withholds on every bill that carries both — that is, nearly every service bill. 10,000 + 7% VAT withheld at 3% is **300**, not 321, and the figure on the 50 ทวิ certificate has to match what the recipient claims. This Part uses **`subtotal_excl_vat × rate/100`** and the spec gets a superseded note. Same family as Pitfall #27, which this project already caught once.

**`payment_status` is `UNPAID | PAID`.** `PARTIAL` describes an amount, and without a payments module there is no amount behind it — a state that asserts something the system cannot support. Deferred with the payments module, on the same reasoning that dropped the PR layer (ADR 0012 Q1) and `REVIEW` on a stock count (ADR 0015 Q6).

### Q7 — Six surfaces, and `allocation_method` is not built

`/expenses` (list, filters, and the "due now" panel) · `/expenses/new` · `/expenses/[id]` · `/expenses/recurring` · the `/cost` rework · and a link from a receipt to the expense it created, without which a system-created document cannot be found.

`expense_item.department_id` **is** built and stays nullable (null = shared) — it becomes meaningful the day departments are switched on. `allocation_method` is **not**: Q1 removed the two shared strategies, leaving a column whose only value is `MANUAL`, which tells a reader nothing.

## Consequences

1. **The VAT snapshot changes what stock is worth, for new receipts only.** Existing layers carry no VAT and are unaffected, so the change lands without a migration of history — but from now on two shops buying identically will value stock differently, correctly, and the reason is a boolean on the receipt rather than a setting read at query time.
2. **`/cost` spend now depends on the receipt → expense link being unbreakable.** Anything that ever writes stock without producing an expense becomes invisible to the executive view. Sprint 3's inter-branch transfer (Part 18) must decide deliberately whether a transfer is spend — it is not, it is a move — and say so.
3. **The WHT base correction is a divergence from the spec that later work will trip on** unless the spec note is read. It is recorded in both places for that reason.
4. **Recurring expenses are only as reliable as someone opening the page.** That is a product limitation, not a bug, and it should be stated to users rather than implied.
5. **Three states and one column have now been dropped for the same reason** across ADRs 0012, 0015 and 0016 — PR, `REVIEW`, `PARTIAL`, `allocation_method`. The rule is stable enough to name: *a state nobody can reach meaningfully is a debt, not a feature.*

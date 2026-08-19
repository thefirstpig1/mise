---
status: accepted
---

# Sales arrive as a file, and the ledger does not move

Parts 10 through 18 taught the system every way stock can **enter** a branch or **leave** it by a decision someone made inside the business: a purchase, a count, a bin, a truck. Part 19 is the first Part about money the business **took in**, and the first whose source of truth lives outside Mise entirely. It is also, deliberately, the first operational Part that writes **nothing** to the stock ledger.

Decisions locked in the grill of 2026-08-19/20 (Q1–Q15).

## Context

Seven facts shaped every answer, and five of them came from reading a real system rather than a document.

1. **`revenue` and `grossProfit` have been `null` since ADR 0014 Q9**, carried on `/cost` from day one precisely so that this Part fills fields instead of forcing a rewrite.
2. **`sales_transaction` in master-spec §5.6 was designed from an imagined POS.** It is one flat table carrying line-grain fields (`pos_menu_id`, `qty`, `unit_price`) beside bill-grain fields (`bill_subtotal`, `bill_vat`, `table_no`, `payment_method`) — two grains in one row, and against the header+line shape every document Part since 11 has used. It is the same staleness §5.5 and §5.7 already showed.
3. **A real Thai POS export was read during the grill** (a Google Apps Script pipeline the owner had been running for a year). What it proved:
   - the file is **TIS-620**, and dates arrive in **พ.ศ.** — both already handled in that code, so neither is a hypothetical;
   - the detailed daily export carries **no bill id, no time, no table, no staff, no channel** — one row is *one menu, summarised for one day*;
   - the **date and the branch were not in the file at all** — a human typed them into a sheet beside the filename, so a typo silently moved a whole day of sales to the wrong day or the wrong branch;
   - dedupe was a status cell reading `"สำเร็จ"` and every row got a fresh `Utilities.getUuid()`, so **nothing in the data could ever tell that a day had been imported twice**;
   - every numeric read was `parseFloat(x) || 0`, and every short row was skipped in silence.
   Every one of those is a failure that leaves the system green and the numbers wrong. Part 19's design is largely a list of refusals to repeat them.
4. **The end-of-shift email that POS platforms send is a summary.** It carries a day's total, never per-menu quantities. Line detail exists only in the back office, as a date-ranged export a human downloads.
5. **`MovementType` has no `CONSUMPTION`, and cannot get one usefully yet.** Turning "12 plates of กะเพรา" into "1.2 kg of minced pork" needs `recipe`, which is Sprint 5.
6. **Adding a `MovementType` costs two migrations** (ADR 0011 Q2), and ADR 0018 established the cost is **per migration, not per value** — so adding `CONSUMPTION` in Sprint 5 costs exactly what adding it now would. There is no saving in reserving it. `SourceType.SYSTEM_INITIAL`, reserved in Part 10 and still unwritten eight Parts later, is the standing warning.
7. **`pg_trgm` fuzzy matching already exists in this codebase** (ADR 0010, threshold 0.4, with coarse Thai badges and no raw score shown). Menu matching reuses it rather than inventing a second one.

## Decision

### Q1 — Part 19 delivers sales and the minimum menu that sales require; the POS mirror and the diff queue do not exist yet

The master spec puts *"POS Sync + mirror + diff queue + stub handling"* in Sprint 4, but the diff queue (`recipe_change_diff`, Section B layer 3) exists to stop a POS sync from overwriting a human's recipe enrichment. **With no `recipe`, there is nothing to protect.** The three-layer mirror moves wholesale to Sprint 5.

`menu` is built, because `sales_line.menu_id` must point somewhere — but only the parts a sale needs: a name, an identity, a category, a department, a stub flag. `pos_raw_snapshot`, `recipe_status` and `recipe_id` are Sprint 5's.

### Q2 — The file arrives by upload; there are no credentials anywhere in this Part

No public API exists that a Thai SME can enable for itself, so `api_credentials` (encrypted) would be a column with no writer and a security surface with no benefit — the same reasoning that kept `photo_url` out of Part 18. Automated retrieval by logging into the shop's own POS back office is possible and is **not** built: it would put the shop's POS password inside Mise, and a leak there damages the shop's money system, not our data.

### Q3 — The chore is *daily* upload, and that is what gets designed away — not periodic import

An owner asked to upload a file after closing will stop within weeks, and rightly. But the back-office export is a **date-ranged report**: one download covers thirty days. The rhythm Mise actually needs is the rhythm the shop already works in — the **stock count** — because variance and (later) consumption are both computed over a period, never per hour.

The transport is a layer, not the design: upload, email intake and a future API all feed the same parse → stage → preview → commit pipeline, distinguished by one column on the batch.

### Q4 — One table, one grain: **one menu × one sales day × one branch**, with `bill_id` and time nullable

A per-bill export and a daily-summary export both land in `sales_line`. A summary row is simply a sale whose bill and time are unknown. Revenue arithmetic and (later) consumption arithmetic are **identical** for both, so there is never a second code path; only bill-count and peak-hour views are unavailable, and the screen must **say so rather than show zero**.

Demanding bill grain would exclude every shop whose POS only exports summaries, which contradicts the promise that Mise works from day one without recipes.

### Q5 — The unit of import is **branch × sales day**, and re-importing replaces the whole day

There is no row-level natural key to upsert against: a summary file has none, and a bill file legitimately repeats a menu inside one bill. Inventing one would be wrong on some day. And the POS owns the truth of sales (Decision #11), so **the latest accepted file for a day is that day's truth, entire**.

A thirty-day file that overlaps six known days replaces those six and inserts the rest — one rule, no special cases. The preview says which days will be replaced, by name and date, before anything is written.

**Replaced rows are kept, marked superseded, never deleted.** The reason is not Part 19's: in Sprint 5 these rows will drive `CONSUMPTION` movements into an append-only ledger, and deleting a sale would leave stock consumed with no document to point at — the exact sin ADR 0011 was designed to prevent.

### Q6 — The blind window is closed by a **daily pulse**, and the pulse is Part 20

Gross profit can never be real-time, because the cost side is not: invoices arrive days late, counts are periodic. What *can* be current is the one number an owner actually checks — the day's takings — and that is precisely what the automatic end-of-shift summary email carries.

So two lanes at two cadences: **detail** (menu × day, periodic, Part 19) and **pulse** (one number per branch per day, automatic, Part 20 — inside this same sprint). When detail arrives it **wins**; if its day-total disagrees with a pulse already recorded, the system **warns rather than overwrites**, because the disagreement is worth more than either number.

### Q7 — A menu is identified by its POS code; names are a fallback, and a fuzzy score never merges anything

`UNIQUE(pos_integration_id, pos_menu_id) WHERE source = 'POS'` means a POS rename, a stray space or a dropped character changes nothing. Where a file carries only names: normalise (trim, collapse internal spaces, Unicode NFC) → match exactly → otherwise **suggest** neighbours with `pg_trgm`, let a human choose, and **remember the pairing in `menu_alias`** so the same odd spelling never asks twice.

Automatic merging on similarity is forbidden. Thai menu names differ by one word for genuinely different dishes — *ผัดกะเพราหมู* and *ผัดกะเพราไก่* score high — so any threshold that catches a typo also merges two real dishes, corrupting revenue now and consuming the wrong ingredient in Sprint 5.

### Q8 — An unknown menu creates a stub; it never rejects the file

A kitchen adding a dish is normal business, not an error. Rejecting the import would break the system on exactly the days something good happened. **Money is money**: revenue must land in full even while we do not yet know what the dish is (Decision #57, `is_pos_stub`). But the stub appears in the **preview before commit** — *"พบเมนูใหม่ 4 รายการ"* — which satisfies Section D.4's ban on unannounced auto-creation.

### Q9 — Category belongs to the menu, and it is a table of Mise's own

The bill-detail export has no category column; the daily summary does. That asymmetry dissolves once the category is understood as a property of the **dish**, not of the **sale** — the summary file merely denormalised it for Excel.

`menu_category` is Mise's, mirroring the POS's name rather than being it (the same principle as Q7, one level up). The category drill-down and the month-over-month category share — the views the owner's previous system actually used — are unreadable if a category changes identity whenever the POS is edited. First import creates a category per distinct name found, shown in the preview like a stub.

### Q10 — Revenue is **after discount, excluding VAT, excluding service charge**

For a bill of 1,000 with 100 discount, 10% service charge and 7% VAT, the customer pays 1,059.30 and **revenue is 900**.

VAT is collected for the Revenue Department and, for an unregistered shop, is not charged at all — symmetric with ADR 0016 Q2, where unreclaimable VAT is swallowed into stock cost. A service charge is paid out to staff as a labour expense (Decision #39): counting it as revenue inflates gross profit with money that has no cost of sales behind it, and then the same baht reappears as an expense.

All five figures are stored — gross, discount, net, service charge, VAT — because ภพ.30 needs output VAT and O17 needs to reconcile what was collected against what was paid out. `net_amount` is normalised **at import** to the definition above, so nothing downstream re-asks.

### Q11 — An import profile declares the shape of the report, and the numbers are normalised on the way in

Encoding, date format (including พ.ศ.), which column is what, **whether the amounts already include VAT**, **whether they already include service charge**, and which kind of file it is. These are properties of the *report*, not of the data, and guessing wrong is a silent 7% error on every row.

The profile also stores a **header signature**. A file whose header still matches imports without a question; a POS update that inserts a column is **detected and stopped**, rather than read one column across while the numbers still look plausible. Vendor adapters are seeded profiles, not separate code paths, so an unrecognised POS still works.

**Branch never comes from the file** — it comes from the profile, which the system knows.

### Q12 — Delivery apps commission is an expense, never a deduction from revenue

⚠️ The Thai restaurant trade calls this commission **"GP"** (25–32%; Grab ~30–32%, LINE MAN 0% unless the free-delivery programme is joined). That is **not** this project's GP. Both meanings can appear on `/cost`, so the UI writes **กำไรขั้นต้น** in full and always pairs the other with เดลิเวอรี; the bare letters are never shown alone. Recorded in CONTEXT.md.

Revenue stays the price recorded on the bill. The platform deducts from a **monthly remittance**, not from a bill, so per-line subtraction would require guessing on every line and would leave one dish carrying two different revenues depending on where it sold.

The real figure therefore arrives as a monthly statement and is recorded as an ordinary expense — **Part 16 already does this, with no new code** — into a newly seeded `OpEx/Commission/Delivery apps`. **The user is never asked what percentage a platform charges**: the answer is on the statement in their hand, and it is more reliable than memory, because programme changes move the rate without the shop noticing. An optional rate for an in-month *estimate* is Sprint 6 (pending Feature 6), and the estimate is **computed at read and never written as an expense row**, or it would double-count against the statement (the rule ADR 0016 Q5 already set for recurring costs).

`channel` is captured when available — from the file, or from the profile — because without it a shop learns that profit shrank but not where.

### Q13 — Part 19 writes nothing to the stock ledger

No recipe, no quantity to consume. An enum value with no writer is not preparation, it is debt, and Q6 of the Context shows the reservation saves nothing. `CONSUMPTION` is created in Sprint 5, in the migration that first writes it.

Said plainly: **sales in Part 19 are a mirror of the POS, not an event in the warehouse.** `/cost` gains a revenue column; not one gram of stock moves. Balances still only rise between counts, which is why every par row already carries a freshness line (ADR 0017 Q6b).

### Q14 — Negative and zero rows are both legal, and a blank is never a zero

Voided bills, refunds, giveaways, tastings, staff meals rung through the POS — all real, all in the file. Rejecting any of them would put Mise's totals permanently out of step with the POS screen, which Q16 below forbids.

The consequence is sharp: **with both 0 and negative legal, there is no `.positive()` left to lean on.** Part 18 paid for this lesson once — `z.coerce.number()` reads `null`, `""` and `undefined` as **0**, and on that form 0 was a legal answer, so a blank box would have written off a whole line as transport loss with a driver's name attached. Here a blank cell would silently erase a menu's sales for a day.

Therefore: **a blank, a missing column or an unparseable value stops the entire file and asks.** Only a `0` actually present in the file means zero. The previous system's `parseFloat(x) || 0` on every column is precisely the behaviour being refused.

### Q15 — The sales day comes from the POS; Mise derives one only when it must

A bill closed at 01:30 belongs to the night before. The POS decided that at shift close, and every report the shop already argues over uses that decision — so when the file states a day, **Mise never recomputes it from a timestamp**. Being right by our own reckoning and different from the POS screen means nobody believes any of our numbers.

Only when a file carries times but no day does Mise derive one, using a per-branch cut-off (default 05:00) stored on `branch`. ★ **This is a value the user sets and can get wrong**, so it belongs in the user manual, not only on screen. Changing it affects **future imports only** — `business_date` is already stored as a plain DATE — and correcting the past means re-importing those days, which Q5 already supports.

`business_date` is a DATE. Day and week grouping use it directly; there is no `DATE_TRUNC` over a timestamp, which would drag Decision #60's timezone problem back into a place where it was already solved.

### Q16 — Revenue lands on a branch always, on a department only when the menu names one

With `enable_departments` off — the default, and most shops — there is one department and everything lands there; the words "ไม่ระบุแผนก" never appear, per H.1. With departments on, menus that name none (a fresh stub, for instance) show as **their own row**. Folding them into Main would make the Bar look profitable on the Kitchen's takings: wrong numbers with nothing on screen looking wrong, which is the failure mode this entire ADR is organised against.

One menu earns for one department. A set meal whose drink comes from the Bar cannot be split until its components are known, which is `recipe` — the spec's own phrasing, *"which dept earns revenue"*, already accepts this.

### Q17 — Gross profit has two honest methods, and the shop picks one

Added after the grill, when filling `/cost` made the omission concrete: gross
profit is revenue minus the cost of what was **sold**, and the column beside it
is the cost of what was **bought**. In a month with a big stock-up those are
wildly different, so `revenue − cogsSpend` would have been a confident wrong
number — the failure this Part is organised against.

Two methods are legitimate, and which one a shop can stand behind follows the
discipline it already keeps, so `tenant.gross_profit_method` chooses:

- **`PERIODIC_INVENTORY` (นับสต๊อก)** — cost of goods sold = opening inventory +
  purchases − closing inventory, all three valued by the FIFO replay. Works
  today with **no recipes at all**, which is the promise Mise makes on day one.
- **`RECIPE_CONSUMPTION` (สูตรอาหาร)** — cost of goods sold = what the recipes
  say the sold dishes consumed. Needs Sprint 5.

A shop may select the second one now; until it works, `/cost` shows "—" **with
the reason**, rather than quietly answering with the other method's arithmetic
under this one's name.

⚠️ **The first method is exactly as accurate as the counts that bound the
period, and until Sprint 5 it is systematically optimistic.** With no
`CONSUMPTION` the ledger believes stock only ever rises between counts, so
closing inventory is overstated, cost of goods sold is understated and gross
profit flatters. Every row therefore carries when its branch last closed a
count, and a branch that has never counted is told so in as many words. This is
rule W4 one level up: a figure whose freshness is invisible will be believed
past the point it deserves.

Cost: a second FIFO replay per period, stopping the day before it starts. It
reads strictly fewer movements than the closing walk, so the page costs well
under twice what it did — but this is already the heaviest query in the system,
and ADR 0014's standing note about building a snapshot now applies with more
force.

## Schema

| Table | Grain | Notes |
| --- | --- | --- |
| `pos_integration` | branch × POS | `pos_type`, `is_active`, `last_import_at`. **No credentials** (Q2) |
| `sales_import_profile` | integration × report kind | column map, header signature, encoding, date format, `amounts_include_vat`, `amounts_include_service_charge`, `default_channel` (Q11) |
| `sales_import_batch` | one upload | file name, uploader, status, row count, covered range, Thai error log (Q5) |
| `sales_day` | **branch × business_date** | holds which batch is current for that day — the unique index that *enforces* Q5, and Part 20's home for the pulse |
| `menu_category` | tenant | Mise's own, mirrors the POS name (Q9). Not the COGS/OpEx `category` tree |
| `menu` | tenant | `source` POS/MISE, `pos_menu_id`, `menu_category_id`, `primary_department_id`, `is_pos_stub`. `UNIQUE(pos_integration_id, pos_menu_id) WHERE source='POS'` (Q7) |
| `menu_alias` | integration × normalised name | confirmed spellings (Q7) |
| `sales_line` | **menu × business_date × branch** | `qty`, `gross`, `discount`, `net`, `service_charge`, `vat`; `bill_id`, `sold_at`, `channel` nullable; superseded marker (Q4, Q10) |

Revenue is `net_amount` — already normalised at import — so there is no second `revenue` column to disagree with it.

Also touched: `branch` gains the sales-day cut-off (Q15); `tenant` gains `gross_profit_method` (Q17); tenant seeding gains `OpEx/Commission/Delivery apps` (Q12).

## Consequences

1. **`/cost` finally shows revenue and gross profit** — the fields ADR 0014 Q9 left null since Sprint 2.
2. **Sprint 5 inherits a standing instruction.** Re-importing a day that has already posted `CONSUMPTION` must append compensating movements, exactly as voiding a receipt does (ADR 0013 Q6). The ledger cannot be edited; the replacement must be *documented*, not silent.
3. **A negative sale becomes returned stock in Sprint 5** — correct for a bill voided before cooking, wrong for a plate sent back after (that is waste). No file distinguishes them; the decision needs recipe semantics and belongs to Sprint 5.
4. **Gross profit will look better than the bank account** while service charge and delivery commission both sit outside revenue for good reasons. Sprint 6's dashboards must place them where they are seen together, or the page misleads while every figure on it is right.
5. **Menu merging is not built.** Where a file carries names only, a renamed dish becomes a second stub and its sales split. `menu_alias` keeps the door open; merging arrives with Sprint 5, when a menu can also carry a recipe.
6. **Every rule in this ADR is registered** in `docs/calculation-rules.md` (P1–P24) with a marker for whether the user must be told — the ★ items seed the user manual.

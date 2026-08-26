---
status: accepted
---

# Two rows that must stay two rows, and one dish

A POS reports ข้าวผัดกุ้ง more than once, so Mise carries more than one `menu` row for one dish and the shop's revenue, its recipe work and its stock deduction all split along that seam. Part 25 closes the seam. It does **not** do so by making the rows into one row — the schema forbids that — but by recording that one row is another row's spelling, from a date onwards.

Decisions locked in the grill of 2026-08-26 (Q1–Q7).

## Context

Seven facts were established by reading the code during the grill. Five of them contradict what the plan assumed on the way in, and one of those reversed the central decision.

1. **A POS integration belongs to exactly one branch** (`PosIntegration.branchId` is non-nullable), and `menu` is unique on `(pos_integration_id, pos_menu_id)`. `planMenuResolutionLogic` further loads only `OR: [{ posIntegrationId }, { source: "MISE" }]`. **A two-branch shop therefore gets two `menu` rows for the same dish on its first import, and a five-branch shop gets five.** Duplicate menus are not an edge case in this system; they are the default for every shop that grows past one branch.

2. **`sales_line` is not writable after INSERT.** The model says so in words — *"The only write this row ever receives after INSERT is this pair, which is why the model carries no `updatedAt`"* — and the absence of `updatedAt` is the enforcement: a repointed row could not record when it was repointed.

3. **`menu_pos_identity_unique` does not filter `deleted_at`**, and the same file gives `menu_category_name_unique` a `WHERE deleted_at IS NULL` two blocks below, explaining why (Pitfall #22/#23). The omission is deliberate: a POS code is held forever by the row that owns it, alive or not.

4. **`planMenuResolutionLogic` matches CODE → ALIAS → NAME → stub, over live menus only**, and `createStubMenusLogic` writes `pos_menu_id` from the code. Taken with (3): **soft-deleting any POS menu breaks the next file that carries its code** — byCode misses, the row falls through to stub creation, and the insert collides with the soft-deleted row's unique. This applies to the losing menu and the winning menu alike.

5. **`resolveRecipeIds` already resolves in two levels** — *"This branch's own line wins; otherwise the central line"* — per target. There is a place for a third level, and it costs one query nothing.

6. **`sales_consumption_run` has no FK to `menu`**; its grain is product × branch × day. But `consumption.ts` groups sales by `menuId` and resolves a recipe per menu, so the ledger path is reached through the menu even though nothing in the ledger names one.

7. Only **five reads group sales by `menuId`** (`consumption.ts` ×2, `menu-lab-read.ts` ×2, `sales.ts` ×1). The blast radius of teaching reads to fold is comparable to ADR 0025 Q4's two `is_draft` filters, not to a system-wide invariant.

## Decision

### Q1 — Merging moves no row. The losing menu stays alive for ever.

`sales_line` is never rewritten and never superseded by a merge. The losing menu keeps its identity, keeps its POS code, and **keeps receiving new sales after the merge**, because the POS goes on sending that code every day and Context (3)+(4) make the code unreclaimable and the row undeletable.

*(Rejected: **repointing `sales_line.menu_id` to the winner.** It breaks Context (2) with nowhere to record that it happened; and it does not even solve the problem, because tomorrow's file lands on the loser again — the rewrite would have to re-run after every import for ever, a migration job wearing a button.)*

*(Rejected: **superseding the losing rows and inserting replacements.** It fits the project's habits — Part 19 Q5 already supersedes on re-import and every read filters `superseded_at IS NULL` — but `sales_line_superseded_pair_check` requires a `superseded_by_batch_id`, and a merge is not an import batch; and it copies the dish's entire history on every merge, tens of thousands of rows for a shop with a per-bill export.)*

So a merge is a **statement about two menus**, not an operation on sales. That also makes it reversible, which nothing else in this ADR would have been.

### Q2 — The recipe question answers itself: a third fallback level

Resolution becomes:

```
สูตรของสาขานี้  →  สูตรกลางของเมนูนี้  →  สูตรของเมนูที่ถูกรวมเข้าไป
```

**Nothing is overwritten and no one is asked to choose.** A losing menu that has its own recipe keeps using it — for future days and for every past day it was ever posted against. A losing menu with no recipe now has somewhere to look. Merging can therefore only *add* costing where there was none; it can never change costing that already existed.

This removes a two-step confirmation the plan had assumed was necessary ("which recipe survives?"), and with it the only path by which a merge could have falsified a posted day.

### Q3 — Merging declares one dish, not one price and not one recipe

Branches legitimately differ: อโศก sells it at ฿180 and พัทยา at ฿220, and พัทยา may use bigger prawns. None of that argues against merging, because `sales_line` carries `branch_id` on every row and Q2 gives each menu its own recipe. What merging changes is only screens that group by menu **alone**.

Two rules follow:

- A screen showing a merged dish's price per plate **must not print a single blended average** where branches differ materially; it shows the spread. (The same refusal Part 22 makes about a bare gross profit with no coverage.)
- The line that must not be crossed is ADR 0019 Q7's: *ผัดกะเพราหมู* and *ผัดกะเพราไก่* are different dishes however high they score. Merging is for one dish spelled more than once.

*"จานเดียวกัน แต่พัทยากำไรต่อจานดีกว่าอโศก 18%"* is only answerable **after** a merge — before it, they are two unrelated menus. Cross-branch comparison is a reason to merge, not a reason to hesitate.

### Q4 — The merge is a row in `menu_merge`, not a column on `menu`

`menu_merge`: `losing_menu_id`, `winning_menu_id`, `effective_from`, `merged_by`, `created_at`, `revoked_at`, `revoked_by`.

Part 24 chose two columns and no new table, and was right to: a draft **is** a recipe. A merge is not a menu — it is a relationship between two menus, with a start date, an author and an end. Undoing it sets `revoked_at`; it never deletes the row, exactly as the ledger, `sales_line` and `recipe` never delete.

The argument against a column is the one Context (2) taught this ADR at the start: a mutable pointer that can be cleared and re-aimed, with nothing recording where it pointed last month, reproduces by hand the very defect that killed the rewrite option.

**No chains.** A menu that is a winner may not become a loser, and a loser may not become a winner. Many losers may share one winner — a star, never a chain — so resolution is always one hop, with no cycle to guard and no depth to cap.

### Q5 — Reporting folds always; the ledger folds only from `effective_from`

These two are not the same kind of thing and do not get the same rule:

| | writes to the database | reversible |
|---|---|---|
| Reporting (revenue per menu, coverage) | no — computed on read | instantly |
| Stock deduction | **yes** — movements into an append-only ledger | only by void + re-post |

- **Reporting folds retroactively, always.** Open March after merging in April and ข้าวผัดกุ้ง is one line. "This is the same dish" is a fact about the dish, not an event that happened in April, and no stored figure moves.
- **The ledger folds only for business dates on or after `effective_from`.** March's skipped sales stay skipped even if the day is posted again, because writing movements into the past is changing what happened.

`effective_from` defaults to **today**: reports stop double-counting immediately, and not one gram of stock moves. Choosing an earlier date is allowed and the screen must first say how many already-posted days it would change.

**A seam this creates, deliberately kept visible:** `sales_consumption_run` stores `covered_net_amount` at post time, while the coverage screen computes on read. After a merge these disagree for March — 52% stored, 100% computed. Both are right and they answer different questions: *"how much of March did we actually deduct"* versus *"how much of March can we explain now"*. **The gap is the value of re-posting March**, so both numbers are shown, never reconciled away.

### Q6 — Which reads fold, and where the fold lives

One helper (`canonicalMenuId`) with one definition, called explicitly:

| Read | Kind | Folds |
|---|---|---|
| `consumption.ts` ×2, `resolveRecipeIds` | writes the ledger | only when `effective_from <= business_date` |
| `menu-lab-read.ts` — coverage | reporting | always |
| `menu-lab-read.ts` — `hasSales` | reporting | always |
| `sales.ts` — revenue per menu | reporting | always |
| **`planMenuResolutionLogic`** | import matching | **never** — it must keep resolving the real code, or imports break |
| The menu screen, the merge screen | management | **never** — a merge nobody can see is a merge nobody can undo |

Pinned by `menu-merge-fold.test.ts`, each case **verified by removing its fold and watching the test go red** — the method ADR 0025 Q4 used for `is_draft` and Part 24 L5a repeated for the drafts list.

On the menu screen the losing rows are **collapsed beneath the winner** — *"+2 ชื่อที่รวมแล้ว"*, expandable, un-mergeable from there. Hiding them entirely would take a row that still collects money every day out of sight; showing them as ordinary rows would give back the duplicate the shop just paid to remove.

### Q7 — The winner is an existing menu the person picks

No menu is created by a merge. Section D.4 bans unannounced auto-creation, the most common case is two codes inside one branch (where inventing a third row is absurd), and a shop that wants a neutral central row can already make one: Menu Lab creates `source: MISE` menus, and merging into one is allowed.

*(Rejected: **auto-creating a MISE menu as the winner for every cross-branch merge.** It is the tidier model — no branch is privileged, the central recipe sits on a neutral row, `recipe_branch` finally does the job Part 21 Q8 designed it for, and a closed branch does not take the canonical dish with it. It is available to any shop that wants it, and it is not worth forcing on the shop whose cashier simply keyed the dish twice.)*

The merge screen **offers** the choice across branches and explains the difference. It offers; it does not decide.

## Consequences

1. **Duplicate menus are structural, not accidental.** Every multi-branch shop has them from its first import, so this Part is not a tidying feature — until it exists, a two-branch shop must write every recipe twice and half its stock deduction is silently skipped.

2. **`menu.is_active` is the only safe "stop selling", and nothing reads it yet.** Context (3)+(4) make soft-deleting any POS menu a broken import waiting for the next file. The column exists (Part 19) with zero readers, exactly as `canPerform` does. Reserved as **Part 27 — วงจรชีวิตของเมนู**, which also owes the menu delete path Part 21 left behind and gives `assertMenuNotUsedInRecipes` its first call site.

3. **Deleting the winner's RECIPE silently stops the losers' stock deduction.** Nothing today warns. Part 25 owes a guard on recipe delete naming the menus that depend on it — the same shape as `assertMenuNotUsedInRecipes`, one level over.

4. **A merge made while a period was posted is not undone by revoking it.** The movements stand, because the ledger is append-only. Recovering means void + re-post through Part 22's existing N6 machinery, and the screen must say so before revoking.

5. **The losing menu never dies.** It keeps its code, keeps collecting sales, and is visible under its winner for ever. Any future feature that enumerates menus must decide, explicitly, whether it means dishes or rows.

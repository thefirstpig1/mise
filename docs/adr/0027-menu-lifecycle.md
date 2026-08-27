# ADR 0027 — วงจรชีวิตของเมนู: เลิกขาย, ลบ, และกู้คืน

**Status:** accepted · **Date:** 2026-08-27 · **Grill:** Q1–Q9
**Part:** Sprint 5 Part 27 · **Supersedes nothing. Pays** ADR 0026 Consequence 2 · **Gives** `assertMenuNotUsedInRecipes` (Part 21) its first call site.

## Context

`menu.is_active` has existed since Part 19 and **nothing has ever read it**. `menu.deleted_at` has existed just as long and **nothing has ever written it**. This Part is about which of those two is the answer to *"เราเลิกขายจานนี้แล้ว"*, and the code had already decided more of it than the plan assumed.

Nine facts were established by reading the code during the grill.

1. **`menu.is_active` truly has zero readers.** The one `isActive: true` under `/menus` (`src/app/menus/page.tsx:67`) is on `department`, not `menu`, and `getMenusLogic` does not filter it. Exactly the shape `canPerform` is in.

2. **`menu.deleted_at` has zero writers, and thirteen readers.** Every menu read filters it, and `menu-lab-read.ts:219` already reports `isDeleted` on a coverage row. The place was built and the door was never cut.

3. **`createStubMenusLogic` (`menu.ts:390`) writes `tx.menu.create({ posMenuId: spec.code })` bare, with no catch.** A POS code that fails to match falls through to stub creation, and a collision is a raw P2002 in the middle of the commit — the whole file fails, on a day when nothing was wrong with it.

4. **`menu_pos_identity_unique` is `(pos_integration_id, pos_menu_id) WHERE source='POS' AND pos_menu_id IS NOT NULL`**, and `menu` has **no unique on name at all**. So a MISE menu collides with nothing, ever.

5. **A MISE menu can accumulate sales.** `planMenuResolutionLogic` loads `OR: [{ posIntegrationId }, { source: "MISE" }]`, so a dish created in the Lab takes part in NAME matching and a POS file can land money on it. "Mise's own menu" is not a synonym for "has no sales".

6. **`menu_alias` has no `deleted_at`, and the alias query does not check that its menu is alive** — `menus` is filtered `deletedAt: null` on the line above, `aliases` is not. And `menu.ts:196` ranks **ALIAS above NAME**, so a dangling alias would outrank a live menu of the same name.

7. **`recipesUsing` filters `deletedAt` and `supersededAt` but NOT `isDraft`.** That is consistent with ADR 0025 Q4's own accounting — its two draft filters are about *resolution* (`recipe-resolve.ts`) and *line identity* (`liveLinesFor`), not about references — so a draft counts as a usage here, deliberately.

8. **`getRecipesLogic` starts from `tx.menu.findMany({ deletedAt: null })`** (`recipe-read.ts:429`), so a deleted menu's recipe disappears from the recipe list silently rather than showing as an orphan.

9. **Restore in Mise is restore-on-recreate, never a trash can.** ADR 0010 built it for products (`product-restore.ts`) and `expense.ts:1000` does the same for a category: you go to create the thing again and Mise offers to bring the old one back.

## Decision

### Q1 — Two states, and the second one is narrow

`is_active` and `deleted_at` both get writers, but they are not two grades of the same act:

* **`is_active = false` — เลิกขาย.** Available for **every** menu, POS or MISE, sales or none. This is the answer for almost every real case.
* **`deleted_at` — ลบ.** Available **only for a menu whose deletion breaks nothing** (Q4). In practice that is a junk row from the Lab.

Rejected: closing `deleted_at` for ever (leaves Lab junk in the database permanently and leaves thirteen filters that can never be true), and the H.6 department pattern applied whole (Context 3+4 make it a broken import waiting for the next file).

### Q2 — `is_active` is a claim about the FUTURE, and nothing else

Three reads change: `/menus` hides retired menus by default behind a toggle · the menu pickers for a new recipe and for the Lab stop offering them · nothing else.

Three things it must **never** touch, and the first is forced rather than chosen:

* **Matching.** If a retired menu were dropped from `planMenuResolutionLogic`, its POS code would fall into Context 3's bare `create` and take the file down. **Matching is about identity, not lifecycle.** There was no second option here.
* **The ledger.** If it still matches, the sale is real, so `sales_line` is written and Part 22 deducts stock exactly as before. The food left the kitchen; a flag does not un-cook it.
* **The past.** No report, no total and no period figure knows this flag exists.

Marking a menu เลิกขาย also **clears `is_pos_stub`**, for `updateMenuLogic`'s existing reason: somebody has now looked at this dish. Otherwise a retired stub sits in the "รอตรวจ" queue for ever.

### Q3 — The contradiction gets a voice, and it costs no column

A menu can be marked เลิกขาย and go on selling, because the shop forgot to retire it in the POS too. Hiding it by default is only safe if that case speaks up.

* **The import preview names them** — a new field on `ImportPreview`, the same shape and the same manners as `pulseMismatches` (ADR 0020 Q3): shown before commit, warns, **never blocks**. It needs no extra query; the match result already says which menu each row hit.
* **A retired row on `/menus` prints its LAST SALE DATE.** If that date is yesterday, the reader draws the conclusion themselves.

Rejected: a `deactivated_at` column so the system could say *"sold after you retired it"*. It is a migration bought to make an **inference** the data can state as a **fact**.

### Q4 — Five blockers, and the menu's own recipe goes with it

A menu may be deleted only when all five are clear. The first four are **hard refusals with no acknowledgement**, because เลิกขาย is the answer to every one of them:

| # | Condition | What deleting would break |
|---|---|---|
| 1 | `source='POS' AND pos_menu_id IS NOT NULL` | Context 3 — the next file carrying that code takes down the whole commit |
| 2 | any `sales_line` | past reports print `(ไม่พบเมนู)` — and Context 5 says this reaches MISE menus too |
| 3 | used as an ingredient of another recipe | `assertMenuNotUsedInRecipes`, **its first call site**. Context 7: a DRAFT counts |
| 4 | in a `menu_merge` with `revoked_at IS NULL`, either side | the fold points at a dead row; the merge screen prints `(ไม่พบเมนู)` |
| 5 | the menu's own live recipe | — see below |

**Blocker 5 is not a refusal but an acknowledgement**: the first attempt is refused **naming the recipe**, and a second press deletes menu and recipe together in one transaction. A menu that passed blockers 1–4 has never posted a movement, so nothing in the ledger can be falsified — but the recipe is somebody's work and must be named before it goes. Drafts do not block; the Lab discards those.

The same shape Part 25's recipe-delete guard settled on hours earlier, for the same reason: the requirement is *"never a surprise"*, not *"never possible"*.

### Q5 — A retired menu still counts, in full, in coverage

`getCoverageLogic` builds `totalRevenue` from every menu that sold in the period. Dropping retired menus from the list would **shrink the denominator**, so today's button press would change last month's coverage percentage — which is Q2's "never touches the past", violated by the feature itself. And the dish somebody just retired is very often the one that sold hardest all month.

So: **counted in the denominator, ranked by revenue exactly as rule M3 says, and labelled.** No rule changes; one badge.

### Q6 / Q7 — Restore-on-recreate, at the Lab door only

Deleting a menu now takes its recipe (Q4), and a twenty-line recipe is real work. So the deletion is reversible in Mise's existing idiom (Context 9): **typing a menu name in the Lab that matches a soft-deleted one offers to bring it back**, recipe included.

**One door, not two.** `createStubMenusLogic` never offers anything — Part 19's rule is that money lands in full immediately and a file never stops to ask a question, and the file's dish is a POS identity while the deleted row is a MISE one.

**What died together comes back together, and that is a fact rather than a guess.** The delete writes **one** timestamp value into both `menu.deleted_at` and `recipe.deleted_at` inside the one transaction, and the restore brings back only recipes whose `deleted_at` matches the menu's **exactly**. A recipe the person deleted deliberately last week has a different timestamp and stays deleted. No column was added to learn this.

### Q8 — An alias is a reference, and the query gets a second line of defence

Context 6 is a fifth way to break things and it is worse than a stub: a dangling alias **outranks** a live menu of the same name, so the next file would file real money against a deleted row.

**A menu holding any `menu_alias` cannot be deleted** — blocker 5b, hard, same manners as 1–4. Soft-deleting the alias instead would need a column and a partial unique (Pitfall #22/#23), and hard-deleting it would contradict Q7's promise that what dies together comes back together.

**And separately, `planMenuResolutionLogic`'s alias query gains `menu: { deletedAt: null }`.** The blocker should make it unreachable; a filter that closes the whole class is worth one line anyway, and it is pinned by a test that writes the alias and soft-deletes the menu directly, past the guard.

### Q9 — The merge screen is the exception to Q2's pickers

ADR 0026 Q6 fixed the merge screen as one of exactly two reads that must never hide a row. Q2's picker rule would hide retired ones — and it would hide them in **precisely the case merging exists for**: a shop that found a duplicate, retired the old spelling because it did not know the merge button existed, and comes back tomorrow to merge it. The POS is still sending that code and the money is still landing on it.

So the merge screen's picker **offers every menu, retired ones labelled**. The recipe picker and the Lab keep excluding them: *"do not write a recipe for a dish you stopped selling"* is good advice, and *"do not hide a row that is still taking money"* is better.

## Consequences

1. **`is_active` is not a weaker delete.** It is the only lifecycle control most shops will ever touch, and every read added to it must answer the question *"is this about the future?"* first. A read about the past that starts filtering `is_active` has broken Q2 and will be found by a coverage figure that moved when nobody imported anything.

2. **`menu_alias` still has no `deleted_at`, on purpose.** Q8 chose a blocker over a migration. If a future Part gives shops a way to REMOVE an alias, that Part inherits this decision and should re-open it rather than adding a column quietly.

3. **`deactivated_at` was refused once.** The next request for *"which menus sold after being retired"* will look like it needs one. It does not: Q3 answers it with the last-sale date, and the reason the column was rejected is that it buys an inference the data can state as a fact.

4. **The stub path is still a bare `create`.** This Part routes around Context 3 rather than fixing it; a P2002 mid-commit is still what a duplicate code produces. Whoever hardens the import owes that a real error.

5. **`assertMenuNotUsedInRecipes` finally has a caller, six Parts after it was written.** The comment saying it is unwired must go with this Part, and the Part 21 note that no menu delete path exists becomes false.

6. **Part 26 (staff meal) is unaffected**; `canPerform` is still owed before Beta, and this Part adds two more destructive buttons any authenticated member can press (ADR 0021 Q18).

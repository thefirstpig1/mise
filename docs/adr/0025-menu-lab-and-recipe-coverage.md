---
status: accepted
---

# A price you may type, on a recipe that is not true yet

Every number Mise shows about a dish comes from something that already happened: cost from the ledger, selling price from the sales file. Menu Lab is the one screen where nothing has happened yet — *"should I price this at ฿89 or ฿99?"* is a question about a dish nobody has cooked. Part 24 builds it, and the recipe-coverage list that tells a shop which dish to work on first.

Decisions locked in the grill of 2026-08-25 (Q1–Q6).

## Context

1. **ADR 0021 Q10 deferred exactly one thing here, by name.** Selling price is read from sales (`net_amount ÷ qty`), never typed, because a number typed once goes stale the day the POS price changes — the same reasoning ADR 0019 Q12 used to refuse a typed delivery-commission percentage. It left open *"whether that price is stored on the menu, stored on the draft recipe, or exists only inside the calculator"*, to be taken "with the screen in front of us".

2. **`recipe_target_check` requires a recipe to point at a menu or a product**, exactly one of the two. A dish that does not exist yet has neither, so Menu Lab either creates something for the draft to hang off or the constraint has to give.

3. **One central recipe per target is enforced in application code, not by an index** (`RecipeAlreadyExistsError`), because the condition spans `recipe` and `recipe_branch`. Anything that adds a second live-looking recipe for a menu trips it.

4. **The ledger path funnels through one file.** Part 22's `explodeToRaw` resolves recipes through `resolveRecipeIds` / `loadRecipeGraph` in `recipe-resolve.ts`, whose single `recipe.findMany` is the only route by which a recipe can reach `stock_movement`. Recipe reads elsewhere are spread over seven files and about nineteen call sites, but none of those move stock.

5. **Cost requires a branch** (ADR 0014 Q9) and never leaves the serializer without its confidence (ADR 0021). Both apply to a what-if as much as to a real recipe.

6. **`pg_trgm` menu matching already exists** in `src/server/menu.ts`, built for Part 19, under ADR 0019's standing rule that a similarity score only ever suggests and a person decides.

## Decision

### Q1 — Part 24 is Menu Lab and recipe coverage. Merging and staff meal are not in it.

Four things were grouped under this name, and they are not the same kind of work. Menu Lab and coverage read; they write nothing but a draft. **Menu merging rewrites history** — `sales_line` rows already imported, and consumption runs already posted against the losing menu. **Staff meal writes to the ledger**, with its own table and its own `source_type` (CONTEXT.md). Each of those is a Part.

The split is about reversibility, not size: a Menu Lab that is designed wrong is a screen to redo, and a merge that is designed wrong has already overwritten sales and stock.

Menu merging becomes **Part 25**, staff meal **Part 26**.

### Q2 — The typed price lives on the draft recipe

Not on `menu`. The reason ADR 0021 Q10 rejected `menu.sale_price` applies with full force to Menu Lab's own success: if the lab works, the dish gets sold, and the number typed during design starts contradicting the POS that same day.

Not nowhere, either. *"฿89 or ฿99"* is precisely the question a person comes back to, and a calculator that forgets on refresh is one they will do in Excel instead.

On the draft, the number means something that cannot go stale: **"the price I was considering while designing this recipe."** That is a fact about a design session, not a claim about today, and it cannot disagree with sales because a draft has none.

It survives publication, because "we planned ฿89 and we are selling at ฿85" is worth knowing. Wherever it appears it is labelled **ราคาที่ตั้งใจ**, never ราคา, and **once the dish has sales the sold price is the price** — the planned figure sits beside it as a comparison and never in place of it.

### Q3 — A draft for a dish that does not exist creates a menu of its own

Saving a draft creates a `menu` row with `source: MISE` — a menu Mise owns rather than one a POS reported — and hangs the draft recipe on it. Nothing before Save is persisted; the calculator is live.

This leaves `recipe_target_check` untouched. The alternative was relaxing it to allow both columns null for drafts, which weakens an invariant guarding the whole table for the sake of one screen's transient state.

It also lands the eventual duplicate in the right place: the day that dish appears in the POS there is one MISE menu and one POS menu for the same food, which is **the central case of Part 25's merging**, not a special one it would have to grow later.

### Q4 — `isDraft` on `recipe`, filtered where it matters, pinned by tests

A separate `recipe_draft` table was the safer-looking option and is rejected for a specific reason: the recursive, yield-correct cost walk in `recipe-cost.ts` is the only one in the system, and a draft with its own shape would need its own. **Two cost engines drift**, and the day they disagree the number in the lab quietly stops matching the number on the recipe page. That is worse than a flag, because nothing reports it.

So a draft is an ordinary recipe carrying `is_draft`, costed by the same code as everything else. It is filtered in two places:

- **`recipe-resolve.ts`** — the single route to the ledger. A draft must never cost a real day or consume real stock.
- **`recipe-guards.ts`** — or a draft variant of a live dish would collide with its own published recipe under `RecipeAlreadyExistsError`, and drafting a change to an existing recipe is half of what the lab is for.

Lists elsewhere may show drafts; that is presentation. **The invariant is a test, not a memo**: a draft must be provably invisible to the resolver, to the uniqueness guard, to consumption posting, and to the cost of the live recipe.

### Q5 — Coverage ranks by revenue, and warns about duplicates without touching them

The list answers one question — *how much of my gross profit is currently guessed?* — so it ranks the menus with no recipe **by revenue**. That is the only ordering that matches why anybody would sit down and enter a recipe.

The awkward part is that merging is Part 25. A POS that reports ข้าวผัด three ways produces three rows, and a list that says nothing sends the user to write the same recipe three times. So each row carries a **per-row hint** — "อาจซ้ำกับ …" — from the `pg_trgm` search already in `menu.ts`, and says plainly that merging is not built yet.

Nothing is grouped, hidden or merged. Grouping would imply a judgement the system has not earned, and ADR 0019's rule stands: **a similarity score suggests, a person decides.**

### Q6 — The what-if opens on the branch with the freshest cost data

Cost needs a branch, and a two-branch shop buying pork at different prices gets two different answers. Defaulting to the branch with the most recent purchases gives the highest confidence available; the branch is switchable, and **its name sits beside the number**, never in a setting.

Confidence travels with it, as it does everywhere else: a dish half of whose ingredients are `UNPRICED` shows what it is. A bare ฿22.40 over unpriced ingredients is the same failure as a bare gross profit without its coverage, which Part 22 refused.

## Consequences

1. **Schema: two columns on `recipe`** — `is_draft` and the planned price. No new table, no relaxed constraint.

2. **Every future recipe read has a question to answer.** `is_draft` joins the set of things a query must consider, alongside `deleted_at` and `superseded_at`. The two that matter are tested; a new read that forgets it will show a draft in a list, which is visible and harmless, rather than post one to the ledger, which is neither.

3. **A MISE menu per experiment.** Drafts accumulate menus that no POS knows about. They carry no sales, so they cannot affect revenue, coverage or consumption — but they will appear in menu lists until Part 25 gives merging somewhere to put them.

4. **The lab can show a cost the ledger would not.** A draft may name products the shop has never bought, whose cost is `UNPRICED`. That is the honest state of a dish nobody has made, and the confidence badge is what keeps it from being read as fact.

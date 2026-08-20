---
status: accepted
---

# A recipe is a graph over things, and the last imagination-era section of the spec did not survive contact

Part 19 taught the system what was sold. Part 21 teaches it what that cost. Between those two sentences sits `recipe` — the table four separate features have been waiting on **by name** since Sprint 2, and the one whose design in the master spec was never once tested against a real system.

It did not survive the test. §5.9's `recipe` was drawn around a POS that pushes recipes into Mise; no such POS is in scope, and half the columns died with that assumption. What replaced it is smaller in some places and considerably larger in others, and the growth came entirely from questions a spec written at a desk did not think to ask: what happens to a shop with a hundred branches, what happens when the kitchen stops buying an ingredient, and what a butcher does with a kilo of beef.

Decisions locked in the grill of 2026-08-20 (Q1–Q18).

## Context

Seven facts shaped the answers, and the sharpest of them came from reading what was actually built rather than what was specified.

1. **Every §5 section that has met a real system has been superseded.** §5.5 by ADR 0011/0017/0018, §5.6 by ADR 0019, §5.7 by ADR 0014, and §5.2's claim that `yield_percent` belongs to RAW by what Part 7c actually built (it is on PREPPED, required, and RAW is forced null). §5.9/§5.10/§5.12/§5.13 were the last untested sections. The base rate was not encouraging and it held.

2. **`Product` models exactly one parent.** ADR 0007 requires a PREPPED product to name one `parentProductId` and one `yieldPercent`, enforced in zod (`product.ts:177-208`) and re-forced server-side (`product.ts:496-497`). That describes portioned salmon perfectly and น้ำพริกเผา not at all.

3. **Nothing in the system can raise the stock of a PREPPED product.** The only inbound movements are `PO_RECEIVE` and `ADJUST_GAIN`. A shop that makes its own chilli jam every morning has a balance permanently at zero, and every stock count of it reports a gain. ADR 0017 named the missing piece — *"the production movement that would record it does not exist until Sprint 5"* — and this ADR does not build it either.

4. **`costSource` was created for this Part.** ADR 0014 Q10 returns `FRONT_LAYER | DECLARED | LAST_KNOWN | UNPRICED` on every cost read specifically so *"Sprint 5 computes confidence without reopening Part 14"*. Q7 of that ADR added negative layers so *"Sprint 5 needs no null branch at every site that costs a recipe"*. The groundwork is real and this Part uses all of it.

5. **ADR 0014 left a standing instruction, not a design.** Consequence 3: H.9's cascade marks `recipe_cost_snapshot` stale via a trigger on `product_cost_history` INSERT — a table that will never exist — and *"Sprint 5 should confirm that before designing around it."* Confirmed below; it dissolves.

6. **ADR 0019 Q16 deferred the set meal here by name**: *"A set meal whose drink comes from the Bar cannot be split until its components are known, which is `recipe`."* The spec itself contains no design for a set menu — not the word, not the shape, nowhere.

7. **`canPerform` has zero call sites.** `PermissionService` has existed since Sprint 0 and nothing in the application has ever called it. Every server action guards with `requireTenant()` alone: authenticated, and scoped to a tenant. Role is not checked anywhere, so a `viewer` — whose permission list is empty — can delete every product in the shop.

## Decision

### Q1 — A PREPPED product is made by a parent **or** by a recipe, never both

ADR 0007's one-parent model is kept for what it describes well: whole salmon → portioned fillets, one input, one output, a yield percent for what the knife takes. It is relaxed, not replaced, for the case it cannot express at all.

A production recipe has many inputs and one output: พริกแห้ง + กระเทียม + หอมแดง + น้ำมัน + น้ำตาลปี๊บ → น้ำพริกเผา. Under the old invariant such a product must nominate one of the five as its parent and the other four vanish from the system — its cost becomes the cost of chilli divided by a yield, which is wrong on a screen where nothing looks wrong.

So `product.type = PREPPED` now requires **`parentProductId` + `yieldPercent`, or a production recipe — exactly one**. Both together is refused.

*(Rejected: **keep the invariant and simply ignore `yieldPercent` when a production recipe exists.** No migration, no ADR to amend — and a number left on the row that nothing reads. That is `SYSTEM_INITIAL`'s sin inverted: not a column without a writer but a value without a reader, and a future maintainer believes it either way. Rejected: **menu recipes only, production recipes later.** The walker would be written to descend through `parentProductId` and then rewritten to descend through recipes as well; the expensive part of this Part is the walker, and its shape is decided by what it walks.)*

**The two are not rivals but two notations for one fact.** A recipe stating 300 g in → 250 g out *is* a yield of 83.3%, written with more detail. Which is why the percentage is still shown — see Q16.

### Q2 — One recipe makes one product; a kilo of beef is a different problem and is not solved here

`recipe` carries `output_product_id` as a column, so a recipe has exactly one output. This closes the door on **joint products** — one input yielding several valuable outputs — and the door is closed knowingly:

> 1 kg of beef primal → 0.8 kg steak cuts + 0.1 kg beef fat (which becomes ข้าวผัดมันเนื้อ) + 0.1 kg discarded.

There is no single yield percent that describes this. 80% pretends the fat is rubbish when it is sold; 90% pretends fat and steak are the same product at the same price per kilo. The real question is not weight at all — it is how the 500 ฿ divides, and **there is no factual answer, only a policy.** That is what Decision #6 ("joint allocation by market value") gestures at, and what `product.target_market_price` and `product.expected_yield_g` were reserved for in Sprint 1. Both columns still have zero readers and zero writers, and Decision #6 remains one line of table in the spec with no design behind it.

The walker is written to take **a list of outputs whose length is always one**, the same trick ADR 0014 Consequence 2 used with `openingStack = []` — future work becomes an addition rather than a rewrite, without shipping a table that has one row forever.

Recorded in `docs/pending-features-v1.5.md` as **Feature 7**, with the beef worked through in full so it does not decay into a slogan the way Decision #6 did.

### Q3 — Ingredients point at **things**, not at recipe versions — and set menus fall out for free

The spec gives `recipe_ingredient` two targets: `product_id`, or `ref_recipe_id` "recursive, for prepped". The second is wrong, and replacing it answers a question the spec never asked.

A `ref_recipe_id` points at one *version* of a recipe. Change the steak recipe and every set containing it still references the old one until someone hunts them down. Pointing at the **thing** instead — this product, this menu — means resolution happens at read time against whatever is current, which is also how a kitchen states it: *"the set contains one steak"*, never *"the set contains steak recipe v3"*.

```
recipe_ingredient targets exactly one of:
  → product   RAW      → a leaf; priced by the FIFO replay
              PREPPED  → descend (production recipe, or parent + yield)
  → menu               → descend into that menu's recipe   ← set menus, at no extra cost
```

เซ็ท B = สเต็ก + โค้ก + ข้าว + สลัด is a recipe whose four ingredients are menus. Change the steak recipe and every set follows, because nothing was copied.

`ref_recipe_id` is dropped. So are `pos_ingredient_name`, `pos_ingredient_code`, `match_status`, `pos_original_qty` and `last_user_edit_at` — all five exist to reconcile a recipe pushed by a POS against a human's edits, and no POS pushes recipes. With them goes the whole of Section B's three-layer mirror and `recipe_change_diff`, which ADR 0019 Q1 had already moved here wholesale.

**Consequences that must be built, not assumed:** the depth-5 budget of Decision #58 is now shared by one walker across both node kinds (เซ็ท B → สเต็ก → สเต็กแล่ → เนื้อทั้งชิ้น is four), a cycle can now run menu → menu and the visited-set must span both kinds, and a menu referenced by a set cannot be deleted — the same block ADR 0007 puts on deleting a product with live children.

### Q4 — Append and supersede, with an effective date, and a UI that stays quiet about it

A recipe changed on 15 October means October's cost comes from two recipes. This is not a refinement: **Part 19 imports periodically**, one file covering thirty days, so Part 22 will post consumption for thirty past days at once. A system that cannot answer *"what was the recipe on the 5th"* posts all thirty days against today's recipe and overstates pork by 20 g per plate for a fortnight, silently.

Time travel is therefore mandatory, and it is mandatory because of something already shipped. Recipes append and supersede, as ADR 0009 does for supplier prices and ADR 0014 Q6 for cost declarations. `version` + `is_active` is rejected: it knows only what is true now.

**But the interface does not inherit that.** The first draft of this decision put an "effective from" field on the edit form, and it was rejected in the grill for the right reason — clutter that earns nothing 95% of the time, and a line reading *"effective from 15 Nov 2026"* still sitting on a recipe page in 2032 tells a reader nothing they can act on.

- **Editing asks nothing.** Save, and it takes effect today. A small "แก้ย้อนหลัง" link opens the date field for the person who knows they mistyped it months ago. One mechanism covers both meanings ADR 0014 Q6 separated — a real change is an event dated today, a correction is a change to our knowledge and is dated back.
- **The date is displayed only where it changes an answer**: on the history view, and on a cost figure whose period straddles a change (*"ต้นทุนงวดนี้มาจาก 2 สูตร (เปลี่ยนวันที่ 15 ต.ค.)"*). Never on a current recipe page. This is rule W4 turned around — do not decorate; speak when it matters.
- **A new version is written only when the arithmetic changes.** Renaming a recipe or editing its notes does not create one, or the history fills with rows of identical cost and the rows that matter cannot be found.

### Q5 — Recipe cost is measured per branch, and the comparison lives on the recipe page

`getProductCostLogic` requires a `branchId` (ADR 0014 Q9): two branches are two physical piles bought on different days at different prices. A recipe belongs to the whole business; its cost does not. กะเพราหมู is as many numbers as there are branches.

The recipe page picks a branch exactly as `/stock?branch=` does, and a single-branch tenant never sees a picker. Where a tenant has several, the **per-branch comparison sits on the recipe page itself** rather than behind another click: ADR 0014 Q9 lists *"the same product bought at different prices across branches"* as one of the leaks the executive view exists to expose, and there is nowhere it shows more plainly than on a dish.

### Q6 — The weakest ingredient sets the confidence of the whole recipe

A branch that has never bought ใบกะเพรา gets `UNPRICED` and a cost of 0 for it. Six ingredients resolve, the total looks plausible, and one of them is free.

Confidence is therefore **the floor, not an average**: any `UNPRICED` ingredient makes the recipe LOW, and the screen says which ingredient and links to the declaration form ADR 0014 Q11 already built.

*(Rejected: **weighting confidence by each ingredient's share of cost.** It reads as the reasonable answer and it is self-defeating — an ingredient with no known price is valued at 0, therefore carries 0 weight, therefore the less we know about something the less the system thinks it matters. The logic inverts exactly where it needs to hold.)*

**CONTEXT.md is corrected rather than implemented.** It defines LOW as *"uses `target_market_price` as fallback"*; that column has never been read or written and no screen offers it. Reviving it is a decision in its own right, not a side effect of this one.

### Q7 — Nothing is stored, and the walk is memoised within one request

H.9 dissolves, as ADR 0014 Consequence 3 predicted: its trigger fires on a table that will not exist, "stale" has no meaning when cost is computed fresh, and its two-level cascade contradicts Decision #58's five in the same document.

The measured shape of the alternative decided it. A recipe list of fifty menus costs **one query for the recipes, an in-memory walk, and one batched `getProductCostsLogic` — four round trips regardless of how many products come back** — roughly five round trips for the page.

Within a single request the same PREPPED product appears in many recipes, so its walk is **memoised per request**. Nothing can change mid-request, so the memo cannot be wrong, and it is discarded before anything can go stale.

*(Rejected: **`recipe_cost_snapshot`.** A backdated receipt keyed three weeks late changes the cost of a past day and fires no event; the snapshot is falsified with nothing to detect it. Same falsification that killed `cost_layer` and `product_cost_history`, one layer higher.)*

The ~1 s threshold from ADR 0014 Consequence 4 carries over unchanged.

### Q8 — Recipes attach to branches through a join table, and copying is a declaration of independence

Branches do differ: a mall branch plates smaller, a franchise controls cost differently, a branch without a charcoal grill cooks another way. This is a property of the market Mise sells into, not of any one shop.

```
no recipe linked to this branch  →  the central recipe applies, and follows it as it changes
a recipe linked to this branch   →  that one applies, and follows nothing, ever
```

The line is the copy button. **Pressing it is the branch declaring that it decides for itself**, and from that moment nothing central reaches it. A branch that has never pressed it has not decided anything, so inheriting is right; a branch that has is not overwritten when head office edits the central recipe — because a recipe change is a change to how a kitchen works, and branch A's cooks were retrained while branch C's were not. A system that propagates it anyway states that C uses 120 g of pork while C's cooks are still using 100.

*(Rejected: **copy the central recipe into every branch at creation.** Every branch instantly counts as having decided, so no central edit ever reaches anyone, and at eight branches nobody keeps up. "Override" must mean *this branch chose differently*, not *this branch was once copied*.)*

**Attachment is `recipe_branch`, a join table, not a `branch_id` column.** With a column, five mall branches cooking identically are five identical rows to keep in step by hand — and the day someone edits four of them, nothing says so. That failure appears at five branches, well inside the SME range this product targets, not at a hundred. A join table also makes the comparison view group naturally, and leaves named recipe sets (มาตรฐาน / ห้าง / ต่างจังหวัด) as a label added later rather than a migration.

### Q9 — Divergence is found by comparing, not by a queue of notifications

At a hundred branches a comparison laid out branch-by-branch is a hundred columns and useless. The fix is not a different screen but a different axis: **group by recipe, count the branches**, which reads better at three branches as well as at a hundred.

```
กะเพราหมู
  สูตรกลาง    หมูสับ 120 ก.    94 สาขา
  แบบห้าง     หมูสับ 100 ก.     5 สาขา   [ดูรายชื่อ]
  สาขาอโศก    หมูสับ 150 ก.     1 สาขา
```

A "make this branch match ___" action sits beside it, so following a change later is a deliberate press.

*(Deferred, not rejected: **a pending-change queue** — remember where a branch copied from, detect that the source has since changed, offer accept/decline. It is `recipe_change_diff` reborn with a real customer: branch to branch rather than POS to Mise, which is why the spec's table was not useless, only aimed at the wrong party. It is deferred because comparison is its first layer regardless, and because nobody has used the comparison view yet — a queue nobody acts on becomes a permanent list of PENDING rows that teaches everyone to ignore it. Recorded as **Feature 8**.)*

### Q10 — Selling price is read from sales, never typed

Food cost percentage is the number restaurants are actually run on, and a recipe page showing 22.40 ฿ without it makes the reader reach for a calculator. The price comes from `sales_line`: `net_amount ÷ qty` **over the same period the cost is computed for**, so the two halves of the ratio describe the same window. A menu with no sales in that period shows "—" with the reason, never 0%.

*(Rejected: **`menu.sale_price`.** A number typed once and never revisited; the day the shop raises its prices in the POS it does not move, and the percentage is quietly wrong. ADR 0019 Q12 refused the identical pattern for delivery commission — *"the user is never asked what percentage a platform charges: the answer is on the statement in their hand, and it is more reliable than memory."* The price is already in the file.)*

A typed price is genuinely needed for a dish that has never been sold, which is precisely Menu Lab's subject (*"should I price this at ฿89 or ฿99?"*). Whether that price is stored on the menu or lives only inside a what-if calculator is **Part 23's decision**, taken with the screen in front of us.

### Q11 — PREPPED stock is not tracked yet, and the walk goes straight through to RAW

Selling a dish explodes its PREPPED ingredients all the way down to RAW and consumes those. น้ำพริกเผา is a way of writing a recipe, not something the system believes is sitting in the fridge.

This is correct for the shop that makes its chilli jam the same morning it uses it, which is most SMEs, and it produces the right cost and the right stock movements without any new document.

**It is wrong for the shop that cooks in batches and counts the result**, and that shop must be told so on screen rather than left to discover it: counting น้ำพริกเผา reports a gain every time, because nothing has ever raised its balance.

Production — a document that consumes inputs and produces an output, closing ADR 0017's `PREP_LOSS` note — is **a Part of its own**, not an extension of this one. It needs decisions this grill did not take: what it means to aim for 3 kg and get 2.8 (which is not yield), whether a batch carries an expiry, and who records it. The walker needs no rewrite when it lands — only an earlier stopping condition when the intermediate has stock of its own.

### Q12 — The movement type is `CONSUMPTION`

Three names were in circulation: `CONSUMPTION` (CONTEXT.md, §5.5, H.5), `RECIPE_CONSUME` (a note in ADR 0011 and the comment at `fifo-replay.ts:479-511`), and `RECIPE_CONSUMPTION` (a shipped `GrossProfitMethod` value). Three names for one thing is the actual defect.

`CONSUMPTION` wins on the precedent that matters: **`ADJUST_LOSS` already serves three different documents** — a manual adjustment, a count variance, a waste log — separated by `sourceType`. A staff meal (Part 23) is stock leaving to be cooked and eaten, exactly like a sale, and belongs under the same type with a different source. `RECIPE_CONSUME` also claims the word "recipe" that the production movement of Q11 will need.

The migration belongs to Part 22, which writes the first one; ADR 0018 established that the two-migration sign-CHECK cost is per migration, not per value, so there is nothing to save by reserving it here. `GrossProfitMethod.RECIPE_CONSUMPTION` is untouched — it names a method of computing profit, not a movement.

### Q13 — The type-change guard falls due, and deletion is blocked

CONTEXT.md has carried this since Sprint 1: *"once procurement / recipe / stock start consuming `type`, add a write-time guard on changing it."* Two changes now break something real:

- **PREPPED → RAW while a production recipe outputs it** — refused outright; the recipe would produce a raw material.
- **RAW → PREPPED while recipes use it** — every one of those recipes gains a level, and some may pass five. The depth of each affected recipe is rechecked before the write, and a refusal names the recipe that overflowed.

*(Rejected: **blocking any type change on a referenced product.** A RAW used in twenty recipes that turns out to need trimming should become PREPPED — that makes all twenty more accurate, not less. Forbidding it forces the data to stay wrong.)*

**A product still used by a recipe cannot be deleted**, and the refusal names the recipes, mirroring ADR 0007's block on deleting a product with live children and Q3's block on deleting a menu inside a set.

### Q14 — Substituting an ingredient across recipes is one screen with checkboxes

A shop stops buying พริกกะเหรี่ยง and moves to พริกชี้ฟ้า. Sometimes every recipe follows; sometimes the signature dish keeps the old one. These are not two features — they are the same screen with different boxes ticked.

The reverse lookup underneath it (*which recipes use this product*) has to exist anyway, because Q13's delete refusal has to name them.

The confirmation step states what will be touched before anything is written, the pattern Part 19's import preview and Q8's copy button both use. It **groups central recipes separately from branch ones** — *"3 central recipes and 1 recipe belonging to สาขาอโศก"* — with each individually removable, because Q8 made branch divergence deliberate and a bulk edit must not undo it by accident. A shop that has genuinely stopped buying an ingredient does need every branch to change; the system presents that and does not decide it.

### Q15 — Substituting across type or unit clears the quantity

พริกกะเหรี่ยง → พริกชี้ฟ้า, same unit, same type: the quantity carries over.

พริกกะเหรี่ยง → พริกกะเหรี่ยงผัดน้ำมัน does not. The fried product has absorbed oil and lost water, so 20 g of it holds nowhere near 20 g of chilli. Carrying the old number over gives a **wrong default that somebody clicks past**, and every plate is wrong from that day with nothing on screen to show it. This project has already paid for that lesson once, in the `parseFloat(x) || 0` that ADR 0019 was largely written to refuse.

So the quantity field is **emptied and must be re-entered** whenever the substitution crosses product type or unit.

*(Rejected: **carrying it over with a highlight.** A warning that does not block is a warning that gets skipped, most reliably in the middle of changing four recipes at once.)*

### Q16 — A recipe says how many servings it makes, and that divisor is not the yield

`recipe.yield_qty` defaults to 1, so a dish cooked to order needs no thought. A curry cooked by the pot says 20, and the arithmetic stays in the system instead of being done by hand into a form — 350 g of curry paste over 20 servings is 17.5 g, and a shop rounding that themselves builds a recipe that no longer matches the pot.

```
per serving      = recipe quantity ÷ servings per recipe
raw qty required = per serving ÷ (yield_percent / 100)      ← rule U3, never × (1 + loss%)
```

**Both divisions apply and they mean different things** — the first splits a pot into plates, the second accounts for what the knife takes. Thai and English both call the pair "yield" and the glossary now separates them explicitly.

Q1's percentage view is the same arithmetic read backwards: a production recipe whose inputs total 300 g and whose output is 250 g displays **83.3%**, computed at read and never stored, because a stored copy can disagree with the recipe it came from. It is shown only when it can be computed — inputs of 200 g, 100 ml and 5 eggs have no common dimension, and that case says so rather than inventing a figure.

### Q17 — Units convert at read, because a recipe is a standing instruction and not a record

A recipe stores `qty` and the `product_unit` it was written in. The base-unit quantity is computed, never stored.

The distinction that decides it: **a purchase order line records that on a particular day we ordered this much at this price** — a fact about the past, which is why ADR 0012 Q3 freezes `to_base_ratio` onto it. **A recipe says: when you make this dish, use one bag.** If a bag is discovered to be 1.2 kg rather than 1 kg, the instruction has not changed but the quantity it denotes has, and every recipe should follow.

*(Rejected: **storing `qty_in_base` as the spec specifies.** A second source of truth beside the two values it derives from, free to drift with nothing to detect it — the objection that killed `cost_layer` and `product_cost_history`, and every recipe written before a ratio correction would silently disagree with every one written after.)*

**The matching guard:** changing a `ProductUnit`'s `toBaseRatio` while recipes reference it must first show which recipes it moves. ADR 0006 left this guard open for want of a downstream reference; this Part supplies the reference and closes it for recipes.

### Q18 — Permissions stay unwired; authorship is recorded

The requirement raised in the grill — only an authorised account may override a branch recipe — is right, and this Part deliberately does not deliver it.

Wiring `canPerform` for `recipe` alone produces a screen that appears protected while fourteen other resources stay open, and a system that looks guarded but is not is worse than one that plainly is not, because people stop being careful. The attempt also runs immediately into a flaw in the matrix itself: `kitchen_staff` has no `recipe` permission, yet a cook is the person who most needs to read a recipe. What they should not see is the **cost**. The matrix has one axis and cannot express the difference, so it needs work before anything is wired to it.

What this Part does give is **half of it, correctly**: append-and-supersede means every version carries its author and its date, so *"who changed the recipe at สาขาอโศก"* is answerable even while the change cannot yet be prevented.

**Recorded as a standing item, visibly:** today any authenticated member of a tenant can perform any action, including a `viewer`. Permissions belong in a Part of their own, alongside the RLS activation already deferred to Sprint 7, and that Part belongs before Beta.

## Schema

| Table | Grain | Notes |
| --- | --- | --- |
| `recipe` | menu **or** output product × version | `menu_id` XOR `output_product_id` (Q1, Q2) · `servings` default 1 (Q16) · `effective_from` DATE, `superseded_at`, `superseded_by_id` (Q4) · `created_by_user_id` (Q18) · `notes` |
| `recipe_ingredient` | recipe × line | `product_id` XOR `component_menu_id` (Q3) · `qty` + `product_unit_id`; **no `qty_in_base`** (Q17) · `notes` |
| `recipe_branch` | recipe × branch | which branches a recipe serves (Q8). No row for a branch ⇒ the central recipe applies |

`product` relaxes the Part 7c invariant: PREPPED requires `parentProductId` + `yieldPercent` **or** a production recipe, never both (Q1).

`menu` gains **no columns at all** — `recipe_status` and the active `recipe_id` are both derivable and a stored copy can only drift; `sale_price` comes from sales (Q10); `pos_raw_snapshot` has no writer.

**Not built, and each for a stated reason:** `recipe_cost_snapshot` (Q7) · `recipe_change_diff` and the three-layer mirror (Q3, Q9) · `recipe_branch_override` (Q8 — replaced by a real recipe row) · `ref_recipe_id`, `pos_ingredient_name`, `pos_ingredient_code`, `match_status`, `pos_original_qty`, `last_user_edit_at`, `yield_override_percent` (Q3) · `menu_branch_override` (no writer) · `recipe_coverage_view` (Part 23).

## Consequences

1. **Part 21 grew during its own grill, and the growth is recorded rather than absorbed.** Set menus (Q3), the branch join table (Q8), the comparison view (Q9) and the substitution screen (Q14) were none of them in the approved plan. Each was accepted on the same argument: the walker and the resolution query are the expensive parts, and their shape is set by what they must handle on the first day.

2. **`recipe_change_diff` was killed and then partly resurrected.** Q3 removed it because no POS pushes recipes; Q9 found it a real customer in branch-to-branch propagation. The spec's table was not wrong about the mechanism, only about who would use it. Worth remembering the next time a spec table looks dead.

3. **Two Parts are now owed and both are named.** Production movements (Q11) and permissions (Q18). Neither is a footnote inside another Part; each needs its own grill.

4. **`Product.type` is load-bearing from now on.** Sprint 1 could change it freely because nothing read it. Q13's guard is the end of that, and anything added later that reads `type` must check whether the guard still covers it.

5. **Nothing about recipe cost can be stale**, for the same reason nothing about product cost can be (ADR 0014 Consequence 1). The memo in Q7 is the only cached thing and it does not outlive a request.

6. **The set menu's revenue still lands on one department.** Q3 makes the components known, which is what ADR 0019 Q16 said was missing — but *how* 299 ฿ divides between kitchen and bar (by cost share? by standalone price?) is a calculation rule of its own and belongs to Part 22, where `/cost` is being touched anyway.

7. **Every rule here is registered** in `docs/calculation-rules.md` (R1–R12), with the ★ items seeding the user manual.

Related: ADR 0007 (PREPPED parent graph — amended by Q1) · ADR 0014 (FIFO by replay — Q5, Q6, Q7 build on it) · ADR 0019 (sales import — Q10, Q16's periodic-import argument) · ADR 0017 (waste and yield boundary — Q11) · ADR 0011 (the ledger — Q12) · ADR 0006 (multi-unit — Q17 closes its deferred guard) · Decision #58 (depth 5) · Decision #59 (yield math).

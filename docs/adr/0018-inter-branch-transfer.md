---
status: accepted
---

# Moving stock between branches

Part 15 taught the ledger to be corrected by counting, Part 16 taught the system what leaves the bank, Part 17 taught it what goes in the bin. Part 18 covers the everyday movement that is **none of those**: stock that leaves branch A and is still the business's stock, because it arrives at branch B. It is the first entry in the ledger that is neither a purchase nor an adjustment — nothing was bought, nothing was corrected, the goods simply changed shelf — and it is the first document in the system whose two halves belong to two different branches and two different people. Decisions locked in the grill of 2026-08-18 (Q1–Q8).

## Context

Five facts about the existing system shaped every answer:

1. **Three earlier ADRs left this Part standing instructions, by name.**
   - **ADR 0014 Q9** — *"stock transferred from branch A to branch B must arrive carrying A's FIFO cost, or the receiving branch's cost is fiction… the replay accommodates it, but it must be designed, not discovered."*
   - **ADR 0016 Consequence 2** — Part 18 *"must decide deliberately whether a transfer is spend — it is not, it is a move — and say so."*
   - **ADR 0017 Consequence 3** — four writers now go through `createStockMovementLogic`, and *"the next writer — Part 18's transfer — should not be the first exception."*
2. **The ledger permits exactly one movement per source row.** `UNIQUE(source_type, source_id)` (`stock_movement_source_unique`) is what makes posting idempotent, and every Part since 10 has relied on it. A transfer needs **two** movements, one at each end, from one line.
3. **Adding a `MovementType` costs two migrations.** `stock_movement_sign_check` is inline and references each type as a literal, so a new value must be `ALTER TYPE … ADD VALUE`d in one migration before the CHECK can name it in the next (ADR 0011 Q2; Part 13's precedent with `PO_RECEIVE_REVERSAL`). Parts 15 and 17 avoided the dance by adding a **source** type instead.
4. **Nothing enforces permissions yet.** `PermissionService` (`src/lib/permissions/service.ts`) is written in full and has **zero call sites**; `tenant_membership.role` is a free-text `String`; and the only place a membership is ever created is the owner's own signup (`src/server/tenant-init.ts`). Today, anyone inside a tenant can write anything, in any branch.
5. **A transfer involves a person the system has never modelled** — the driver, who belongs to no branch and has no login.

## Decision

### Q1 — Both legs post at dispatch. The document's status is about paperwork, not about stock

Stock in transit **belongs to branch B** from the moment the truck leaves, because that is where it is going. Pressing **ส่งของ** posts both movements at once: `−qty` at A and `+qty` at B. Pressing **รับของ** at the far end posts nothing by itself — it records that a named human at B has seen the goods.

The document therefore carries a status (`SENT` → `RECEIVED`, or `VOIDED`), and the single most important sentence in this ADR is what that status does **not** mean:

> **`SENT` does not mean the stock is missing from B's balance. It means nobody at B has confirmed it yet.**

Written down because the opposite is the natural guess, and a future reader who guesses wrong will "fix" the balance by gating it on the status and quietly break every figure that depends on it.

*(Rejected: **two-step posting** — `−A` on dispatch, `+B` on receipt. It reads more like the truck, but it makes the goods belong to nobody while they move: tenant-wide inventory value on `/cost` dips by the size of the truck and recovers with no event to explain it. Rejected: **a full `DRAFT` → `SENT` → `RECEIVED` lifecycle** — a draft transfer is real stock sitting in a state the ledger cannot see, which is the exact failure ADR 0017 Q2 refused for waste.)*

### Q2 — Receiving records the quantity actually counted, and the shortfall is a transport loss with a name on it

A sends 10 crates; B counts 8. The receive step **takes a number**, so `stock_transfer_item` carries both `qty_sent` and `qty_received`.

The ledger records three facts, not two:

| movement | branch | why |
|---|---|---|
| `TRANSFER_OUT` −10 | A | A really did hand over ten |
| `TRANSFER_IN` +10 | B | B really did become the owner of ten |
| `ADJUST_LOSS` −2 | B | and two of them never arrived |

Keeping the pair symmetric is deliberate. The alternative — posting `+8` at B and letting two crates evaporate between the branches — makes the two legs of one document disagree, and the missing value disappears from every loss figure in the system instead of appearing in one.

**Loss in transit is its own kind of loss.** It is not `ADJUST_LOSS`'s generic *"stock left without a document"*, because there is a document, and it names the person who accepted the crates at the roadside. `SourceType.TRANSFER_SHORTAGE` is what makes `/cost` able to say so.

*(Rejected: **receive is a rubber stamp with no number.** Cheaper — one column instead of two — and it turns every transport loss into a mystery shortage at B, found weeks later by a stock count, blamed on whoever happened to be standing at the destination.)*

### Q3 — There are two kinds of driver, and only one of them will ever have a login

The person who carries the goods must be recorded, because otherwise a shortfall is an argument between two branches that no record can settle: A says it sent ten, B says eight arrived, and nobody can say which half of the journey lost them. The document therefore records **three people**: who dispatched at A, **who drove and how much they accepted at the roadside**, and who received at B.

The two kinds are not a UI detail — they take different evidence, permanently:

- **A company driver** is an employee, so they are a member of the tenant and the end state is that they sign in and confirm the count themselves. `driver_user_id` (nullable FK) is the column that waits for them.
- **A hired outside driver** — a messenger, a hired truck — will *never* have a login, and giving one to a stranger would be worse than having no record at all. Their evidence is a **photograph of the handover** attached to the transfer, plus the name.

Today neither confirmation mechanism exists: user management is unbuilt, and the system has **no file storage of any kind**. So Part 18 ships what does work — `driver_name` (free text), `driver_confirmed_at`, and the quantity the driver accepted, typed by the person at A **in front of them**. The count agreed at the roadside is the fairness mechanism; the login and the photograph each make it harder to dispute later, and neither is what makes it fair.

`driver_user_id` is written now because it becomes fillable the moment user management ships, with no new infrastructure and no vendor decision — **no migration**. A `photo_url` is deliberately **not** written now, for the opposite reason: the storage vendor determines whether that column holds a URL, a bucket key or a signed path, so writing it early is a guess a later migration pays for. Attachments are captured as their own future Part (`docs/pending-features-v1.5.md` Feature 5), which is where they belong — a goods receipt has wanted an invoice photo since Part 13 and an expense a payment slip since Part 16, both refused for this same missing dependency, and a payment slip will want one next.

Recording the name at all is ADR 0015 Q2's attribution pattern (`counted_by_name`) and ADR 0017 Q7's (`wasted_by_name`) applied a third time: the FK alone would record that the owner personally drove every delivery — tidy, and false.

*(Rejected: **give the driver an account now.** The role string costs nothing — `tenant_membership.role` is a free-text column, not an enum — but the app has no way to add a second person to a tenant, and `canPerform` is never called, so a driver account today is a person with write access to every branch's stock and every purchase order. Correct end-state, wrong Part: it needs user management and the permission layer switched on, which is Sprint 7's business.)*

### Q4 — The ledger gets four new words of its own

`TRANSFER_OUT` / `TRANSFER_IN`, plus `TRANSFER_OUT_REVERSAL` / `TRANSFER_IN_REVERSAL` for a void. This is the first Part since 13 to pay the two-migration sign-CHECK dance, and it is paid deliberately.

Two reasons, and the second is the load-bearing one:

1. **A transfer is not an adjustment.** Nobody adjusted anything. `/stock/history` would otherwise read "ปรับลด" for stock that was neither lost nor corrected, and every screen that groups by type would have to remember an exception. Miss it in one place and a truck full of pork appears in **ส่วนต่าง/ปรับปรุง** — the column a manager reads as *someone to talk to*.
2. **FIFO needs the distinction to be correct, not merely tidy.** ADR 0014 Q8 already established that a reversal must cut **its own** layer rather than the head of the queue. A `TRANSFER_IN_REVERSAL` at B has to withdraw the layer that this transfer pushed; were it an ordinary `ADJUST_LOSS`, the walk would pop whatever is at the front — quietly consuming stock B bought elsewhere at a different price.

**Four values still cost only two migrations**, because the dance is per-migration, not per-value: one `ALTER TYPE … ADD VALUE` migration for all four, then one that drops and re-declares `stock_movement_sign_check` naming them (`TRANSFER_IN` / `TRANSFER_OUT_REVERSAL` positive, `TRANSFER_OUT` / `TRANSFER_IN_REVERSAL` negative).

Source types are added too — `TRANSFER_OUT`, `TRANSFER_IN`, `TRANSFER_SHORTAGE`, all pointing at the **same** `stock_transfer_item.id`. This is what resolves Context fact 2 without touching the unique index: `(TRANSFER_OUT, item)` and `(TRANSFER_IN, item)` are two different keys, so one line legitimately posts two movements and both stay idempotent.

*(Rejected: **reuse `ADJUST_LOSS`/`ADJUST_GAIN` with the new source types only** — Parts 15 and 17's cheap precedent, and it would work for `/cost`, which splits on source. It fails on both counts above, and a mislabelled ledger outlives every screen currently reading it.)*

### Q5 — The cost travels with the goods, frozen onto the line

At dispatch the system replays A's FIFO queue, takes the money that leaves with those units, and **stores it on `stock_transfer_item`** — as **money at 2 dp**, never a per-unit rate (ADR 0014 Q12: 1,000 ÷ 90 × 90 loses a fraction of a satang, per layer, forever). B's walk pushes a layer holding exactly that money.

This is a **deliberate, narrow exception to ADR 0014's "cost is stored nowhere"**, and the reason is that the alternative is not "a fresher number" but "a number that costs a graph traversal to produce". Reading the cost of prawns at อารีย์ would mean replaying ทองหล่อ's ledger, which — if ทองหล่อ has itself received transfers — means replaying a third branch, and so on. ADR 0014 Consequence 4 already names the branch-comparison page (every product × every branch) as the first caller that can make replay slow; this would multiply it by the transfer graph.

The exception is narrow because the frozen figure is **an event, not a derivation**: what left A's shelf that afternoon is a historical fact, exactly like the `line_total_actual` a goods receipt freezes.

Accepted, and stated rather than hidden: a backdated receipt at A revalues A's queue but does **not** revalue transfers already dispatched — the same way it does not revalue an invoice already paid. A and B can therefore disagree by that amount, and neither is wrong.

### Q6 — A void is always allowed, and a void is not a transfer back

Voiding appends **reversal lines into the same document** (Part 13's and ADR 0015's pattern — never an edit), each carrying the same frozen money as the line it reverses, and each occurring **now**, because a reversal is itself an event (ADR 0013 L3b). The goods revert to A and B never received them.

Void is permitted **even after B has confirmed receipt**, because that is usually when the mistake surfaces: the wrong product, the wrong branch, the wrong document entirely. Blocking it would leave a keying error with no way out.

The distinction the UI must state in words, because the two are easy to confuse and the ledger cannot tell them apart afterwards:

- **ยกเลิกใบโอน (void)** — this document should never have existed. The goods did not travel.
- **โอนกลับ** — the goods physically travelled back. That is a **new transfer document in the opposite direction**, not a deletion of the old one.

Collapse the two and a crate that made two journeys reads as a crate that never left.

If B has already used the stock when the void lands, B's balance goes negative — which ADR 0014 Q7 already handles as a negative layer at the last known cost, and ADR 0011 Q9 already refuses to block. Accepted silently for MVP: the layer restored at A re-enters at the **back** of its FIFO queue rather than its original position, so value is exact while ordering is approximate — the same class of accepted imprecision as ADR 0014 Q7's price difference.

### Q7 — A count taken while the truck is moving is warned about, not blocked

Because B owns the stock from dispatch, a stock count at B during transit finds a shortage exactly the size of the truck — and Part 15 posts that variance as a real `ADJUST_LOSS` with the counter's name on it.

`/stock-counts` therefore shows the destination branch a notice — *"มีของกำลังส่งมา ยังไม่กดรับ"*, with the quantity and a link to the document — **and lets the count proceed**. The counter decides whether the goods are on the shelf; the system's job is to make sure nobody discovers the truck after the variance has been posted and investigated.

*(Rejected: **blocking the close while a transfer is open.** Safer on paper, and it hands a shop a count it cannot finish because a branch across town forgot to press รับของ. A stock take has to end the evening it starts. Rejected: **saying nothing** — cheapest, and it manufactures exactly one blameless person to blame.)*

### Q8 — One route, and the box that says "something is coming" travels to where people already are

`/transfers` is the route: the list, the create form, the receive step, the void.

But the receiving half of this document is **somebody else's work in another branch**, which no earlier Part has been true of — a waste log, a count and a receipt are each finished by the person who started them. So the *"รอรับ"* box also appears on **`/stock` and the dashboard** of the destination branch. This is Part 17's UX lesson applied before the fact: `/stock` rendering nothing when no product was below par made the feature invisible to every shop that had never used it, and a transfer nobody at the far end can see is worse — it is stock the system says is there, that nobody has been told to look for.

## Decided by existing convention (not grilled)

`tenant_id` on both new tables + RLS (inert until Sprint 7) · document number `{BRANCH_CODE}-TF-####` from the **sending** branch via `withCounterLock` (Part 13.5, Pitfall #25) · quantities `Decimal(15,3)`, entered in any unit and converted with `toBaseQty`, the base figures living on the ledger · Decimal→string at the view layer (Pitfall #20) · decimal guards via the `toFixed` round-trip (Pitfall #30) · `submit_key` read from the form, never minted server-side (ADR 0017 L4) · **both legs go through `createStockMovementLogic`** — ADR 0017 Consequence 3's standing ask, honoured · **a transfer writes no `expense`**: it is a move, not spend — ADR 0016 Consequence 2's standing ask, answered · **inter-department transfer is out of scope**: master-spec's `INTERDEPARTMENT_TRANSFER` waits for a reachable second department (ADR 0012 Q1) and stays Sprint 6+.

## Consequences

1. **The ledger's vocabulary doubles in one Part** — four new movement types after two Parts that deliberately added none. Every `switch` on `MovementType` (the FIFO walk, the drift guards, `/cost`, `/stock/history`) must gain its transfer branch, and the sign CHECK must be re-declared. This is the largest ledger change since Part 13, and the reason Q4 was a stop-and-ask.
2. **`/cost` gains a fourth kind of outflow and must not treat it as a third.** A transfer leg belongs in **neither** purchase spend **nor** ส่วนต่าง/ปรับปรุง — the value never left the business. `TRANSFER_SHORTAGE`, by contrast, **is** a real loss and needs a home on that screen. Part 17 wrote the split so an unrecognised source type falls into variance; that default is now actively wrong for two of the three new values, so the split must be revisited rather than extended.
3. **`purchase_order.branch_id` NOT NULL stops being a limitation.** Central purchasing becomes expressible with no schema change: HQ orders to its own branch and transfers out, and the receiving branch's cost is A's real cost rather than a guess. ADR 0014 Q9c is closed.
4. **One stored cost figure now exists in a system that stores none.** Anything that changes how a transfer's money is computed changes historical costs at the receiving branch, exactly as ADR 0014 Consequence 5 says of `line_total_actual`. It is one number, on one row, written once — and that narrowness is the whole defence.
5. **The driver's identity is a promise to two Parts that do not exist**, and it is honoured differently for each. `driver_user_id` is null for every row until user management ships, so every read must treat the **name** as the authority and the FK as a bonus — if user management never ships, nothing breaks. The handover photograph is not carried at all until attachments exist, because its column cannot be shaped before the storage vendor is chosen. **Both gaps are visible on screen rather than hidden**: the transfer says what evidence it holds, so nobody discovers at the argument that the record was thinner than they assumed.
6. **Two branches can now disagree about cost, correctly.** A backdated receipt at the sending branch revalues its own queue and not the transfers already gone. Anyone reconciling the two will find the gap; it is written here so they find the reason with it.

---
status: accepted
---

# Purchase Order: a sent document, frozen at send time

A PO is not a row that describes an intention — it is **a document that left the building**. Part 11 models it that way: while `DRAFT` it is freely editable, and the moment it is `SENT` it becomes immutable, because from that instant the supplier holds a copy and any silent edit makes the two disagree. Everything a PO line needs in order to still be readable years later — unit price, unit name, and the `toBaseRatio` that converts the ordered unit into the product's base unit — is **copied onto the line at send time** rather than followed through a live FK (the `supplier_product_mapping_id` survives only as provenance, and may be null when the price was typed by hand). Part 11 deliberately ships **without the PR layer** and **without the H.2 deferrable trigger pair**, both for the same reason: the thing they exist to coordinate — multiple departments requesting and being allocated stock — is not reachable in the product yet. Decisions locked in the grill of 2026-08-15/16 (Q1–Q9 + Q8b).

## Context

Sprint 2 = the transactional core. Part 10 shipped the append-only ledger (ADR 0011); Part 13 (GR) will write into it and Part 14 (Cost Engine) will read it. Part 11 sits between: it produces the document that a GR receives *against*, and the prices the cost engine will eventually trust.

Two pieces of prior art bind this Part:

- **ADR 0009** (supplier-product mapping, time-series) explicitly deferred its own consumer: *"Sprint 2 — PO consumer: must **snapshot** mapping price/orderUnit at order time, NOT live FK lookup (preserve historical stock value)."* Part 11 is that consumer, and it also has to **build** the resolver Part 8 never wrote — Part 8 shipped 7 `*Logic` functions, none of which answer "what does this product cost from this supplier, at this branch, today?"
- **ADR 0011 Q1** solved the same class of problem for the ledger by storing base-unit quantities, immune to later `toBaseRatio` edits. A PO line has to answer for itself, because it is written *before* any movement exists.

**Part numbering.** ADR 0011's Context sketched the sequence as "Part 11 auto-pick preferred supplier → Part 12 PO (state machine + snapshot)". This ADR **merges those into a single Part 11**: the price resolver is not a feature on its own, it is the read layer the PO form calls. **Part 12 is left unallocated**, and Part 13 (GR) / Part 14 (Cost Engine) keep their numbers — sprint-progress, CONTEXT.md and ADR 0011 already reference them by number, and renumbering to close a gap would invalidate more than it tidies.

## Decision

### Q1 — No PR layer in Part 11; `purchase_request` deferred to Sprint 3+

The spec's flow is PR → PO → GR, where a PR is a **department's request** that a manager approves (`department_id NOT NULL`, requester needs `can_request_for = true`). That value only exists once a tenant has more than one department. Today `Tenant.enableDepartments` defaults to `false`, and while `/settings` can flip it, **there is no `/departments` route at all** — `tenant-init.ts` creates exactly one department ("Main") and nothing can create a second. A PR layer now would be a form the owner fills in and then approves by themselves. *(Rejected: build PR+PO together per the spec — doubles the Part, adds a second status machine and a many-to-many PR→PO conversion, and pushes GR further out for a workflow no current tenant can exercise.)*

### Q2 — `purchase_order_item_allocation` ships, but the H.2 trigger pair does not

The table is created now, always with **exactly one row per line (department "Main")** while departments are off, because introducing a child table later means migrating a column *and* backfilling every historical PO — the expensive, hard-to-reverse half. The invariant `SUM(allocation.qty_allocated) = po_item.qty_ordered` is enforced **in the app**, inside the same transaction as the write, matching how every other guard in this codebase works (all `*Logic`, RLS inert until Sprint 7 — ADR 0004). H.2's `DEFERRABLE INITIALLY DEFERRED` trigger pair is a **pure additive migration** whenever multi-department allocation becomes reachable. *(Rejected: ship the triggers now — they would be the first database triggers in the project, with the infrastructure and test surface that implies, to police an invariant that can currently only ever be `1 row = the whole line`. Also rejected: a plain `department_id` column on the line, which is cheapest today and the most expensive to undo.)*

### Q3 — A PO line freezes price, unit name, and `toBaseRatio`; the mapping FK is provenance only

`qty_ordered` is stored **in the unit that was ordered** — that is what the supplier's invoice will say and what the person who placed the order remembers — alongside a frozen `to_base_ratio`, so the base-unit quantity is always exactly recomputable. This is the same split Part 10 already uses between `stock_adjustment` (`input_qty` + `input_unit_id`, as entered) and `stock_movement` (base unit, authoritative).

The failure this prevents: order *"1 sack × 25 kg"* on the 1st; someone corrects the sack ratio to 30 on the 5th; the goods arrive on the 10th and Part 13 converts the receipt at **30**, against a PO that meant **25**. `supplier_product_mapping_id` is kept nullable, purely to answer "where did this number come from" (null = typed by hand, per Q5). *(Rejected: freeze the price only and keep `product_unit_id` a live FK, as spec §5.3 literally reads — Part 8's guard blocks *deleting* a referenced ProductUnit but nothing stops an **edit** to its ratio. Also rejected: a full `jsonb` snapshot of the mapping — better audit, worse queries, and Part 14 would have to dig numbers out of JSON.)*

### Q4 — `DRAFT` is editable; `SENT` locks the document

Reachable in Part 11: `DRAFT → SENT` and `→ CANCELLED`. `PARTIALLY_RECEIVED` / `RECEIVED` exist in the enum but are **Part 13's to write** — a GR is what moves them. Amending a sent order means `CANCELLED` + a new PO; a revision/amendment flow is Sprint 3+ if it is ever wanted. This is what lets Part 13 assume a PO line under a GR cannot move beneath it. *(Rejected: editable until the first GR lands — closer to how a Thai SME actually reorders by phone, but it forces Part 13 to reconcile a PO that shifts mid-flight and gives the Q3 snapshot multiple versions.)*

### Q5 — A product with no current price can still be ordered

The resolver returns nothing when there is no live mapping covering today; the line then accepts a **hand-typed price**, snapshotted exactly like any other, with `supplier_product_mapping_id = null` recording that it never came from the price list. This matches the product's founding promise — *works even if you haven't set everything up* — and the very first order from a new supplier is precisely the case with no mapping yet. *(Rejected: block until a mapping exists — turns "order something new" into a detour through master data. Also rejected: auto-create a mapping from the typed price — it writes master data from a transaction the user did not ask to be permanent, and would have to invent an `effectiveFrom` inside ADR 0009's append+supersede series.)*

### Q6 — VAT is snapshotted on the PO; WHT is not captured at all

`subtotal_excl_vat`, `vat_rate_percent`, `vat_amount`, `total_amount` are computed and frozen at send time (same reasoning as Q3 — a supplier's VAT registration can change). `wht_expected_amount` and `net_payment_expected` from spec §5.3 are **not built**: withholding tax attaches to services, rent and professional fees — the seed's only WHT default sits on `OpEx/Professional/Accounting` — so a raw-materials PO would carry two permanently-zero columns. WHT is deducted **at payment**, and there is no payment or expense module until Sprint 3; it lands there, with the accounts that need it. *(Rejected: build the full spec header now.)*

### Q7 — "Send" is a status transition plus a printable page

`SENT` sets `sent_at`, locks the document, and reveals a print-friendly view. Nothing leaves the server: `pdf_url` stays null, no PDF library, no object storage, no outbound mail. Thai SME restaurants send orders over **LINE**, and a page that screenshots cleanly is the shortest path to that; the project also has no real email transport yet (magic links still log to the console). *(Rejected: generate and store a PDF — a new dependency plus storage plus Thai font embedding. Also rejected: email the supplier — outbound mail to third parties is a different kind of system than this one currently is.)*

### Q8 / Q8b — `{BRANCH_CODE}-PO-####`, which makes `Branch.code` required

The number carries its branch so a chain can tell at a glance which kitchen ordered; the counter runs per branch and never resets (no date-boundary reset to get wrong — Decision #60 — and no second race on top of Pitfall #25). The generator mirrors `generateSku` from Part 7a, **including its known scan-then-insert race** — the eventual advisory-lock fix now covers `sku` and `po_number` in one place.

This forces a schema change: `Branch.code` was `String?` with no uniqueness at all. It becomes **NOT NULL with a PARTIAL unique** `(tenant_id, code) WHERE deleted_at IS NULL` in `prisma/manual/`, following `supplier_code_unique.sql` — a **full** unique would let a soft-deleted branch permanently reserve its code, which is Pitfall #22/#23 exactly. Backfill is trivial: every existing tenant has one branch, already coded `MAIN` by `tenant-init.ts`. Branch CRUD (Sprint 3+) inherits the constraint. *(Rejected: `PO-####` per tenant — simplest and consistent with `P-####`, but the number then says nothing about where the order came from. Also rejected: monthly reset.)*

### Q9 — `DRAFT` can be soft-deleted; a sent PO can only be cancelled

`deletedAt` on a `DRAFT` matches how every Sprint 1 entity behaves (hide-not-destroy, CONTEXT.md) and costs nothing; a `SENT` PO becomes `CANCELLED` and stays visible forever. **Nothing is ever hard-deleted.** Consequently `po_number` also takes a **partial** unique `WHERE deleted_at IS NULL` — same trap as Q8b.

## Consequences

1. **Part 13 (GR) gains a hard guarantee and a hard requirement.** A PO line it receives against cannot change (Q4) and carries its own conversion ratio (Q3) — so a GR must convert received quantities with **the line's frozen `to_base_ratio`**, never with a fresh `ProductUnit` lookup, or it reintroduces exactly the bug Q3 closes.
2. **Part 14 (Cost Engine) reads frozen numbers.** Unit price and ratio on the line are historical fact, not a join.
3. **A new `*Logic` lands that Part 8 owed:** `resolveSupplierPriceLogic` — branch-specific mapping first, tenant-default fallback, `today BETWEEN effective_from AND COALESCE(effective_to, 'infinity')`, live rows only. It is a read, and it is the only place ADR 0009's lookup rule is implemented.
4. **`isPreferred` is not used for price resolution.** The user picks the supplier on the PO header, so resolution is already keyed by `(product, supplier, branch, today)`; `isPreferred` only ever suggests *which supplier to pick*.
5. **The spec is now stale in three places** — §5.3's `purchase_order_item.product_unit_id` as a live FK (Q3), `wht_expected_amount` / `net_payment_expected` on the header (Q6), and H.2's trigger pair as Sprint 2 work (Q2). Per the source-of-truth rule in CLAUDE.md, this ADR wins; reconcile the spec toward it.
6. **`purchase_order_item.qty_received` ships now, defaulted to 0, and Part 13 owns every write to it.** The column belongs to the line, and creating it here saves Part 13 a migration on a table it does not own.
7. **`Branch.code` becomes user-visible identity.** It is baked into every PO number of that branch, so editing a code later changes future numbers only — old documents keep the string they were issued with (it is stored on the row, not derived).

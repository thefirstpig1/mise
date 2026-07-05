---
status: accepted
---

# Stock Movement: append-only ledger + manual adjustment source

Sprint 2's transactional core (PO → GR → Cost Engine) all sits on top of one primitive: a record of *how much stock exists, where, and why it changed*. Part 10 builds that primitive as an **append-only ledger** — `stock_movement` — plus the first user-facing producer of ledger rows, `stock_adjustment` (manual count corrections + waste). The design philosophy locked in the grill (Drive `10aiHL24jMSmqHQ8gfl8bPOh5k0liPRtrmUCVJdX-eIs`, 2026-06-20) is **financial integrity over convenience**: the ledger is immutable — no `UPDATE`, no `DELETE`, no `deletedAt` — and every correction is a *new* compensating entry, exactly as a general ledger or a bank statement works. Balance is never stored; it is `SUM(qty)` over the movements of a `(product, branch)`, which is trivial only because every row is normalised to the product's **base unit** (Q1) and carries a **signed** qty (Q2, `+` = in, `−` = out) guarded by a DB `CHECK`. Movements reference their origin **polymorphically** (`source_type` enum + `source_id`, no FK — Q3) with a **1:1** uniqueness invariant (`UNIQUE(source_type, source_id)` — Q4) that makes writes idempotent under retry, and carry **two timestamps** (`occurred_at` = business reality, backdatable; `created_at` = audit — Q5). `branch_id` is **NOT NULL** (Q6, stock is always physically somewhere). Deletion is **strictly forbidden** (Q7); corrections compensate. Balance is a **realtime SUM** on a composite index (Q8). A movement that drives a balance negative is **allowed with a UI warning + explicit confirm**, never blocked (Q9). The MVP ships **3 movement types + 3 source types + 1 ledger table**, with waste folded into `ADJUST_LOSS + reason` rather than a dedicated table (Q10). Part 13 (GR) and Part 14 (Cost Engine) are **pure consumers** of these primitives.

## Context

Mise Sprint 2 = transactional systems layered on Sprint 1 master data. The Part sequence: **Part 10 Stock Movement (this)** → Part 11 auto-pick preferred supplier → Part 12 PO (state machine + snapshot) → Part 13 GR (partial receive, *calls* Part 10's write primitive) → Part 14 Cost Engine (weighted-avg or FIFO) → Part 15 wrap-up. Stock Movement is the foundation every later Part depends on, so it must lock the ledger invariants *now* — sign convention, immutability, base-unit normalisation, source-reference shape — because changing them later means rewriting historical rows and every consumer.

The prior art this ADR builds on:
- **ADR 0004** (`withTenantContext`) — every read/write is tenant-scoped; explicit `tenantId` filtering is the active isolation guard (RLS inert until Sprint 7).
- **ADR 0005** (Product base unit) — each Product has exactly one base unit (`ProductUnit.isBase`, `toBaseRatio = 1`); Q1 stores every movement in that base unit, so ratio changes never rewrite history.
- **ADR 0009** (Supplier-Product Mapping time-series) — the *supersede* pattern (close the old row, open a new one) is the same instinct the ledger applies to corrections: append, never mutate.
- **Part 8.5** (`computeBangkokToday`, ADR 0010) — the Bangkok UTC+7 date helper Q5's backdating reuses.

## Decision

Ten sub-decisions were locked in the grill. Each is `Chosen option — rationale (rejected alternative)`.

### Q1 — Movement quantity storage: **base unit only, normalise on entry**
`stock_movement.qty` is stored in the product's `primaryDimension` base unit (g / ml / count). Conversion from the user's / source's unit happens at the **action layer** using the Sprint 1 `ProductUnit.toBaseRatio` *before* the `INSERT`; the original as-entered unit + qty are preserved on the source row (`stock_adjustment.input_unit_id` / `input_qty`; a GR line will carry its own `orderUnit`). Balance becomes `SUM(qty)` with **no JOIN and no ratio math**, cost calc stays consistent in one unit, and past movements are **immune to later ratio edits** (historical accuracy). *(Rejected: store native unit + ratio per row → every balance/cost read pays a JOIN + multiplication and a ratio edit silently rewrites history.)* **Risk:** an action-layer conversion bug is silent corruption — mitigated by zod validation + a dedicated unit-conversion helper with tests.

### Q2 — Sign convention: **signed qty + DB `CHECK` constraint**
`qty` is a signed `Decimal(15,3)`; `+` = stock in, `−` = stock out. A Postgres `CHECK` (manual SQL, `prisma/manual/stock_movement_sign_check.sql`) binds the sign to the type so an app bug cannot write an inconsistent row:
```sql
CHECK (
  (type IN ('PO_RECEIVE', 'ADJUST_GAIN') AND qty > 0)
  OR (type = 'ADJUST_LOSS' AND qty < 0)
)
```
Balance stays a direct `SUM(qty)`; the invariant is guaranteed at the DB, mirroring the Sprint 1 manual-SQL `CHECK` precedent (mapping `effective_to > effective_from`). *(Rejected: unsigned qty + a separate direction column → balance needs a `CASE`, and nothing stops a direction/qty mismatch.)* **Standing item:** every new movement type must update this `CHECK` and re-apply the manual SQL.

### Q3 — Source reference: **polymorphic (`source_type` enum + `source_id`, no FK)**
Both columns `NOT NULL` — every movement has an origin. A composite index on `(source_type, source_id)` supports lookups; there is **no foreign key**, because an append-only ledger *outlives* its sources and a FK would force either a dangerous `CASCADE` or friction-heavy `RESTRICT`. The enum constraint keeps values valid; the write logic asserts the source row exists before `INSERT`. This scales to Sprint 7+ source types without column bloat and is the mainstream ledger pattern. *(Rejected: one nullable FK per source type → column explosion as source types grow; a single hard FK → coupling the ledger to source lifecycle.)* **Standing item:** a new source type is an append-only Postgres enum `ALTER` (values cannot be removed).

### Q4 — Idempotency / dedupe: **`UNIQUE(source_type, source_id)` + 1:1 model**
A partial `UNIQUE` is unnecessary here (the ledger has no soft-delete — Q7), so a **plain `@@unique([source_type, source_id])`** enforces *exactly one movement per source row* at the DB. The source `INSERT` and the movement `INSERT` run in the **same transaction** (both commit or both roll back — no orphans). A retry that hits `P2002` on this index is caught and **treated as success** (idempotent):
```ts
try {
  await tx.stockMovement.create({ data: { … } });
} catch (e) {
  if (isPrismaP2002(e, ['source_type', 'source_id'])) return { ok: true }; // already exists
  throw e;
}
```
The movement layer is **insert-only** — no update/delete methods are exposed. Corrections are compensating *source* rows (reverse + replace), leaving all three rows visible with a correct net balance. *(Rejected: allow N movements per source + app-side dedupe → the 1:1 DB guarantee is stronger and simpler.)* **Carry-forward:** source-level idempotency (a client-generated submit key) is a Part 13 (GR) concern.

### Q5 — Timestamp granularity: **`occurred_at` + `created_at` (two timestamps)**
- `occurred_at TIMESTAMP(3) NOT NULL DEFAULT now()` — *business reality*: when stock actually changed. The action layer may **backdate** it (real restaurant workflow), stored UTC, displayed Bangkok.
- `created_at TIMESTAMP(3) NOT NULL DEFAULT now()` — *audit*: when the row was inserted. Immutable.

Cost calc (Part 14) orders `ORDER BY occurred_at, created_at`. Backdate validation (zod, Q-note): `occurred_at` not in the future and not older than `today − 90 days` (MVP guard; per-tenant configurable in Sprint 3+). Bangkok handling reuses `computeBangkokToday()` from Part 8.5. *(Rejected: a single timestamp → cannot separate "when it happened" from "when we recorded it", which breaks both backdated cost accuracy and audit.)*

### Q6 — Branch handling: **`branch_id` NOT NULL required**
`branch_id UUID NOT NULL`, FK → `branch(id)` `ON DELETE RESTRICT`. Stock is always physically *somewhere*, so `SUM`/`GROUP BY` never handle a NULL. Action-layer assertions reuse the Sprint 1 pattern: `branch.tenantId === tenantId` (`assertRefBelongsToTenant`) and `branch.deletedAt IS NULL` for *new* movements; existing movements referencing a since-soft-deleted branch keep their history. *(Rejected: nullable branch = "tenant-wide stock" → physically meaningless and pollutes every aggregate with NULL handling.)* **L0 pre-task (Q6):** verify Sprint 1 onboarding guarantees ≥1 branch — **done, guaranteed** (see Consequences); no prep task needed.

### Q7 — Deletion policy + audit: **strict append-only + standard audit fields**
The ledger has **no** `deletedAt`, **no** `update*Logic`, **no** `delete*Logic`. Audit fields: `tenant_id NOT NULL` (RLS prep), `created_by NOT NULL` FK → `app_user`, `notes TEXT NULL`. **No** `updatedAt` / `updated_by` / `deletedAt` / `deleted_by`. Corrections use the Q4 compensating pattern, so `SUM` always includes every row and the balance is unambiguous. UI clutter (a mistake → 3 rows) is bounded (~30 movements/week/SME, ~5% mistake rate) and mitigated by per-type visual badges (L5); Sprint 5+ may add source-level `reverses_source_id` grouping. An AP over/under-delivery discrepancy is captured on the GR line (Part 13), **not** by mutating a movement — the movement always reflects physical truth (`received_qty`). *(Rejected: soft-delete or in-place edit on the ledger → destroys the immutability the whole design rests on.)*

### Q8 — Balance computation: **realtime `SUM` + composite index (MVP)**
```ts
export async function getStockBalanceLogic(
  tenantId: string, productId: string, branchId: string, asOf?: Date
): Promise<Decimal> {
  return withTenantContext(tenantId, async (tx) => {
    const r = await tx.stockMovement.aggregate({
      where: { tenantId, productId, branchId, occurredAt: { lte: asOf ?? new Date() } },
      _sum: { qty: true },
    });
    return r._sum.qty ?? new Decimal(0);
  });
}
```
Variants: `getStockBalancesByBranchLogic` (one product, all branches), `getStockBalancesByProductLogic` (all products at one branch — low-stock report). `asOf` enables time-travel. Returns `Decimal`, serialised to string at the view layer (Pitfall #20). No trigger/materialised balance — `revalidatePath` handles cache (Sprint 1 pattern). At MVP scale (~7.8K rows per (product, branch) over 5 years) the SUM is 5–10 ms on Neon. *(Rejected: a stored/triggered running balance → premature; correctness risk under concurrency for no perceptible gain at MVP scale.)* **Sprint 5+ trigger:** recipe consumption pushes 100K+ rows/(product, branch) → migrate to a `stock_balance_snapshot` + daily delta.

### Q9 — Negative balance policy: **allow with UI warning + explicit confirm**
The action **never blocks** on balance; it always inserts and returns `{ movement, postBalance }`. The L5 form shows a preview (current balance → delta → post-balance); if `postBalance < 0` it raises a warning banner ("หลังบันทึกจะเหลือ X — ตรวจสอบว่าลืมบันทึกรับหรือไม่?") and requires an explicit confirm; the dashboard renders a negative balance as a red "ต้องตรวจสอบ" badge. This handles legitimate backdated cases (a block would reject them) while surfacing data-quality issues. *(Rejected: hard block → breaks backdated entry; silent allow → hides real mistakes.)* **Standing items (Sprint 5+):** concurrency race (`SELECT FOR UPDATE` once recipe consumption exists), per-tenant strict/warn/allow toggle, fiscal-close lockout.

### Q10 — MVP scope: **3 movement types + 3 source types + 1 table + waste-via-adjust**
- **MovementType** (MVP): `PO_RECEIVE` (+, from GR), `ADJUST_GAIN` (+, count up), `ADJUST_LOSS` (−, count down / spoilage / waste).
- **SourceType** (MVP): `GR_LINE` → `goods_received_line` (Part 13), `ADJUSTMENT` → `stock_adjustment` (this Part), `SYSTEM_INITIAL` → onboarding initial stock (**enum reserved; no writer in Part 10**).
- **Waste compromise:** waste is `ADJUST_LOSS` + a `reason` enum (`RECOUNT` / `SPOILAGE` / `DAMAGE` / `OTHER`); Sprint 2 reports `GROUP BY reason`. Sprint 3+ upgrades to a dedicated `WASTE` type + `WASTE_EVENT` table.
- **Responsibility split:** Part 10 builds `stock_movement` + `stock_adjustment` + `createStockMovementLogic` + `createStockAdjustmentLogic` + balance/history reads + the adjust/dashboard/history UI. Part 13 builds `goods_received_line` + GR workflow and *calls* `createStockMovementLogic` — a pure consumer.

*(Rejected: shipping all Sprint 3+ types/tables now → speculative schema for features not yet designed.)*

## Schema

Prisma models (illustrative — final field ordering/relations settled at L1). Both tables are tenant-scoped and RLS-prepped (`tenant_id`), added to `prisma/manual/enable_rls.sql` alongside the Sprint 1 tables (policies inert until Sprint 7, ADR 0004).

```prisma
enum MovementType {
  PO_RECEIVE   // +  IN  — from GR (Part 13)
  ADJUST_GAIN  // +  IN  — manual count correction up
  ADJUST_LOSS  // -  OUT — manual count correction down / spoilage / waste
  @@map("movement_type")
}

enum SourceType {
  GR_LINE         // -> goods_received_line (Part 13)
  ADJUSTMENT      // -> stock_adjustment (Part 10)
  SYSTEM_INITIAL  // reserved: onboarding initial stock (no writer in Part 10)
  @@map("source_type")
}

enum AdjustmentReason {
  RECOUNT
  SPOILAGE
  DAMAGE
  OTHER
  @@map("adjustment_reason")
}

/// Append-only stock ledger. INSERT-only: no updatedAt, no deletedAt, no update/delete
/// logic (Q7). Corrections are new compensating rows (Q4). Balance = SUM(qty) (Q8).
model StockMovement {
  id         String       @id @default(uuid()) @db.Uuid
  tenantId   String       @map("tenant_id") @db.Uuid
  productId  String       @map("product_id") @db.Uuid
  branchId   String       @map("branch_id") @db.Uuid           // NOT NULL (Q6)
  qty        Decimal      @db.Decimal(15, 3)                   // signed, base unit (Q1/Q2)
  type       MovementType
  sourceType SourceType   @map("source_type")                 // polymorphic (Q3)
  sourceId   String       @map("source_id") @db.Uuid          // no FK (Q3)
  occurredAt DateTime     @default(now()) @map("occurred_at") @db.Timestamp(3) // business time (Q5)
  createdAt  DateTime     @default(now()) @map("created_at") @db.Timestamp(3)  // audit time (Q5)
  createdBy  String       @map("created_by")                  // cuid FK -> app_user (Q7)
  notes      String?                                          // optional free-text (Q7)

  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  product       Product  @relation(fields: [productId], references: [id])            // RESTRICT
  branch        Branch   @relation(fields: [branchId], references: [id])             // RESTRICT (Q6)
  createdByUser User     @relation(fields: [createdBy], references: [id])

  /// Sign CHECK is manual SQL (prisma/manual/stock_movement_sign_check.sql) — Prisma
  /// cannot express CHECK. Full @@unique is SAFE here (no soft-delete → no #22/#23 trap).
  @@unique([sourceType, sourceId], map: "stock_movement_source_unique")             // 1:1 idempotency (Q4)
  @@index([branchId, occurredAt], map: "stock_movement_branch_audit_idx")           // branch audit (Q6)
  @@index([productId, branchId, occurredAt, createdAt], map: "stock_movement_chronological_idx") // ordering (Q5) + balance SUM (Q8, leftmost-prefix)
  @@index([tenantId])
  @@map("stock_movement")
}

/// Manual adjustment source (Q10). One adjustment -> exactly one StockMovement, same TX
/// (Q4). Preserves the AS-ENTERED unit + magnitude for audit (Q1); the signed base-unit
/// qty lives on the movement. reason drives Sprint 2 waste analytics.
model StockAdjustment {
  id          String           @id @default(uuid()) @db.Uuid
  tenantId    String           @map("tenant_id") @db.Uuid
  productId   String           @map("product_id") @db.Uuid
  branchId    String           @map("branch_id") @db.Uuid
  type        MovementType                                    // ADJUST_GAIN | ADJUST_LOSS (CHECK-subset)
  reason      AdjustmentReason                                // Q10
  inputQty    Decimal          @map("input_qty") @db.Decimal(15, 6)  // as-entered magnitude (Q1); precision (15,6) vs (15,3) — L1 decides
  inputUnitId String           @map("input_unit_id") @db.Uuid        // as-entered unit (Q1)
  occurredAt  DateTime         @map("occurred_at") @db.Timestamp(3)  // business time (mirrors movement)
  createdAt   DateTime         @default(now()) @map("created_at") @db.Timestamp(3)
  createdBy   String           @map("created_by")             // cuid FK -> app_user

  tenant        Tenant      @relation(fields: [tenantId], references: [id])
  product       Product     @relation(fields: [productId], references: [id])
  branch        Branch      @relation(fields: [branchId], references: [id])
  inputUnit     ProductUnit @relation(fields: [inputUnitId], references: [id])
  createdByUser User        @relation(fields: [createdBy], references: [id])

  @@index([tenantId])
  @@index([productId, branchId, occurredAt])
  @@map("stock_adjustment")
}
```

Manual SQL (`prisma/manual/stock_movement_sign_check.sql`, applied via `DIRECT_URL` after `prisma migrate`, mirroring the Sprint 1 manual-index precedent):
```sql
-- Q2: sign bound to type on the ledger (app bug cannot bypass).
ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_sign_check CHECK (
  (type IN ('PO_RECEIVE', 'ADJUST_GAIN') AND qty > 0)
  OR (type = 'ADJUST_LOSS' AND qty < 0)
);
-- Q10: adjustments are ADJUST_GAIN | ADJUST_LOSS only (PO_RECEIVE is GR-only).
ALTER TABLE stock_adjustment ADD CONSTRAINT stock_adjustment_type_check CHECK (
  type IN ('ADJUST_GAIN', 'ADJUST_LOSS')
);
```

## Consequences

- **One L1 migration** lands both tables, the three enums, all four movement indexes + the two adjustment indexes, and the two `CHECK` constraints (manual SQL). Both tables join `prisma/manual/enable_rls.sql`. Greenfield (no production rows) so every edit is non-destructive.
- **`UNIQUE(source_type, source_id)` is a plain full unique, and that is correct here** — precisely *because* the ledger has no soft-delete (Q7), the Pitfall #22/#23 FULL-unique-soft-delete trap that forced `Product.sku` / `Supplier.code` / `SupplierProductMapping` onto manual partial indexes **does not apply**. This is the mirror-image of the ADR 0010 fix, and worth stating so a future reader doesn't "correct" it into a partial index.
- **The ledger is insert-only by construction.** No `update*Logic` / `delete*Logic` / `deletedAt` exist to call, so a mistaken write can only be corrected by a compensating source row (Q4/Q7). This is the single most load-bearing invariant — every Sprint 2+ consumer (GR edit, cost recompute, transfers) must express corrections as new entries.
- **Base-unit normalisation (Q1) concentrates all conversion risk at the action layer.** The `input_qty × ProductUnit.toBaseRatio → signed base qty` step is the one place a bug becomes silent stock corruption; it gets a dedicated, unit-tested conversion helper + zod bounds, and the as-entered unit is preserved on `stock_adjustment` for audit/back-out.
- **Sign integrity is DB-enforced (Q2), at a maintenance cost:** the `stock_movement_sign_check` must be extended and re-applied for *every* future movement type (WASTE, TRANSFER_*, RECIPE_CONSUME). Recorded as a standing item so the manual-SQL step is never skipped in a Sprint 3+ migration.
- **Balance is a realtime SUM (Q8)** returning `Decimal` → string at the view boundary (Pitfall #20, same as mapping `currentUnitPrice`). Index review is a Sprint 5+ checkpoint; the snapshot+delta migration path is pre-documented.
- **Index collapsed (decided at L0 review):** the grill listed both `stock_movement_balance_idx (product_id, branch_id, occurred_at)` and `stock_movement_chronological_idx (product_id, branch_id, occurred_at, created_at)`, but the former is a strict leftmost-prefix of the latter — so `chronological_idx` covers the balance-`SUM` queries via an index-only scan (leftmost-prefix match on `product_id, branch_id, occurred_at`) with no separate index. `balance_idx` is therefore **dropped**; the ledger ships four indexes — `stock_movement_source_unique`, `stock_movement_chronological_idx`, `stock_movement_branch_audit_idx` (`branch_id, occurred_at` — the branch-wide audit view, not a prefix of the others), and `@@index(tenant_id)`. Fewer redundant indexes = cheaper INSERTs on the hot append path.
- **Backdating is tz-correct (Q5)** via `computeBangkokToday()` reuse (Part 8.5) and a zod `[today−90d, today]` window; the Part 14 Cost Engine will need to decide how a backdated entry triggers a **retroactive cost recompute** (carry-forward, not decided here).
- **Negative balance never blocks the write (Q9)** — the action returns `postBalance` and the L5 UI owns the warn-and-confirm. This keeps the logic layer policy-free and pushes the (Sprint 5+) per-tenant strict/warn/allow toggle to a single UI + one config field.
- **`branch_id` NOT NULL is verified safe (Q6, L0 pre-task).** Both real tenant-creation paths — `createTenant` (`src/server/tenant-init.ts`, called from `src/app/signup/page.tsx`) and the demo `seed.ts` — create the first branch inside the **same atomic `$transaction`** as the tenant row, so no persisted tenant can exist without ≥1 branch. Greenfield production has no legacy rows. **No prep task needed** before L1. (Test files create bare tenants without branches, but those roll back inside their transactions and never persist; the Part 10 E2E harness will create a branch explicitly, as `supplier-product-mapping-logic.test.ts` already does.)
- **Part 13 (GR) is a pure consumer** — it builds `goods_received_line` (`ordered_qty`, `received_qty`, `invoiced_qty`, `discrepancy_qty`, `discrepancy_reason`, `resolution_status`) and calls `createStockMovementLogic` with `received_qty` → `qty`, `source_type = GR_LINE`. Source-level idempotency (client submit key) and the "edit GR → compensating entries" UX are Part 13's to design.
- **Part 14 (Cost Engine) is a pure consumer** — it orders movements by `(occurred_at, created_at)`, chooses weighted-average vs FIFO (its own ADR), and owns the AP discrepancy cost policy (A: `invoice_total / received_qty` recommended default / B: write-off / C: provisional) and retroactive recompute on backdated entries.

Related: **ADR 0009** (Supplier-Product Mapping time-series — the append/supersede instinct the ledger generalises; note the ledger is *stricter* — no in-place overwrite at all, unlike ADR 0010's same-day exception), **ADR 0005** (Product base unit — Q1 stores every movement in this unit), **ADR 0004** (`withTenantContext` — all reads/writes tenant-scoped), **ADR 0010** / Part 8.5 (`computeBangkokToday` reused by Q5 backdating), **CONTEXT.md** (Movement, Adjustment, Ledger, Compensating entry, Balance, `occurred_at` vs `created_at`, Base unit for stock — added in Part 10), **Decision #59** (yield math — relevant when RECIPE_CONSUME lands Sprint 5+), **Decision #60** (tz-aware date boundary — Q5 Bangkok handling), **Pitfall #20** (Decimal across RSC — `qty` string at view layer), **Pitfall #29** (Neon IPv6 hosts pin), **Pitfall #19** (git hook inert — manual push), master-spec-v1.4.md §32, Drive grill doc `10aiHL24jMSmqHQ8gfl8bPOh5k0liPRtrmUCVJdX-eIs`.

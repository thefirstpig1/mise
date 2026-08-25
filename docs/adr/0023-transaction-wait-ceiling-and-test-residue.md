---
status: accepted
---

# A two-second ceiling nobody chose, and the residue a crash leaves behind

For five Parts the test suite had been going red at random — 0 to 4 failures a run, every one of them concurrency-shaped, every one of them green when its file was re-run alone. It never hid a real failure. It was doing something worse: it was making **red unreadable**, and a suite whose red you have learned to re-run is a suite you no longer have.

Part 23 is not a feature. It is the debugging session that found out why, and the two changes that came out of it. Decisions locked in the grill of 2026-08-25 (Q1–Q6).

## Context

1. **The failure was never the advisory lock.** Pitfall #25's counter lock (`acquireCounterLock`, Part 13.5) was the obvious suspect, because the tests that failed most often were the ones that fire `Promise.all` at a counter — `product-logic` L23 and `purchase-order-write` W17. It is not guilty. The lock is `pg_advisory_xact_lock`, released by COMMIT and ROLLBACK alike, and across ten full runs it never produced a single unique-constraint violation.

2. **The error, once captured, says something quite different.** `PrismaClientKnownRequestError: Transaction API error: Unable to start a transaction in the given time` — thrown from `withTenantContext` itself, on `stock-count-logic` N5, a test whose widest moment is a `Promise.all` of **three**. Not a transaction that ran too long. A transaction that never **started**.

3. **That ceiling is Prisma's `maxWait`, and its default is 2,000 ms.** Nobody in this project ever chose it. It arrived with the library, tuned for a Postgres on the same machine as the app. Mise talks to Neon in Singapore through pgbouncer.

4. **In-process contention is not the cause, and the numbers are not close.** Instrumenting every `withTenantContext` call showed the peak number of simultaneous interactive transactions in any one worker process, across the whole suite, is **3** — against a Prisma pool of 29. The slow starts that were captured (503 ms, 521 ms, 542 ms) all occurred at `inflight=1`: the transaction was the only thing its process was doing, and still took half a second to begin. Whatever stalls, stalls **outside our process**.

5. **On a healthy run there is enormous headroom.** 1,771 transaction starts in one green run: mean 32 ms, max 279 ms, and **not one above 500 ms**. The failure is not a distribution creeping up against a ceiling. It is a rare, isolated stall on the link to Singapore — and a 2,000 ms ceiling is low enough to be hit by one.

6. **The project had already decided this, six times, and never wrote it down.** Every place anyone in Mise consciously thought about `maxWait`, they wrote `10_000` — `consumption-post`, `goods-receipt`, `sales-import`, `sales`, and `stock-count` twice. The seventh, the heaviest import, wrote `15_000`. Not one wrote `2_000`. The value was settled long ago; it simply never became the default, so the **126 call sites nobody had reason to think about** silently kept Prisma's.

7. **This is not a test-only bug.** Production runs the same code against the same Neon through the same pooler. Today a user meeting that stall sees "รบกวนลองใหม่อีกครั้ง" after two seconds, at a moment when waiting another half-second would have succeeded.

8. **The tenant residue is real but narrower than it was filed as.** The Sprint 5 handoff recorded that each flake "leaks a tenant, because `afterAll` never finishes". Vitest runs `afterAll` even when a test fails, and the red run captured for this Part cleaned up completely — the database was left at zero tenants. Residue needs a failure in a **hook**, or a worker that dies, and those are rarer than a red test.

## Decision

### Q1 — This is Part 23; Menu Lab becomes Part 24

Part numbers in Mise are a record of what was built and when, not a taxonomy of the product — Part 13.5 exists because Pitfall #25 turned up in the middle of Sprint 2, and it is easier to read the history for it. Menu Lab has not started, so moving it costs nothing.

### Q2 — `withTenantContext` defaults `maxWait` to 10 s. `timeout` does not move.

The default becomes the value the project already chose six times. The seven sites that override it are left exactly as they are: five say the same thing more locally, and two ask for more.

**`timeout` keeps Prisma's 5 s default**, and the asymmetry is deliberate rather than an oversight:

- `maxWait` bounds a transaction that is **waiting to begin**. It holds nothing while it waits. Being generous costs nothing when the system is healthy, because it is a *ceiling*, not a delay — a start that takes 30 ms still takes 30 ms.
- `timeout` bounds a transaction that is **running**, and a running transaction pins a pgbouncer server connection for its whole life. Being generous there lets one runaway hold a genuinely scarce resource, and killing it is a safety property worth keeping.

The twelve sites that need a longer `timeout` already say so out loud, and that explicitness is documentation of which operations are heavy. A raised default would erase it.

### Q3 — The ceiling is the same everywhere, including production

No `NODE_ENV` gate. Two reasons, and the second is the one that matters.

The exposure is real in production: same database, same region, same pooler. A user is *more* exposed than a test, because a test that fails gets re-run and a user who sees an error goes and does something else.

And behaviour that differs by environment means the tests stop testing what production does. That is the classic trap, and it is exactly the kind of thing this Part exists to stop happening.

### Q4 — One sweep module, two ways in

Tenant residue gets a single module that knows how to delete a tenant and everything hanging off it, reachable two ways:

- **`globalTeardown`** deletes only tenants created inside this run's own time window, recorded by `globalSetup`. It catches what a dead worker leaves behind, and it cannot touch anything that existed before the run started.
- **`pnpm test:sweep`** runs the same code with no window, for cleaning up by hand.

**No marker column, and no helper threaded through 47 `tenant.create` sites.** A `createdAt` window identifies exactly what this run is responsible for, needs no schema change, and needs no test file to remember to opt in — a test that forgets a marker is precisely the test whose residue you wanted caught.

The fragile part is the delete order: 39 models carry a `tenantId`, and they must go in FK order. A hardcoded list rots silently as Parts add tables, so **a test reads `Prisma.dmmf` and fails when a model carrying `tenantId` is missing from the sweep**. Part 24's tables will turn that test red the day they land, instead of leaking quietly for a sprint.

### Q5 — Residue on a green run is a bug, and it gets said out loud

If the run was green, every `afterAll` completed. So residue after a green run does not mean a crash — it means **some test's teardown does not delete everything it creates**, which is a real bug in the suite. Part 22 shipped two of those and found them by hand.

The sweep deletes what it finds, so the database does not accumulate, and **prints a warning naming each tenant** so the bug can be traced to its file. It does **not** fail the run: a green suite that reports failure is its own kind of unreadable red, and confusing the two is what this Part is trying to end.

### Q6 — The instrumentation stays

`MISE_TX_TRACE=1` makes `withTenantContext` report how long each transaction took to start. It is inert without the flag, it is what cracked this case, and re-deriving it cost most of a session. Keeping it means the next occurrence is one environment variable away from a distribution instead of a guess.

## Consequences

1. **A genuinely unreachable database now takes 10 s to say so instead of 2 s.** Accepted knowingly: the stall this fixes is transient, and the failure mode it lengthens is one where nothing was going to work anyway.

2. **Vitest parallelism is left alone.** Capping `maxForks` was on the table and was rejected on the evidence: the stalls happened at `inflight=1`, so worker count is not the proximate cause, and paying for it in wall-clock time would have bought a fix for a mechanism that was not the one operating.

3. **Verification is a count of runs, and the count is honest about itself.** The baseline red rate was roughly one run in ten. Ten green runs after a change would still leave better than a one-in-three chance of having proved nothing, so the bar is **30 consecutive runs**, and the result is reported as what it is: evidence, not proof.

   **Result: the mechanism this Part fixes did not occur once in 31 post-change runs** (`Unable to start a transaction in the given time`, baseline roughly 1 in 10). Every red seen afterwards was the different mechanism in Consequence 4.

4. **A SECOND failure mechanism exists, it is not this one, and this Part does not fix it.** Verification turned up `Can't reach database server` — the connection failing outright, and from `withAdminContext`, which opens no transaction at all, so `maxWait` cannot be involved and no ceiling can help it.

   What is known about it:

   - **7 occurrences in 31 post-change runs, 0 in 20 pre-change runs** — but those two totals ran at different times, and the phenomenon comes in windows, so the raw counts are confounded and prove nothing on their own.
   - **Interleaved run-for-run to control for time — including five pairs run while it was actively happening — it is 1 in 11 against 0 in 11.** No detectable difference between the two versions. That is a null result, not an acquittal: one event cannot separate 0 % from 9 %.
   - **It is not reachability.** A bare probe opening a fresh connection to the same endpoint every two seconds scored **205 successes to 1 failure** overall, and **zero failures** across the window in which the suite went red. The endpoint answered a single client in the same minute the suite could not connect.
   - **So it is about connection COUNT, not connection health** — which is the one thing a 14-worker suite does that a probe does not.
   - It strikes a different spec every time, and in its first window it recurred at an interval of very close to **four minutes**. Four minutes is a cycle, and nothing in Mise runs on one.

   The lever for this mechanism is the one that was rightly rejected for the first: capping `maxForks` reduces aggregate connections, and aggregate connections are exactly what this appears to be about. Consequence 2's reasoning does not transfer — it was about `inflight=1`, which is evidence concerning `maxWait` and says nothing here. **This needs its own investigation, and it should not be folded into this Part retroactively.**

5. **When a `beforeAll` fails, the real error is buried by the teardown that follows it.** The spec's `afterAll` then runs with its tenant ids still `undefined` and throws `Can not use 'undefined' value within array` — which is louder, later, and says nothing true about what went wrong. Every red run in verification showed the misleading error second, where a reader looks first. Guarding those teardowns is a real improvement to how readable red is, which is this Part's whole subject, and it is left undone here deliberately: it touches 47 files and was not part of what the grill agreed.

6. **This changes the behaviour of all 133 `withTenantContext` call sites at once**, which is the reason it is written down here rather than left as a one-line diff.

7. **The suite is still slow, and this Part does not address it.** Every read in Mise opens an interactive transaction so that `SET LOCAL app.current_tenant_id` has somewhere to live — four round trips to Singapore to fetch one row. Per ADR 0004 that `SET LOCAL` protects nothing today: the app connects as the table owner, `FORCE ROW LEVEL SECURITY` is not set, and RLS does not become real until Sprint 7. Whether a read that needs no tenant context should still pay for a transaction is a genuine question, it is worth a decision, and it belongs to Sprint 7's RLS work rather than here.

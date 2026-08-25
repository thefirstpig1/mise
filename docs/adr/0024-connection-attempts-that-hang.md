---
status: accepted
---

# Some connection attempts just hang, and the cure is a new attempt

Part 23 fixed the failure it set out to fix and, in verifying it, uncovered a second one wearing similar clothes: `Can't reach database server`. Part 23.5 is the investigation of that, and the one-line change it turned out to need. Decisions locked in the grill of 2026-08-25.

The short version: **a cold connection to Neon hangs about three times in a thousand, and no amount of waiting rescues it — only starting over does.**

## Context

Six suspects were ruled out by measurement rather than by argument. Each one is recorded because each one is the obvious thing to try again next time.

1. **Not server capacity.** Sampling `pg_stat_activity` through a run: peak **19** connections against `max_connections` of **901**. Two per cent.
2. **Not Windows ephemeral ports.** **11** sockets in `TIME_WAIT` against a dynamic range of **16,384**.
3. **Not a client poisoned by `$disconnect`.** Fifteen specs disconnect the shared client in `afterAll`, and `global.prismaGlobal` is process-wide, so a reused worker would inherit a dead client. Logging pids showed **54 files across 54 distinct pids** — vitest gives every file its own process, and nothing is ever shared.
4. **Not the link.** A probe opening one fresh connection every two seconds scored **205 successes to 1 failure**, and **zero** failures across a window in which the suite went red. DNS resolution never failed once.
5. **Not the Part 23 change.** Interleaved run-for-run against the pre-Part-23 code, including five pairs run while the phenomenon was active: **1 in 11 against 0 in 11**.
6. **Not one spec's fault.** It struck a different file every time, and **six of eight** captures were in a `beforeAll` — a fresh process's very first contact with the database.

What survived is visible in the shape of the failures. Three separate instruments — a standalone probe, a burst probe, and the suite itself — all failed at **5.0–5.1 s**, never at any other duration. That is not network variance. That is a fixed ceiling: Prisma's `connect_timeout`, default 5 s.

**And raising that ceiling fixed nothing.** Three arms, each about 2,300 cold connections:

| Arm | Failures | Rate | Failure duration |
|---|---|---|---|
| default | 7 / 2,352 | **0.30 %** | 5097–5124 ms |
| `connect_timeout=20` | 6 / 2,170 | **0.28 %** | 10098–10110 ms |
| retry immediately | **0** | **0 %** | recovered in 266–315 ms |

Raising the ceiling moved which ceiling reported the failure — from `connect_timeout` at 5 s to `pool_timeout` at 10 s — and left the rate untouched. **The attempt that hangs never completes, however long it is given.**

The third arm is the one that says what to do. Seven failures, **seven recovered on one immediate retry**, each in 266–315 ms — ordinary latency, in the same second the first attempt had been hanging. If this were a bad period on the link, a retry fired a moment later would have failed too. It is not a period. It is a per-attempt hazard.

That also explains the rate the suite sees. Every test file is its own process, so a run opens **54-odd cold connections**; at 0.3 % each, roughly one run in five goes red. Observed: **7 in 31**.

## Decision

### Retry the operations that never reached the database — and only those

A failure to *establish* a connection means the query was never sent. Nothing executed, so nothing can execute twice, and that is the entire safety argument. It does not extend to errors the database actually answered, and the set must not be widened casually: retrying a write that *did* reach the server is how you double-charge somebody.

**The match is on the error CLASS, not on `P1001`** — and getting that wrong is what shipped a dead retry the first time. `PrismaClientInitializationError` carries no error code whatsoever: `code` is undefined, `errorCode` is undefined, and the string "P1001" appears nowhere on the object or in its message. Only `P2024`, the pool timeout, is matched by code, because that one is a `PrismaClientKnownRequestError` and does carry one.

Two retries, no backoff. Backoff would be wrong here — the hazard is not congestion clearing, it is one attempt being dead on arrival, and the replacement succeeds immediately.

### It lives in a Prisma client extension, not in `withTenantContext`

Six of the eight captured failures were in a spec's `beforeAll`, going through `withAdminContext` — which opens no transaction and would have sailed straight past a wrapper in `withTenantContext`. An extension over `$allOperations` covers every call in the project, including bare reads like `getUnitTemplates`.

The extended client is cast back to `PrismaClient` so that all 133 call sites keep their existing types. The extension is invisible to them, which is the point.

### The transaction layer needs the same retry, and a guard the extension does not

A transaction that dies on BEGIN never runs an operation, so the extension cannot see it. `withTenantContext` therefore retries too — **but only while the callback has not started.**

That guard is not defensive habit; it is the difference between safe and unsafe. Once the callback has run, a connection error might have arrived after a COMMIT was sent and before its acknowledgement came back, and re-running the callback would apply the same writes a second time. Before the callback starts, nothing has been sent, and starting over is exactly equivalent to never having tried.

### `connect_timeout` goes DOWN, from 5 s to 3 s

Counter-intuitive, and it follows directly from the measurements. Waiting out a hang buys nothing, because it never succeeds; every second spent waiting is a second before the attempt that would have worked. With a retry in place the ceiling's job is to **give up quickly**, and 3 s is comfortably clear of the ~300 ms a healthy connection takes.

It is applied to the URL in code, not in `.env` — that file holds credentials and is not this module's to edit.

Note the direction is opposite to ADR 0023's `maxWait`, and that is consistent rather than contradictory: `maxWait` bounds a wait that *does* eventually succeed, so being generous helps. `connect_timeout` bounds an attempt that will not, so being generous only delays the cure.

### Everywhere, including production

Same reasoning as ADR 0023 Q3. A user meets the identical hazard, and 0.3 % of every button press failing is an error that could have been a 300 ms hiccup nobody noticed.

## Verification

| Condition | Red runs | Rate |
|---|---|---|
| before the fix | 7 / 31 | **23 %** |
| retry present but never firing (see below) | 2 / 15 | 13 % |
| **retry actually firing** | **0 / 15** | **0 %** |

Suite duration was unchanged at a mean of **78.3 s**, which matters: a retry
firing where it should not would have shown up as time, not as red.

If the true rate were still 23 %, fifteen consecutive green runs would happen
about 2 % of the time. Evidence, not proof.

## Consequences

1. **This is tolerance, not a cure.** Something makes a TCP connection to that endpoint hang — the layered probe caught raw TCP and TLS connects exceeding **8 s**, twice, both landing exactly on the minute (17:17:00, 17:19:00). Why is unknown, it lives outside Mise, and it may be a router, an ISP, or Neon's edge. **The retry hides it. It does not fix it**, and if the rate ever climbs, the hiding stops working.

2. **The diagnostic tools are worth keeping.** Four throwaway probes did the work here: a plain connection probe, a **layered** DNS/TCP/TLS probe that separates what Prisma's single P1001 flattens together, a burst probe that opens N cold connections at once, and a retry probe. The layered one is the one to reach for first — Prisma reports DNS failure, TCP failure and TLS failure with the same sentence.

3. **A verification harness can be silently wrong.** The first attempt at verifying the fix reused one client and reported 3,262 successes and no failures — which proved nothing, because it never opened a cold connection and so never met the hazard. `slowRecoveries=0` was the tell: had the hazard occurred and been survived, some request would have taken about 3.3 s. **Verify against the thing that reproduces the failure, not against a convenient proxy.**

4. **Retries are invisible in the numbers.** A recovered attempt costs about 3.3 s and shows up nowhere. If the underlying rate worsens, the first symptom will be the suite quietly getting slower, not going red.

5. **The first version of this retry never fired, and everything looked fine.**
   The predicate tested `e.code === "P1001"`. `PrismaClientInitializationError`
   carries **no code at all** — `code` undefined, `errorCode` undefined, and the
   string "P1001" nowhere on the object or in its message — so it matched
   nothing. `tsc` was clean, 969 tests passed, the suite ran at its usual speed,
   and fifteen verification runs came back looking merely like a fix that had
   not helped. The tell was in probe output from an hour earlier, printed and
   not read: `FAIL 5105ms code=-`.

   `tests/db-retry-logic.test.ts` exists so this cannot recur silently, and
   **D2 builds a real Prisma failure by connecting to a dead port** rather than
   a hand-made object carrying the properties the predicate expects. A fake
   would have passed against the broken predicate too. Reverting the predicate
   turns 3 of the 4 tests red.

6. **A story that fits is not evidence.** "A second Prisma default tuned for a local database" fit Part 23's narrative exactly, was reached for immediately, and was wrong — raising the ceiling took the failure rate from 0.30 % to 0.28 %. Only the second arm caught it, and it was nearly not run.

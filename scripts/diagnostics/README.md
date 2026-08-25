# Connection diagnostics (Part 23.5, ADR 0024)

Four probes, kept because they are what cracked `Can't reach database server`
and because Prisma reports **DNS failure, TCP failure and TLS failure with that
same one sentence**. Reaching for these beats hypothesising.

Run them from the project root, always with `-r dotenv/config`:

```sh
node -r dotenv/config scripts/diagnostics/<probe>.cjs
```

| Probe | Answers |
|---|---|
| `layer-probe.cjs` | **Start here.** Which layer is failing — DNS, TCP or TLS? Times each separately. |
| `conn-monitor.cjs` | How many connections is the server actually holding? Samples `pg_stat_activity` via **DIRECT_URL**, so it stays sighted if the pooler is the problem. |
| `burst-probe.cjs` | Does the failure need N *cold* connections at once? `BURST_N=14`, `BURST_EXTRA="connect_timeout=20"` to A/B a connection-string setting. |
| `retry-probe.cjs` | Does a failed attempt succeed if simply retried? This is the one that identified the fix. |
| `verify-retry.cjs` | Drives `src/lib/db.ts` itself. ⚠️ Reuses one client, so it does **not** open cold connections — see ADR 0024 Consequence 3, where exactly that made a verification meaningless. |

## The shape of the answer, last time

- 2,352 cold connections → 7 failures (**0.30 %**), every one at **5.0–5.1 s**.
  A duration that tight is a fixed ceiling, not network variance.
- Raising `connect_timeout` to 20 s moved failures to **10.1 s** (`pool_timeout`)
  and left the rate at 0.28 %. **The hanging attempt never completes.**
- One immediate retry recovered **7 of 7**, in **266–315 ms**.

A run of the test suite opens ~54 cold connections (every file is its own
process), which is why ~0.3 % per attempt showed up as roughly one red run in
five.

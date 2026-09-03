// ============================================================
// Mise — layer 2 of the two that keep /login from being a cannon
// (Sprint 7 Part 34, ADR 0033 Q7 — owed since ADR 0031 Q6)
// ============================================================
// Layer 1 (`rate-limit.ts`) counts unused links PER ADDRESS, and its own header
// records what it cannot catch: ten thousand addresses hit once each. No single
// identifier ever passes the threshold, and that is precisely the shape of an
// attack on deliverability — which is what actually hurts, because a magic link
// is the only way into Mise. The attacker never suffers; paying shops do.
//
// ── WHY AN IN-MEMORY COUNTER IS CORRECT HERE AND NOT A HACK ────────────────
// Counting in memory normally breaks the moment there are two instances. ADR
// 0033 Q2 chose ONE long-running Node server (the read-per-transaction pattern
// is the worst possible fit for serverless), and Q4 accepted "almost always up"
// rather than "never down". Those two decisions, made for other reasons, are
// what make this one sound. It is a conclusion, not a shortcut.
//
// The alternative was rejected on its own terms: a table would mean a disk
// write on every press of the button, which is exactly what the attacker wants
// — a DoS defence that is itself a DoS vector (Q7).
//
// 🔴 THE SAME TRAP, ONE LEVEL UP, AND IT IS WHY THERE IS A CAP BELOW. An
// unbounded Map keyed by IP is also a memory-shaped DoS: a million source
// addresses would grow it until a 1GB machine is killed, and Q13 warns that an
// OOM restart looks exactly like "the app crashes randomly". So the map is
// capped, and over the cap the LEAST RECENTLY SEEN entries are evicted. That
// degrades in the right direction: an attacker spraying millions of addresses
// pushes real visitors out of the map, which means real visitors stop being
// counted — never that they are refused. Layer 1 still stands underneath.
//
// ── WEAKNESSES ACCEPTED KNOWINGLY (ADR 0033 Q7) ────────────────────────────
// The counter is lost on restart. We control when we restart; the attacker
// does not. And if a second instance is ever added, the limit silently doubles
// — which is why `singleInstanceWarning` exists and is called at startup
// rather than left to be noticed.
// ============================================================

/**
 * ⚠️ A REASONED FLOOR, NOT A MEASURED ONE. Loose enough for five or six staff
 * on one shop Wi-Fi (they share a public IP) each mistyping an address a
 * couple of times; tight enough that spraying thousands of addresses from one
 * source stops after twenty. Validate against a real shop before Beta, the
 * same way MAX_OUTSTANDING_LINKS is owed a validation.
 */
export const MAX_SENDS_PER_IP_PER_HOUR = 20;

/** The window the count is taken over. */
export const IP_WINDOW_MS = 60 * 60 * 1000;

/**
 * How many distinct addresses the map will hold. See the header: this is the
 * bound that stops the defence becoming the attack.
 */
export const MAX_TRACKED_IPS = 10_000;

type Bucket = {
  /** Timestamps of sends attributed to this address, oldest first. */
  hits: number[];
  /** Last time this address was seen at all — the LRU key. */
  seenAt: number;
};

const buckets = new Map<string, Bucket>();

/**
 * The client's address, as the EDGE reports it — never as the client claims it.
 *
 * 🔴 `Fly-Client-IP` and NOT `X-Forwarded-For`. Fly's proxy sets the former on
 * every request it forwards and a client cannot influence it. `X-Forwarded-For`
 * is a client-supplied header that any proxy may append to, so a rate limit
 * keyed on it is a rate limit the attacker chooses the key for — one line of
 * curl and every request looks like a new visitor.
 *
 * NO HEADER MEANS PASS, NOT BLOCK (Q7). Locally there is no proxy and no
 * header, and a login form that refuses on a dev machine would be discovered
 * at the worst moment. The cost is that this layer does nothing without an
 * edge in front — which is true of the whole layer by construction.
 */
export function clientIpFrom(headers: {
  get(name: string): string | null;
}): string | null {
  const ip = headers.get("fly-client-ip");
  if (!ip) return null;
  const trimmed = ip.trim();
  return trimmed.length > 0 && trimmed.length <= 45 ? trimmed : null;
}

/** Drop timestamps that have fallen out of the window; report what is left. */
function live(bucket: Bucket, now: number): number[] {
  const floor = now - IP_WINDOW_MS;
  if (bucket.hits.length > 0 && bucket.hits[0] <= floor) {
    bucket.hits = bucket.hits.filter((t) => t > floor);
  }
  return bucket.hits;
}

/**
 * How far over the cap the map is allowed to drift before a sweep runs.
 *
 * 🔴 THIS SLACK IS NOT A ROUNDING CHOICE, IT IS THE FIX FOR A REAL DEFECT.
 * Sweeping the instant the map passes the cap means sorting ten thousand
 * entries on EVERY subsequent request, because the sweep leaves the map exactly
 * at the cap and the next insert exceeds it again. Under a spray attack — the
 * one case this whole file exists for — the defence would burn more CPU than
 * the attack. It was caught by the tests taking 4.5 seconds, which is what a
 * quadratic cost looks like from outside.
 *
 * With slack the sweep drops the map back to the cap and cannot recur until
 * another `MAX_TRACKED_IPS / 10` distinct addresses have arrived.
 */
const SWEEP_AT = MAX_TRACKED_IPS + Math.floor(MAX_TRACKED_IPS / 10);

/**
 * Make room, in the order that loses the least.
 *
 * First a full prune, since an attack leaves thousands of buckets whose
 * timestamps have all aged out; that alone usually suffices. Only if the map is
 * still over the cap does anything live get evicted, and then it is the least
 * recently seen.
 */
function enforceCap(now: number): void {
  if (buckets.size <= SWEEP_AT) return;

  for (const [ip, bucket] of buckets) {
    if (live(bucket, now).length === 0) buckets.delete(ip);
  }
  if (buckets.size <= MAX_TRACKED_IPS) return;

  const byAge = [...buckets.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt);
  const excess = buckets.size - MAX_TRACKED_IPS;
  for (let i = 0; i < excess; i++) buckets.delete(byAge[i][0]);
}

/**
 * Count this address's send and say whether it has had too many.
 *
 * RECORDS FIRST, THEN DECIDES — deliberately, and it is the same reasoning
 * layer 1 records for itself: a refused attempt must still count, or hammering
 * the button resets the very limit it is tripping.
 *
 * `null` (no edge header) always passes and records nothing.
 */
export function tooManySendsFromIp(
  ip: string | null,
  now: number = Date.now(),
): boolean {
  if (!ip) return false;

  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { hits: [], seenAt: now };
    buckets.set(ip, bucket);
  }

  bucket.seenAt = now;
  const hits = live(bucket, now);
  hits.push(now);
  enforceCap(now);

  return hits.length > MAX_SENDS_PER_IP_PER_HOUR;
}

/**
 * The count this address currently carries, without recording anything.
 * For tests and for a diagnostic line; never for a decision.
 */
export function sendsFromIp(ip: string, now: number = Date.now()): number {
  const bucket = buckets.get(ip);
  return bucket ? live(bucket, now).length : 0;
}

/** Tests only. Production has one process and never wants this. */
export function resetIpRateLimit(): void {
  buckets.clear();
}

/**
 * How many addresses are currently held. The bound this reports IS the
 * invariant that keeps the limiter from being a memory-shaped DoS, so it is
 * exported to be asserted on rather than left to be reasoned about.
 */
export function trackedIpCount(): number {
  return buckets.size;
}

/**
 * What to say at startup, or `null` when there is nothing to say.
 *
 * ADR 0033 Consequence 2: the day a second instance is added this limit leaks
 * to double, and it leaks SILENTLY — no error, no failed request, just twice
 * as much mail as intended. A wrong number that never announces itself is the
 * failure mode this project has spent whole Parts removing, so the counter
 * says out loud what it is assuming.
 *
 * Pure, and takes the environment as an argument, so the message can be tested
 * without a Fly machine. Typed as the two variables it actually reads rather
 * than as `NodeJS.ProcessEnv`, which Next augments with a required NODE_ENV and
 * would force every caller to build a whole environment to ask one question.
 */
export function singleInstanceWarning(env: {
  FLY_APP_NAME?: string;
  FLY_MACHINE_ID?: string;
}): string | null {
  if (!env.FLY_APP_NAME) return null; // not on Fly: no edge, no header, no limit

  const machine = env.FLY_MACHINE_ID ?? "unknown";
  return (
    `[rate-limit] per-IP login limiting is IN MEMORY on machine ${machine}: ` +
    `${MAX_SENDS_PER_IP_PER_HOUR} sends per IP per hour, counted by this process alone. ` +
    `It is correct only while this app runs exactly ONE instance (ADR 0033 Q2/Q7). ` +
    `If you see this line from two different machine ids, the limit has silently ` +
    `doubled and needs a shared counter.`
  );
}

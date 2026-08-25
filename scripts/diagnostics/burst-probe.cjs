// Part 23.5 — mimic what the suite does that a one-at-a-time probe does not:
// open N COLD connections at the same instant, the way 14 fresh fork processes
// do when vitest hands out the next batch of files.
const { PrismaClient } = require('@prisma/client');
const ts = () => new Date().toTimeString().slice(0, 8);
const N = Number(process.env.BURST_N || 14);
const EXTRA = process.env.BURST_EXTRA || '';

(async () => {
  const base = process.env.DATABASE_URL;
  const url = EXTRA ? base + (base.includes('?') ? '&' : '?') + EXTRA : base;
  console.log(`${ts()} burst N=${N} extra=${EXTRA || '(none)'}`);
  let ok = 0, fail = 0; const fails = [];
  const deadline = Date.now() + 6 * 60 * 1000;
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    const clients = Array.from({ length: N }, () => new PrismaClient({ datasources: { db: { url } } }));
    const results = await Promise.all(clients.map(async (c) => {
      const t0 = Date.now();
      try { await c.$queryRaw`SELECT 1`; return { ms: Date.now() - t0, ok: true }; }
      catch (e) { return { ms: Date.now() - t0, ok: false, code: e.code || '-', err: String(e.message).replace(/[\r\n]+/g, ' ').slice(0, 200) }; }
    }));
    for (const r of results) {
      if (r.ok) ok++; else { fail++; fails.push(r.ms); console.log(`${ts()} r${round} FAIL ${r.ms}ms code=${r.code} :: ${r.err}`); }
    }
    const slowest = Math.max(...results.map(r => r.ms));
    if (round % 10 === 0 || slowest > 3000) console.log(`${ts()} r${round} slowest=${slowest}ms ok=${ok} fail=${fail}`);
    await Promise.all(clients.map(c => c.$disconnect().catch(() => {})));
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`${ts()} BURST DONE ok=${ok} fail=${fail} failMs=[${fails.join(',')}]`);
})();

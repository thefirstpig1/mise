// Part 23.5 — raising the ceiling did not reduce the failure rate (0.30% -> 0.28%),
// it only changed which ceiling reports it. So the stall is long, not marginal.
// The question that matters now: does the SAME connection succeed on a retry?
const { PrismaClient } = require('@prisma/client');
const ts = () => new Date().toTimeString().slice(0, 8);
const N = Number(process.env.BURST_N || 14);

const attempt = async () => {
  const c = new PrismaClient();
  const t0 = Date.now();
  try { await c.$queryRaw`SELECT 1`; return { ms: Date.now() - t0, ok: true, c }; }
  catch (e) { return { ms: Date.now() - t0, ok: false, code: e.code || '-', c }; }
};

(async () => {
  console.log(`${ts()} retry-probe N=${N}`);
  let ok = 0, firstFail = 0, retryOk = 0, retryFail = 0;
  const deadline = Date.now() + 6 * 60 * 1000;
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    const results = await Promise.all(Array.from({ length: N }, async () => {
      const a = await attempt();
      await a.c.$disconnect().catch(() => {});
      if (a.ok) return { ok: true };
      firstFail++;
      const b = await attempt();               // immediate retry, fresh client
      await b.c.$disconnect().catch(() => {});
      console.log(`${ts()} r${round} FAIL ${a.ms}ms code=${a.code} -> RETRY ${b.ok ? 'OK' : 'FAIL'} ${b.ms}ms code=${b.code || '-'}`);
      return { ok: false, retried: b.ok };
    }));
    for (const r of results) {
      if (r.ok) ok++; else if (r.retried) retryOk++; else retryFail++;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`${ts()} RETRY DONE firstTryOk=${ok} firstFail=${firstFail} retryRecovered=${retryOk} retryStillFailed=${retryFail}`);
})();

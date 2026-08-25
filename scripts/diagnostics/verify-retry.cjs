// Part 23.5 — does the SHIPPED code (extension + connect_timeout=3) actually
// survive the hazard? Same burst as the probes, but through src/lib/db.ts.
const path = require('node:path');
require('tsx/cjs');
const { prisma } = require(path.join(process.cwd(), 'src/lib/db.ts'));
const ts = () => new Date().toTimeString().slice(0, 8);
const N = Number(process.env.BURST_N || 14);
(async () => {
  console.log(`${ts()} verify-retry N=${N} (through src/lib/db.ts)`);
  let ok = 0, fail = 0, slow = 0;
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    const rs = await Promise.all(Array.from({ length: N }, async () => {
      const t0 = Date.now();
      try { await prisma.$queryRaw`SELECT 1`; return { ms: Date.now() - t0, ok: true }; }
      catch (e) { return { ms: Date.now() - t0, ok: false, code: e.code || '-', err: String(e.message).replace(/[\r\n]+/g, ' ').slice(0, 140) }; }
    }));
    for (const r of rs) {
      if (r.ok) { ok++; if (r.ms > 3000) { slow++; console.log(`${ts()} RECOVERED-slow ${r.ms}ms`); } }
      else { fail++; console.log(`${ts()} STILL-FAILED ${r.ms}ms code=${r.code} :: ${r.err}`); }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`${ts()} VERIFY DONE ok=${ok} fail=${fail} slowRecoveries=${slow}`);
  await prisma.$disconnect();
})();

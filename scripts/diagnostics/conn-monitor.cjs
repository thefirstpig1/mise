// Part 23.5 — sample server-side connections while the suite runs.
// Connects via DIRECT_URL on purpose: if the POOLER is the thing saturating,
// a monitor sharing it would go blind at exactly the moment that matters.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const ts = () => new Date().toTimeString().slice(0, 8);
(async () => {
  const s = await db.$queryRawUnsafe(
    "SELECT current_setting('max_connections') AS max_conn, current_setting('superuser_reserved_connections') AS reserved"
  );
  console.log(`${ts()} settings ${JSON.stringify(s[0])}`);
  const deadline = Date.now() + 12 * 60 * 1000;
  let peak = 0;
  while (Date.now() < deadline) {
    try {
      const rows = await db.$queryRawUnsafe(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE state = 'active')::int AS active,
               count(*) FILTER (WHERE state = 'idle')::int AS idle,
               count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_tx
        FROM pg_stat_activity WHERE datname = current_database()`);
      const r = rows[0];
      if (r.total > peak) peak = r.total;
      console.log(`${ts()} total=${r.total} active=${r.active} idle=${r.idle} idle_tx=${r.idle_tx} peak=${peak}`);
    } catch (e) {
      console.log(`${ts()} MONITOR-FAIL :: ${String(e.message).split('\n').find(l => l.trim())}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`${ts()} MONITOR DONE peak=${peak}`);
  await db.$disconnect();
})();

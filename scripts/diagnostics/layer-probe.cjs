// Part 23.5 — Prisma's P1001 says "Can't reach database server" for DNS
// failure, TCP failure and TLS failure alike. This separates them, so the next
// occurrence names its own layer instead of being three suspects at once.
const dns = require('node:dns').promises;
const net = require('node:net');
const tls = require('node:tls');

const HOST = (process.env.DATABASE_URL.match(/@([^/:]+)/) || [])[1];
const PORT = 5432;
const ts = () => new Date().toTimeString().slice(0, 8);

const timed = (label, fn) => async () => {
  const t0 = Date.now();
  try { await fn(); return { label, ms: Date.now() - t0, ok: true }; }
  catch (e) { return { label, ms: Date.now() - t0, ok: false, err: e.code || e.message }; }
};

const resolve = timed('dns', () => dns.lookup(HOST));
const connect = timed('tcp', () => new Promise((res, rej) => {
  const s = net.createConnection({ host: HOST, port: PORT, timeout: 8000 });
  s.on('connect', () => { s.destroy(); res(); });
  s.on('timeout', () => { s.destroy(); rej(new Error('TIMEOUT')); });
  s.on('error', (e) => { s.destroy(); rej(e); });
}));
// Postgres needs an SSLRequest before TLS; Neon also needs SNI. A bare TLS
// handshake on 5432 is not valid PG, so this only measures reachability+SNI.
const handshake = timed('tls', () => new Promise((res, rej) => {
  const s = net.createConnection({ host: HOST, port: PORT, timeout: 8000 });
  s.on('connect', () => {
    s.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])); // SSLRequest
    s.once('data', (b) => {
      if (b.toString() !== 'S') { s.destroy(); return rej(new Error('NO-SSL:' + b.toString())); }
      const t = tls.connect({ socket: s, servername: HOST, rejectUnauthorized: false }, () => { t.destroy(); res(); });
      t.on('error', (e) => { t.destroy(); rej(e); });
    });
  });
  s.on('timeout', () => { s.destroy(); rej(new Error('TIMEOUT')); });
  s.on('error', (e) => { s.destroy(); rej(e); });
}));

(async () => {
  console.log(`${ts()} probing ${HOST}:${PORT}`);
  const tally = { dns: [0, 0], tcp: [0, 0], tls: [0, 0] };
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    for (const step of [resolve, connect, handshake]) {
      const r = await step();
      tally[r.label][r.ok ? 0 : 1]++;
      if (!r.ok) console.log(`${ts()} ${r.label.toUpperCase()}-FAIL ${r.ms}ms :: ${r.err}`);
      else if (r.ms > 2000) console.log(`${ts()} ${r.label}-slow ${r.ms}ms`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`${ts()} LAYER DONE dns=${tally.dns} tcp=${tally.tcp} tls=${tally.tls} (ok,fail)`);
})();

// ============================================================
// คิดครัว — the operator's two billing commands (Kong 2026-10-29)
// ============================================================
// Every shop has a package and the day it stops being free. Only the platform
// sets them, so they have no screen inside any shop — and a platform screen
// would need to read across every tenant, which is a second door around the
// per-shop isolation (ADR 0030: the bypass door has an allowlist of one). A
// command run ON the production machine needs neither.
//
//   fly ssh console -C "node scripts/plan.mjs list"
//   fly ssh console -C "node scripts/plan.mjs set <tenant-id> standard 2027-10-30 'ร้านแรก ใช้ฟรี 1 ปี'"
//
// Locally the same commands read .env (the dev database).
//
// It connects with DIRECT_URL — the owner role, which bypasses row-level
// security — because listing shops is by definition across tenants. PLAIN .mjs,
// NOT TypeScript: the production image has no tsx (see manual-sql-order.mjs).
// ============================================================

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const PLANS = { trial: "ทดลองใช้", standard: "มาตรฐาน" };

if (!process.env.DIRECT_URL && fs.existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL is not set — run this on the production machine (fly ssh console) or from the repo root.");
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const day = (d) => (d ? d.toISOString().slice(0, 10) : "—");

async function list() {
  const shops = await db.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      plan: true,
      planFreeUntil: true,
      planNote: true,
      _count: { select: { branches: { where: { deletedAt: null } } } },
    },
  });
  for (const t of shops) {
    console.log(
      [t.id, t.name, `สร้าง ${day(t.createdAt)}`, `${t._count.branches} สาขา`, PLANS[t.plan] ?? t.plan, `ฟรีถึง ${day(t.planFreeUntil)}`, t.planNote ?? ""].join(" | ")
    );
  }
  console.log(`${shops.length} ร้าน`);
}

async function set(id, plan, freeUntil, note) {
  // An omitted note keeps the old one; "" clears it.
  if (!id || !plan) throw new Error("usage: set <tenant-id> <trial|standard> [YYYY-MM-DD|none] [note]");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`"${id}" is not a shop id — copy it from "list"`);
  if (!(plan in PLANS)) throw new Error(`plan must be one of: ${Object.keys(PLANS).join(", ")}`);
  let until = null;
  if (freeUntil && freeUntil !== "none") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(freeUntil) || Number.isNaN(Date.parse(`${freeUntil}T00:00:00Z`))) {
      throw new Error(`free-until must be YYYY-MM-DD (got ${freeUntil})`);
    }
    until = new Date(`${freeUntil}T00:00:00Z`);
  }
  const before = await db.tenant.findUnique({ where: { id }, select: { name: true, plan: true, planFreeUntil: true, planNote: true } });
  if (!before) throw new Error(`no shop with id ${id} — run "list" first`);
  const after = await db.tenant.update({
    where: { id },
    data: { plan, planFreeUntil: until, planNote: note === undefined ? before.planNote : note.trim() || null, planUpdatedAt: new Date() },
    select: { name: true, plan: true, planFreeUntil: true, planNote: true },
  });
  console.log(`${after.name}`);
  console.log(`  ก่อน: ${PLANS[before.plan] ?? before.plan} · ฟรีถึง ${day(before.planFreeUntil)} · ${before.planNote ?? ""}`);
  console.log(`  หลัง: ${PLANS[after.plan]} · ฟรีถึง ${day(after.planFreeUntil)} · ${after.planNote ?? ""}`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "list") await list();
  else if (cmd === "set") await set(...args);
  else {
    console.error('usage: node scripts/plan.mjs list | set <tenant-id> <trial|standard> [YYYY-MM-DD|none] ["note"]');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}

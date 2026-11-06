// ADR 0045 — the control page's figures and its to-do box, from plain rows.
// Pure: no database. src/server/platform.ts only fetches what these read.

import { describe, expect, it } from "vitest";
import { buildOverview, buildTodos, type OverviewShop } from "@/lib/platform-overview";
import { parseBlocks } from "@/app/platform/docs/_components/LegalMarkdown";
import { PLAYBOOKS } from "@/lib/platform-playbooks";
import { readFileSync } from "node:fs";
import path from "node:path";

const NOW = new Date("2026-11-07T03:00:00Z"); // 10:00 Bangkok
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const ADMINS = new Set(["kong@example.com"]);

let seq = 0;
function shop(over: Partial<OverviewShop> = {}): OverviewShop {
  seq += 1;
  const createdAt = over.createdAt ?? daysAgo(20);
  return {
    id: `t${seq}`,
    name: `ร้าน ${seq}`,
    createdAt,
    updatedAt: createdAt,
    plan: "trial",
    freeUntil: null,
    method: "PERIODIC_INVENTORY",
    branches: 1,
    members: [{ userId: `u${seq}`, email: `owner${seq}@shop.th`, role: "owner" }],
    facts: { hasSupplier: false, hasProduct: false, hasSalesDay: false, hasLiveRecipe: false, hasClosedCount: false },
    lastByFeature: {},
    lastMovement: null,
    pos: {},
    branchesWithoutPos: 1,
    staffWithoutAccount: 0,
    peopleWithOwnPermissions: 0,
    ...over,
  };
}

describe("ภาพรวม (ADR 0045 Q3)", () => {
  it("O1: a shop an admin owns is left out of every figure and named instead", () => {
    const mine = shop({ name: "ครัวคุณแม่ (ร้านตัวอย่าง)", members: [{ userId: "k", email: "Kong@Example.com", role: "owner" }], branches: 2 });
    const real = shop();
    const o = buildOverview([mine, real], ADMINS, NOW);
    expect(o.shops).toBe(1);
    expect(o.excluded).toEqual([{ id: mine.id, name: mine.name }]);
    expect(o.branches.total).toBe(1);
    expect(o.users.total).toBe(1);
  });

  it("O2: people — owners, and one person in two shops counts once but shows as multi-shop", () => {
    const a = shop({ members: [{ userId: "boss", email: "b@x.th", role: "owner" }, { userId: "acc", email: "acc@x.th", role: "accountant" }] });
    const b = shop({ members: [{ userId: "boss2", email: "b2@x.th", role: "owner" }, { userId: "acc", email: "acc@x.th", role: "accountant" }] });
    const o = buildOverview([a, b], ADMINS, NOW);
    expect(o.users).toEqual({ total: 3, owners: 2, multiShop: 1 });
    expect(o.roles.find((r) => r.key === "accountant")!.n).toBe(2);
  });

  it("O3: 'recorded in 7 days' reads every feature and the stock ledger; an older record does not count", () => {
    const fresh = shop({ lastByFeature: { goodsReceipt: daysAgo(2) } });
    const ledgerOnly = shop({ lastMovement: daysAgo(6) });
    const stale = shop({ lastByFeature: { expense: daysAgo(12) } });
    const o = buildOverview([fresh, ledgerOnly, stale], ADMINS, NOW);
    expect(o.recorded.d7.map((s) => s.id)).toEqual([fresh.id, ledgerOnly.id]);
    expect(o.recorded.d30).toHaveLength(3);
    expect(o.features.find((f) => f.key === "expense")!.n).toBe(1);
    expect(o.features.find((f) => f.key === "goodsReceipt")!.n).toBe(1);
  });

  it("O4: POS is counted in branches, and a branch with none says so", () => {
    const two = shop({ branches: 2, pos: { FOODSTORY: 2 }, branchesWithoutPos: 0 });
    const half = shop({ branches: 2, pos: { OCHA: 1 }, branchesWithoutPos: 1 });
    const o = buildOverview([two, half], ADMINS, NOW);
    expect(o.pos.find((p) => p.key === "FOODSTORY")!.n).toBe(2);
    expect(o.pos.find((p) => p.key === "OCHA")!.n).toBe(1);
    expect(o.pos.find((p) => p.key === "none")!.n).toBe(1);
  });

  it("O5: the funnel uses the shop's own checklist rule; the recipe step counts only recipe shops", () => {
    const saved = (d: Date) => new Date(d.getTime() + 60_000); // settings saved a minute after signup
    const a = shop({ updatedAt: saved(daysAgo(20)), facts: { hasSupplier: true, hasProduct: true, hasSalesDay: true, hasLiveRecipe: false, hasClosedCount: true } });
    const b = shop({ method: "RECIPE_CONSUMPTION", facts: { hasSupplier: false, hasProduct: false, hasSalesDay: true, hasLiveRecipe: true, hasClosedCount: false } });
    const c = shop();
    const o = buildOverview([a, b, c], ADMINS, NOW);
    const step = (k: string) => o.funnel.find((s) => s.key === k)!;
    expect(step("signup")).toMatchObject({ n: 3, of: 3 });
    expect(step("shop")).toMatchObject({ n: 1, of: 3 }); // b and c never saved settings
    expect(step("sales")).toMatchObject({ n: 2, of: 3 });
    expect(step("recipe")).toMatchObject({ n: 1, of: 1 });
    expect(step("team")).toMatchObject({ n: 0, of: 3 });
    // The biggest drop is a share, not a count: signup 100% → settings 33%.
    expect(o.biggestDrop).toBe("shop");
  });

  it("O5b: a small recipe pool is not mistaken for the drop — 10 shops, 2 on recipes and both done", () => {
    const all = { hasSupplier: true, hasProduct: true, hasSalesDay: true, hasLiveRecipe: true, hasClosedCount: true };
    const saved = new Date(daysAgo(20).getTime() + 60_000);
    const shops = Array.from({ length: 10 }, (_, i) =>
      shop({
        createdAt: daysAgo(20),
        updatedAt: saved,
        method: i < 2 ? "RECIPE_CONSUMPTION" : "PERIODIC_INVENTORY",
        facts: { ...all, hasClosedCount: i < 5 },
      })
    );
    const o = buildOverview(shops, ADMINS, NOW);
    // Counted raw, supplier 10 → recipe 2 looks like the worst step; as a share it is 100% → 100%.
    expect(o.funnel.find((s) => s.key === "recipe")).toMatchObject({ n: 2, of: 2 });
    expect(o.biggestDrop).toBe("count");
  });

  it("O6: weekly signups cover twelve weeks ending this week", () => {
    const o = buildOverview([shop({ createdAt: daysAgo(1) }), shop({ createdAt: daysAgo(200) })], ADMINS, NOW);
    expect(o.signups.weekly).toHaveLength(12);
    expect(o.signups.weekly.reduce((a, w) => a + w.n, 0)).toBe(1);
    expect(o.signups.weekly[11].n).toBe(1);
  });
});

describe("ต้องทำ (ADR 0045 Q2)", () => {
  const none = { count: 0, oldest: null };

  it("T1: nothing to do is an empty list — except the legal drafts, which are not lawyer-reviewed yet", () => {
    const t = buildTodos({ shops: [shop({ facts: { hasSupplier: false, hasProduct: false, hasSalesDay: true, hasLiveRecipe: false, hasClosedCount: false } })], admins: ADMINS, newReports: none, now: NOW });
    expect(t.map((x) => x.key)).toEqual(["legal"]);
  });

  it("T2: free ending within 30 days, or already over, is an item with its date; 31 days away is not", () => {
    const soon = shop({ name: "ใกล้หมด", freeUntil: new Date("2026-11-20T00:00:00Z"), facts: { hasSupplier: false, hasProduct: false, hasSalesDay: true, hasLiveRecipe: false, hasClosedCount: false } });
    const over = shop({ name: "หมดแล้ว", freeUntil: new Date("2026-11-01T00:00:00Z"), facts: soon.facts });
    const far = shop({ name: "อีกนาน", freeUntil: new Date("2026-12-08T00:00:00Z"), facts: soon.facts });
    const t = buildTodos({ shops: [soon, over, far], admins: ADMINS, newReports: none, now: NOW });
    const free = t.filter((x) => x.key.startsWith("free-"));
    expect(free.map((x) => x.shops![0].name)).toEqual(["หมดแล้ว", "ใกล้หมด"]); // earliest due first
    expect(free[0]).toMatchObject({ tone: "bad", chip: "เลยมา 6 วัน", due: "2026-11-01" });
    expect(free[1]).toMatchObject({ tone: "warn", chip: "อีก 13 วัน" });
  });

  it("T3: dated items come before undated ones", () => {
    const s = shop({ freeUntil: new Date("2026-11-10T00:00:00Z") });
    const t = buildTodos({ shops: [s], admins: ADMINS, newReports: { count: 2, oldest: daysAgo(3) }, now: NOW });
    expect(t[0].key).toBe(`free-${s.id}`);
    expect(t.find((x) => x.key === "reports")).toMatchObject({ title: "เรื่องที่แจ้งเข้ามายังไม่ได้เปิดอ่าน 2 เรื่อง", chip: "เก่าสุด 3 วัน" });
  });

  it("T4: a shop signed up over 7 days ago with no sales imported; 7 days exactly is not yet", () => {
    const stuck = shop({ createdAt: daysAgo(9) });
    const fresh = shop({ createdAt: daysAgo(7) });
    const t = buildTodos({ shops: [stuck, fresh], admins: ADMINS, newReports: none, now: NOW });
    expect(t.find((x) => x.key === "stuck-sales")!.shops).toEqual([{ id: stuck.id, name: stuck.name }]);
  });

  it("T5: one owner holding two Free shops is an item; an admin's own shops are never one", () => {
    const o1 = shop({ members: [{ userId: "x", email: "same@x.th", role: "owner" }] });
    const o2 = shop({ members: [{ userId: "x", email: "same@x.th", role: "owner" }] });
    const k1 = shop({ members: [{ userId: "k", email: "kong@example.com", role: "owner" }], createdAt: daysAgo(40) });
    const k2 = shop({ members: [{ userId: "k", email: "kong@example.com", role: "owner" }], createdAt: daysAgo(40) });
    const t = buildTodos({ shops: [o1, o2, k1, k2], admins: ADMINS, newReports: none, now: NOW });
    expect(t.find((x) => x.key === "free-limit")!.title).toBe("เจ้าของ 1 คนมีร้าน Free มากกว่าหนึ่งร้าน");
    expect(t.find((x) => x.key === "stuck-sales")!.shops!.map((s) => s.id)).toEqual([o1.id, o2.id]);
  });
});

describe("ขั้นตอนและเอกสาร (ADR 0045 Q5)", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), "docs", "legal", f), "utf8");

  it("D1: the drafts parse — every numbered section is a heading and the privacy tables come out as tables", () => {
    const terms = parseBlocks(read("terms-th.md"));
    const privacy = parseBlocks(read("privacy-th.md"));
    expect(terms.filter((b) => b.k === "h" && b.level === 2)).toHaveLength(14);
    expect(privacy.filter((b) => b.k === "h" && b.level === 2)).toHaveLength(12);
    const tables = privacy.filter((b) => b.k === "table");
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) if (t.k === "table") expect(t.rows.flat().some((c) => /^-+$/.test(c))).toBe(false);
  });

  it("D2: the playbooks' deadlines are the drafts' own (30 days to return or delete, 72 hours for a breach)", () => {
    const terms = read("terms-th.md");
    const privacy = read("privacy-th.md");
    const sec10 = terms.slice(terms.indexOf("## 10."), terms.indexOf("## 11."));
    expect(sec10).toContain("30 วัน");
    expect(privacy).toContain("72 ชั่วโมง");
    const by = (k: string) => PLAYBOOKS.find((p) => p.key === k)!.deadline;
    expect(by("export")).toContain("30 วัน");
    expect(by("delete")).toContain("30 วัน");
    expect(by("breach")).toContain("72 ชั่วโมง");
  });
});

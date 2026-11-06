// ============================================================
// คิดครัว — หน้าควบคุม: ภาพรวม and ต้องทำ, built from plain rows (ADR 0045)
// ============================================================
// src/server/platform.ts fetches the cross-shop rows (it is the only file
// allowed to); everything that turns them into figures lives here, pure, so
// the tests can pin each rule without a database.
//
// Counted from what shops have RECORDED. "มีการบันทึก" is not "เปิดใช้" — a
// shop that only looks at its dashboard is not counted until the daily
// activity table exists (ADR 0045 part B, Consequence 2).
//
// Shops owned by a platform admin (the demo shop, Kong's test shops) are left
// out of every figure and named in `excluded`, so marketing numbers are not
// Kong's own clicks (ADR 0045 Q3).
// ============================================================

import { onboardingDone, type OnboardingFacts } from "@/lib/onboarding-rule";
import { ownersOverFreeLimit } from "@/lib/free-rule";
import { REQUEST_LABEL, type RequestKind } from "@/lib/platform-requests";

export const FEATURES = [
  ["salesImport", "นำเข้ายอดขาย"],
  ["goodsReceipt", "รับสินค้า"],
  ["stockCount", "นับสต็อก"],
  ["expense", "บิลค่าใช้จ่าย"],
  ["purchaseOrder", "ใบสั่งซื้อ"],
  ["purchaseRequest", "ใบขอซื้อ"],
  ["consumption", "ตัดสต็อก"],
  ["waste", "ของเสีย"],
  ["dailyClose", "ปิดร้านประจำวัน"],
  ["staffMeal", "มื้อพนักงาน"],
  ["menuLab", "ทดลองเมนู"],
  ["transfer", "โอนของระหว่างสาขา"],
  ["production", "การผลิต"],
] as const;
export type FeatureKey = (typeof FEATURES)[number][0];

export const ROLE_ORDER = ["owner", "admin", "manager", "cashier", "kitchen_staff", "purchaser", "accountant", "dept_head", "viewer"] as const;

export const POS_LABEL: Record<string, string> = {
  FOODSTORY: "FoodStory",
  WONGNAI: "Wongnai",
  OCHA: "Ocha",
  LOYVERSE: "Loyverse",
  STOREHUB: "StoreHub",
  CUSTOM: "อื่น ๆ",
};

/** One shop as the server read it. */
export type OverviewShop = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  plan: string;
  freeUntil: Date | null;
  method: "PERIODIC_INVENTORY" | "RECIPE_CONSUMPTION";
  branches: number;
  /** Active memberships. */
  members: { userId: string; email: string; role: string }[];
  /** Setup facts, as onboardingDone reads them (minus the tenant's own dates and members). */
  facts: Omit<OnboardingFacts, "createdAt" | "updatedAt" | "activeMembers">;
  /** Latest createdAt per feature table. */
  lastByFeature: Partial<Record<FeatureKey, Date>>;
  /** Latest stock movement — counts as "recorded" but is no feature of its own. */
  lastMovement: Date | null;
  /** Branches per POS brand; branches with no POS set up. */
  pos: Record<string, number>;
  branchesWithoutPos: number;
  staffWithoutAccount: number;
  peopleWithOwnPermissions: number;
  /** ADR 0045 Q14 — the setup card's three optional answers. */
  answers: { shopType: string | null; province: string | null; heardFrom: string | null };
  /** Days each person opened this shop in the last 28 days (user_activity_day). */
  activeDays: Record<string, number>;
};

export type ShopRef = { id: string; name: string };
export type Bar = { key: string; label: string; n: number; shops: ShopRef[] };

export type PlatformOverview = {
  asOf: string;
  shops: number;
  excluded: ShopRef[];
  users: { total: number; owners: number; multiShop: number };
  branches: { total: number; multiBranchShops: ShopRef[] };
  recorded: { d7: ShopRef[]; d30: ShopRef[] };
  signups: { last30: ShopRef[]; prev30: number; weekly: { weekStart: string; n: number }[] };
  roles: Bar[];
  peopleWithOwnPermissions: number;
  staffWithoutAccount: number;
  pos: Bar[];
  funnel: (Bar & { of: number; note?: string })[];
  /** The funnel step that lost the most shops from the one before it. */
  biggestDrop: string | null;
  features: Bar[];
  methods: { periodic: number; recipe: number };
  plans: Bar[];
  freeEndingSoon: ShopRef[];
  freeUnset: ShopRef[];
  /** Days a week each role opens the app, over the last four weeks; null = nothing recorded yet. */
  usage: { since: string; roles: { key: string; people: number; perWeek: number }[] } | null;
  answers: { shopType: Bar[]; province: Bar[]; heardFrom: Bar[]; unanswered: ShopRef[] };
};

const DAY = 86_400_000;
const ref = (s: { id: string; name: string }): ShopRef => ({ id: s.id, name: s.name });

/** Monday (UTC) of the week holding `d`, as YYYY-MM-DD. */
function weekStart(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

export function isAdminOwned(s: Pick<OverviewShop, "members">, admins: ReadonlySet<string>): boolean {
  return s.members.some((m) => m.role === "owner" && admins.has(m.email.toLowerCase()));
}

export function lastRecordedAt(s: Pick<OverviewShop, "lastByFeature" | "lastMovement">): Date | null {
  let last = s.lastMovement;
  for (const d of Object.values(s.lastByFeature)) if (d && (!last || d > last)) last = d;
  return last;
}

/** Answers counted into bars, most first; a value nobody gave is not a bar. */
function answerBars(shops: readonly OverviewShop[], pick: (s: OverviewShop) => string | null): Bar[] {
  const by = new Map<string, ShopRef[]>();
  for (const s of shops) {
    const v = pick(s);
    if (v) (by.get(v) ?? by.set(v, []).get(v)!).push(ref(s));
  }
  return [...by.entries()].map(([k, list]) => ({ key: k, label: k, n: list.length, shops: list })).sort((a, b) => b.n - a.n);
}

/**
 * `firstActivity` — the earliest user_activity_day anywhere, so the card can
 * say since when it counts; null when the table is still empty.
 */
export function buildOverview(all: readonly OverviewShop[], admins: ReadonlySet<string>, now: Date, firstActivity: Date | null = null): PlatformOverview {
  const shops = all.filter((s) => !isAdminOwned(s, admins));
  const excluded = all.filter((s) => isAdminOwned(s, admins)).map(ref);
  const since = (days: number) => new Date(now.getTime() - days * DAY);

  // --- people ---
  const shopsOfUser = new Map<string, Set<string>>();
  const owners = new Set<string>();
  for (const s of shops)
    for (const m of s.members) {
      (shopsOfUser.get(m.userId) ?? shopsOfUser.set(m.userId, new Set()).get(m.userId)!).add(s.id);
      if (m.role === "owner") owners.add(m.userId);
    }
  const roleBars: Bar[] = ROLE_ORDER.map((role) => {
    const having = shops.filter((s) => s.members.some((m) => m.role === role));
    return { key: role, label: role, n: shops.reduce((a, s) => a + s.members.filter((m) => m.role === role).length, 0), shops: having.map(ref) };
  });

  // --- recorded / signups ---
  const recordedSince = (d: Date) => shops.filter((s) => (lastRecordedAt(s)?.getTime() ?? 0) >= d.getTime()).map(ref);
  const weeks: { weekStart: string; n: number }[] = [];
  const thisWeek = weekStart(now);
  for (let i = 11; i >= 0; i--) {
    const w = new Date(Date.parse(`${thisWeek}T00:00:00Z`) - i * 7 * DAY).toISOString().slice(0, 10);
    weeks.push({ weekStart: w, n: shops.filter((s) => weekStart(s.createdAt) === w).length });
  }

  // --- POS (counted in branches) ---
  const posKeys = Object.keys(POS_LABEL);
  const pos: Bar[] = posKeys.map((k) => ({
    key: k,
    label: POS_LABEL[k],
    n: shops.reduce((a, s) => a + (s.pos[k] ?? 0), 0),
    shops: shops.filter((s) => (s.pos[k] ?? 0) > 0).map(ref),
  }));
  pos.push({
    key: "none",
    label: "ยังไม่ตั้ง POS",
    n: shops.reduce((a, s) => a + s.branchesWithoutPos, 0),
    shops: shops.filter((s) => s.branchesWithoutPos > 0).map(ref),
  });

  // --- setup funnel: the same rule as each shop's own checklist ---
  const done = new Map(
    shops.map((s) => [s.id, onboardingDone({ ...s.facts, createdAt: s.createdAt, updatedAt: s.updatedAt, activeMembers: s.members.length })])
  );
  const recipeShops = shops.filter((s) => s.method === "RECIPE_CONSUMPTION");
  const step = (key: string, label: string, pool: readonly OverviewShop[], ok: (s: OverviewShop) => boolean, note?: string) => {
    const hit = pool.filter(ok);
    return { key, label, n: hit.length, of: pool.length, shops: hit.map(ref), note };
  };
  const funnel = [
    step("signup", "สมัคร", shops, () => true),
    step("shop", "ตั้งค่าร้าน", shops, (s) => done.get(s.id)!.shop),
    step("sales", "นำเข้ายอดขาย", shops, (s) => done.get(s.id)!.sales),
    step("product", "เพิ่มวัตถุดิบ", shops, (s) => done.get(s.id)!.product),
    step("supplier", "นำเข้าบิลซื้อ", shops, (s) => done.get(s.id)!.supplier),
    step("recipe", "สูตรของเมนู", recipeShops, (s) => done.get(s.id)!.recipe, "เฉพาะร้านที่คิดแบบสูตร"),
    step("count", "นับสต็อกเปิดระบบ", shops, (s) => done.get(s.id)!.count),
    step("team", "เชิญผู้ใช้งาน", shops, (s) => done.get(s.id)!.team),
  ];
  // Biggest drop as a share of the shops that could take the step — the recipe
  // step's pool is smaller, so raw counts would always point at it.
  let biggestDrop: string | null = null;
  let worst = 0;
  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1];
    const cur = funnel[i];
    if (!prev.of || !cur.of) continue;
    const drop = prev.n / prev.of - cur.n / cur.of;
    if (drop > worst + 1e-9) {
      worst = drop;
      biggestDrop = cur.key;
    }
  }

  // --- features in the last 30 days ---
  const d30 = since(30);
  const features: Bar[] = FEATURES.map(([key, label]) => {
    const hit = shops.filter((s) => (s.lastByFeature[key]?.getTime() ?? 0) >= d30.getTime());
    return { key, label, n: hit.length, shops: hit.map(ref) };
  });

  // --- packages ---
  const in30 = (s: OverviewShop) => s.freeUntil !== null && s.freeUntil.getTime() <= now.getTime() + 30 * DAY;
  const plans: Bar[] = [
    { key: "trial", label: "Free", n: 0, shops: [] },
    { key: "standard", label: "Standard", n: 0, shops: [] },
  ];
  for (const s of shops) {
    const bar = plans.find((p) => p.key === s.plan);
    if (bar) {
      bar.n += 1;
      bar.shops.push(ref(s));
    }
  }

  // --- days a week, per role (ADR 0045 part B) ---
  let usage: PlatformOverview["usage"] = null;
  if (firstActivity) {
    const people = new Map<string, { n: number; days: number }>();
    for (const s of shops)
      for (const m of s.members) {
        const r = people.get(m.role) ?? people.set(m.role, { n: 0, days: 0 }).get(m.role)!;
        r.n += 1;
        r.days += s.activeDays[m.userId] ?? 0;
      }
    // Four weeks, or fewer while the record is younger than that.
    const weeks = Math.min(4, Math.max(1, (now.getTime() - firstActivity.getTime()) / (7 * DAY)));
    usage = {
      since: firstActivity.toISOString().slice(0, 10),
      roles: ROLE_ORDER.filter((r) => people.has(r)).map((r) => ({ key: r, people: people.get(r)!.n, perWeek: people.get(r)!.days / people.get(r)!.n / weeks })),
    };
  }

  return {
    asOf: now.toISOString(),
    shops: shops.length,
    excluded,
    users: {
      total: shopsOfUser.size,
      owners: owners.size,
      multiShop: [...shopsOfUser.values()].filter((v) => v.size > 1).length,
    },
    branches: {
      total: shops.reduce((a, s) => a + s.branches, 0),
      multiBranchShops: shops.filter((s) => s.branches > 1).map(ref),
    },
    recorded: { d7: recordedSince(since(7)), d30: recordedSince(d30) },
    signups: {
      last30: shops.filter((s) => s.createdAt.getTime() >= d30.getTime()).map(ref),
      prev30: shops.filter((s) => s.createdAt.getTime() >= since(60).getTime() && s.createdAt.getTime() < d30.getTime()).length,
      weekly: weeks,
    },
    roles: roleBars,
    peopleWithOwnPermissions: shops.reduce((a, s) => a + s.peopleWithOwnPermissions, 0),
    staffWithoutAccount: shops.reduce((a, s) => a + s.staffWithoutAccount, 0),
    pos,
    funnel,
    biggestDrop,
    features,
    methods: {
      periodic: shops.filter((s) => s.method === "PERIODIC_INVENTORY").length,
      recipe: recipeShops.length,
    },
    plans,
    freeEndingSoon: shops.filter(in30).map(ref),
    freeUnset: shops.filter((s) => s.plan === "trial" && !s.freeUntil).map(ref),
    usage,
    answers: {
      shopType: answerBars(shops, (s) => s.answers.shopType),
      province: answerBars(shops, (s) => s.answers.province),
      heardFrom: answerBars(shops, (s) => s.answers.heardFrom),
      unanswered: shops.filter((s) => !s.answers.shopType && !s.answers.province && !s.answers.heardFrom).map(ref),
    },
  };
}

// ------------------------------------------------------------
// ต้องทำ (ADR 0045 Q2): worked out on every visit from what is true now, so an
// item disappears by itself when its cause does — no "done" box to forget.
// ------------------------------------------------------------

/** Kong 2026-11-04: the drafts are not lawyer-reviewed. Change here when they are. */
export const LEGAL_DOCS = [
  { key: "terms", file: "terms-th.md", title: "ข้อกำหนดการใช้บริการ", draft: 1, lawyerReviewed: false, published: false },
  { key: "privacy", file: "privacy-th.md", title: "นโยบายความเป็นส่วนตัว", draft: 1, lawyerReviewed: false, published: false },
] as const;

export type TodoTone = "bad" | "warn" | "plain";
export type Todo = {
  key: string;
  tone: TodoTone;
  title: string;
  detail: string;
  /** YYYY-MM-DD when there is a deadline; items with one come first, earliest first. */
  due: string | null;
  chip: string | null;
  href: string;
  cta: string;
  shops?: ShopRef[];
};

export type TodoInput = {
  shops: readonly OverviewShop[];
  admins: ReadonlySet<string>;
  newReports: { count: number; oldest: Date | null };
  now: Date;
  /** Data requests not done yet (ADR 0045 part B). */
  requests?: { id: string; kind: RequestKind; shopName: string | null; requester: string; dueOn: Date }[];
  /** Closed shops and the day each may be erased. */
  closed?: { id: string; name: string; purgeAfter: Date }[];
};

const ymdBkk = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const daysFrom = (a: Date, b: Date) => Math.round((Date.parse(`${ymdBkk(b)}T00:00:00Z`) - Date.parse(`${ymdBkk(a)}T00:00:00Z`)) / DAY);

export function buildTodos({ shops: all, admins, newReports, now, requests = [], closed = [] }: TodoInput): Todo[] {
  const shops = all.filter((s) => !isAdminOwned(s, admins));
  const out: Todo[] = [];

  // A request has a legal deadline: 30 days (terms §10, privacy §8).
  for (const r of requests) {
    const left = daysFrom(now, r.dueOn);
    const who = r.kind === "personal" ? r.requester : (r.shopName ?? r.requester);
    out.push({
      key: `request-${r.id}`,
      tone: left <= 7 ? "bad" : "warn",
      title: `${who} · ${REQUEST_LABEL[r.kind].title}`,
      detail: r.kind === "delete" ? "ปิดร้านทันที แล้วลบจริงเมื่อครบ 30 วัน" : "ต้องตอบภายใน 30 วันนับจากวันที่ขอ",
      due: ymdBkk(r.dueOn),
      chip: left < 0 ? `เลยกำหนด ${-left} วัน` : left === 0 ? "ครบกำหนดวันนี้" : `เหลือ ${left} วัน`,
      href: "/platform/requests",
      cta: "เปิดคำขอ",
    });
  }

  // A closed shop whose erase day has come: the operator presses it, nothing erases by itself (Q10).
  for (const c of closed) {
    const left = daysFrom(now, c.purgeAfter);
    if (left > 0) continue;
    out.push({
      key: `purge-${c.id}`,
      tone: "bad",
      title: `ถึงวันลบข้อมูลร้าน ${c.name}`,
      detail: "ร้านปิดครบ 30 วันแล้ว · ลบถาวรได้ที่ร้านทั้งหมด ส่วนร้านที่ปิดรอลบ",
      due: ymdBkk(c.purgeAfter),
      chip: left === 0 ? "ถึงวันนี้" : `เลยมา ${-left} วัน`,
      href: "/platform/shops",
      cta: "ไปที่ร้าน",
      shops: [{ id: c.id, name: c.name }],
    });
  }

  if (newReports.count > 0) {
    const age = newReports.oldest ? daysFrom(newReports.oldest, now) : 0;
    out.push({
      key: "reports",
      tone: "warn",
      title: `เรื่องที่แจ้งเข้ามายังไม่ได้เปิดอ่าน ${newReports.count} เรื่อง`,
      detail: age > 0 ? `เรื่องเก่าที่สุดแจ้งมาแล้ว ${age} วัน` : "เรื่องเก่าที่สุดแจ้งมาวันนี้",
      due: null,
      chip: age > 0 ? `เก่าสุด ${age} วัน` : "วันนี้",
      href: "/platform/reports",
      cta: "เปิดอ่าน",
    });
  }

  for (const s of shops) {
    if (!s.freeUntil) continue;
    const left = daysFrom(now, s.freeUntil);
    if (left > 30) continue;
    out.push({
      key: `free-${s.id}`,
      tone: left < 0 ? "bad" : "warn",
      title: left < 0 ? `ช่วงใช้ฟรีหมดไปแล้ว · ${s.name}` : `ช่วงใช้ฟรีใกล้หมด · ${s.name}`,
      detail: "คุยกับเจ้าของร้านเรื่องแพ็กเกจ แล้วตั้งแพ็กเกจหรือวันหมดใหม่ที่หน้าร้านทั้งหมด",
      due: ymdBkk(s.freeUntil),
      chip: left < 0 ? `เลยมา ${-left} วัน` : left === 0 ? "หมดวันนี้" : `อีก ${left} วัน`,
      href: "/platform/shops",
      cta: "ดูร้าน",
      shops: [ref(s)],
    });
  }

  const stuck = shops.filter((s) => !s.facts.hasSalesDay && daysFrom(s.createdAt, now) > 7);
  if (stuck.length > 0)
    out.push({
      key: "stuck-sales",
      tone: "plain",
      title: `ร้านสมัครเกิน 7 วันแล้วยังไม่นำเข้ายอดขาย ${stuck.length} ร้าน`,
      detail: "ขั้นนี้ร้านหลุดบ่อยที่สุด · ลองติดต่อช่วยตั้งรูปแบบไฟล์",
      due: null,
      chip: null,
      href: "/platform/shops",
      cta: "ดูร้าน",
      shops: stuck.map(ref),
    });

  const over = ownersOverFreeLimit(shops.map((s) => ({ id: s.id, name: s.name, plan: s.plan, owners: s.members.filter((m) => m.role === "owner").map((m) => m.email) })));
  if (over.size > 0)
    out.push({
      key: "free-limit",
      tone: "plain",
      title: `เจ้าของ ${over.size} คนมีร้าน Free มากกว่าหนึ่งร้าน`,
      detail: "ยังไม่บังคับจนกว่าจะขาย Standard ได้ · ระหว่างนี้ให้ Standard เองที่หน้าร้านทั้งหมด",
      due: null,
      chip: null,
      href: "/platform/shops",
      cta: "ดูร้าน",
      shops: [...over.values()].flat(),
    });

  const unreviewed = LEGAL_DOCS.filter((d) => !d.lawyerReviewed);
  if (unreviewed.length > 0)
    out.push({
      key: "legal",
      tone: "plain",
      title: `${unreviewed.map((d) => d.title).join("และ")} ยังไม่ผ่านทนาย`,
      detail: `ต้องเสร็จก่อนมีร้านแรกที่จ่ายเงิน · ร่างฉบับที่ ${unreviewed[0].draft}`,
      due: null,
      chip: "งานค้าง",
      href: "/platform/docs",
      cta: "เปิดร่าง",
    });

  const rank = (t: Todo) => (t.due ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || (a.due && b.due ? a.due.localeCompare(b.due) : 0));
}

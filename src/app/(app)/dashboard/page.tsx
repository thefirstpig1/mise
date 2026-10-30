import { Suspense, type ReactNode } from "react";
import { requireTenant } from "@/lib/require-tenant";
import { getOnboardingLogic, type OnboardingStep } from "@/server/onboarding";
import OnboardingCard, { type OnboardingStepView } from "./_components/OnboardingCard";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getPnlLogic, getRevenueByDayLogic, narrowReach, type Pnl, type PnlBranchRow } from "@/server/pnl";
import { latestCountedMonthLogic } from "@/server/stock-cost";
import { getDueRecurringLogic } from "@/server/expense";
import { monthEndCountDueLogic, openingPricesWaitingLogic } from "@/server/stock-count";
import { getSalesSummaryLogic } from "@/server/sales";
import { getPriceWatchLogic } from "@/server/price-watch";
import { LABOR_SECTIONS } from "@/server/cost-overview";
import { periodLabelTh } from "@/lib/sales-insight";
import { getSalesQuerySchema } from "@/lib/validations/sales-import";
import { getTransfersLogic } from "@/server/transfer";
import { getTransfersQuerySchema } from "@/lib/validations/transfer";
import { toTransferView } from "@/app/(app)/transfers/_components/transfer-view";
import { getPulseDashboardLogic } from "@/server/sales-pulse";
import { getCloseStatusLogic, getGuestDaysLogic } from "@/server/daily-close";
import { guestStats } from "@/lib/guest-stats";
import { getRequestQueueLogic } from "@/server/purchase-request";
import { toPulseDashboardView } from "@/app/(app)/sales/_components/sales-view";
import PulsePanel from "./_components/PulsePanel";
import DashboardControls, { type BranchChip } from "./_components/DashboardControls";
import { SERIES } from "@/components/charts/chart-theme";
import { MonthlyTrend, type MenuBar, type RevenueRow } from "./_components/Charts";
import { DailySalesBars, TopMenusCard } from "./_components/DashboardParts";
import { isoDay, parseBranchParam, parsePreset, periodFor, type Period } from "./_components/dashboard-period";
import { grossProfitBlockerShort, isCountBlocker, purchasesLookLow } from "@/lib/gross-profit-blocker";

// ============================================================
// Mise — แดชบอร์ด (rewritten in Part 35 L5)
// ============================================================
// Until Part 35 this page was a grid of nineteen links, three cards saying
// the reader's role, and a "Sprint 0 — Foundation Complete ✓" box. It is now
// the one screen that answers "how is the business doing": the P&L
// (src/server/pnl.ts — the same numbers as /cost, by construction), four
// charts, and what is waiting on somebody.
//
// WHAT EACH PERSON SEES FOLLOWS WHAT THEY MAY SEE (ADR 0029 Q7). Revenue needs
// `sales:view`, cost needs `cost:view`, overheads need `expense:view`, and net
// profit needs all three — a figure built from something the reader may not
// see would disclose it by subtraction. A cook sees the work queue only.
//
// WHICH BRANCHES: the reader's reach (rule A5), narrowed further by the chips.
// Both the chip list and every query are narrowed on the server; a URL
// naming a branch outside the reach is ignored, never trusted.
// ============================================================

// 2026-10-29 (Kong: "อันนี้โอเคเลย", mockup R9edWU3oJsjMSj2SqR3Fyn): from a
// column three screens long to a grid that answers the morning's questions on
// one — what needs doing today, are we selling, what is left as profit, which
// branch, what sells and what to watch. A figure that cannot be worked out
// says WHAT is missing and where to fix it, and shows the branches that can
// be worked out, instead of a bare "—".

type SearchParams = Promise<{ p?: string; b?: string }>;

const baht = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
const pct1 = (n: number) => `${n.toFixed(1)}%`;
const short = (name: string) => name.replace(/^สาขา/, "");

// Ordered as the setup flow runs (src/server/onboarding.ts). The count step
// names its night: the month's last, after closing — that count is the next
// month's opening stock (rule PG2).
function setupStep(key: OnboardingStep, today: Date): Omit<OnboardingStepView, "key" | "done"> {
  switch (key) {
    case "shop":
      return { title: "ตรวจตั้งค่าร้าน", hint: "วิธีคิดกำไร บิลที่ยกเลิก และมื้อพนักงาน ให้ตรงกับที่ร้านทำ", cta: "ตรวจตั้งค่า", href: "/settings" };
    case "team":
      return { title: "เชิญคนในร้าน", hint: "ครัว จัดซื้อ แคชเชียร์ แต่ละคนเห็นเฉพาะที่ต้องใช้", cta: "เชิญคน", href: "/settings/members" };
    case "supplier":
      return { title: "ผู้ขายและราคา", hint: "นำเข้าบิลซื้อย้อนหลัง ได้ผู้ขายและราคาของแต่ละวัตถุดิบในครั้งเดียว · ราคานี้ใช้ตอนนับเปิดระบบ", cta: "นำเข้าบิลซื้อ", href: "/suppliers/import" };
    case "product":
      return { title: "เพิ่มวัตถุดิบให้ครบทุกตัวที่จะนับ", hint: "นำเข้าจากไฟล์ได้ทีเดียวทั้งรายการ ให้ AI ของร้านจัดไฟล์ให้ · ของที่ไม่อยู่ในรายการจะไม่ถูกนับ", cta: "นำเข้าวัตถุดิบ", href: "/products/import" };
    case "sales":
      return { title: "นำเข้ายอดขาย", hint: "ไฟล์จาก POS ที่ร้านใช้ ย้อนหลังได้ ตั้งครั้งเดียวแล้วใช้ได้ทุกวัน", cta: "นำเข้ายอดขาย", href: "/sales/import" };
    case "recipe":
      return { title: "สูตรของเมนู", hint: "ร้านนี้คิดกำไรจากสูตร · นำเข้าจากไฟล์เดียวกับวัตถุดิบได้ แล้วกดใช้สูตรทีละเมนู หรือเขียนเองเริ่มจากเมนูขายดี", cta: "นำเข้าสูตร", href: "/menus/import" };
    case "count": {
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
      const night = last.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
      return {
        title: last.getTime() === today.getTime() ? `นับเปิดระบบ คืนนี้ (${night})` : `นับเปิดระบบ คืนวันที่ ${night}`,
        hint: "หลังปิดร้าน ทุกรายการพร้อมราคาทุน · ยอดที่นับคืนนั้นเป็นสต๊อกต้นงวดของเดือนถัดไป",
        cta: "เริ่มนับ",
        href: "/stock-counts/new",
      };
    }
  }
}

/** A setup nearly done shrinks to one chip in the strip; a new shop still gets the whole checklist. */
const SETUP_CHIP_FROM = 4;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { membership, tenantId, reach, costAccess, can, canEditShared } = await requireTenant("any:member");
  const params = await searchParams;

  const see = { sales: can("sales:view"), cost: can("cost:view"), expense: can("expense:view") };
  const seeMoney = see.sales || see.cost || see.expense;
  const seeNet = see.sales && see.cost && see.expense;

  const period = periodFor(parsePreset(params.p));
  const branches = await getBranchesLogic(tenantId, reach);
  // Colour follows the branch, never its position among the ones switched on.
  const chips: BranchChip[] = branches.map((b, i) => ({ id: b.id, name: b.name, color: SERIES[i % SERIES.length] }));
  const selected = parseBranchParam(params.b, branches.map((b) => b.id));
  const activeIds = selected.length ? selected : branches.map((b) => b.id);
  const label = periodLabelTh(isoDay(period.from), isoDay(period.to));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight">ภาพรวม</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {membership.tenant.name}
            {seeMoney && ` · ${label}`}
          </p>
        </div>
        {seeMoney ? <DashboardControls preset={period.preset} branches={chips} selected={selected} rangeLabel="" /> : null}
      </header>

      <Suspense fallback={<div className="h-14 animate-pulse rounded-2xl border border-border bg-surface-sunk" />}>
        <TodayStrip
          tenantId={tenantId}
          reach={reach}
          costAccess={costAccess}
          membershipId={membership.id}
          userId={membership.userId}
          setup={can("settings:write")}
          drafts={can("recipe:write") ? { shared: canEditShared } : null}
          expenses={see.expense ? activeIds : null}
          pulse={see.sales && !membership.tenant.dailyCloseEnabled}
          dailyClose={
            membership.tenant.dailyCloseEnabled ? { branches: branches.map((b) => ({ id: b.id, name: b.name })), canFill: can("sales:import") } : null
          }
          purchaseBranches={can("purchase:approve") ? branches.map((b) => ({ id: b.id, name: b.name })) : []}
          monthCount={can("count:write")}
        />
      </Suspense>

      {seeMoney ? (
        <Suspense key={`${period.preset}|${activeIds.join(",")}`} fallback={<AnalyticsSkeleton />}>
          <Analytics
            tenantId={tenantId}
            reach={reach}
            period={period}
            selected={selected}
            activeIds={activeIds}
            chips={chips}
            see={see}
            targets={{ food: Number(membership.tenant.foodCostTargetPct), prime: Number(membership.tenant.primeCostTargetPct) }}
            dailyCloseOn={membership.tenant.dailyCloseEnabled}
          />
        </Suspense>
      ) : null}

      {seeNet ? (
        // Fetched by the chart itself, once per branch choice — a period
        // click only moves its highlight (see dashboard/trend-read.ts).
        <Card title="6 เดือนล่าสุด" meta="กดที่เดือนเพื่อดูทั้งหน้าเป็นเดือนนั้น · เดือนปัจจุบันนับถึงวันนี้">
          <MonthlyTrend branchIds={selected} active={period.month} />
        </Card>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// ต้องทำวันนี้ — one strip, for everyone, cooks included
// ------------------------------------------------------------
type StripItem = { key: string; n: string; label: string; detail?: string; href: string; tone: "do" | "warn" | "soft" };

async function TodayStrip({
  tenantId,
  reach,
  costAccess,
  membershipId,
  userId,
  setup,
  drafts,
  expenses,
  pulse,
  dailyClose,
  purchaseBranches,
  monthCount,
}: {
  tenantId: string;
  reach: Awaited<ReturnType<typeof requireTenant>>["reach"];
  costAccess: Awaited<ReturnType<typeof requireTenant>>["costAccess"];
  membershipId: string;
  userId: string;
  setup: boolean;
  drafts: { shared: boolean } | null;
  /** The branches whose overdue recurring bills this reader may see; null = none. */
  expenses: string[] | null;
  /** Part 20a — keying the till's figure, for a shop without the closing add-on. */
  pulse: boolean;
  dailyClose: { branches: { id: string; name: string }[]; canFill: boolean } | null;
  purchaseBranches: { id: string; name: string }[];
  /** Rule PG2 — this reader may count, so remind them on the month's last two days. */
  monthCount: boolean;
}) {
  const today = computeBangkokToday();
  const [transfers, pulseRaw, requests, closeStatus, onboarding, draftCount, overdue, countDue, openingWaiting] = await Promise.all([
    // Part 18 Q8: any truck still unconfirmed, whatever the chips say.
    getTransfersLogic(tenantId, getTransfersQuerySchema.parse({ status: "SENT", includeReversalLines: "false" }), reach),
    pulse ? getPulseDashboardLogic(tenantId, reach) : Promise.resolve(null),
    // ADR 0036 Q9 — the purchaser learns a kitchen is ready without being told.
    getRequestQueueLogic(tenantId, purchaseBranches),
    dailyClose ? getCloseStatusLogic(tenantId, dailyClose.branches.map((b) => b.id)) : Promise.resolve(null),
    setup ? getOnboardingLogic(tenantId, membershipId) : Promise.resolve(null),
    drafts ? draftsWaiting(tenantId, userId, drafts.shared) : Promise.resolve(0),
    // C2: every recurring bill already due and not recorded, up to today.
    expenses ? missingRecurring(tenantId, { from: new Date(Date.UTC(2000, 0, 1)), to: today }, expenses) : Promise.resolve([]),
    monthCount ? monthEndCountDueLogic(tenantId, reach, today) : Promise.resolve(null),
    // Rule PG6: opening stock a receipt can now price — prices are cost, so cost:view.
    costAccess ? openingPricesWaitingLogic(tenantId, reach).catch(() => []) : Promise.resolve([]),
  ]);

  const items: StripItem[] = [];
  if (openingWaiting.length > 0) {
    const ready = openingWaiting.reduce((s, w) => s + w.ready, 0);
    items.push({
      key: "opening-prices",
      n: String(ready),
      label: "ราคาสต๊อกยกมารอยืนยัน",
      detail: `${openingWaiting.length > 1 ? `${openingWaiting.map((w) => short(w.branchName)).join(" · ")} — ` : ""}รับของแล้ว ใช้ราคาจากใบรับของได้`,
      href: `/stock-counts/${openingWaiting[0].countId}`,
      tone: "soft",
    });
  }
  if (countDue) {
    // Rule PG2: without tonight's count the month's gross profit stays "—".
    const tonight = countDue.lastDay.getTime() === today.getTime();
    const month = countDue.lastDay.toLocaleDateString("th-TH", { month: "short", year: "2-digit", timeZone: "UTC" });
    items.push({
      key: "month-count",
      n: String(countDue.branches.length),
      label: tonight ? "คืนนี้นับปิดเดือน" : "พรุ่งนี้นับปิดเดือน",
      detail: `${countDue.branches.length > 1 ? `${countDue.branches.map((b) => short(b.name)).join(" · ")} — ` : ""}หลังปิดร้าน · ใช้คิดกำไรของ ${month}`,
      href: "/stock-counts/new",
      tone: tonight ? "do" : "soft",
    });
  }
  if (closeStatus && dailyClose) {
    const nameOf = (id: string) => short(dailyClose.branches.find((b) => b.id === id)?.name ?? "");
    const open = closeStatus.branches.filter((b) => !b.today);
    const lateYesterday = closeStatus.branches.filter((b) => !b.yesterday);
    const issues = closeStatus.branches.reduce((s, b) => s + b.openIssues, 0);
    if (dailyClose.canFill && lateYesterday.length > 0) {
      items.push({
        key: "yesterday",
        n: String(lateYesterday.length),
        label: "เมื่อวานยังไม่ปิดร้าน",
        detail: `${lateYesterday.map((b) => nameOf(b.branchId)).join(" · ")} — ปิดได้ถึงเที่ยงคืนนี้`,
        href: lateYesterday.length === 1 ? `/closing/day?branch=${lateYesterday[0].branchId}&date=${closeStatus.yesterday}` : "/closing",
        tone: "warn",
      });
    }
    if (open.length > 0) {
      items.push({
        key: "close",
        n: String(open.length),
        label: "ปิดร้านประจำวัน",
        detail: open.map((b) => nameOf(b.branchId)).join(" · "),
        href: dailyClose.canFill && open.length === 1 ? `/closing/day?branch=${open[0].branchId}&date=${closeStatus.today}` : "/closing",
        tone: "do",
      });
    }
    if (issues > 0) items.push({ key: "issues", n: String(issues), label: "ปัญหาค้างจากปิดร้าน", href: "/closing", tone: "warn" });
  }
  if (transfers.length > 0) {
    const t = toTransferView(transfers[0], costAccess);
    items.push({
      key: "transfers",
      n: String(transfers.length),
      label: "ใบโอนรอรับ",
      detail: transfers.length === 1 ? `${short(t.fromBranch.name)} → ${short(t.toBranch.name)}` : undefined,
      href: transfers.length === 1 ? `/transfers/${t.id}` : "/transfers?status=SENT",
      tone: "warn",
    });
  }
  for (const r of [...requests].sort((a, b) => Number(b.allReady) - Number(a.allReady))) {
    items.push({
      key: `pr-${r.branchId}`,
      n: String(r.waiting),
      label: `ใบขอซื้อ ${short(r.branchName)}`,
      detail: r.allReady ? "ทุกแผนกพร้อม สั่งได้เลย" : `พร้อม ${r.readyDepartments} จาก ${r.departments} แผนก`,
      href: `/purchase-requests/cut?b=${r.branchId}`,
      tone: r.allReady ? "do" : "soft",
    });
  }
  if (overdue.length > 0) {
    items.push({
      key: "recurring",
      n: String(overdue.length),
      label: "บิลประจำยังไม่บันทึก",
      detail: `${overdue[0].description} ${overdue[0].periodLabel} ${baht(overdue[0].amount)}${overdue.length > 1 ? ` และอีก ${overdue.length - 1}` : ""}`,
      href: "/expenses",
      tone: "warn",
    });
  }
  if (draftCount > 0) items.push({ key: "drafts", n: String(draftCount), label: "ร่างสูตรรอคุณ", detail: "ในทดลองเมนู", href: "/menus/lab", tone: "soft" });

  const setupSteps = onboarding ? onboarding.steps.map((key) => ({ key, done: onboarding.done[key], ...setupStep(key, today) })) : [];
  const setupOpen = onboarding && !onboarding.dismissed && onboarding.doneCount < onboarding.steps.length;
  if (onboarding && setupOpen && onboarding.doneCount >= SETUP_CHIP_FROM) {
    const next = setupSteps.find((s) => !s.done)!;
    items.push({ key: "setup", n: `${onboarding.doneCount}/${onboarding.steps.length}`, label: "เริ่มต้นใช้งาน", detail: `เหลือ${next.title}`, href: next.href, tone: "soft" });
  }

  const pulseView = pulseRaw ? toPulseDashboardView(pulseRaw) : null;
  return (
    <div className="space-y-3">
      {onboarding && setupOpen && onboarding.doneCount < SETUP_CHIP_FROM ? <OnboardingCard steps={setupSteps} dismissed={false} /> : null}
      <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3" aria-label="ต้องทำวันนี้">
        <h2 className="shrink-0 pl-1 font-display text-sm font-semibold">ต้องทำวันนี้</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">ไม่มีงานค้าง ✓</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((it) => (
              <a key={it.key} href={it.href} className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-border bg-background py-1.5 pl-2 pr-2.5 text-sm transition-colors hover:border-border-strong">
                <span
                  className={`grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full px-1.5 font-display text-xs font-semibold ${
                    it.tone === "do" ? "bg-primary text-primary-foreground" : it.tone === "warn" ? "border border-warn-border bg-warn-bg text-warn" : "border border-border bg-surface-sunk text-muted-foreground"
                  }`}
                >
                  {it.n}
                </span>
                <span className="shrink-0 whitespace-nowrap">{it.label}</span>
                {it.detail && <span className="min-w-0 truncate text-xs text-muted-subtle">{it.detail}</span>}
              </a>
            ))}
          </div>
        )}
      </section>
      {pulseView ? <PulsePanel dashboard={pulseView} todayIso={today.toISOString().slice(0, 10)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------
// Figures — streamed, so the frame and the strip appear at once
// ------------------------------------------------------------
async function Analytics({
  tenantId,
  reach,
  period,
  selected,
  activeIds,
  chips,
  see,
  targets,
  dailyCloseOn,
}: {
  tenantId: string;
  reach: Awaited<ReturnType<typeof requireTenant>>["reach"];
  period: Period;
  selected: string[];
  activeIds: string[];
  chips: BranchChip[];
  see: { sales: boolean; cost: boolean; expense: boolean };
  targets: { food: number; prime: number };
  /** ADR 0042 — the shop keys guest counts at close. */
  dailyCloseOn: boolean;
}) {
  const q = { from: period.from, to: period.to, branchIds: selected };
  // The previous period's P&L only feeds "ส.ค. 69 ฿x" lines, so it is NOT
  // awaited here: the figures paint first (Kong 2026-10-01: "dashboard
  // โหลดช้าๆ"). A failure only costs the comparison, never the page.
  const prevP: Promise<Pnl | null> = getPnlLogic(tenantId, { from: period.prevFrom, to: period.prevTo, branchIds: selected }, reach).catch((e) => {
    console.error("[dashboard] previous-period P&L failed", e);
    return null;
  });
  const vs = periodLabelTh(isoDay(period.prevFrom), isoDay(period.prevTo));
  const label = periodLabelTh(isoDay(period.from), isoDay(period.to));
  const [pnl, revenueDays, prevRevenueDays, menus, missing, guestNow, prices] = await Promise.all([
    getPnlLogic(tenantId, q, reach),
    see.sales ? getRevenueByDayLogic(tenantId, q, reach, activeIds) : Promise.resolve([]),
    see.sales
      ? getRevenueByDayLogic(tenantId, { from: period.prevFrom, to: period.prevTo, branchIds: selected }, reach, activeIds).catch(() => [])
      : Promise.resolve([]),
    see.sales ? topMenus(tenantId, period, activeIds, new Map(chips.map((c) => [c.id, c.name]))) : Promise.resolve([] as MenuBar[]),
    see.expense ? missingRecurring(tenantId, period, activeIds) : Promise.resolve([]),
    see.sales ? getGuestDaysLogic(tenantId, { branchIds: activeIds, from: period.from, to: period.to }).catch(() => []) : Promise.resolve([]),
    // Prices are cost (rule A1): what the shop paid, first receipt → last, over this period and the one before.
    see.cost
      ? getPriceWatchLogic(tenantId, { from: period.prevFrom, to: period.to }, narrowReach(reach, selected)).catch(() => null)
      : Promise.resolve(null),
  ]);

  const seeGross = see.sales && see.cost;
  const seeNet = seeGross && see.expense;
  const multi = pnl.branches.length > 1;

  // C1 (Kong 2026-10-24): a per-day figure divides by the days the shop
  // OPERATED — days with sales — never the calendar.
  const opDays = (rows: { businessDate: Date }[]) => new Set(rows.map((r) => isoDay(r.businessDate))).size;
  const days = { cur: opDays(revenueDays), prev: opDays(prevRevenueDays) };
  const sum = (rows: { net: { toString(): string } }[]) => rows.reduce((s, r) => s + Number(r.net.toString()), 0);
  const revenue = num(pnl.revenue);
  const perDay = revenue !== null && days.cur > 0 ? revenue / days.cur : null;
  const prevPerDay = days.prev > 0 ? sum(prevRevenueDays) / days.prev : null;

  // One row per day, one key per branch — a day with no import has no row.
  const byDay = new Map<string, RevenueRow>();
  for (const p of revenueDays) {
    const d = isoDay(p.businessDate);
    const row = byDay.get(d) ?? ({ day: d } as RevenueRow);
    row[p.branchId] = Number(p.net.toString());
    byDay.set(d, row);
  }
  const revenueRows = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const allDays: string[] = [];
  for (let t = period.from.getTime(); t <= period.to.getTime(); t += 86_400_000) allDays.push(isoDay(new Date(t)));
  const series = chips
    .filter((c) => activeIds.includes(c.id) && revenueDays.some((p) => p.branchId === c.id))
    .map((c) => ({ branchId: c.id, name: c.name, color: c.color }));
  const lastDay = revenueRows.length ? String(revenueRows[revenueRows.length - 1].day) : null;

  const g = guestStats(guestNow);
  const guestLine = see.sales && g.enough && g.perHead !== null ? `ยอดต่อหัว ${baht(g.perHead)} · ${Math.round(g.guestsPerDay ?? 0).toLocaleString("th-TH")} คน/วัน` : null;

  const labor = pnl.opexBySection.filter((s) => LABOR_SECTIONS.includes(s.section)).reduce((t, s) => t + Number(s.amount.toString()), 0);
  const cogs = num(pnl.cogs);
  const net = num(pnl.netProfit);
  const foodPct = revenue && cogs !== null ? (cogs / revenue) * 100 : null;
  const primePct = revenue && cogs !== null && see.expense && labor > 0 ? ((cogs + labor) / revenue) * 100 : null;
  const branchRows = pnl.branches.filter((b) => num(b.revenue));
  const branchFood = (b: PnlBranchRow) => (num(b.revenue) && b.cogs !== null ? (num(b.cogs)! / num(b.revenue)!) * 100 : null);
  const branchNet = (b: PnlBranchRow) => (num(b.revenue) && b.netProfit !== null ? (num(b.netProfit)! / num(b.revenue)!) * 100 : null);
  // Rules PG1/PG2: when นับสต๊อก withheld a branch's profit, say what is missing
  // there and send the reader to fix THAT — counting, or pricing stock.
  const blocked = pnl.branches.filter((b) => b.revenue !== null && b.grossProfit === null && b.grossProfitBlocker);
  const blockerWhy = blocked.length
    ? multi
      ? blocked.map((b) => `${short(b.branchName)} ${grossProfitBlockerShort(b.grossProfitBlocker!)}`).join(" · ")
      : grossProfitBlockerShort(blocked[0].grossProfitBlocker!)
    : null;
  const allBlocked = blockerWhy !== null && blocked.length === pnl.branchesMissingGrossProfit.length;
  const blockerFix = blocked.some((b) => isCountBlocker(b.grossProfitBlocker))
    ? { href: "/stock-counts/new", action: "นับสต๊อก" }
    : blocked.length
      ? { href: "/cost", action: "ใส่ราคาทุน" }
      : { href: "/cost", action: "ดูที่หน้าต้นทุน" };
  // Rule PG2: นับสต๊อก answers month by month, so while this one runs (or was
  // never counted) show the latest month that WAS counted at both ends —
  // named, never passed off as this period. Streamed: the cards paint first.
  const countGap = pnl.unknownReason === "GROSS_PROFIT_UNKNOWN" && allBlocked && blocked.every((b) => isCountBlocker(b.grossProfitBlocker));
  const countedP: Promise<Counted | null> =
    seeGross && countGap
      ? latestCountedMonthLogic(tenantId, narrowReach(reach, selected))
          .then(async (m) => (m && m.from.getTime() !== period.from.getTime() ? { from: m.from, to: m.to, pnl: await getPnlLogic(tenantId, { ...m, branchIds: selected }, reach) } : null))
          .catch((e) => {
            console.error("[dashboard] counted-month P&L failed", e);
            return null;
          })
      : Promise.resolve(null);
  const countedQs = selected.length ? `&b=${selected.join(",")}` : "";
  // Rule PG3: judged on the whole shop only — a branch fed by a central
  // kitchen's transfers buys little of its own and would be flagged wrongly.
  const purchases = pnl.branches.reduce((s, b) => s + Number(b.purchases.toString()), 0);
  const buyingLow =
    seeGross &&
    period.preset !== "7d" &&
    (selected.length === 0 || selected.length === chips.length) &&
    purchasesLookLow({ purchases, revenue, salesDays: days.cur, foodTargetPct: targets.food });
  const unknownWhy =
    pnl.unknownReason === "GROSS_PROFIT_UNKNOWN"
      ? allBlocked
        ? blockerWhy
        : `${pnl.branchesMissingGrossProfit.map(short).join(", ")} ยังคิดไม่ได้: มียอดขายแต่ยังหาต้นทุนขายไม่ได้${
            pnl.recipeCoverage !== null ? ` · ตัดสต๊อกตามสูตรแล้ว ${Math.round(pnl.recipeCoverage * 100)}% ของยอดขายทั้งร้าน` : ""
          }`
      : pnl.unknownReason === "NO_SALES"
        ? "ยังไม่มียอดขายในช่วงนี้"
        : null;
  const missingNote =
    missing.length > 0
      ? `ยังไม่ครบ: ${missing.slice(0, 2).map((m) => `${m.description} ${m.periodLabel} ${baht(m.amount)}`).join(" · ")}${missing.length > 2 ? ` และอีก ${missing.length - 2}` : ""} ยังไม่บันทึก`
      : null;

  // From sales to profit: the whole shop when it is known (rule PL5), otherwise
  // the biggest branch that can be worked out — named, never passed off as the shop.
  const wfBranch =
    seeNet && net === null
      ? [...pnl.branches].filter((b) => b.netProfit !== null && num(b.revenue)).sort((a, b) => num(b.revenue)! - num(a.revenue)!)[0] ?? null
      : null;
  const wf =
    seeNet && revenue !== null && net !== null
      ? { who: multi ? "ทั้งร้าน" : short(pnl.branches[0]?.branchName ?? ""), revenue, cogs: cogs!, opex: num(pnl.opex)!, net }
      : wfBranch
        ? { who: short(wfBranch.branchName), revenue: num(wfBranch.revenue)!, cogs: num(wfBranch.cogs)!, opex: num(wfBranch.opex)!, net: num(wfBranch.netProfit)! }
        : null;

  // Kong 2026-10-30: under นับสต๊อก a count's shortfall is what the shop USED
  // (no sale takes stock out), so it is not something to watch — it is already
  // the cost of sales on the food-cost card. /cost names it ใช้ไปตามการนับ.
  const shortage = pnl.method === "PERIODIC_INVENTORY" ? 0 : pnl.branches.reduce((s, b) => s + Number(b.shortage.toString()), 0);
  const waste = pnl.branches.reduce((s, b) => s + Number(b.waste.toString()), 0);
  const worstShort = [...pnl.branches].sort((a, b) => Number(b.shortage.toString()) - Number(a.shortage.toString()))[0];
  const priceUps = (prices?.products ?? []).filter((p) => (p.changePct ?? 0) >= 3).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 3);

  const salesQs = new URLSearchParams({ from: isoDay(period.from), to: isoDay(period.to) });
  if (selected.length === 1) salesQs.set("branch", selected[0]);
  const profitInput =
    seeGross && selected.length <= 1
      ? { from: isoDay(period.from), to: isoDay(period.to), ...(selected.length === 1 ? { branchId: selected[0] } : {}) }
      : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {see.sales ? (
          <Kpi label="ยอดขายต่อวัน" href={`/sales?${salesQs}`} link="ยอดขาย">
            <p className="font-display text-[1.7rem] font-semibold leading-tight tabular-nums">{perDay === null ? "—" : baht(perDay)}</p>
            {perDay !== null && prevPerDay ? (
              <p className="flex flex-wrap items-center gap-1.5 text-xs">
                <DeltaChip pct={((perDay - prevPerDay) / prevPerDay) * 100} goodWhenUp />
                <span className="text-muted-subtle">เทียบ {vs} ({baht(prevPerDay)}/วัน)</span>
              </p>
            ) : perDay !== null ? (
              <p className="text-xs text-muted-subtle">ไม่มียอดขาย {vs} ให้เทียบ</p>
            ) : null}
            {revenueRows.length > 1 ? <Spark values={allDays.map((d) => { const r = byDay.get(d); return r ? series.reduce((s, x) => s + Number(r[x.branchId] ?? 0), 0) : null; })} baseline={prevPerDay} /> : null}
            <p className="text-xs text-muted-subtle">
              {revenue === null ? (
                <a href="/sales/import" className="text-primary hover:underline">นำเข้าไฟล์ยอดขาย ›</a>
              ) : (
                `รวม ${baht(revenue)} · ขาย ${days.cur} วัน · ไม่รวม VAT และ service charge`
              )}
            </p>
            {guestLine && <p className="text-xs text-muted-foreground">{guestLine}</p>}
          </Kpi>
        ) : null}

        {seeGross ? (
          <Kpi label="ต้นทุนอาหาร % ของยอดขาย" href="/cost" link="ต้นทุน">
            <p className="font-display text-[1.7rem] font-semibold leading-tight tabular-nums">
              {foodPct === null ? "—" : pct1(foodPct)}
              {foodPct === null && multi ? <span className="ml-1.5 text-sm font-medium text-muted-subtle">ทั้งร้าน</span> : null}
            </p>
            {multi || foodPct === null ? <MiniBars rows={branchRows.map((b) => ({ name: short(b.branchName), value: branchFood(b) }))} target={targets.food} scale={Math.max(50, targets.food * 1.5)} warm /> : null}
            <p className="text-xs text-muted-subtle">
              เป้า {pct1(targets.food)}
              {foodPct !== null && ` · ${foodPct > targets.food ? `เกินเป้า ${(foodPct - targets.food).toFixed(1)} จุด` : `ต่ำกว่าเป้า ${(targets.food - foodPct).toFixed(1)} จุด`}`}
              {primePct !== null && ` · Prime cost (รวมค่าแรง) ${pct1(primePct)} เป้า ${pct1(targets.prime)}`}
            </p>
            {countGap ? (
              <Suspense fallback={null}>
                <CountedMonth p={countedP} show="food" qs={countedQs} />
              </Suspense>
            ) : null}
            {buyingLow && revenue ? (
              <Why href="/my-advances" action="ซื้อเอง / สำรองจ่าย">
                {purchases > 0
                  ? `บันทึกซื้อวัตถุดิบช่วงนี้ ${baht(purchases)} = ${pct1((purchases / revenue) * 100)} ของยอดขาย ไม่ถึงครึ่งของเป้าต้นทุนอาหาร ${pct1(targets.food)}`
                  : "ช่วงนี้มียอดขายแต่ยังไม่มีบิลซื้อวัตถุดิบเลย"}{" "}
                — ถ้าซื้อเงินสดจากตลาดด้วย บันทึกไว้ ต้นทุนจะได้ไม่ต่ำกว่าจริง
              </Why>
            ) : null}
            {unknownWhy ? (
              pnl.unknownReason === "NO_SALES" ? (
                <Why href="/sales/import" action="นำเข้าไฟล์ยอดขาย">{unknownWhy}</Why>
              ) : (
                <Why href={blockerFix.href} action={blockerFix.action}>{unknownWhy}</Why>
              )
            ) : null}
          </Kpi>
        ) : null}

        {see.expense ? (
          <Kpi label="ค่าใช้จ่ายดำเนินงาน" href="/expenses/analysis" link="รายจ่าย">
            <p className="font-display text-[1.7rem] font-semibold leading-tight tabular-nums">{num(pnl.opex) ? baht(num(pnl.opex)!) : "—"}</p>
            <p className="text-xs text-muted-subtle">
              {!num(pnl.opex) ? "ยังไม่มีบิลในช่วงนี้" : revenue ? `${pct1((num(pnl.opex)! / revenue) * 100)} ของยอดขาย` : "ยังไม่มียอดขายให้เทียบ"}
              <Suspense fallback={null}>
                <PrevAmount prevP={prevP} vs={vs} pick={(p) => num(p.opex)} />
              </Suspense>
            </p>
            {missingNote ? <Why href="/expenses" action="บันทึกบิล">{missingNote} — ตัวเลขนี้จึงต่ำกว่าจริง</Why> : null}
          </Kpi>
        ) : null}

        {seeNet ? (
          <Kpi label="กำไรสุทธิ" href="/cost" link="กำไร">
            <p className={`font-display text-[1.7rem] font-semibold leading-tight tabular-nums ${net === null ? "" : net >= 0 ? "text-good" : "text-bad"}`}>
              {net === null ? "—" : baht(net)}
              {net === null && multi ? <span className="ml-1.5 text-sm font-medium text-muted-subtle">ทั้งร้าน</span> : null}
            </p>
            {multi || net === null ? <MiniBars rows={branchRows.map((b) => ({ name: short(b.branchName), value: branchNet(b), note: b.netProfit === null ? null : baht(num(b.netProfit)!) }))} scale={100} /> : null}
            {net !== null && revenue ? <p className="text-xs text-muted-subtle">{pct1((net / revenue) * 100)} ของยอดขาย{missing.length > 0 && " · ยังไม่หักบิลประจำที่ค้าง"}</p> : null}
            {countGap ? (
              <Suspense fallback={null}>
                <CountedMonth p={countedP} show="net" qs={countedQs} />
              </Suspense>
            ) : null}
            {net === null && unknownWhy && allBlocked ? (
              <Why href={blockerFix.href} action={blockerFix.action}>{multi ? `ทั้งร้านยังคิดไม่ได้ — ${unknownWhy}` : unknownWhy}</Why>
            ) : net === null && unknownWhy ? <Why>{"ทั้งร้านยังคิดไม่ได้ — " + unknownWhy}</Why> : missingNote ? <Why href="/expenses" action="บันทึกบิล">ยังไม่หักบิลประจำที่ค้าง — สูงกว่าจริง</Why> : null}
          </Kpi>
        ) : null}
      </div>

      {see.sales || wf ? (
        <div className="grid gap-4 lg:grid-cols-12">
          {see.sales ? (
            <Card className={wf ? "lg:col-span-8" : "lg:col-span-12"} title="ยอดขายรายวัน" meta={lastDay ? `${label} · ข้อมูลถึง ${new Date(`${lastDay}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" })}` : label}>
              {revenueRows.length ? (
                <DailySalesBars
                  days={allDays}
                  rows={revenueRows}
                  series={series}
                  avgCur={perDay}
                  avgPrev={prevPerDay}
                  prevLabel={`เฉลี่ย ${vs}`}
                  branchParam={selected.length === 1 ? selected[0] : null}
                />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  ยังไม่มียอดขายในช่วงนี้ ·{" "}
                  <a href="/sales/import" className="text-primary hover:underline">นำเข้าไฟล์ยอดขาย ›</a>
                </p>
              )}
            </Card>
          ) : null}
          {wf ? (
            <Card className={see.sales ? "lg:col-span-4" : "lg:col-span-12"} title="จากยอดขายสู่กำไร" meta={`${wf.who} · ${label}`}>
              <Waterfall {...wf} />
              {missing.length > 0 && <p className="mt-2 text-xs text-warn">ค่าใช้จ่ายยังไม่รวมบิลประจำที่ค้าง {missing.length} รายการ</p>}
              {wfBranch && <p className="mt-2 text-xs text-muted-subtle">ทั้งร้านแสดงไม่ได้จนกว่าทุกสาขามีต้นทุนขาย — เลือกสาขาด้านบนเพื่อดูทีละสาขา</p>}
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {see.sales ? (
          <Card title="เมนูขายดี">
            <TopMenusCard menus={menus} profitInput={profitInput} salesHref={`/sales?${salesQs}`} />
          </Card>
        ) : null}
        {see.sales && multi ? (
          <Card title="สาขาเทียบกัน" meta={label}>
            <BranchCompare rows={pnl.branches} days={revenueDays} seeGross={seeGross} seeNet={seeNet} />
          </Card>
        ) : null}
        {see.cost ? (
          <Card title="ต้องระวัง" meta="เรียงตามเงิน">
            <ul className="space-y-3 text-sm">
              {shortage > 0 && (
                <Watch tone="bad" icon="!" title="ของขาดจากการนับ" amount={baht(shortage)} href="/cost/leaks">
                  {multi && worstShort ? `มากสุดที่${short(worstShort.branchName)}` : "ของหายโดยไม่มีบันทึก"}
                </Watch>
              )}
              {waste > 0 && (
                <Watch tone="warn" icon="✕" title="ของทิ้ง" amount={baht(waste)} href="/waste">
                  มีใบบันทึกของเสีย
                </Watch>
              )}
              {priceUps.map((p) => (
                <Watch key={p.key} tone="warn" icon="↑" title={`${p.productName} แพงขึ้น ${p.changePct!.toFixed(1)}%`} amount={`+${p.changePct!.toFixed(1)}%`} href="/cost/prices">
                  {`฿${p.first.toLocaleString("th-TH")} → ฿${p.last.toLocaleString("th-TH")} ต่อ${p.baseUnit} · ${p.receipts} ครั้งที่รับ`}
                </Watch>
              ))}
              {shortage <= 0 && waste <= 0 && priceUps.length === 0 && <li className="py-4 text-center text-muted-subtle">ไม่มีเรื่องต้องระวังในช่วงนี้</li>}
            </ul>
            <div className="mt-3 flex flex-wrap gap-x-4 text-xs">
              <a href="/cost/leaks" className="text-primary hover:underline">ของหายไปไหน ›</a>
              <a href="/cost/prices" className="text-primary hover:underline">ราคาวัตถุดิบ ›</a>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

async function topMenus(tenantId: string, period: Period, branchIds: string[], branchName: Map<string, string>): Promise<MenuBar[]> {
  // One summary per branch — getSalesSummaryLogic already folds merged menus
  // (ADR 0026: reporting folds retroactively and always), so summing its rows
  // by menu id keeps that fold across branches too.
  const summaries = await Promise.all(
    branchIds.map((branchId) =>
      getSalesSummaryLogic(tenantId, {
        ...getSalesQuerySchema.parse({ branchId, from: isoDay(period.from), to: isoDay(period.to), includeSuperseded: "false" }),
        // `branchIds` is already the reader's reach narrowed by the chips.
        reach: { allBranches: false, allowedBranchIds: branchIds },
      })
    )
  );
  const by = new Map<string, MenuBar & { branchId: string }>();
  summaries.forEach((s, i) => {
    for (const m of s.topMenus) {
      const cur = by.get(m.menuId) ?? { id: m.menuId, name: m.name, net: 0, qty: 0, branchId: branchIds[i] };
      cur.net += Number(m.net.toString());
      cur.qty += Number(m.qty.toString());
      by.set(m.menuId, cur);
    }
  });
  const top = [...by.values()].sort((a, b) => b.net - a.net).slice(0, 10);
  // Two branches' POS menus for one dish stay two menus until someone merges
  // them (ADR 0026: a person decides). Two bars both reading
  // "กะเพราหมูสับไข่ดาว" told the owner nothing — and collided as chart keys —
  // so a name that appears twice says whose it is (2026-10-29).
  const seen = new Map<string, number>();
  for (const m of top) seen.set(m.name, (seen.get(m.name) ?? 0) + 1);
  return top.map(({ branchId, ...m }) => ((seen.get(m.name) ?? 0) > 1 ? { ...m, name: `${m.name} · ${short(branchName.get(branchId) ?? "")}` } : m));
}

// ------------------------------------------------------------
// Pieces
// ------------------------------------------------------------
function Card({ title, meta, className = "", children }: { title: string; meta?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-border bg-surface p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        {meta ? <span className="text-xs text-muted-subtle">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, href, link, children }: { label: string; href: string; link: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        <a href={href} className="shrink-0 text-xs text-primary hover:underline">
          {link} ›
        </a>
      </div>
      {children}
    </section>
  );
}

/** Rule PL5 on a card: what is missing, and where to fix it. */
function Why({ href, action, children }: { href?: string; action?: string; children: ReactNode }) {
  return (
    <p className="mt-auto rounded-xl border border-warn-border bg-warn-bg px-2.5 py-1.5 text-xs leading-snug text-warn">
      {children}
      {href && action ? (
        <>
          {" · "}
          <a href={href} className="font-medium underline">
            {action}
          </a>
        </>
      ) : null}
    </p>
  );
}

function DeltaChip({ pct, goodWhenUp }: { pct: number; goodWhenUp: boolean }) {
  const up = pct >= 0;
  const good = up === goodWhenUp;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px font-display font-medium ${good ? "bg-good-bg text-good" : "bg-bad-bg text-bad"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/** "ส.ค. 69 ฿172,330" — joins the line when the previous period arrives. */
type Counted = { from: Date; to: Date; pnl: Pnl };

/** Rule PG2: the latest month นับสต๊อก could answer for, named and one click away. */
async function CountedMonth({ p, show, qs }: { p: Promise<Counted | null>; show: "food" | "net"; qs: string }) {
  const c = await p;
  if (!c) return null;
  const revenue = num(c.pnl.revenue);
  const figure =
    show === "food"
      ? revenue && c.pnl.cogs !== null
        ? `ต้นทุนอาหาร ${pct1((num(c.pnl.cogs)! / revenue) * 100)}`
        : null
      : c.pnl.netProfit !== null
        ? `กำไรสุทธิ ${baht(num(c.pnl.netProfit)!)}${revenue ? ` · ${pct1((num(c.pnl.netProfit)! / revenue) * 100)} ของยอดขาย` : ""}`
        : null;
  if (!figure) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <a href={`/dashboard?p=${isoDay(c.from).slice(0, 7)}${qs}`} className="hover:text-primary hover:underline">
        {periodLabelTh(isoDay(c.from), isoDay(c.to))} (เดือนล่าสุดที่นับสต๊อกครบ): {figure} ›
      </a>
    </p>
  );
}

async function PrevAmount({ prevP, vs, pick }: { prevP: Promise<Pnl | null>; vs: string; pick: (p: Pnl) => number | null }) {
  const prev = await prevP;
  const v = prev ? pick(prev) : null;
  return v ? <span>{` · ${vs} ${baht(v)}`}</span> : null;
}

/** The period's daily totals as one line; the dashed line is the previous period's per-day average. */
function Spark({ values, baseline }: { values: (number | null)[]; baseline: number | null }) {
  const max = Math.max(1, baseline ?? 0, ...values.map((v) => v ?? 0)) * 1.1;
  const W = 240;
  const H = 32;
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : 0);
  const y = (v: number) => H - (v / max) * H;
  const pts = values.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      {baseline ? <line x1={0} x2={W} y1={y(baseline)} y2={y(baseline)} stroke="#8B8D63" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
      <polyline points={pts.join(" ")} fill="none" stroke="#5E6B14" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A % per branch, with the shop's target as a tick when there is one. "—" when it cannot be worked out. */
function MiniBars({ rows, target, scale, warm = false }: { rows: { name: string; value: number | null; note?: string | null }[]; target?: number; scale: number; warm?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
          <span className="truncate text-muted-foreground">{r.name}</span>
          <span className="relative h-1.5 rounded-full bg-wash">
            {r.value !== null ? (
              <i
                className="absolute inset-y-0 left-0 origin-left animate-grow-x rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, (r.value / scale) * 100))}%`, background: warm ? "linear-gradient(90deg,#E8A76F,#C0692B)" : "linear-gradient(90deg,#9DAA55,#5E6B14)" }}
              />
            ) : null}
            {target !== undefined ? <b className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `${(target / scale) * 100}%` }} /> : null}
          </span>
          <span className={`text-right font-display font-medium tabular-nums ${r.value === null ? "text-muted-subtle" : ""}`} title={r.note ?? undefined}>
            {r.value === null ? "—" : pct1(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Waterfall({ revenue, cogs, opex, net }: { revenue: number; cogs: number; opex: number; net: number }) {
  const gross = revenue - cogs;
  const rows: [string, number, number, string, boolean][] = [
    ["ยอดขาย", revenue, 0, "linear-gradient(90deg,#9DAA55,#5E6B14)", true],
    ["ต้นทุนขาย", -cogs, revenue, "linear-gradient(90deg,#E8A76F,#C0692B)", false],
    ["กำไรขั้นต้น", gross, 0, "linear-gradient(90deg,#C7CC9B,#9DAA55)", true],
    ["ค่าใช้จ่าย", -opex, gross, "#E8A76F", false],
    ["กำไรสุทธิ", net, 0, net >= 0 ? "linear-gradient(90deg,#9DAA55,#5E6B14)" : "#A83A22", true],
  ];
  const max = Math.max(revenue, 1);
  return (
    <div className="space-y-2">
      {rows.map(([label, v, base, bg, total], i) => {
        const left = v < 0 ? Math.max(0, (base + v) / max) : 0;
        return (
          <div key={label} className="grid grid-cols-[5.5rem_minmax(0,1fr)_6rem] items-center gap-2.5 text-sm">
            <span className={total ? "font-medium" : "text-muted-foreground"}>{label}</span>
            <span className="relative h-3.5">
              <i
                className="absolute inset-y-0 origin-left animate-grow-x rounded"
                style={{ left: `${left * 100}%`, width: `${(Math.abs(v) / max) * 100}%`, background: bg, animationDelay: `${i * 60}ms` }}
              />
            </span>
            <span className={`text-right font-display tabular-nums ${total ? "font-semibold" : ""}`}>{v < 0 ? `−${baht(-v)}` : baht(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function BranchCompare({ rows, days, seeGross, seeNet }: { rows: PnlBranchRow[]; days: { businessDate: Date; branchId: string }[]; seeGross: boolean; seeNet: boolean }) {
  const daysOf = (id: string) => new Set(days.filter((d) => d.branchId === id).map((d) => isoDay(d.businessDate))).size;
  const sorted = [...rows].sort((a, b) => (num(b.revenue) ?? 0) - (num(a.revenue) ?? 0));
  const unknown = rows.filter((r) => num(r.revenue) && r.cogs === null).map((r) => short(r.branchName));
  if (!rows.some((r) => num(r.revenue))) return <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มียอดขายในช่วงนี้</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-subtle">
              <th className="py-1.5 pr-2 text-left font-medium">สาขา</th>
              <th className="px-2 py-1.5 text-right font-medium">ขาย/วัน</th>
              {seeGross && <th className="px-2 py-1.5 text-right font-medium">ต้นทุนอาหาร</th>}
              {seeNet && <th className="py-1.5 pl-2 text-right font-medium">กำไรสุทธิ</th>}
            </tr>
          </thead>
          <tbody className="font-display tabular-nums">
            {sorted.map((r) => {
              const rev = num(r.revenue);
              const d = daysOf(r.branchId);
              return (
                <tr key={r.branchId} className="border-b border-border last:border-b-0">
                  <td className="py-2 pr-2 font-sans">{short(r.branchName)}</td>
                  <td className="px-2 py-2 text-right">{rev && d ? baht(rev / d) : <span className="text-muted-subtle">—</span>}</td>
                  {seeGross && <td className="px-2 py-2 text-right">{rev && r.cogs !== null ? pct1((num(r.cogs)! / rev) * 100) : <span className="text-muted-subtle">—</span>}</td>}
                  {seeNet && <td className={`py-2 pl-2 text-right ${r.netProfit === null ? "" : r.netProfit.gte(0) ? "text-good" : "text-bad"}`}>{r.netProfit === null ? <span className="text-muted-subtle">—</span> : baht(num(r.netProfit)!)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {seeGross && unknown.length > 0 && <p className="mt-2 text-xs text-muted-subtle">{unknown.join(", ")} ยังไม่มีต้นทุนขาย</p>}
      <a href="/cost" className="mt-2 inline-block text-xs text-primary hover:underline">
        เทียบละเอียดในหน้าต้นทุน ›
      </a>
    </>
  );
}

function Watch({ tone, icon, title, amount, href, children }: { tone: "bad" | "warn"; icon: string; title: string; amount: string; href: string; children: ReactNode }) {
  return (
    <li>
      <a href={href} className="grid grid-cols-[1.6rem_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg hover:bg-muted/50">
        <span className={`grid h-6 w-6 place-items-center rounded-lg font-display text-xs font-semibold ${tone === "bad" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>{icon}</span>
        <span className="min-w-0">
          {title}
          <span className="block text-xs text-muted-subtle">{children}</span>
        </span>
        <span className="whitespace-nowrap font-display font-medium tabular-nums">{amount}</span>
      </a>
    </li>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="กำลังคำนวณตัวเลข">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl border border-border bg-surface-sunk" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="h-80 animate-pulse rounded-2xl border border-border bg-surface-sunk lg:col-span-8" />
        <div className="h-80 animate-pulse rounded-2xl border border-border bg-surface-sunk lg:col-span-4" />
      </div>
    </div>
  );
}

/**
 * ADR 0041 — recipe drafts this person can move forward: one a cook proposed
 * (to endorse or apply), and for whoever applies to every branch, one a
 * manager already endorsed.
 */
async function draftsWaiting(tenantId: string, userId: string, shared: boolean): Promise<number> {
  return withTenantContext(tenantId, (tx) =>
    tx.recipe.count({
      where: {
        tenantId,
        isDraft: true,
        deletedAt: null,
        createdBy: { not: userId },
        draftStatus: { in: shared ? ["SUBMITTED", "ENDORSED"] : ["SUBMITTED"] },
      },
    })
  );
}

const MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/**
 * C2 (Kong 2026-10-24). Recurring expenses whose due date inside the period has
 * passed and that nobody has recorded — salaries, rent. Without this the
 * dashboard reported September's net profit ▲169% because September's
 * salaries were simply not entered yet. A template is owed in a month only once
 * its day of the month has arrived (October's salary on the 28th is not missing
 * on the 24th).
 */
async function missingRecurring(tenantId: string, period: { from: Date; to: Date }, branchIds: string[]) {
  const today = computeBangkokToday();
  const toKey = isoDay(period.to).slice(0, 7);
  const fromKey = isoDay(period.from).slice(0, 7);
  const due = await getDueRecurringLogic(tenantId, { asOfPeriod: toKey }, { allBranches: false, allowedBranchIds: branchIds }).catch(() => []);
  const out: { description: string; periodLabel: string; amount: number }[] = [];
  for (const row of due) {
    if (!branchIds.includes(row.template.branch.id)) continue;
    for (const p of row.duePeriods) {
      if (p < fromKey || p > toKey) continue;
      const [y, m] = p.split("-").map(Number);
      const dueDay = new Date(Date.UTC(y, m - 1, Math.min(row.template.dayOfMonth, new Date(Date.UTC(y, m, 0)).getUTCDate())));
      if (dueDay.getTime() > today.getTime() || dueDay.getTime() > period.to.getTime()) continue;
      out.push({
        description: row.template.description,
        periodLabel: `${MONTHS_SHORT[m - 1]} ${String((y + 543) % 100).padStart(2, "0")}`,
        amount: Number(row.template.defaultAmount),
      });
    }
  }
  return out;
}

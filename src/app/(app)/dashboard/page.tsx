import { Suspense } from "react";
import { requireTenant } from "@/lib/require-tenant";
import { ONBOARDING_STEPS, getOnboardingLogic, type OnboardingStep } from "@/server/onboarding";
import OnboardingCard, { type OnboardingStepView } from "./_components/OnboardingCard";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getPnlLogic, getRevenueByDayLogic, type Pnl } from "@/server/pnl";
import { getDueRecurringLogic } from "@/server/expense";
import { getSalesSummaryLogic } from "@/server/sales";
import { periodLabelTh } from "@/lib/sales-insight";
import { getSalesQuerySchema } from "@/lib/validations/sales-import";
import { getTransfersLogic } from "@/server/transfer";
import { getTransfersQuerySchema } from "@/lib/validations/transfer";
import { toTransferView } from "@/app/(app)/transfers/_components/transfer-view";
import { getPulseDashboardLogic } from "@/server/sales-pulse";
import { getCloseStatusLogic, getGuestDaysLogic } from "@/server/daily-close";
import { GUEST_COVERAGE_MIN, guestStats, type GuestStats } from "@/lib/guest-stats";
import { getRequestQueueLogic, type RequestQueueRow } from "@/server/purchase-request";
import { toPulseDashboardView } from "@/app/(app)/sales/_components/sales-view";
import PulsePanel from "./_components/PulsePanel";
import KpiViewToggle from "./_components/KpiViewToggle";
import ActionLink from "@/components/ui/ActionLink";
import DashboardControls, { type BranchChip } from "./_components/DashboardControls";
import BarList, { type BarListGroup } from "@/components/charts/BarList";
import { SERIES } from "@/components/charts/chart-theme";
import {
  MonthlyTrend,
  PnlWaterfallChart,
  RevenueTrendChart,
  TopMenusChart,
  type MenuBar,
  type RevenueRow,
} from "./_components/Charts";
import { isoDay, parseBranchParam, parsePreset, periodFor, type Period } from "./_components/dashboard-period";

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

type SearchParams = Promise<{ p?: string; b?: string }>;

const baht = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
const dateTh = (d: Date) =>
  d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const SETUP_STEPS: Record<OnboardingStep, Omit<OnboardingStepView, "key" | "done">> = {
  shop: { title: "ตรวจตั้งค่าร้าน", hint: "วิธีคิดกำไร บิลที่ยกเลิก และมื้อพนักงาน ให้ตรงกับที่ร้านทำ", cta: "ตรวจตั้งค่า", href: "/settings" },
  supplier: { title: "เพิ่มผู้ขาย", hint: "ร้านที่ซื้อของประจำ พร้อมวิธีจ่ายเงิน", cta: "เพิ่มผู้ขาย", href: "/suppliers/new" },
  product: { title: "เพิ่มสินค้าและวัตถุดิบ", hint: "พร้อมหน่วยที่ซื้อ เช่น ลัง 24 ขวด · กระสอบ 50 กก.", cta: "เพิ่มสินค้า", href: "/products/new" },
  sales: { title: "นำเข้ายอดขายวันแรก", hint: "ไฟล์จาก POS ที่ร้านใช้ ตั้งครั้งเดียวแล้วใช้ได้ทุกวัน", cta: "นำเข้ายอดขาย", href: "/sales/import" },
  count: { title: "นับสต๊อกครั้งแรก", hint: "จุดเริ่มต้นของต้นทุนและของหาย", cta: "เริ่มนับ", href: "/stock-counts/new" },
  team: { title: "เชิญคนในร้าน", hint: "ครัว จัดซื้อ แคชเชียร์ แต่ละคนเห็นเฉพาะที่ต้องใช้", cta: "เชิญคน", href: "/settings/members" },
};

/** The checklist disappears for good once every step is done. */
async function SetupChecklist({ tenantId, membershipId }: { tenantId: string; membershipId: string }) {
  const o = await getOnboardingLogic(tenantId, membershipId);
  if (o.doneCount === ONBOARDING_STEPS.length) return null;
  const steps = ONBOARDING_STEPS.map((key) => ({ key, done: o.done[key], ...SETUP_STEPS[key] }));
  return <OnboardingCard steps={steps} dismissed={o.dismissed} />;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { membership, tenantId, reach, costAccess, can, canEditShared } = await requireTenant("any:member");
  const params = await searchParams;

  const seeSales = can("sales:view");
  const seeCost = can("cost:view");
  const seeExpense = can("expense:view");
  const seeMoney = seeSales || seeCost || seeExpense;

  const period = periodFor(parsePreset(params.p));
  const branches = await getBranchesLogic(tenantId, reach);
  // Colour follows the branch, never its position among the ones switched on.
  const chips: BranchChip[] = branches.map((b, i) => ({ id: b.id, name: b.name, color: SERIES[i % SERIES.length] }));
  const selected = parseBranchParam(params.b, branches.map((b) => b.id));
  const activeIds = selected.length ? selected : branches.map((b) => b.id);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div>
        <h1 className="text-2xl font-bold">ภาพรวม</h1>
        <p className="mt-1 text-sm text-muted-foreground">{membership.tenant.name}</p>
      </div>

      {/* เริ่มต้นใช้งาน (Kong 2026-10-28): for whoever sets the shop up. */}
      {can("settings:write") && (
        <Suspense fallback={null}>
          <SetupChecklist tenantId={tenantId} membershipId={membership.id} />
        </Suspense>
      )}

      {can("recipe:write") && (
        <Suspense fallback={null}>
          <DraftsWaiting tenantId={tenantId} userId={membership.userId} shared={canEditShared} />
        </Suspense>
      )}

      {/* B9 (Kong 2026-10-24): today's work — keying the till's figure, trucks
          to receive — leads the page; it is done every day. */}
      <Suspense fallback={null}>
        <WorkQueue
          showPulse={seeSales}
          dailyClose={
            membership.tenant.dailyCloseEnabled ? { branches: branches.map((b) => ({ id: b.id, name: b.name })), canFill: can("sales:import") } : null
          }
          tenantId={tenantId}
          reach={reach}
          costAccess={costAccess}
          purchaseBranches={can("purchase:approve") ? branches.map((b) => ({ id: b.id, name: b.name })) : []}
        />
      </Suspense>
      {seeMoney ? (
        <>
          <DashboardControls
            preset={period.preset}
            branches={chips}
            selected={selected}
            rangeLabel={`${dateTh(period.from)} – ${dateTh(period.to)}`}
          />
          <Suspense key={`${period.preset}|${activeIds.join(",")}`} fallback={<AnalyticsSkeleton />}>
            <Analytics
              tenantId={tenantId}
              reach={reach}
              period={period}
              selected={selected}
              activeIds={activeIds}
              chips={chips}
              see={{ sales: seeSales, cost: seeCost, expense: seeExpense }}
              dailyCloseOn={membership.tenant.dailyCloseEnabled}
            />
          </Suspense>
          {seeSales && seeCost && seeExpense ? (
            // Fetched by the chart itself, once per branch choice — a period
            // click only moves its highlight (see dashboard/trend-read.ts).
            <Card title="กำไรรายเดือน (6 เดือนล่าสุด)" hint="กดที่เดือนเพื่อดูตัวเลขของเดือนนั้นทั้งหน้า · เดือนปัจจุบันนับถึงวันนี้">
              <MonthlyTrend branchIds={selected} active={period.month} />
            </Card>
          ) : null}
        </>
      ) : null}

    </div>
  );
}

// ------------------------------------------------------------
// Figures and charts — streamed, so the page frame appears at once
// ------------------------------------------------------------
async function Analytics({
  tenantId,
  reach,
  period,
  selected,
  activeIds,
  chips,
  see,
  dailyCloseOn,
}: {
  tenantId: string;
  reach: Awaited<ReturnType<typeof requireTenant>>["reach"];
  period: Period;
  selected: string[];
  activeIds: string[];
  chips: BranchChip[];
  see: { sales: boolean; cost: boolean; expense: boolean };
  /** ADR 0042 — the shop keys guest counts at close. */
  dailyCloseOn: boolean;
}) {
  const q = { from: period.from, to: period.to, branchIds: selected };
  // The previous period only feeds the ▲▼ under each KPI, so it is NOT awaited
  // here: the figures paint first and the comparisons stream in after (Kong,
  // 2026-10-01: "dashboard โหลดช้าๆ"). It is a whole second P&L — on this
  // machine ~1.5 s that every KPI used to wait for. A failure only costs the
  // comparison, never the page.
  const prevP: Promise<Pnl | null> = getPnlLogic(
    tenantId,
    { from: period.prevFrom, to: period.prevTo, branchIds: selected },
    reach
  ).catch((e) => {
    console.error("[dashboard] previous-period P&L failed", e);
    return null;
  });
  const vs = periodLabelTh(isoDay(period.prevFrom), isoDay(period.prevTo));
  const dayCount = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  const [pnl, revenueDays, prevRevenueDays, menus] = await Promise.all([
    getPnlLogic(tenantId, q, reach),
    see.sales ? getRevenueByDayLogic(tenantId, q, reach, activeIds) : Promise.resolve([]),
    see.sales
      ? getRevenueByDayLogic(tenantId, { from: period.prevFrom, to: period.prevTo, branchIds: selected }, reach, activeIds).catch(() => [])
      : Promise.resolve([]),
    see.sales ? topMenus(tenantId, period, activeIds, new Map(chips.map((c) => [c.id, c.name]))) : Promise.resolve([] as MenuBar[]),
  ]);
  // Customers per head (Kong 2026-10-25): the card exists when the shop keys
  // guests (the add-on) or the data already holds some.
  const [missing, guestNow, guestPrev] = await Promise.all([
    see.expense ? missingRecurring(tenantId, period, activeIds) : Promise.resolve([]),
    see.sales ? getGuestDaysLogic(tenantId, { branchIds: activeIds, from: period.from, to: period.to }).catch(() => []) : Promise.resolve([]),
    see.sales ? getGuestDaysLogic(tenantId, { branchIds: activeIds, from: period.prevFrom, to: period.prevTo }).catch(() => []) : Promise.resolve([]),
  ]);
  const gNow = guestStats(guestNow);
  const gPrev = guestStats(guestPrev);
  const guestCard = see.sales && (dailyCloseOn || gNow.guestDays > 0) ? { now: gNow, prev: gPrev, vs, canKey: dailyCloseOn } : null;
  // Kong 2026-10-24 (C1): a per-day figure divides by the days the shop
  // OPERATED — days with sales — not by the calendar. "This month 10 days → ÷10,
  // last month 31 → ÷31", and the ▲▼ compares those averages, so a month with
  // fewer trading days no longer reads as a fall (or a part month as a rise).
  // The same rule /sales uses (SI1). With no sales at all, the calendar stands in.
  const opDays = (rows: { businessDate: Date }[]) => new Set(rows.map((r) => isoDay(r.businessDate))).size;
  const days = {
    cur: opDays(revenueDays) || dayCount(period.from, period.to),
    prev: opDays(prevRevenueDays) || dayCount(period.prevFrom, period.prevTo),
  };

  const seeGross = see.sales && see.cost;
  const seeNet = seeGross && see.expense;

  // One row per day, one key per branch — days with no import stay absent
  // rather than drawn as ฿0, because "not imported" is not "sold nothing".
  const byDay = new Map<string, RevenueRow>();
  for (const p of revenueDays) {
    const d = isoDay(p.businessDate);
    const row = byDay.get(d) ?? ({ day: d } as RevenueRow);
    row[p.branchId] = Number(p.net.toString());
    byDay.set(d, row);
  }
  const revenueRows = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const series = chips
    .filter((c) => activeIds.includes(c.id) && revenueDays.some((p) => p.branchId === c.id))
    .map((c) => ({ branchId: c.id, name: c.name, color: c.color }));
  // Kong (2026-09-28): "ทุกสาขา but only one line" read as a bug. A branch with
  // no imported sales has nothing to draw — say so by name instead of
  // silently leaving it out (and never draw it as a flat ฿0 line: not
  // imported is not "sold nothing").
  const noSales = chips.filter((c) => activeIds.includes(c.id) && !revenueDays.some((p) => p.branchId === c.id));

  // Where the revenue went (Kong, 2026-09-28: the donut cut every label off).
  const qs = `from=${isoDay(period.from)}&to=${isoDay(period.to)}`;
  const spendGroups: BarListGroup[] = [
    ...(seeGross && pnl.cogs !== null
      ? [
          {
            heading: "ต้นทุนขาย",
            rows: [
              {
                key: "cogs",
                label: "วัตถุดิบที่ขายไป",
                detail:
                  pnl.recipeCoverage !== null
                    ? `คิดจากสูตรอาหาร · ครอบคลุม ${(pnl.recipeCoverage * 100).toFixed(0)}% ของยอดขาย`
                    : "คิดจากการนับสต๊อก",
                value: num(pnl.cogs)!,
                href: "/cost",
              },
            ],
          },
        ]
      : []),
    ...(see.expense
      ? [
          {
            heading: "ค่าใช้จ่ายดำเนินงาน",
            rows: pnl.opexBySection.map((sct) => ({
              key: sct.section,
              label: sct.section,
              detail: sct.groups.length > 1 ? sct.groups.map((g) => g.group).join(" · ") : undefined,
              value: Number(sct.amount.toString()),
              href: `/expenses?${qs}`,
            })),
          },
        ]
      : []),
  ];
  const spendTotal = spendGroups.reduce((s, g) => s + g.rows.reduce((t, r) => t + r.value, 0), 0);
  const revenueNum = num(pnl.revenue);
  const shareBase = revenueNum && revenueNum > 0 ? revenueNum : spendTotal;

  return (
    <div className="space-y-6">
      {missing.length > 0 && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">
          <b>ค่าใช้จ่ายของช่วงนี้ยังไม่ครบ</b> — รายการประจำที่ถึงกำหนดแล้วยังไม่ได้บันทึก {missing.length} รายการ:{" "}
          {missing.slice(0, 4).map((m) => `${m.description} ${m.periodLabel} (ตั้งต้น ฿${Math.round(m.amount).toLocaleString("th-TH")})`).join(" · ")}
          {missing.length > 4 && ` และอีก ${missing.length - 4}`} · ค่าใช้จ่ายและกำไรสุทธิจึงยังต่ำ/สูงกว่าจริง ·{" "}
          <a href="/expenses" className="font-medium underline">
            บันทึกค่าใช้จ่าย ›
          </a>
        </div>
      )}
      <KpiViewToggle
        cards={<KpiRow pnl={pnl} prevP={prevP} vs={vs} days={days} see={{ ...see, gross: seeGross, net: seeNet }} incomplete={missing.length > 0} guest={guestCard} />}
        chart={
          seeNet && pnl.netProfit !== null && pnl.revenue !== null ? (
            <Card title="จากยอดขายสู่กำไร" hint="ยอดขาย − ต้นทุนขาย − ค่าใช้จ่าย = กำไรสุทธิ">
              <PnlWaterfallChart data={{ revenue: num(pnl.revenue)!, cogs: num(pnl.cogs)!, opex: num(pnl.opex)!, net: num(pnl.netProfit)! }} />
            </Card>
          ) : null
        }
      />
      <UnknownNote pnl={pnl} seeGross={seeGross} />

      <div className="grid gap-6">
        {see.sales ? (
          <Card title="รายรับรายวัน" hint="ยอดขายไม่รวม VAT และ service charge · กดชื่อสาขาเพื่อซ่อน/แสดงเส้น">
            {revenueRows.length ? (
              <>
                <RevenueTrendChart rows={revenueRows} series={series} />
                {noSales.length > 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    ไม่มีเส้นของ {noSales.map((c) => c.name).join(", ")} เพราะยังไม่มียอดขายที่นำเข้าในช่วงนี้ ·{" "}
                    <ActionLink href="/sales/import" className="ml-1 align-middle">นำเข้าไฟล์ยอดขาย</ActionLink>
                  </p>
                ) : null}
              </>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">
                ยังไม่มียอดขายในช่วงนี้ ·{" "}
                <ActionLink href="/sales/import" className="ml-1 align-middle">นำเข้าไฟล์ยอดขาย</ActionLink>
              </p>
            )}
          </Card>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        {see.expense || seeGross ? (
          <Card
            className="xl:col-span-3"
            title="เงินจากยอดขายไปอยู่ที่ไหน"
            hint={`${revenueNum ? "% คือสัดส่วนของยอดขาย" : "% คือสัดส่วนของรายจ่ายรวม"} · กดแต่ละแถวเพื่อดูรายละเอียด`}
          >
            <BarList groups={spendGroups} total={shareBase} emptyText="ยังไม่มีรายจ่ายในช่วงนี้" />
          </Card>
        ) : null}
        {see.sales ? (
          <Card className="xl:col-span-2" title="เมนูขายดี 10 อันดับ" hint="เรียงตามยอดขาย · ชี้ที่แท่งเพื่อดูจำนวนจาน">
            <TopMenusChart rows={menus} />
          </Card>
        ) : null}
      </div>

      {pnl.branches.length > 1 && seeNet ? <BranchTable pnl={pnl} /> : null}
    </div>
  );
}

async function topMenus(tenantId: string, period: Period, branchIds: string[], branchName: Map<string, string>): Promise<MenuBar[]> {
  // One summary per branch — getSalesSummaryLogic already folds merged menus
  // (ADR 0026: reporting folds retroactively and always), so summing its rows
  // by menu id keeps that fold across branches too.
  const summaries = await Promise.all(
    branchIds.map((branchId) =>
      getSalesSummaryLogic(
        tenantId,
        {
          ...getSalesQuerySchema.parse({ branchId, from: isoDay(period.from), to: isoDay(period.to), includeSuperseded: "false" }),
          // `branchIds` is already the reader's reach narrowed by the chips.
          reach: { allBranches: false, allowedBranchIds: branchIds },
        }
      )
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
  return top.map(({ branchId, ...m }) =>
    (seen.get(m.name) ?? 0) > 1 ? { ...m, name: `${m.name} · ${(branchName.get(branchId) ?? "").replace(/^สาขา/, "")}` } : m
  );
}

// ------------------------------------------------------------
// Pieces
// ------------------------------------------------------------
function Card({ title, hint, className = "", children }: { title: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? <p className="mb-4 mt-0.5 text-xs text-muted-foreground">{hint}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

function Delta({ cur, prev, goodWhenUp, vs, days }: { cur: number | null; prev: number | null; goodWhenUp: boolean; vs: string; days: DayCounts }) {
  if (cur === null || prev === null || prev === 0) {
    return <span className="text-xs text-muted-subtle">ไม่มีตัวเลข {vs} ให้เทียบ</span>;
  }
  // Average per operating day against average per operating day (C1).
  const perDay = days.cur !== days.prev;
  const a = perDay ? cur / days.cur : cur;
  const b = perDay ? prev / days.prev : prev;
  const pct = ((a - b) / Math.abs(b)) * 100;
  const up = pct >= 0;
  const good = up === goodWhenUp;
  return (
    <span className={`text-xs font-medium ${good ? "text-good" : "text-bad"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%{perDay && " ต่อวัน"} <span className="font-normal text-muted-foreground">เทียบ {vs}</span>
    </span>
  );
}

function Kpi({
  label,
  value,
  sub,
  delta,
  tone,
  extra,
}: {
  label: string;
  value: number | null;
  sub?: string;
  delta: React.ReactNode;
  tone?: "good" | "bad";
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 tabular-nums text-2xl font-semibold ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>
        {value === null ? "—" : baht(value)}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
      <div className="mt-2">{delta}</div>
      {extra ? <div className="mt-1">{extra}</div> : null}
    </div>
  );
}

/** Change in a margin, in percentage POINTS — "51% → 53%" is +2 pp, not +4%. */
function MarginDelta({ label, cur, prev }: { label: string; cur: number | null; prev: number | null }) {
  if (cur === null) return null;
  const d = prev === null ? null : cur - prev;
  return (
    <span className="text-xs text-muted-foreground">
      {label} {cur.toFixed(1)}%
      {d === null ? null : (
        <span className={`ml-1 font-medium ${d >= 0 ? "text-good" : "text-bad"}`}>
          {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)} pp
        </span>
      )}
    </span>
  );
}

const marginOf = (part: { toString(): string } | null, whole: { toString(): string } | null) => {
  const w = whole === null ? null : Number(whole.toString());
  return part === null || !w ? null : (Number(part.toString()) / w) * 100;
};

type PnlPick = (p: Pnl) => number | null;

/** A KPI's ▲▼ — waits for the previous period without holding up the figure above it. */
/** Operating days (days with sales) in each period — what a per-day figure divides by (C1). */
type DayCounts = { cur: number; prev: number };

/**
 * "เฉลี่ย ฿X/วัน" beside the total (Kong, 2026-10-01). Two periods of different
 * lengths — September's 30 days against August's 31 — differ by ~3% from the
 * calendar alone; the per-day pair shows how much of a % is the calendar.
 * Operating days, not calendar days (Kong 2026-10-24, C1): "เดือนนี้ 10 วันก็หาร 10".
 */
function PerDay({ cur, prev, days, vs }: { cur: number | null; prev: number | null | undefined; days: DayCounts; vs: string }) {
  if (cur === null) return null;
  return (
    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
      <span className="block whitespace-nowrap">
        เฉลี่ย <span className="tabular-nums">{baht(cur / days.cur)}</span>/วัน ({days.cur} วัน)
      </span>
      {prev === undefined || prev === null ? null : (
        <span className="block whitespace-nowrap">
          {vs} <span className="tabular-nums">{baht(prev / days.prev)}</span>/วัน ({days.prev} วัน)
        </span>
      )}
    </span>
  );
}

function PrevDelta(props: { prevP: Promise<Pnl | null>; cur: number | null; pick: PnlPick; goodWhenUp: boolean; vs: string; days: DayCounts }) {
  return (
    <Suspense
      fallback={
        <>
          <span className="text-xs text-muted-subtle">กำลังเทียบกับ {props.vs}…</span>
          <PerDay cur={props.cur} prev={undefined} days={props.days} vs={props.vs} />
        </>
      }
    >
      <PrevDeltaResolved {...props} />
    </Suspense>
  );
}

async function PrevDeltaResolved({ prevP, cur, pick, goodWhenUp, vs, days }: { prevP: Promise<Pnl | null>; cur: number | null; pick: PnlPick; goodWhenUp: boolean; vs: string; days: DayCounts }) {
  const prev = await prevP;
  if (prev === null) {
    return (
      <>
        <span className="text-xs text-muted-subtle">เทียบกับ {vs} ไม่ได้ในตอนนี้</span>
        <PerDay cur={cur} prev={undefined} days={days} vs={vs} />
      </>
    );
  }
  return (
    <>
      <Delta cur={cur} prev={pick(prev)} goodWhenUp={goodWhenUp} vs={vs} days={days} />
      <PerDay cur={cur} prev={pick(prev)} days={days} vs={vs} />
    </>
  );
}

/** The margin shows at once; its pp change joins it when the previous period arrives. */
function PrevMargin({ prevP, label, cur, part }: { prevP: Promise<Pnl | null>; label: string; cur: number | null; part: (p: Pnl) => { toString(): string } | null }) {
  return (
    <Suspense fallback={<MarginDelta label={label} cur={cur} prev={null} />}>
      <PrevMarginResolved prevP={prevP} label={label} cur={cur} part={part} />
    </Suspense>
  );
}

async function PrevMarginResolved({ prevP, label, cur, part }: { prevP: Promise<Pnl | null>; label: string; cur: number | null; part: (p: Pnl) => { toString(): string } | null }) {
  const prev = await prevP;
  return <MarginDelta label={label} cur={cur} prev={prev === null ? null : marginOf(part(prev), prev.revenue)} />;
}

function KpiRow({
  pnl,
  prevP,
  vs,
  days,
  see,
  incomplete,
  guest,
}: {
  pnl: Pnl;
  prevP: Promise<Pnl | null>;
  vs: string;
  days: DayCounts;
  see: { sales: boolean; cost: boolean; expense: boolean; gross: boolean; net: boolean };
  /** C2: recurring expenses due in the period are not recorded — never say "better". */
  incomplete?: boolean;
  /** Rules GH-HEAD / GH-COV — null = no card. */
  guest?: { now: GuestStats; prev: GuestStats; vs: string; canKey: boolean } | null;
}) {
  const revenue = num(pnl.revenue);
  const notYet = <span className="text-xs font-medium text-warn">ยังเทียบไม่ได้ — รายการประจำยังไม่ครบ</span>;
  const cogs = num(pnl.cogs);
  const gross = num(pnl.grossProfit);
  const net = num(pnl.netProfit);
  const foodCost = revenue && cogs !== null ? `food cost ${((cogs / revenue) * 100).toFixed(1)}% ของยอดขาย` : undefined;
  const coverage =
    pnl.recipeCoverage !== null ? `คิดจากสูตร ครอบคลุม ${(pnl.recipeCoverage * 100).toFixed(0)}% ของยอดขาย` : undefined;

  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${guest ? "xl:grid-cols-3 2xl:grid-cols-6" : "xl:grid-cols-5"}`}>
      {see.sales ? (
        <Kpi label="ยอดขาย" value={revenue} sub="ไม่รวม VAT และ service charge" delta={<PrevDelta prevP={prevP} vs={vs} days={days} cur={revenue} pick={(p) => num(p.revenue)} goodWhenUp />} />
      ) : null}
      {see.gross ? (
        <Kpi label="ต้นทุนขาย" value={cogs} sub={foodCost ?? coverage} delta={<PrevDelta prevP={prevP} vs={vs} days={days} cur={cogs} pick={(p) => num(p.cogs)} goodWhenUp={false} />} />
      ) : null}
      {see.gross ? (
        <Kpi
          label="กำไรขั้นต้น"
          value={gross}
          sub={coverage}
          delta={<PrevDelta prevP={prevP} vs={vs} days={days} cur={gross} pick={(p) => num(p.grossProfit)} goodWhenUp />}
          extra={<PrevMargin prevP={prevP} label="อัตรากำไรขั้นต้น" cur={marginOf(pnl.grossProfit, pnl.revenue)} part={(p) => p.grossProfit} />}
        />
      ) : null}
      {see.expense ? (
        <Kpi label="ค่าใช้จ่ายดำเนินงาน" value={num(pnl.opex)} sub={incomplete ? "ยังไม่ครบ — มีรายการประจำที่ยังไม่บันทึก" : "ค่าเช่า ค่าแรง ค่าน้ำไฟ ฯลฯ"} delta={incomplete ? notYet : <PrevDelta prevP={prevP} vs={vs} days={days} cur={num(pnl.opex)} pick={(p) => num(p.opex)} goodWhenUp={false} />} />
      ) : null}
      {see.net ? (
        <Kpi
          label="กำไรสุทธิ"
          value={net}
          tone={net === null ? undefined : net >= 0 ? "good" : "bad"}
          sub={incomplete ? "ยังไม่ครบ — สูงกว่าจริง" : undefined}
          delta={incomplete ? notYet : <PrevDelta prevP={prevP} vs={vs} days={days} cur={net} pick={(p) => num(p.netProfit)} goodWhenUp />}
          extra={incomplete ? null : <PrevMargin prevP={prevP} label="อัตรากำไรสุทธิ" cur={marginOf(pnl.netProfit, pnl.revenue)} part={(p) => p.netProfit} />}
        />
      ) : null}
      {guest ? <GuestKpi {...guest} /> : null}
    </div>
  );
}

/** ยอดต่อหัว — shown only when enough sales days carry a guest count (GH-COV). */
function GuestKpi({ now, prev, vs, canKey }: { now: GuestStats; prev: GuestStats; vs: string; canKey: boolean }) {
  if (!now.enough || now.perHead === null) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">ยอดต่อหัว</p>
        <p className="mt-1 text-2xl font-semibold text-muted-subtle">—</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {now.salesDays === 0
            ? "ยังไม่มียอดขายในช่วงนี้"
            : `กรอกจำนวนลูกค้าแล้ว ${now.guestDays} จาก ${now.salesDays} วันขาย · ต้องได้ ${Math.round(GUEST_COVERAGE_MIN * 100)}% ถึงจะแสดง`}
        </p>
        {canKey && now.salesDays > 0 && (
          <a href="/closing" className="mt-2 inline-block text-xs text-primary hover:underline">
            กรอกตอนปิดร้าน ›
          </a>
        )}
      </div>
    );
  }
  const diff = prev.enough && prev.perHead !== null ? now.perHead - prev.perHead : null;
  return (
    <a href="/sales" className="block rounded-2xl border border-border bg-surface p-4 transition hover:bg-muted/40">
      <p className="text-sm text-muted-foreground">ยอดต่อหัว</p>
      <p className="mt-1 tabular-nums text-2xl font-semibold">{baht(now.perHead)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {now.guestsPerDay === null ? "" : `${Math.round(now.guestsPerDay).toLocaleString("th-TH")} คน/วัน`} · ยอดขาย ÷ ลูกค้า
      </p>
      <p className="mt-2 text-xs">
        {diff === null ? (
          <span className="text-muted-subtle">ช่วงก่อนข้อมูลลูกค้าไม่พอ ยังเทียบไม่ได้</span>
        ) : (
          <span className={diff >= 0 ? "text-good" : "text-bad"}>
            {diff >= 0 ? "▲" : "▼"} {baht(Math.abs(diff))} ต่อหัว เทียบ {vs}
          </span>
        )}
      </p>
    </a>
  );
}

/** Rule PL5: an unknown figure says WHY, and where to fix it. */
function UnknownNote({ pnl, seeGross }: { pnl: Pnl; seeGross: boolean }) {
  if (!seeGross || !pnl.unknownReason) return null;
  return (
    <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">
      {pnl.unknownReason === "NO_SALES" ? (
        <>
          ยังคำนวณกำไรไม่ได้ เพราะยังไม่มียอดขายในช่วงนี้ ·{" "}
          <ActionLink href="/sales/import" tone="warn" className="ml-1 align-middle">นำเข้าไฟล์ยอดขาย</ActionLink>
        </>
      ) : (
        <>
          ยังคำนวณกำไรรวมไม่ได้ เพราะ {pnl.branchesMissingGrossProfit.join(", ")} มียอดขายแต่ยังหาต้นทุนขายไม่ได้
          (วิธีนับสต๊อกต้องมีการนับทั้งต้นงวดและปลายงวด) · ดูรายละเอียดที่{" "}
          <ActionLink href="/cost" tone="warn" className="ml-1 align-middle">หน้าต้นทุน</ActionLink>
        </>
      )}
    </div>
  );
}

function BranchTable({ pnl }: { pnl: Pnl }) {
  const cell = (d: { toString(): string } | null) => (d === null ? "—" : baht(Number(d.toString())));
  return (
    <section className="data-table">
      <table>
        <thead className="bg-surface-sunk text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2">สาขา</th>
            <th className="px-4 py-2 text-right">ยอดขาย</th>
            <th className="px-4 py-2 text-right">ต้นทุนขาย</th>
            <th className="px-4 py-2 text-right">กำไรขั้นต้น</th>
            <th className="px-4 py-2 text-right">ค่าใช้จ่าย</th>
            <th className="px-4 py-2 text-right">กำไรสุทธิ</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {pnl.branches.map((b) => (
            <tr key={b.branchId}>
              <td className="px-4 py-2">{b.branchName}</td>
              <td className="px-4 py-2 text-right">{cell(b.revenue)}</td>
              <td className="px-4 py-2 text-right">{cell(b.cogs)}</td>
              <td className="px-4 py-2 text-right">{cell(b.grossProfit)}</td>
              {/* No bill recorded is "—", never ฿0 (kit rule). */}
              <td className="px-4 py-2 text-right">{b.opex === null || Number(b.opex.toString()) === 0 ? "—" : cell(b.opex)}</td>
              <td className={`px-4 py-2 text-right font-medium ${b.netProfit === null ? "" : b.netProfit.gte(0) ? "text-good" : "text-bad"}`}>
                {cell(b.netProfit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="กำลังคำนวณตัวเลข">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-surface-sunk" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="h-80 animate-pulse rounded-2xl border border-border bg-surface-sunk xl:col-span-3" />
        <div className="h-80 animate-pulse rounded-2xl border border-border bg-surface-sunk xl:col-span-2" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// What is waiting on somebody — for everyone, cooks included
// ------------------------------------------------------------
async function WorkQueue({
  showPulse,
  dailyClose,
  tenantId,
  reach,
  costAccess,
  purchaseBranches,
}: {
  showPulse: boolean;
  /** ADR 0042: the add-on is on — the closing card replaces the till box (keyed in one place). */
  dailyClose: { branches: { id: string; name: string }[]; canFill: boolean } | null;
  tenantId: string;
  reach: Awaited<ReturnType<typeof requireTenant>>["reach"];
  costAccess: Awaited<ReturnType<typeof requireTenant>>["costAccess"];
  /** Branches whose purchase requests this reader cuts (purchase:approve); empty = none. */
  purchaseBranches: { id: string; name: string }[];
}) {
  // Streamed in its own Suspense: the page frame and the figures no longer
  // wait for these two reads before anything appears.
  const [transfers, pulseRaw, requests, closeStatus] = await Promise.all([
    // Part 18 Q8: any truck still unconfirmed, whatever the chips say.
    getTransfersLogic(tenantId, getTransfersQuerySchema.parse({ status: "SENT", includeReversalLines: "false" }), reach),
    // Part 20a Q4 — "the shop runs blind between imports".
    showPulse && !dailyClose ? getPulseDashboardLogic(tenantId, reach) : Promise.resolve(null),
    // ADR 0036 Q9 — the purchaser learns a kitchen is ready without being told.
    getRequestQueueLogic(tenantId, purchaseBranches),
    dailyClose ? getCloseStatusLogic(tenantId, dailyClose.branches.map((b) => b.id)) : Promise.resolve(null),
  ]);
  const waiting = transfers.map((t) => toTransferView(t, costAccess));
  const pulse = pulseRaw ? toPulseDashboardView(pulseRaw) : null;
  const todayIso = computeBangkokToday().toISOString().slice(0, 10);

  if (!pulse && !closeStatus && waiting.length === 0 && requests.length === 0) return null;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">งานวันนี้</h2>
      {pulse ? <PulsePanel dashboard={pulse} todayIso={todayIso} /> : null}
      {closeStatus && dailyClose ? (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">ปิดร้านประจำวัน</h3>
            <a href="/closing" className="text-xs text-primary hover:underline">
              ดูย้อนหลัง
            </a>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {closeStatus.branches.map((b) => {
              const name = dailyClose.branches.find((x) => x.id === b.branchId)?.name ?? "";
              const href = `/closing/day?branch=${b.branchId}&date=${closeStatus.today}`;
              return (
                <div key={b.branchId} className="space-y-2 rounded-2xl border border-border bg-surface-sunk p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{name}</span>
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${b.today ? "bg-good-bg text-good" : "bg-bad-bg text-bad"}`}>
                      {b.today ? "ปิดร้านแล้ว" : "ยังไม่ปิด"}
                    </span>
                  </div>
                  {dailyClose.canFill && (
                    <a href={href} className={`block rounded-full px-4 py-2 text-center text-sm font-semibold ${b.today ? "border border-border-strong bg-surface" : "bg-primary text-primary-foreground"}`}>
                      {b.today ? "ดู / แก้ใบวันนี้" : "ปิดร้านวันนี้"}
                    </a>
                  )}
                  <p className="text-xs text-muted-subtle">
                    {!b.yesterday && dailyClose.canFill ? (
                      <a href={`/closing/day?branch=${b.branchId}&date=${closeStatus.yesterday}`} className="text-warn underline">
                        เมื่อวานยังไม่ได้ปิด — ปิดได้ถึงเที่ยงคืนนี้
                      </a>
                    ) : b.yesterday ? (
                      "เมื่อวานปิดแล้ว"
                    ) : (
                      "เมื่อวานไม่ได้ปิด"
                    )}
                    {b.openIssues > 0 && (
                      <>
                        {" · "}
                        <a href={`/closing?branch=${b.branchId}`} className="text-bad underline">
                          ปัญหาค้าง {b.openIssues}
                        </a>
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {requests.length > 0 ? <RequestQueue rows={requests} /> : null}
      {waiting.length > 0 ? (
        // Kong (2026-09-28): this must LEAD somewhere. The heading opens the
        // transfer list filtered to the ones waiting; each document opens its
        // own page (items, quantities, who sent it).
        <div className="rounded-xl border border-warn-border bg-warn-bg p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-warn">มีใบโอน {waiting.length} ใบที่ปลายทางยังไม่กดรับ</p>
            <ActionLink href="/transfers?status=SENT" tone="warn">
              ดูใบโอนที่รอรับทั้งหมด
            </ActionLink>
          </div>
          <p className="mt-1 text-xs text-warn">
            ของเข้ายอดของสาขาปลายทางแล้วตั้งแต่ต้นทางกดส่ง — ที่ค้างคือการนับยืนยันที่ปลายทาง
          </p>
          <ul className="mt-3 divide-y divide-warn-border overflow-hidden rounded-lg border border-warn-border bg-surface">
            {waiting.map((t) => (
              <li key={t.id}>
                <a
                  href={`/transfers/${t.id}`}
                  className="group flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-xs text-muted-foreground">{t.tfNumber}</span>{" "}
                    <span className="font-medium">
                      {t.fromBranch.name} → {t.toBranch.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">ส่งเมื่อ {t.dispatchedAtLabel}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** ADR 0036 Q9 — kitchens waiting on the purchaser. Ready ones lead, in green. */
function RequestQueue({ rows }: { rows: RequestQueueRow[] }) {
  const sorted = [...rows].sort((a, b) => Number(b.allReady) - Number(a.allReady));
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold">ใบขอซื้อรอตัดรอบ</p>
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
        {sorted.map((r) => (
          <li key={r.branchId} className="group relative flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-muted">
            <a href={`/purchase-requests/cut?b=${r.branchId}`} className="font-medium after:absolute after:inset-0 after:content-['']">
              {r.branchName} · {r.waiting} รายการ
            </a>
            <span
              className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${
                r.allReady ? "border-good-border bg-good-bg text-good" : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {r.allReady ? "ทุกแผนกพร้อมแล้ว สั่งได้เลย" : `พร้อม ${r.readyDepartments} จาก ${r.departments} แผนก`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ADR 0041 — recipe drafts this person can move forward: one a cook proposed
 * (to endorse or apply), and for whoever applies to every branch, one a
 * manager already endorsed. Nothing when there is nothing to do.
 */
async function DraftsWaiting({ tenantId, userId, shared }: { tenantId: string; userId: string; shared: boolean }) {
  const n = await withTenantContext(tenantId, (tx) =>
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
  if (n === 0) return null;
  return (
    <a href="/menus/lab" className="block rounded-xl border border-warn-border bg-warn-bg px-4 py-3 text-sm hover:brightness-[0.98]">
      มีร่างสูตรรอคุณ <b className="tabular-nums">{n}</b> รายการ ในทดลองเมนู — ตรวจแล้วรับรองหรือนำไปใช้จริง
    </a>
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
async function missingRecurring(tenantId: string, period: Period, branchIds: string[]) {
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

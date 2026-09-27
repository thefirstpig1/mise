import { Suspense } from "react";
import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getPnlLogic, getRevenueByDayLogic, type Pnl } from "@/server/pnl";
import { getSalesSummaryLogic } from "@/server/sales";
import { getSalesQuerySchema } from "@/lib/validations/sales-import";
import { getTransfersLogic } from "@/server/transfer";
import { getTransfersQuerySchema } from "@/lib/validations/transfer";
import { toTransferView } from "@/app/(app)/transfers/_components/transfer-view";
import { getPulseDashboardLogic } from "@/server/sales-pulse";
import { toPulseDashboardView } from "@/app/(app)/sales/_components/sales-view";
import PulsePanel from "./_components/PulsePanel";
import ActionLink, { RowChevron } from "@/components/ui/ActionLink";
import DashboardControls, { type BranchChip } from "./_components/DashboardControls";
import BarList, { type BarListGroup } from "@/components/charts/BarList";
import {
  PnlWaterfallChart,
  RevenueTrendChart,
  SERIES,
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

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { membership, tenantId, reach, costAccess, can } = await requireTenant("any:member");
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

  // Part 18 Q8: any truck still unconfirmed, whatever the chips say.
  const waiting = (
    await getTransfersLogic(tenantId, getTransfersQuerySchema.parse({ status: "SENT", includeReversalLines: "false" }))
  ).map((t) => toTransferView(t, costAccess));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div>
        <h1 className="text-2xl font-bold">ภาพรวม</h1>
        <p className="mt-1 text-sm text-muted-foreground">{membership.tenant.name}</p>
      </div>

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
            />
          </Suspense>
        </>
      ) : null}

      <WorkQueue waiting={waiting} showPulse={seeSales} tenantId={tenantId} reach={reach} />
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
}: {
  tenantId: string;
  reach: Awaited<ReturnType<typeof requireTenant>>["reach"];
  period: Period;
  selected: string[];
  activeIds: string[];
  chips: BranchChip[];
  see: { sales: boolean; cost: boolean; expense: boolean };
}) {
  const q = { from: period.from, to: period.to, branchIds: selected };
  const [pnl, prev, revenueDays, menus] = await Promise.all([
    getPnlLogic(tenantId, q, reach),
    getPnlLogic(tenantId, { from: period.prevFrom, to: period.prevTo, branchIds: selected }, reach),
    see.sales ? getRevenueByDayLogic(tenantId, q, reach, activeIds) : Promise.resolve([]),
    see.sales ? topMenus(tenantId, period, activeIds) : Promise.resolve([] as MenuBar[]),
  ]);

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
      <KpiRow pnl={pnl} prev={prev} see={{ ...see, gross: seeGross, net: seeNet }} />
      <UnknownNote pnl={pnl} seeGross={seeGross} />

      <div className="grid gap-6 xl:grid-cols-5">
        {see.sales ? (
          <Card className="xl:col-span-3" title="รายรับรายวัน" hint="ยอดขายไม่รวม VAT และ service charge · กดชื่อสาขาเพื่อซ่อน/แสดงเส้น">
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
        {seeNet && pnl.netProfit !== null && pnl.revenue !== null ? (
          <Card className="xl:col-span-2" title="จากยอดขายสู่กำไร" hint="ยอดขาย − ต้นทุนขาย − ค่าใช้จ่าย = กำไรสุทธิ">
            <PnlWaterfallChart
              data={{ revenue: num(pnl.revenue)!, cogs: num(pnl.cogs)!, opex: num(pnl.opex)!, net: num(pnl.netProfit)! }}
            />
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

async function topMenus(tenantId: string, period: Period, branchIds: string[]): Promise<MenuBar[]> {
  // One summary per branch — getSalesSummaryLogic already folds merged menus
  // (ADR 0026: reporting folds retroactively and always), so summing its rows
  // by menu id keeps that fold across branches too.
  const summaries = await Promise.all(
    branchIds.map((branchId) =>
      getSalesSummaryLogic(
        tenantId,
        getSalesQuerySchema.parse({ branchId, from: isoDay(period.from), to: isoDay(period.to), includeSuperseded: "false" })
      )
    )
  );
  const by = new Map<string, MenuBar>();
  for (const s of summaries) {
    for (const m of s.topMenus) {
      const cur = by.get(m.menuId) ?? { name: m.name, net: 0, qty: 0 };
      cur.net += Number(m.net.toString());
      cur.qty += Number(m.qty.toString());
      by.set(m.menuId, cur);
    }
  }
  return [...by.values()].sort((a, b) => b.net - a.net).slice(0, 10);
}

// ------------------------------------------------------------
// Pieces
// ------------------------------------------------------------
function Card({ title, hint, className = "", children }: { title: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? <p className="mb-4 mt-0.5 text-xs text-muted-foreground">{hint}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

function Delta({ cur, prev, goodWhenUp }: { cur: number | null; prev: number | null; goodWhenUp: boolean }) {
  if (cur === null || prev === null || prev === 0) {
    return <span className="text-xs text-muted-subtle">ไม่มีช่วงก่อนหน้าให้เทียบ</span>;
  }
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  const good = up === goodWhenUp;
  return (
    <span className={`text-xs font-medium ${good ? "text-good" : "text-bad"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% <span className="font-normal text-muted-foreground">จากช่วงก่อนหน้า</span>
    </span>
  );
}

function Kpi({
  label,
  value,
  sub,
  delta,
  tone,
}: {
  label: string;
  value: number | null;
  sub?: string;
  delta: React.ReactNode;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 tabular-nums text-2xl font-semibold ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>
        {value === null ? "—" : baht(value)}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
      <div className="mt-2">{delta}</div>
    </div>
  );
}

function KpiRow({
  pnl,
  prev,
  see,
}: {
  pnl: Pnl;
  prev: Pnl;
  see: { sales: boolean; cost: boolean; expense: boolean; gross: boolean; net: boolean };
}) {
  const revenue = num(pnl.revenue);
  const cogs = num(pnl.cogs);
  const gross = num(pnl.grossProfit);
  const net = num(pnl.netProfit);
  const foodCost = revenue && cogs !== null ? `food cost ${((cogs / revenue) * 100).toFixed(1)}% ของยอดขาย` : undefined;
  const margin = revenue && net !== null ? `${((net / revenue) * 100).toFixed(1)}% ของยอดขาย` : undefined;
  const coverage =
    pnl.recipeCoverage !== null ? `คิดจากสูตร ครอบคลุม ${(pnl.recipeCoverage * 100).toFixed(0)}% ของยอดขาย` : undefined;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {see.sales ? (
        <Kpi label="ยอดขาย" value={revenue} sub="ไม่รวม VAT และ service charge" delta={<Delta cur={revenue} prev={num(prev.revenue)} goodWhenUp />} />
      ) : null}
      {see.gross ? (
        <Kpi label="ต้นทุนขาย" value={cogs} sub={foodCost ?? coverage} delta={<Delta cur={cogs} prev={num(prev.cogs)} goodWhenUp={false} />} />
      ) : null}
      {see.gross ? (
        <Kpi label="กำไรขั้นต้น" value={gross} sub={coverage} delta={<Delta cur={gross} prev={num(prev.grossProfit)} goodWhenUp />} />
      ) : null}
      {see.expense ? (
        <Kpi label="ค่าใช้จ่ายดำเนินงาน" value={num(pnl.opex)} sub="ค่าเช่า ค่าแรง ค่าน้ำไฟ ฯลฯ" delta={<Delta cur={num(pnl.opex)} prev={num(prev.opex)} goodWhenUp={false} />} />
      ) : null}
      {see.net ? (
        <Kpi
          label="กำไรสุทธิ"
          value={net}
          sub={margin}
          tone={net === null ? undefined : net >= 0 ? "good" : "bad"}
          delta={<Delta cur={net} prev={num(prev.netProfit)} goodWhenUp />}
        />
      ) : null}
    </div>
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
    <section className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-sunk text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">สาขา</th>
            <th className="px-4 py-2 text-right font-medium">ยอดขาย</th>
            <th className="px-4 py-2 text-right font-medium">ต้นทุนขาย</th>
            <th className="px-4 py-2 text-right font-medium">กำไรขั้นต้น</th>
            <th className="px-4 py-2 text-right font-medium">ค่าใช้จ่าย</th>
            <th className="px-4 py-2 text-right font-medium">กำไรสุทธิ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">
          {pnl.branches.map((b) => (
            <tr key={b.branchId}>
              <td className="px-4 py-2">{b.branchName}</td>
              <td className="px-4 py-2 text-right">{cell(b.revenue)}</td>
              <td className="px-4 py-2 text-right">{cell(b.cogs)}</td>
              <td className="px-4 py-2 text-right">{cell(b.grossProfit)}</td>
              <td className="px-4 py-2 text-right">{cell(b.opex)}</td>
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
          <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-surface-sunk" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="h-80 animate-pulse rounded-xl border border-border bg-surface-sunk xl:col-span-3" />
        <div className="h-80 animate-pulse rounded-xl border border-border bg-surface-sunk xl:col-span-2" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// What is waiting on somebody — for everyone, cooks included
// ------------------------------------------------------------
async function WorkQueue({
  waiting,
  showPulse,
  tenantId,
  reach,
}: {
  waiting: ReturnType<typeof toTransferView>[];
  showPulse: boolean;
  tenantId: string;
  reach: Awaited<ReturnType<typeof requireTenant>>["reach"];
}) {
  // Part 20a Q4 — "the shop runs blind between imports".
  const pulse = showPulse ? toPulseDashboardView(await getPulseDashboardLogic(tenantId, reach)) : null;
  const todayIso = computeBangkokToday().toISOString().slice(0, 10);

  if (!pulse && waiting.length === 0) return null;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">งานที่รออยู่</h2>
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
                  <RowChevron label="ดูรายละเอียด" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {pulse ? <PulsePanel dashboard={pulse} todayIso={todayIso} /> : null}
    </div>
  );
}

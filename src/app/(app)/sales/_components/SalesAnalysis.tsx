"use client";

// ============================================================
// Mise — the measured half of /sales, switched in the browser
// ============================================================
// Kong (2026-09-28): "ขนาดแค่สับสวิตช์มุมมองยังช้า". Everything below the
// filters that depends on ยอดขาย / จำนวนจาน / กำไร lives here, fed by views the
// server built in one pass (sales-views.ts). Switching is setState — instant.
//
//  - ยอดขาย and จำนวนจาน arrive with the page.
//  - กำไร is built in the background right after the page appears
//    (getSalesProfitViewAction) and kept for the life of the page; pressing it
//    early just shows a spinner on the pill until it lands.
//  - The URL keeps `?by=` (history.replaceState) so the view stays linkable,
//    and every /sales link on the page carries the CURRENT measure when
//    clicked, so changing a filter does not throw the reader back to ยอดขาย.
// ============================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { METRIC_LABELS_TH, fmtMetric, periodLabelTh, type Metric } from "@/lib/sales-insight";
import { getSalesProfitViewAction } from "../insight-actions";
import { announceStale } from "@/lib/stale-tab";
import type { SalesView } from "./sales-views";
import MetricSwitch from "./MetricSwitch";
import CompareButton from "./CompareModal";
import { MenuInsightProvider } from "./MenuInsight";
import DayDetailModal, { type DayModalBranch } from "./DayDetailModal";
import { ActionError, CategoryShare, STALE_TAB_MESSAGE, type ToneMap } from "./Breakdown";
import CategoryWeekdayHeatmap from "./CategoryWeekdayHeatmap";
import MenuChanges from "./MenuChanges";
import MenuEngineering from "./MenuEngineering";
import ComparePicker, { type CompareOption } from "./ComparePicker";
import { MenuTable, SalesDailyChart, WeekdayChart } from "./SalesCharts";

type MonthOpt = { key: string; label: string; from: string; to: string };

const OPTIONS: { key: Metric; label: string }[] = [
  { key: "net", label: "ยอดขาย ฿" },
  { key: "qty", label: "จำนวนจาน" },
  { key: "profit", label: "กำไร" },
];

/** The same href with `by` set to the current measure. */
function withBy(href: string, by: Metric): string {
  const url = new URL(href, "http://x");
  if (by === "net") url.searchParams.delete("by");
  else url.searchParams.set("by", by);
  return `${url.pathname}${url.search}`;
}

export default function SalesAnalysis({
  views: initialViews,
  initialBy,
  canProfit,
  range,
  branchId,
  categoryId,
  tones,
  months,
  periodShort,
  prevLabel,
  asOfLabel,
  noMenuCategories,
  filterHref,
  between,
  dayModal,
  compare,
}: {
  views: Partial<Record<Metric, SalesView>>;
  initialBy: Metric;
  canProfit: boolean;
  range: { from: string; to: string };
  branchId?: string;
  categoryId?: string;
  tones: ToneMap;
  months: MonthOpt[];
  /** "ก.ย. 69" or "1–28 ก.ย." — for popup titles. */
  periodShort: string;
  prevLabel: string;
  /** The date recipe costs are priced at, for the profit banner. */
  asOfLabel: string;
  noMenuCategories: boolean;
  filterHref: Record<string, string>;
  /** Server-rendered tiles and notices, placed under the switch. */
  between: ReactNode;
  /** What the page compares against, and the choices (Kong, 2026-10-03). */
  compare: {
    defaultLabel: string;
    months: CompareOption[];
    selected: string;
    custom: { from: string; to: string } | null;
    vsFrom: string;
    vsTo: string;
  };
  dayModal: null | {
    day: string;
    title: string;
    net: number;
    qty: number;
    branches: DayModalBranch[];
    canKeyPulse: boolean;
    closeHref: string;
    prevHref: string | null;
    nextHref: string | null;
  };
}) {
  const [by, setBy] = useState<Metric>(initialBy);
  const [pending, setPending] = useState<Metric | null>(null);
  const [profitError, setProfitError] = useState<{ message: string; stale: boolean } | null>(null);

  // The profit view belongs to exactly these filters (and the open day, whose
  // breakdown it carries). A different key is a different view — refetch.
  const key = `${range.from}|${range.to}|${branchId ?? ""}|${categoryId ?? ""}|${dayModal?.day ?? ""}|${compare.vsFrom}|${compare.vsTo}`;
  const [fetched, setFetched] = useState<{ key: string; view: SalesView } | null>(null);
  const views: Partial<Record<Metric, SalesView>> = {
    ...initialViews,
    profit: initialViews.profit ?? (fetched?.key === key ? fetched.view : undefined),
  };

  const loadProfit = useCallback(() => {
    if (!canProfit) return Promise.resolve();
    const k = key;
    return getSalesProfitViewAction({ ...range, branchId, categoryId, day: dayModal?.day ?? null, vsFrom: compare.vsFrom, vsTo: compare.vsTo })
      // `undefined` = a tab older than the server (see mise-ui-review).
      .then((r) => {
        if (r?.ok) setFetched({ key: k, view: r.view });
        else {
          if (!r) announceStale();
          setProfitError({ message: r?.formError ?? STALE_TAB_MESSAGE, stale: !r || Boolean(r.stale) });
        }
      })
      .catch(() => {
        announceStale();
        setProfitError({ message: STALE_TAB_MESSAGE, stale: true });
      });
  }, [canProfit, key, range, branchId, categoryId, dayModal?.day, compare.vsFrom, compare.vsTo]);

  // Build the profit view in the background, once per set of filters.
  const haveProfit = Boolean(views.profit);
  useEffect(() => {
    if (!canProfit || haveProfit) return;
    const t = window.setTimeout(() => void loadProfit(), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canProfit, key, haveProfit]);

  // When the profit view lands while someone is waiting for it, show it.
  useEffect(() => {
    if (pending === "profit" && haveProfit) {
      setBy("profit");
      setPending(null);
    }
  }, [pending, haveProfit]);

  const select = useCallback(
    (m: Metric) => {
      window.history.replaceState(null, "", withBy(window.location.pathname + window.location.search, m));
      if (views[m]) {
        setBy(m);
        setPending(null);
      } else {
        setPending(m);
        if (profitError) {
          setProfitError(null);
          void loadProfit();
        }
      }
    },
    [views, profitError, loadProfit]
  );

  // Any navigation inside /sales (a <Link> ignores the rewritten attribute
  // below) lands on a URL without the measure; put it back so a refresh or a
  // shared link shows what is on screen.
  const params = useSearchParams();
  useEffect(() => {
    const want = by === "net" ? null : by;
    if (params.get("by") !== want) {
      window.history.replaceState(null, "", withBy(window.location.pathname + window.location.search, by));
    }
  }, [params, by]);

  // Every /sales link carries the current measure when followed.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href^='/sales?'], a[href='/sales']") as HTMLAnchorElement | null;
      if (a) a.setAttribute("href", withBy(a.getAttribute("href") ?? "/sales", by));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [by]);

  const options = useMemo(() => OPTIONS.filter((o) => o.key !== "profit" || canProfit), [canProfit]);
  const v = views[by] ?? views.net!;

  return (
    <MenuInsightProvider
      from={range.from}
      to={range.to}
      branchId={branchId}
      by={by}
      metric={{ options, select, pending }}
      costRows={views.profit?.table}
    >
      <div className="space-y-8">
        {/* ---------- the measure, for the whole page (Kong, 2026-09-28) ---------- */}
        <section className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">ดูจาก</span>
            <MetricSwitch current={by} options={options} onSelect={select} pending={pending} />
            {pending && profitError && (
              <span className="text-xs text-bad">
                {profitError.message}{" "}
                {profitError.stale && (
                  <button type="button" onClick={() => window.location.reload()} className="underline">
                    รีเฟรช
                  </button>
                )}
              </span>
            )}
          </div>
          <CompareButton months={months} from={range.from} to={range.to} branchId={branchId} by={by} tones={tones} canProfit={canProfit} />
        </section>

        {v.profit && (
          <section className="rounded-xl border border-good-border bg-good-bg/60 p-4 text-sm">
            <p>
              <span className="font-semibold">กำไรขั้นต้นจากสูตร</span>{" "}
              <span className="font-display text-lg font-semibold tabular-nums text-good">{fmtMetric("profit", v.profit.total)}</span> · เฉลี่ย{" "}
              {fmtMetric("profit", v.profit.perDay)} ต่อวัน
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              กำไร = ยอดขาย (หลังหักส่วนลด ไม่รวม VAT) − จำนวนจาน × ต้นทุนต่อจานจากสูตรอาหาร ณ {asOfLabel}
              {v.profit.unknownNet > 0 && (
                <>
                  {" "}· ยอดขาย {fmtMetric("net", v.profit.unknownNet)} มาจากเมนูที่ยังไม่มีสูตร จึงยังไม่นับในกำไร —{" "}
                  <a href="/menus/coverage" className="text-primary underline">
                    ดูเมนูที่ยังไม่มีสูตร
                  </a>
                </>
              )}
            </p>
          </section>
        )}

        {between}

        {/* ---------- by day ---------- */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-base font-semibold">{METRIC_LABELS_TH[by]}รายวัน</h3>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">กดที่แท่งเพื่อดูรายละเอียดของวันนั้น</p>
          <SalesDailyChart activeDay={dayModal?.day ?? null} rows={v.daily} by={by} />
        </section>

        {dayModal && v.day ? (
          <DayDetailModal
            {...dayModal}
            categories={v.day.categories}
            menus={v.day.menus}
            tones={tones}
            by={by}
            closeHref={withBy(dayModal.closeHref, by)}
            prevHref={dayModal.prevHref ? withBy(dayModal.prevHref, by) : null}
            nextHref={dayModal.nextHref ? withBy(dayModal.nextHref, by) : null}
          />
        ) : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold">วันไหนของสัปดาห์ขายดี</h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              {METRIC_LABELS_TH[by]}เฉลี่ยต่อวัน หารด้วยจำนวนวันนั้นที่มีจริงในช่วง — วันที่ดีที่สุดเป็นแท่งสีส้มอิฐ · ใช้วางกะพนักงาน
            </p>
            <WeekdayChart rows={v.weekday} by={by} />
          </section>
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold">สัดส่วนหมวดเมนู</h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">ตาม{METRIC_LABELS_TH[by]} · กดหมวดเพื่อดูเมนูในหมวดนั้น</p>
            {noMenuCategories && <UncategorisedHint />}
            <CategoryShare
              total={v.total}
              tones={tones}
              by={by}
              periodLabel={periodShort}
              categories={v.categories}
              menus={v.menus}
              filterHref={Object.fromEntries(Object.entries(filterHref).map(([k, h]) => [k, withBy(h, by)]))}
            />
          </section>
        </div>

        {/* ---------- question 1: which category sells on which day ---------- */}
        {!noMenuCategories && (
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold">หมวดไหนขายดีวันไหน</h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              เช่น วันเสาร์ ต้มยำคิดเป็นกี่ % ของทั้งวัน เทียบกับเครื่องดื่มหรือเบียร์ · เฉลี่ยจากจำนวนวันนั้นที่มีข้อมูลจริง
            </p>
            <CategoryWeekdayHeatmap
              rows={v.heat.rows}
              weekdays={v.heat.weekdays}
              daysPerWeekday={v.heat.daysPerWeekday}
              menusByCell={v.heat.menusByCell}
              tones={tones}
              by={by}
            />
          </section>
        )}

        {/* ---------- question 4: what moved (Kong, 2026-10-03: one chart, any comparison) ---------- */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-base font-semibold">เมนูที่น่าจับตา</h3>
          <div className="mb-4 mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <ComparePicker
              curLabel={periodLabelTh(range.from, range.to)}
              defaultLabel={compare.defaultLabel}
              months={compare.months}
              selected={compare.selected}
              custom={compare.custom}
            />
            <span>· {METRIC_LABELS_TH[by]}เฉลี่ยต่อวัน · กดเมนูเพื่อดู insight</span>
          </div>
          <MenuChanges changes={v.changes} by={by} tones={tones} curLabel={periodLabelTh(range.from, range.to)} prevLabel={prevLabel} />
        </section>

        {canProfit ? (
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold">เมนูไหนควรทำอะไร</h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              ขายได้กี่จาน × กำไรต่อจาน · กดวงหรือรายชื่อเพื่อดู insight
            </p>
            {noMenuCategories && <UncategorisedHint />}
            <MenuEngineering
              rows={views.profit?.table ?? null}
              loading={!views.profit && !profitError}
              periodLabel={periodShort}
              asOfLabel={asOfLabel}
              tones={tones}
              table={<MenuTable total={v.total} by={by} rows={v.table} />}
            />
            {profitError && !views.profit && (
              <div className="mt-3">
                <ActionError message={profitError.message} stale={profitError.stale} />
                <MenuTable total={v.total} by={by} rows={v.table} />
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-semibold">
              {by === "net" ? "เมนูทำเงินสูงสุด" : by === "qty" ? "เมนูที่ลูกค้าสั่งมากที่สุด" : "เมนูทำกำไร"}
            </h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              ทั้ง {v.table.length} เมนูของช่วงนี้ · เรียงตาม{METRIC_LABELS_TH[by]} · กดแถวเพื่อดู insight · กดหัวคอลัมน์เพื่อเรียงใหม่
            </p>
            {noMenuCategories && <UncategorisedHint />}
            <MenuTable total={v.total} by={by} rows={v.table} />
          </section>
        )}
        {profitError && !pending && by === "profit" && <ActionError message={profitError.message} stale={profitError.stale} />}
      </div>
    </MenuInsightProvider>
  );
}

function UncategorisedHint() {
  return (
    <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      เมนูยังไม่ได้จัดหมวด จึงแยกยอดตามหมวดไม่ได้ —{" "}
      <a href="/menus" className="font-medium text-primary underline">
        จัดหมวดที่หน้าเมนู
      </a>{" "}
      แล้วสัดส่วนหมวดกับตารางนี้จะแยกให้เอง
    </p>
  );
}

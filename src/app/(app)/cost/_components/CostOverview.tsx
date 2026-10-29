"use client";

// /cost overview — the client half. See ../page.tsx and
// src/server/cost-overview.ts for where the figures come from; this file only
// arranges them around the questions an owner asks, and never computes a cost.
//
// Rules applied here (docs/calculation-rules.md):
//   CO-COV   below the shop's coverage threshold a cost % is not compared with
//            a target or with the period before — fewer recipes posted means
//            less cost, which would read as good news that is not real.
//   RC-LB    an incomplete cost reads "อย่างน้อย"; a lower bound may say
//            "เกินเป้า" (the truth is higher still) but never "อยู่ในเป้า".
//   CO-UNIT  baht is the default view; in baht a cost moves with sales, so the
//            change against the period before is shown in a neutral colour and
//            only the % view carries good/bad.

import { use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import { SERIES, BAD, TONES } from "@/components/charts/chart-theme";
import { orStale } from "@/lib/stale-tab";
import { saveCostTargetsAction } from "../actions";
import type { CostCell, CostOverview as Overview, CostPeriod, CostTargets, CountEvent, StockItem } from "@/server/cost-overview";

const f0 = (n: number) => Math.round(n).toLocaleString("th-TH");
const f2 = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CLAY = TONES.clay[0];
/** "fully posted" — a cost below this share of sales is a lower bound (RC-LB). */
const FULL = 0.995;

type Gran = "week" | "month";
type Unit = "baht" | "pct";
type MetricKey = "prime" | "food" | "var" | "waste";

type Agg = {
  rev: number | null;
  cogs: number | null;
  cogsWhy: string | null;
  coverage: number | null;
  labor: number | null;
  laborMissing: string | null;
  waste: number;
  daysPosted: number;
  salesDays: number;
};

function agg(p: CostPeriod | undefined, branchIds: string[]): Agg {
  const cells = branchIds.map((b) => p?.cells[b]).filter((c): c is CostCell => !!c && c.revenue !== null);
  if (!p || cells.length === 0) return { rev: null, cogs: null, cogsWhy: null, coverage: null, labor: null, laborMissing: null, waste: 0, daysPosted: 0, salesDays: 0 };
  const rev = cells.reduce((s, c) => s + (c.revenue ?? 0), 0);
  const cogsKnown = cells.every((c) => c.cogs !== null);
  const covKnown = cells.every((c) => c.coverage !== null);
  const laborKnown = cells.every((c) => c.labor !== null);
  return {
    rev,
    cogs: cogsKnown ? cells.reduce((s, c) => s + (c.cogs ?? 0), 0) : null,
    cogsWhy: cells.find((c) => c.cogs === null)?.cogsWhy ?? null,
    coverage: covKnown && rev > 0 ? cells.reduce((s, c) => s + (c.coverage ?? 0) * (c.revenue ?? 0), 0) / rev : null,
    labor: laborKnown ? cells.reduce((s, c) => s + (c.labor ?? 0), 0) : null,
    laborMissing: cells.find((c) => c.labor === null)?.laborMissing ?? null,
    waste: cells.reduce((s, c) => s + c.waste, 0),
    daysPosted: cells.reduce((s, c) => s + c.daysPosted, 0),
    salesDays: cells.reduce((s, c) => s + c.salesDays, 0),
  };
}

type Metric = {
  tab: string;
  hint: string;
  baht: (a: Agg) => number | null;
  target?: (t: CostTargets) => number;
  /** Is this figure a lower bound (RC-LB)? */
  bound: (a: Agg) => boolean;
  why: (a: Agg) => string;
};

const lowerBound = (a: Agg) => a.coverage !== null && a.coverage < FULL;
const METRICS: Record<Exclude<MetricKey, "var">, Metric> = {
  prime: {
    tab: "Prime cost",
    hint: "ต้นทุนของที่ขายไป + ค่าแรง · ค่าแรงรายเดือนกระจายตามจำนวนวัน",
    baht: (a) => (a.rev === null || a.cogs === null || a.labor === null ? null : a.cogs + a.labor),
    target: (t) => t.prime,
    bound: lowerBound,
    why: (a) => (a.rev === null ? "ไม่มียอดขาย" : a.cogs === null ? a.cogsWhy ?? "ยังไม่ได้ตัดสต๊อก" : a.laborMissing ?? "ยังไม่มีค่าแรง"),
  },
  food: {
    tab: "ต้นทุนอาหาร",
    hint: "ต้นทุนของที่ขายไป",
    baht: (a) => (a.rev === null ? null : a.cogs),
    target: (t) => t.food,
    bound: lowerBound,
    why: (a) => (a.rev === null ? "ไม่มียอดขาย" : a.cogsWhy ?? "ยังไม่ได้ตัดสต๊อก"),
  },
  waste: {
    tab: "ทิ้ง",
    hint: "ของที่บันทึกว่าทิ้ง (เมนูของเสีย)",
    baht: (a) => (a.rev === null ? null : a.waste),
    bound: () => false,
    why: () => "ไม่มียอดขาย",
  },
};
// Kong 2026-10-30: under นับสต๊อก no sale takes stock out, so what a count finds
// short of the ledger is what the shop USED — sold and lost together, never
// separable. It is named for that, with no target and no alarm (the month-end
// close already says "ใช้ไปทั้งหมด" for the same reason).
const VAR_NAME_PERIODIC = "ใช้ไปตามการนับ";
const VAR_TIP_PERIODIC =
  "ร้านนี้คิดกำไรแบบนับสต๊อก ยอดขายไม่ตัดสต๊อก ส่วนที่นับได้น้อยกว่าระบบจึงคือของที่ใช้ไปทั้งช่วง (ขายและขาดรวมกัน แยกกันไม่ได้) · อยากเห็นของหายจริงต้องคิดกำไรแบบสูตรอาหาร";
const VAR_TIP =
  "นับได้ไม่ตรงกับที่ระบบคำนวณว่าควรเหลือ (รับเข้า − ตัดตามสูตรที่ขาย − ที่บันทึกว่าทิ้งและของเสียแล้ว) · ส่วนที่ต่างคือของที่ไม่มีใครบันทึกว่าไปไหน · สาเหตุที่พบบ่อย: ตักเกินสูตร ทิ้งแต่ไม่ได้บันทึก รับของไม่ครบ นับหรือหน่วยผิด ของถูกหยิบไป";

const pctOf = (v: number | null, rev: number | null) => (v === null || !rev ? null : (v / rev) * 100);

export function CostOverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-6 w-64 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
      <p className="text-sm text-muted-foreground">กำลังคำนวณต้นทุน…</p>
    </div>
  );
}

export default function CostOverview({ overview, canEditTargets }: { overview: Promise<Overview | null>; canEditTargets: boolean }) {
  const data = use(overview);
  if (data === null) {
    return (
      <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">
        คำนวณต้นทุนไม่สำเร็จในครั้งนี้ กรุณารีเฟรชหน้าอีกครั้ง
      </div>
    );
  }
  if (data.branches.length === 0) {
    return <p className="text-sm text-muted-foreground">ยังไม่มีสาขาที่คุณดูได้</p>;
  }
  return <Overview data={data} canEditTargets={canEditTargets} />;
}

function lastWithSales(ps: CostPeriod[]) {
  for (let i = ps.length - 1; i >= 0; i--) if (Object.values(ps[i].cells).some((c) => c.revenue !== null)) return i;
  return ps.length - 1;
}

function Overview({ data, canEditTargets }: { data: Overview; canEditTargets: boolean }) {
  const [gran, setGran] = useState<Gran>("week");
  const [unit, setUnit] = useState<Unit>("baht");
  const [targets, setTargets] = useState<CostTargets>(data.targets);
  const [branch, setBranch] = useState<string>("ALL");
  const [metric, setMetric] = useState<MetricKey>("prime");
  const P = gran === "week" ? data.week : data.month;
  const [sel, setSel] = useState(() => lastWithSales(data.week));
  // B5 (Kong 2026-10-24): a count opens ของหายไปไหน at that count — the deep
  // page with causes and a checklist — instead of a shorter popup of the same list.
  // Under นับสต๊อก that page cannot tell loss from usage, so a count opens its own sheet.
  const openCount = (c: CountEvent) => {
    window.location.href = data.method === "PERIODIC_INVENTORY" ? `/stock-counts/${c.countId}` : `/cost/leaks?count=${c.countId}`;
  };
  const [editTargets, setEditTargets] = useState(false);
  const [stockView, setStockView] = useState<"age" | "left">("age");

  const colorOf = useMemo(() => new Map(data.branches.map((b, i) => [b.id, SERIES[i % SERIES.length]])), [data.branches]);
  const nameOf = useMemo(() => new Map(data.branches.map((b) => [b.id, b.name])), [data.branches]);
  const bs = branch === "ALL" ? data.branches.map((b) => b.id) : [branch];
  const multi = data.branches.length > 1;
  const isPct = unit === "pct";
  const covGate = targets.coverageMin;
  const periodic = data.method === "PERIODIC_INVENTORY";
  const varName = periodic ? VAR_NAME_PERIODIC : "ไม่ตรงกับระบบ";

  const switchGran = (g: Gran) => {
    setGran(g);
    setSel(lastWithSales(g === "week" ? data.week : data.month));
  };

  const valueOf = (m: Metric, a: Agg) => {
    const b = m.baht(a);
    return isPct ? pctOf(b, a.rev) : b;
  };
  const fmtV = (v: number) => (isPct ? `${v.toFixed(v < 1 ? 2 : 1)}%` : `฿${f0(v)}`);

  // Counts that fall up to the selected period's end, latest per branch.
  const periodEnd = P[sel]?.to ?? data.today;
  const latestCounts = (ids: string[]) =>
    ids
      .map((b) => data.counts.filter((c) => c.branchId === b && c.date <= periodEnd).at(-1))
      .filter((c): c is CountEvent => !!c);
  const countSum = (cs: CountEvent[]) => {
    const v = cs.reduce((s, c) => s + c.value, 0);
    const known = cs.filter((c) => c.sinceRevenue);
    const rev = known.reduce((s, c) => s + (c.sinceRevenue ?? 0), 0);
    return { v, pct: rev > 0 ? (known.reduce((s, c) => s + c.value, 0) / rev) * 100 : null };
  };

  const cur = agg(P[sel], bs);
  const prev = sel > 0 ? agg(P[sel - 1], bs) : null;
  const periodWord = gran === "week" ? "สัปดาห์ " : "";

  return (
    <div className="space-y-5">
      {/* sticky "what am I looking at" + the switches that change everything */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface/95 px-3 py-2 text-sm shadow-card backdrop-blur">
        <span className="text-muted-foreground">
          กำลังดู{" "}
          <b className="text-foreground">
            {periodWord}
            {P[sel]?.label} · {branch === "ALL" ? "ทุกสาขา" : nameOf.get(branch)} · {metric === "var" ? varName : METRICS[metric].tab}
          </b>
        </span>
        <span className="flex flex-wrap gap-2">
          <Seg value={gran} onChange={switchGran} options={[["week", "รายสัปดาห์"], ["month", "รายเดือน"]]} label="ช่วง" />
          <Seg value={unit} onChange={setUnit} options={[["baht", "เงิน"], ["pct", "% ของยอดขาย"]]} label="หน่วย" />
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">ร้านแข็งแรงไหม ดีขึ้นหรือแย่ลง และต้องจัดการอะไรก่อน</p>
        <button
          type="button"
          onClick={() => canEditTargets && setEditTargets(true)}
          className={`rounded-full border border-border bg-surface px-3 py-1 text-sm ${canEditTargets ? "hover:border-border-strong" : "cursor-default"}`}
          title={canEditTargets ? "แก้เป้าของร้าน" : "เจ้าของร้านหรือผู้ดูแลเป็นผู้ตั้งเป้า"}
        >
          เป้าของร้าน: อาหาร <b>≤{targets.food}%</b> · prime <b>≤{targets.prime}%</b>
          {!periodic && (
            <>
              {" "}
              · ไม่ตรงกับระบบ <b>≤{targets.variance}%</b>
            </>
          )}
          {canEditTargets && " ✎"}
        </button>
      </div>

      <div className="space-y-2 rounded-2xl border border-border bg-surface px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-12 text-xs text-muted-foreground">ช่วง</span>
          {P.map((p, i) => (
            <Chip key={p.key} on={i === sel} onClick={() => setSel(i)}>
              {p.label}
              {p.partial && <span className="ml-1 text-[10px] opacity-70">(ยังไม่จบ)</span>}
            </Chip>
          ))}
        </div>
        {multi && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-12 text-xs text-muted-foreground">สาขา</span>
            <Chip on={branch === "ALL"} onClick={() => setBranch("ALL")}>
              ทุกสาขา (เทียบกัน)
            </Chip>
            {data.branches.map((b) => (
              <Chip key={b.id} on={branch === b.id} onClick={() => setBranch(b.id)}>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: colorOf.get(b.id) }} />
                {b.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* Q1–3 */}
      <QLabel n="1–3">ร้านแข็งแรงไหม · ดีขึ้นหรือแย่ลง</QLabel>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="tablist">
        {(["prime", "food", "var", "waste"] as MetricKey[]).map((k) => {
          if (k === "var") {
            const cs = latestCounts(bs);
            const s = countSum(cs);
            const spark = P.map((p) => {
              const inP = data.counts.filter((c) => bs.includes(c.branchId) && c.date >= p.from && c.date <= p.to);
              return inP.length ? inP.reduce((x, c) => x + c.value, 0) : null;
            });
            return (
              <Tab key={k} on={metric === k} onClick={() => setMetric(k)} title={varName} tip={periodic ? VAR_TIP_PERIODIC : VAR_TIP} spark={spark} sel={sel}>
                {cs.length === 0 ? (
                  <>
                    <TabValue muted>ยังไม่ได้นับ</TabValue>
                    <TabSub>นับสต๊อกถึงจะรู้</TabSub>
                  </>
                ) : (
                  <>
                    <TabValue>{isPct && s.pct !== null ? `${s.pct.toFixed(2)}%` : `฿${f0(s.v)}`}</TabValue>
                    {s.pct === null ? (
                      <Tag tone="muted">ยังเทียบยอดขายไม่ได้</Tag>
                    ) : (
                      <Tag tone={periodic ? "muted" : s.pct > targets.variance ? "bad" : "ok"}>
                        {isPct ? `฿${f0(s.v)}` : `${s.pct.toFixed(2)}% ของยอดขาย`}
                        {!periodic && ` · เป้า ≤${targets.variance}%`}
                      </Tag>
                    )}
                    <TabSub>นับล่าสุด {cs.map((c) => (cs.length > 1 ? `${(nameOf.get(c.branchId) ?? "").replace(/^สาขา/, "")} ${c.dateLabel}` : c.dateLabel)).join(" · ")}</TabSub>
                  </>
                )}
              </Tab>
            );
          }
          const m = METRICS[k];
          const v = valueOf(m, cur);
          const vp = pctOf(m.baht(cur), cur.rev);
          const pv = prev ? valueOf(m, prev) : null;
          const tgt = m.target?.(targets) ?? null;
          const thin = cur.coverage !== null && cur.coverage < covGate;
          const prevThin = prev?.coverage != null && prev.coverage < covGate;
          const pre = m.bound(cur) ? "อย่างน้อย " : "";
          const spark = P.map((p) => valueOf(m, agg(p, bs)));
          let status: ReactNode = null;
          if (v !== null && vp !== null) {
            const pv2 = isPct ? "" : ` · ${vp.toFixed(1)}%`;
            if (tgt === null) status = isPct ? null : <span className="text-xs text-muted-foreground">{vp.toFixed(2)}% ของยอดขาย</span>;
            else if (k !== "waste" && thin) status = <Tag tone="warn">ตัดสต๊อกแล้วแค่ {Math.round((cur.coverage ?? 0) * 100)}% ของยอดขาย · ยังเทียบเป้าไม่ได้</Tag>;
            else if (vp > tgt) status = <Tag tone="bad">เกินเป้า ≤{tgt}%{pv2}</Tag>;
            else if (pre) status = <Tag tone="warn">ต่ำกว่าเป้าตอนนี้{pv2} · ตัดสต๊อกแล้ว {Math.round((cur.coverage ?? 0) * 100)}%</Tag>;
            else status = <Tag tone="ok">อยู่ในเป้า ≤{tgt}%{pv2}</Tag>;
          }
          let delta: ReactNode = null;
          if (v !== null && sel > 0) {
            if (k !== "waste" && (thin || prevThin)) delta = `เทียบ ${P[sel - 1].label} ไม่ได้ (ตัดสต๊อกไม่ครบ)`;
            else if (pv !== null) {
              // Baht totals of periods with different numbers of sales days are
              // compared per day (Aug has 19 days of data, Sep 26) — rule SI1.
              const perDay = !isPct && prev !== null && cur.salesDays > 0 && prev.salesDays > 0 && cur.salesDays !== prev.salesDays;
              const d = perDay && prev ? v / cur.salesDays - pv / prev.salesDays : v - pv;
              const color = !isPct ? "text-muted-foreground" : d < 0 ? "text-good" : "text-bad";
              delta = (
                <>
                  <b className={color}>
                    {d < 0 ? "▼" : "▲"} {isPct ? `${Math.abs(d).toFixed(Math.abs(d) < 1 ? 2 : 1)} จุด` : `฿${f0(Math.abs(d))}`}
                    {perDay && " ต่อวัน"}
                  </b>{" "}
                  เทียบ {P[sel - 1].label}
                </>
              );
            } else delta = `เทียบ ${P[sel - 1].label} ไม่ได้`;
          }
          return (
            <Tab key={k} on={metric === k} onClick={() => setMetric(k)} title={m.tab} spark={spark} sel={sel}>
              {v === null ? (
                <TabValue muted>{m.why(cur)}</TabValue>
              ) : (
                <TabValue warn={!!pre}>
                  {pre}
                  {fmtV(v)}
                </TabValue>
              )}
              {status}
              {delta && <TabSub>{delta}</TabSub>}
            </Tab>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{metric === "var" ? varName : METRICS[metric].tab}</h3>
          <span className="text-xs text-muted-foreground">
            {metric === "var"
              ? periodic
                ? "ยอดขายไม่ตัดสต๊อก ส่วนที่นับได้น้อยกว่าระบบคือของที่ใช้ไป (ขายและขาดรวมกัน) · รู้ได้ตอนนับสต๊อกเท่านั้น"
                : "นับได้ไม่ตรงกับที่ระบบคำนวณ หลังหักที่บันทึกว่าทิ้งและของเสียแล้ว · รู้ได้ตอนนับสต๊อกเท่านั้น"
              : METRICS[metric].hint}
          </span>
        </div>
        {metric === "var" ? (
          <CountsChart P={P} sel={sel} counts={data.counts.filter((c) => bs.includes(c.branchId))} colorOf={colorOf} nameOf={nameOf} targets={targets} onOpen={openCount} varName={varName} periodic={periodic} />
        ) : (
          <BarChart
            P={P}
            sel={sel}
            onSel={setSel}
            metric={METRICS[metric]}
            metricKey={metric}
            sets={bs}
            colorOf={colorOf}
            nameOf={nameOf}
            isPct={isPct}
            targets={targets}
            valueOf={valueOf}
            fmtV={fmtV}
            periodWord={periodWord}
          />
        )}
      </div>

      {/* Q4–7 */}
      <QLabel n="4–7">ต้องจัดการอะไรก่อน · เรียงตามเงิน</QLabel>
      <Todo
        period={P[sel]}
        cur={cur}
        counts={latestCounts(bs)}
        nameOf={nameOf}
        onCount={openCount}
        missingSales={bs.filter((b) => agg(P[sel], [b]).rev === null).map((b) => nameOf.get(b) ?? "")}
        multi={multi}
        periodic={periodic}
      />

      <div className={`grid gap-5 ${multi ? "lg:grid-cols-2" : ""}`}>
        {multi && (
          <div className="space-y-2">
            <QLabel n="8">สาขาไหนดี สาขาไหนแย่</QLabel>
            <Bench P={P} sel={sel} branches={data.branches} colorOf={colorOf} branch={branch} latestCounts={latestCounts} covGate={covGate} varName={varName} />
          </div>
        )}
        <div className="space-y-2">
          <QLabel n="9">เงินจมในสต๊อก · ของค้างนาน</QLabel>
          <Stock stock={data.stock} bs={bs} view={stockView} setView={setStockView} slowDays={targets.slowDays} branchLabel={branch === "ALL" ? "ทุกสาขา" : nameOf.get(branch) ?? ""} />
        </div>
      </div>

      {/* Q12 */}
      <QLabel n="12">ตัวเลขเชื่อได้แค่ไหน</QLabel>
      <Trust data={data} bs={bs} cur={cur} nameOf={nameOf} periodEnd={periodEnd} />

      <p className="text-xs text-muted-foreground">
        สิ้นเดือนต้องส่งสต๊อกและต้นทุนขายให้นักบัญชี?{" "}
        <a href="/month-end" className="text-primary hover:underline">
          ปิดเดือน · ส่งให้บัญชี
        </a>
      </p>

      {editTargets && (
        <TargetsPopup
          targets={targets}
          onClose={() => setEditTargets(false)}
          onSaved={(t) => {
            setTargets(t);
            setEditTargets(false);
          }}
        />
      )}
    </div>
  );
}

// ── small pieces ────────────────────────────────────────────────────────────

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <span role="group" aria-label={label} className="inline-flex rounded-full border border-border bg-muted p-0.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3 py-0.5 text-xs transition-colors ${value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {l}
        </button>
      ))}
    </span>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`pill inline-flex items-center ${on ? "is-on" : ""}`}
    >
      {children}
    </button>
  );
}

function QLabel({ n, children }: { n: string; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 font-display text-[0.95rem] font-semibold">
      <span className="inline-grid h-[22px] min-w-[34px] place-items-center rounded-full bg-primary px-1.5 text-[0.72rem] text-primary-foreground">{n}</span>
      {children}
    </h3>
  );
}

function Tag({ tone, children }: { tone: "ok" | "bad" | "warn" | "muted"; children: ReactNode }) {
  const cls = { ok: "bg-good-bg text-good", bad: "bg-bad-bg text-bad", warn: "bg-warn-bg text-warn", muted: "bg-muted text-muted-foreground" }[tone];
  return <span className={`inline-block w-fit rounded-full px-2 py-px text-[0.7rem] leading-snug ${cls}`}>{children}</span>;
}

function TabValue({ children, muted, warn }: { children: ReactNode; muted?: boolean; warn?: boolean }) {
  return (
    <span className={`font-display text-xl font-bold tabular-nums ${muted ? "text-base font-medium text-muted-foreground" : warn ? "text-warn" : ""}`}>{children}</span>
  );
}
function TabSub({ children }: { children: ReactNode }) {
  return <span className="text-[0.72rem] text-muted-foreground">{children}</span>;
}

function Tab({
  on,
  onClick,
  title,
  tip,
  spark,
  sel,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  tip?: string;
  spark: (number | null)[];
  sel: number;
  children: ReactNode;
}) {
  const mx = Math.max(1, ...spark.filter((x): x is number => x !== null));
  const n = spark.length;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
        on ? "border-primary bg-surface shadow-card ring-1 ring-primary-line" : "border-border bg-surface hover:-translate-y-0.5 hover:border-border-strong"
      }`}
    >
      <span className="text-xs text-muted-foreground" title={tip}>
        {title}
        {tip && (
          <span className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full border border-border text-[10px]" aria-label={tip}>
            ?
          </span>
        )}
      </span>
      {children}
      <svg className="mt-auto" width="100%" height="26" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden>
        {spark.map((x, i) =>
          x === null ? (
            <rect key={i} x={(i / n) * 100} y={22} width={80 / n} height={2} fill="var(--border, #E3DBBB)" />
          ) : (
            <rect
              key={i}
              x={(i / n) * 100}
              y={24 - (x / mx) * 22}
              width={80 / n}
              height={Math.max(2, (x / mx) * 22)}
              rx={1.5}
              fill={i === sel ? CLAY : on ? TONES.olive[0] : TONES.sage[0]}
            />
          )
        )}
      </svg>
    </button>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// ── the trend chart ─────────────────────────────────────────────────────────

function BarChart({
  P,
  sel,
  onSel,
  metric,
  metricKey,
  sets: all,
  colorOf,
  nameOf,
  isPct,
  targets,
  valueOf,
  fmtV,
  periodWord,
}: {
  P: CostPeriod[];
  sel: number;
  onSel: (i: number) => void;
  metric: Metric;
  metricKey: MetricKey;
  sets: string[];
  colorOf: Map<string, string>;
  nameOf: Map<string, string>;
  isPct: boolean;
  targets: CostTargets;
  valueOf: (m: Metric, a: Agg) => number | null;
  fmtV: (v: number) => string;
  periodWord: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // A branch with nothing in the whole range gets one line of text, not a row of empty bars.
  const sets = all.filter((b) => P.some((p) => valueOf(metric, agg(p, [b])) !== null));
  const silent = all.filter((b) => !sets.includes(b));
  const W = Math.max(360, width);
  const H = 250, L = 58, B = 34, Tp = 20;
  const n = P.length;
  const slot = (W - L) / n;
  const bw = Math.min(30, slot * (sets.length > 1 ? 0.28 : 0.42));
  const tgt = metric.target?.(targets) ?? null;
  const tgtOf = (i: number, b: string) => (tgt === null ? null : isPct ? tgt : ((agg(P[i], [b]).rev ?? 0) * tgt) / 100);
  const vals = sets.map((b) => P.map((p) => valueOf(metric, agg(p, [b]))));
  const mx =
    Math.max(1, ...vals.flat().filter((v): v is number => v !== null), isPct && tgt !== null ? tgt : 0, ...(isPct ? [] : sets.flatMap((b) => P.map((_, i) => tgtOf(i, b) ?? 0)))) * 1.18;
  const y = (v: number) => Tp + (H - Tp - B) * (1 - v / mx);
  const cx = (i: number) => L + slot * (i + 0.5);
  const bx = (i: number, j: number) => cx(i) + (j - (sets.length - 1) / 2) * (bw + 5) - bw / 2;
  const thinOf = (i: number, b: string) => {
    const c = agg(P[i], [b]).coverage;
    return metricKey !== "waste" && c !== null && c < targets.coverageMin;
  };

  if (sets.length === 0) {
    return (
      <div ref={ref} className="py-10 text-center text-sm text-muted-foreground">
        {all.map((b) => nameOf.get(b)).join(" และ ")}ยังไม่มีข้อมูลสำหรับตัวนี้ในช่วงที่แสดง
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <svg width={W} height={H} className="block overflow-visible" key={`${metricKey}-${isPct}-${P[0]?.key}-${all.join()}`}>
        <defs>
          <pattern id="co-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#F1ECD6" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#CFC6A0" strokeWidth="2" />
          </pattern>
          {sets.map((b) => (
            <linearGradient key={b} id={`co-g-${b}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={colorOf.get(b)} />
              <stop offset="1" stopColor={colorOf.get(b)} stopOpacity={0.55} />
            </linearGradient>
          ))}
        </defs>
        {[0, 1, 2, 3, 4].map((t) => {
          const v = (mx / 4) * t;
          return (
            <g key={t}>
              <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="#ECE6CC" />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#5A5C31">
                {isPct ? `${v.toFixed(v > 0 && v < 1 ? 1 : 0)}%` : `฿${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : f0(v)}`}
              </text>
            </g>
          );
        })}
        {isPct && tgt !== null && (
          <g>
            <rect x={L} width={W - L} y={Tp} height={Math.max(0, y(tgt) - Tp)} fill={BAD} opacity={0.05} />
            <line x1={L} x2={W} y1={y(tgt)} y2={y(tgt)} stroke={BAD} strokeDasharray="6 4" strokeWidth={1.5} />
            <rect x={L - 46} y={y(tgt) - 9} width={42} height={18} rx={9} fill={BAD} />
            <text x={L - 25} y={y(tgt) + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#fff">
              เป้า {tgt}
            </text>
          </g>
        )}
        <rect x={L + slot * sel + 3} y={Tp - 8} width={slot - 6} height={H - Tp - B + 8} rx={10} fill={CLAY} opacity={0.09} />
        {hover !== null && hover !== sel && <rect x={L + slot * hover + 3} y={Tp - 8} width={slot - 6} height={H - Tp - B + 8} rx={10} fill="#262811" opacity={0.05} />}
        {sets.map((b, j) =>
          vals[j].map((v, i) => {
            const X = bx(i, j);
            const a = agg(P[i], [b]);
            if (v === null) {
              const why = metric.why(a);
              return (
                <g key={`${b}-${i}`}>
                  <rect x={X} width={bw} y={y(mx * 0.2)} height={y(0) - y(mx * 0.2)} rx={5} fill="url(#co-hatch)" stroke="#CFC6A0" />
                  {(sets.length === 1 || i === sel) && (
                    <text x={X + bw / 2} y={y(mx * 0.2) - 5} textAnchor="middle" fontSize={9.5} fill="#8B8D63">
                      {why.replace("ยังไม่มีค่าแรง ", "ไม่มีค่าแรง ")}
                    </text>
                  )}
                </g>
              );
            }
            const h = y(0) - y(v);
            const tg = tgtOf(i, b);
            const over = tg !== null && v > tg;
            if (thinOf(i, b)) {
              return (
                <g key={`${b}-${i}`}>
                  <rect x={X} width={bw} y={y(v)} height={h} rx={5} fill="url(#co-hatch)" stroke={colorOf.get(b)} strokeWidth={1.5} strokeDasharray="4 3" />
                  <text x={X + bw / 2} y={y(v) - 18} textAnchor="middle" fontSize={9.5} fill="#9A6A0F">
                    ตัดสต๊อก {Math.round((a.coverage ?? 0) * 100)}%
                  </text>
                  {i === sel && (
                    <text x={X + bw / 2} y={y(v) - 6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#262811">
                      อย่างน้อย {fmtV(v)}
                    </text>
                  )}
                </g>
              );
            }
            return (
              <g key={`${b}-${i}`}>
                <rect
                  x={X}
                  width={bw}
                  y={y(v)}
                  height={h}
                  rx={5}
                  fill={`url(#co-g-${b})`}
                  style={{ transformOrigin: `${X}px ${y(0)}px`, animation: `co-rise .55s cubic-bezier(.2,.8,.2,1) ${i * 35 + j * 20}ms both` }}
                />
                {over && tg !== null && <rect x={X} width={bw} y={y(v)} height={Math.max(0, y(tg) - y(v))} rx={5} fill={BAD} opacity={0.55} />}
                {tg !== null && !isPct && <line x1={X - 3} x2={X + bw + 3} y1={y(tg)} y2={y(tg)} stroke={BAD} strokeWidth={2} />}
                {i === sel && (
                  <text x={X + bw / 2} y={y(v) - 6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#262811">
                    {metric.bound(a) ? "≥" : ""}
                    {fmtV(v)}
                  </text>
                )}
              </g>
            );
          })
        )}
        {P.map((p, i) => (
          <g key={p.key}>
            <text x={cx(i)} y={H - 14} textAnchor="middle" fontSize={10.5} fill={i === sel ? CLAY : "#5A5C31"} fontWeight={i === sel ? 700 : 400}>
              {p.label}
            </text>
            <rect
              x={L + slot * i}
              y={0}
              width={slot}
              height={H}
              fill="transparent"
              className="cursor-pointer outline-none"
              tabIndex={0}
              role="button"
              aria-label={`${periodWord}${p.label}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onSel(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSel(i);
                }
              }}
            />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1.5 z-10 w-60 animate-fade-in rounded-xl bg-[#262811] px-3 py-2 text-xs text-white shadow-card"
          style={{ left: cx(hover) > W / 2 ? Math.max(8, cx(hover) - slot / 2 - 250) : Math.min(cx(hover) + slot / 2 + 8, W - 250) }}
        >
          <b>
            {periodWord}
            {P[hover].label}
          </b>
          {all.map((b) => {
            const a = agg(P[hover], [b]);
            const v = valueOf(metric, a);
            const pa = hover > 0 ? agg(P[hover - 1], [b]) : null;
            const pv = pa ? valueOf(metric, pa) : null;
            const perDay = !isPct && pa !== null && a.salesDays > 0 && pa.salesDays > 0 && a.salesDays !== pa.salesDays;
            const d = v !== null && pv !== null ? (perDay && pa ? v / a.salesDays - pv / pa.salesDays : v - pv) : null;
            return (
              <div key={b} className="mt-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-2 w-2 rounded-full" style={{ background: colorOf.get(b) }} />
                  {nameOf.get(b)}
                </span>
                <b>{v === null ? metric.why(a) : `${metric.bound(a) ? "อย่างน้อย " : ""}${fmtV(v)}`}</b>
                {d !== null && (
                  <em className="not-italic" style={{ color: !isPct ? "inherit" : d < 0 ? "#B7CF7C" : "#EC9C80" }}>
                    {d < 0 ? "▼" : "▲"}
                    {isPct ? `${Math.abs(d).toFixed(1)}จุด` : `฿${f0(Math.abs(d))}${perDay ? "/วัน" : ""}`}
                  </em>
                )}
              </div>
            );
          })}
          {(() => {
            const a = agg(P[hover], all);
            return a.rev !== null && a.coverage !== null ? (
              <div className="mt-1 opacity-75">
                ตัดสต๊อก {a.daysPosted}/{a.salesDays} วัน · {Math.round(a.coverage * 100)}% ของยอดขาย
              </div>
            ) : null;
          })()}
          <div className="opacity-75">กดเพื่อดูช่วงนี้ทั้งหน้า</div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {sets.map((b) => (
          <span key={b} className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf.get(b) }} />
            {nameOf.get(b)}
          </span>
        ))}
        {silent.map((b) => (
          <span key={b}>{nameOf.get(b)}: ยังไม่มีข้อมูลตัวนี้ในช่วงที่แสดง</span>
        ))}
        {tgt !== null && (
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BAD }} />
            {isPct ? "เส้นประแดง = เป้าของร้าน" : "ขีดแดงบนแท่ง = เป้าของร้าน (เป้า % × ยอดขายช่วงนั้น)"} · ส่วนสีแดงบนแท่ง = เกินเป้า
          </span>
        )}
        {metricKey !== "waste" && (
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-border-strong" />
            แท่งลาย = ตัดสต๊อกไม่ถึง {Math.round(targets.coverageMin * 100)}% ของยอดขาย ตัวเลขยังต่ำกว่าจริง
          </span>
        )}
        <span>ชี้ = ดูตัวเลข · กด = เลือกช่วงนั้น</span>
      </div>
      <style>{`@keyframes co-rise{from{transform:scaleY(0)}to{transform:scaleY(1)}}`}</style>
    </div>
  );
}

function CountsChart({
  P,
  sel,
  counts,
  colorOf,
  nameOf,
  targets,
  onOpen,
  varName,
  periodic,
}: {
  P: CostPeriod[];
  sel: number;
  counts: CountEvent[];
  colorOf: Map<string, string>;
  nameOf: Map<string, string>;
  targets: CostTargets;
  onOpen: (c: CountEvent) => void;
  varName: string;
  periodic: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<CountEvent | null>(null);
  const W = Math.max(360, width);
  const H = 250, L = 58, B = 34, Tp = 26;
  const n = P.length;
  const slot = (W - L) / n;
  const pos = (c: CountEvent) => P.findIndex((p) => c.date >= p.from && c.date <= p.to);
  const cs = counts.filter((c) => pos(c) >= 0);
  const mx = Math.max(1, ...cs.map((c) => c.value)) * 1.25;
  const y = (v: number) => Tp + (H - Tp - B) * (1 - v / mx);
  const branchIds = [...new Set(cs.map((c) => c.branchId))];
  const xOf = (c: CountEvent) => L + slot * (pos(c) + 0.5) + (branchIds.length > 1 ? (branchIds.indexOf(c.branchId) - (branchIds.length - 1) / 2) * 16 : 0);

  return (
    <div ref={ref} className="relative">
      <svg width={W} height={H} className="block overflow-visible">
        <defs>
          <pattern id="co-hatch2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#F6F2E2" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#E3DBBB" strokeWidth="2" />
          </pattern>
        </defs>
        {[0, 1, 2, 3, 4].map((t) => {
          const v = (mx / 4) * t;
          return (
            <g key={t}>
              <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="#ECE6CC" />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#5A5C31">
                ฿{v >= 1000 ? `${(v / 1000).toFixed(0)}K` : f0(v)}
              </text>
            </g>
          );
        })}
        {P.map((p, i) => (
          <g key={p.key}>
            {!cs.some((c) => pos(c) === i) && (
              <>
                <rect x={L + slot * i + 2} y={Tp} width={slot - 4} height={H - Tp - B} fill="url(#co-hatch2)" rx={8} />
                <text x={L + slot * (i + 0.5)} y={H - B - 8} textAnchor="middle" fontSize={9.5} fill="#8B8D63">
                  ไม่ได้นับ
                </text>
              </>
            )}
            <text x={L + slot * (i + 0.5)} y={H - 14} textAnchor="middle" fontSize={10.5} fill={i === sel ? CLAY : "#5A5C31"} fontWeight={i === sel ? 700 : 400}>
              {p.label}
            </text>
          </g>
        ))}
        <rect x={L + slot * sel + 2} y={Tp - 6} width={slot - 4} height={H - Tp - B + 6} rx={10} fill={CLAY} opacity={0.07} />
        {branchIds.map((b) => {
          const pts = cs.filter((c) => c.branchId === b);
          return pts.length > 1 ? (
            <polyline key={b} points={pts.map((c) => `${xOf(c)},${y(c.value)}`).join(" ")} fill="none" stroke={colorOf.get(b)} strokeWidth={1.6} opacity={0.45} />
          ) : null;
        })}
        {cs.map((c, idx) => {
          const X = xOf(c);
          const r = 7 + Math.sqrt(c.value / mx) * 18;
          return (
            <g
              key={c.countId}
              className="cursor-pointer outline-none"
              tabIndex={0}
              role="button"
              aria-label={`${nameOf.get(c.branchId)} นับ ${c.dateLabel} ${varName} ฿${f0(c.value)}`}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(c)}
              onBlur={() => setHover(null)}
              onClick={() => onOpen(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(c);
                }
              }}
            >
              <circle
                cx={X}
                cy={y(c.value)}
                r={r}
                fill={colorOf.get(c.branchId)}
                opacity={0.88}
                style={{ transformOrigin: `${X}px ${y(c.value)}px`, animation: `co-pop .45s cubic-bezier(.2,.8,.2,1) ${idx * 60}ms both` }}
              />
              <text x={X} y={y(c.value) - r - 5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#262811">
                ฿{f0(c.value)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute top-1.5 z-10 w-64 animate-fade-in rounded-xl bg-[#262811] px-3 py-2 text-xs text-white shadow-card"
          style={{ left: Math.min(Math.max(8, xOf(hover) - 120), W - 260) }}
        >
          <b>
            {nameOf.get(hover.branchId)} · นับ {hover.dateLabel}
          </b>
          <div className="mt-1 flex justify-between gap-2">
            <span>{varName}</span>
            <b>฿{f2(hover.value)}</b>
          </div>
          {hover.sinceRevenue && (
            <div className="flex justify-between gap-2">
              <span>% ของยอดขาย{hover.sinceLabel}</span>
              <b className="whitespace-nowrap">
                {((hover.value / hover.sinceRevenue) * 100).toFixed(2)}%{!periodic && ` (เป้า ≤${targets.variance}%)`}
              </b>
            </div>
          )}
          <div className="mt-1 opacity-75">{periodic ? "กดเพื่อเปิดใบนับ" : "กดเพื่อเปิดหน้าของหายไปไหน"}</div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {branchIds.map((b) => (
          <span key={b} className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf.get(b) }} />
            {nameOf.get(b)}
          </span>
        ))}
        <span>ลายเส้น = ช่วงที่ไม่ได้นับ (ไม่รู้ ไม่ใช่ ฿0) · จุด = การนับแต่ละครั้ง {periodic ? "กดเพื่อดูใบนับ" : "กดเพื่อดูว่าอะไรไม่ตรง"}</span>
      </div>
      <style>{`@keyframes co-pop{from{transform:scale(0)}to{transform:scale(1)}}`}</style>
    </div>
  );
}

// ── Q4–7 ────────────────────────────────────────────────────────────────────

type TodoItem = { type: string; tone: "bad" | "warn" | "muted"; title: string; detail: string; money: number; href?: string; dest: string; count?: CountEvent };

function Todo({
  period,
  cur,
  counts,
  nameOf,
  onCount,
  missingSales,
  multi,
  periodic,
}: {
  period: CostPeriod | undefined;
  cur: Agg;
  counts: CountEvent[];
  nameOf: Map<string, string>;
  onCount: (c: CountEvent) => void;
  missingSales: string[];
  multi: boolean;
  /** นับสต๊อก: a count's shortfall is usage, not something to go and fix. */
  periodic: boolean;
}) {
  const items: TodoItem[] = [];
  for (const c of periodic ? [] : counts) {
    for (const it of c.items.slice(0, 3)) {
      if (it.value <= 0) continue;
      items.push({
        type: "ไม่ตรงกับระบบ",
        tone: "bad",
        title: `${it.name} นับได้น้อยกว่าระบบ ${it.qty.replace("−", "")}`,
        detail: `${nameOf.get(c.branchId)} · นับ ${c.dateLabel} · หักที่บันทึกทิ้งและของเสียแล้ว`,
        money: it.value,
        dest: "ดูรายการ",
        count: c,
      });
    }
  }
  for (const p of period?.priceUp.slice(0, 3) ?? []) {
    items.push({ type: "ราคาขึ้น", tone: "warn", title: `${p.name} ขึ้น ${p.changePct}%`, detail: `${p.detail} · ${period?.label} จ่ายเพิ่ม (ทั้งร้าน)`, money: p.extra, href: "/cost/prices", dest: "ไปที่ การผันผวนราคาวัตถุดิบ" });
  }
  if (cur.rev !== null && cur.waste > 0) {
    items.push({ type: "ทิ้ง", tone: "muted", title: "ของที่บันทึกว่าทิ้ง", detail: period?.label ?? "", money: cur.waste, href: "/waste", dest: "ไปที่ ของเสีย" });
  }
  items.sort((a, b) => b.money - a.money);
  const shown = items.slice(0, 6);
  const mx = Math.max(1, ...shown.map((i) => i.money));

  const gaps: ReactNode[] = [];
  if (cur.rev !== null && cur.coverage !== null && cur.coverage < FULL)
    gaps.push(
      <>
        ตัดสต๊อกยังไม่ครบ ({cur.daysPosted}/{cur.salesDays} วัน · {Math.round(cur.coverage * 100)}% ของยอดขาย) — ต้นทุนช่วงนี้จึงเป็น “อย่างน้อย” ·{" "}
        <a className="text-primary hover:underline" href="/consumption">
          ไปตัดสต๊อก ›
        </a>
      </>
    );
  if (cur.rev !== null && cur.labor === null)
    gaps.push(
      <>
        {cur.laborMissing ?? "ยังไม่มีค่าแรง"} — prime cost คิดไม่ได้ ·{" "}
        <a className="text-primary hover:underline" href="/expenses/new">
          บันทึกเงินเดือนในค่าใช้จ่าย หมวดค่าแรง ›
        </a>
      </>
    );
  if (multi && missingSales.length)
    gaps.push(
      <>
        {missingSales.join(", ")} ยังไม่มีไฟล์ยอดขายในช่วงนี้ — เทียบสาขาไม่ได้ ·{" "}
        <a className="text-primary hover:underline" href="/sales/import">
          นำเข้ายอดขาย ›
        </a>
      </>
    );

  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      {shown.length === 0 ? (
        <p className="px-1 py-3 text-sm text-muted-foreground">ช่วงนี้ยังไม่มีเรื่องที่เป็นเงิน — ยังไม่ได้นับสต๊อก ไม่มีราคาที่ขึ้น และไม่มีของที่บันทึกว่าทิ้ง</p>
      ) : (
        <div className="grid gap-1.5">
          {shown.map((it, i) => {
            const body = (
              <>
                <Tag tone={it.tone}>{it.type}</Tag>
                <div className="grid min-w-0 gap-0.5">
                  <b className="truncate text-sm">{it.title}</b>
                  <span className="text-xs text-muted-foreground">
                    {it.detail} · <span className="text-primary">{it.dest}</span>
                  </span>
                  <span className="block h-[5px] overflow-hidden rounded-full bg-muted">
                    <i
                      className="block h-full origin-left animate-grow-x rounded-full"
                      style={{ width: `${(it.money / mx) * 100}%`, background: "linear-gradient(90deg,#E8A76F,#C0692B)", animationDelay: `${i * 50}ms` }}
                    />
                  </span>
                </div>
                <span className="text-right font-display text-base font-bold tabular-nums">฿{f0(it.money)}</span>
              </>
            );
            const cls =
              "grid grid-cols-[96px_minmax(0,1fr)_96px] items-center gap-3 rounded-2xl border border-border bg-surface px-2.5 py-2 text-left transition-all hover:translate-x-0.5 hover:border-border-strong hover:shadow-card";
            return it.count ? (
              <button key={i} type="button" className={cls} onClick={() => onCount(it.count!)}>
                {body}
              </button>
            ) : (
              <a key={i} href={it.href} className={cls}>
                {body}
              </a>
            );
          })}
        </div>
      )}
      {period && period.priceDown.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          ราคาที่ลดลง: {period.priceDown.map((p) => `${p.name} ถูกลง ${Math.abs(p.changePct)}% (ประหยัด ฿${f0(-p.extra)})`).join(" · ")}
        </p>
      )}
      {gaps.length > 0 && (
        <div className="mt-2.5 rounded-xl border border-warn-border bg-warn-bg px-3 py-2 text-sm">
          <b>ข้อมูลยังไม่ครบ ตัวเลขข้างบนจึงอาจยังไม่เต็ม</b>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Q8 ──────────────────────────────────────────────────────────────────────

function Bench({
  P,
  sel,
  branches,
  colorOf,
  branch,
  latestCounts,
  covGate,
  varName,
}: {
  P: CostPeriod[];
  sel: number;
  branches: Overview["branches"];
  colorOf: Map<string, string>;
  branch: string;
  latestCounts: (ids: string[]) => CountEvent[];
  covGate: number;
  varName: string;
}) {
  type Row = { key: string; label: string; val: (b: string) => number | null; fmt: (v: number) => string; why: (b: string) => string; cost: boolean };
  const a = (b: string) => agg(P[sel], [b]);
  const rows: Row[] = [
    { key: "prime", label: "Prime cost %", val: (b) => pctOf(METRICS.prime.baht(a(b)), a(b).rev), fmt: (v) => `${v.toFixed(1)}%`, why: (b) => METRICS.prime.why(a(b)), cost: true },
    { key: "food", label: "ต้นทุนอาหาร %", val: (b) => pctOf(METRICS.food.baht(a(b)), a(b).rev), fmt: (v) => `${v.toFixed(1)}%`, why: (b) => METRICS.food.why(a(b)), cost: true },
    {
      key: "var",
      label: `${varName} % ของยอดขาย (นับล่าสุด)`,
      val: (b) => {
        const c = latestCounts([b])[0];
        return c && c.sinceRevenue ? (c.value / c.sinceRevenue) * 100 : null;
      },
      fmt: (v) => `${v.toFixed(2)}%`,
      why: (b) => (latestCounts([b]).length ? "ยังเทียบยอดขายไม่ได้" : "ยังไม่ได้นับ"),
      cost: false,
    },
    { key: "waste", label: "ทิ้ง % ของยอดขาย", val: (b) => pctOf(a(b).rev === null ? null : a(b).waste, a(b).rev), fmt: (v) => `${v.toFixed(2)}%`, why: () => "ไม่มียอดขาย", cost: false },
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface p-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="py-1 text-left font-normal">ตัวชี้วัด · {P[sel]?.label}</th>
            {branches.map((b) => (
              <th key={b.id} className="px-2 py-1 text-center font-normal">
                <i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorOf.get(b.id) }} />
                {b.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const vs = branches.map((b) => {
              const thin = r.cost && (a(b.id).coverage ?? 1) < covGate;
              return { id: b.id, v: r.val(b.id), thin };
            });
            const comparable = vs.filter((x) => x.v !== null && !x.thin);
            const best = comparable.length > 1 ? comparable.reduce((p, q) => ((q.v ?? 0) < (p.v ?? 0) ? q : p)).id : null;
            return (
              <tr key={r.key}>
                <td className="py-1.5 pr-2">{r.label}</td>
                {vs.map((x) => (
                  <td
                    key={x.id}
                    className={`px-2 py-1.5 text-center tabular-nums ${x.id === best ? "bg-warn-bg font-bold" : ""} ${branch !== "ALL" && branch !== x.id ? "opacity-45" : ""}`}
                  >
                    {x.v === null ? (
                      <span className="text-xs text-muted-foreground">{r.why(x.id)}</span>
                    ) : x.thin ? (
                      <>
                        <span className="text-warn">อย่างน้อย {r.fmt(x.v)}</span>
                        <br />
                        <span className="text-xs text-muted-foreground">ตัดสต๊อกแล้ว {Math.round((a(x.id).coverage ?? 0) * 100)}%</span>
                      </>
                    ) : (
                      <>
                        {x.id === best && "★ "}
                        {r.fmt(x.v)}
                      </>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">★ = ดีกว่า (ต่ำกว่า) · เทียบเฉพาะสาขาที่ข้อมูลครบพอ</p>
    </div>
  );
}

// ── Q9 ──────────────────────────────────────────────────────────────────────

function Stock({
  stock,
  bs,
  view,
  setView,
  slowDays,
  branchLabel,
}: {
  stock: Overview["stock"];
  bs: string[];
  view: "age" | "left";
  setView: (v: "age" | "left") => void;
  slowDays: number;
  branchLabel: string;
}) {
  const items: StockItem[] = bs.flatMap((b) => stock[b]?.items ?? []);
  const total = bs.reduce((s, b) => s + (stock[b]?.value ?? 0), 0);
  // One row per product across the chosen branches: the oldest lot wins the age.
  const merged = new Map<string, StockItem>();
  for (const it of items) {
    const m = merged.get(it.productId);
    if (!m) merged.set(it.productId, { ...it });
    else {
      m.value += it.value;
      if ((it.ageDays ?? -1) > (m.ageDays ?? -1)) {
        m.ageDays = it.ageDays;
        m.oldestDate = it.oldestDate;
        m.oldestValue = it.oldestValue;
      }
      m.daysLeft = m.daysLeft === null || it.daysLeft === null ? null : Math.max(m.daysLeft, it.daysLeft);
    }
  }
  const all = [...merged.values()];
  const rows =
    view === "age"
      ? all.filter((i) => i.ageDays !== null).sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0) || b.value - a.value).slice(0, 6)
      : all.filter((i) => i.daysLeft !== null).sort((a, b) => (b.daysLeft ?? 0) - (a.daysLeft ?? 0) || b.value - a.value).slice(0, 6);
  const mx = Math.max(1, ...rows.map((r) => r.value));
  const slow = all.filter((i) => (i.ageDays ?? 0) >= slowDays);
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">มูลค่าของในสต๊อก ณ วันนี้ · {branchLabel}</span>
        <b className="font-display text-xl tabular-nums">฿{f0(total)}</b>
      </div>
      {slow.length > 0 && (
        <p className="mt-1 text-xs text-bad">
          ค้างเกิน {slowDays} วัน {slow.length} รายการ · รวม ฿{f0(slow.reduce((s, i) => s + i.value, 0))}
        </p>
      )}
      <div className="mt-2 flex justify-end">
        <Seg value={view} onChange={setView} options={[["age", "ค้างมากี่วัน"], ["left", "อีกกี่วันจะใช้หมด"]]} label="มุมมองสต๊อก" />
      </div>
      <p className="mb-1 mt-2 text-xs text-muted-foreground">
        {view === "age" ? (
          <span title="นับจากวันรับล็อตเก่าสุดที่ยังเหลือ (ระบบใช้ของตามลำดับเข้าก่อนออกก่อน) · ของที่ค้างนานเสี่ยงเสื่อมและเป็นเงินที่จมอยู่">
            ของเก่าสุดที่ยังอยู่ในสต๊อก ซื้อมากี่วันแล้ว (ตัวแดง = เกิน {slowDays} วัน) ⓘ
          </span>
        ) : (
          <span title="คงเหลือ ÷ ใช้ต่อวัน (เฉลี่ยจากวันที่ตัดสต๊อกตามยอดขายแล้ว)">ถ้าใช้เท่าที่ผ่านมา อีกกี่วันจะใช้หมด ⓘ</span>
        )}
      </p>
      {rows.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{view === "age" ? "ไม่มีของในสต๊อก" : "ยังไม่รู้อัตราใช้ — ต้องตัดสต๊อกตามยอดขายก่อน"}</p>
      ) : (
        rows.map((s, i) => (
          <div key={s.productId} className="py-1" title={view === "age" && s.oldestDate ? `${s.name} · ล็อตรับ ${s.oldestDate} ยังเหลือ ฿${f0(s.oldestValue)} · ทั้งหมดในสต๊อก ฿${f0(s.value)}` : undefined}>
            <div className="grid grid-cols-[110px_minmax(0,1fr)_80px_56px] items-center gap-2.5 text-sm">
              <a href={`/products?product=${s.productId}`} className="truncate hover:text-primary hover:underline">
                {s.name}
              </a>
              <span className="block h-[5px] overflow-hidden rounded-full bg-muted">
                <i
                  className="block h-full origin-left animate-grow-x rounded-full"
                  style={{ width: `${(s.value / mx) * 100}%`, background: "linear-gradient(90deg,#9DAA55,#5E6B14)", animationDelay: `${i * 40}ms` }}
                />
              </span>
              <span className="text-right tabular-nums">฿{f0(s.value)}</span>
              <span className={`text-right tabular-nums ${view === "age" && (s.ageDays ?? 0) >= slowDays ? "font-semibold text-bad" : "text-muted-foreground"}`}>
                {view === "age" ? s.ageDays : s.daysLeft} วัน
              </span>
            </div>
            {view === "age" && s.oldestDate && (
              <div className="pl-[120px] text-[0.72rem] text-muted-foreground">
                รับ {s.oldestDate} · จากล็อตนั้นยังเหลือ ฿{f0(s.oldestValue)}
              </div>
            )}
          </div>
        ))
      )}
      <a href="/products?sort=value" className="mt-1 inline-block text-xs text-primary hover:underline">
        ดูทั้งหมดที่หน้าสินค้า/วัตถุดิบ ›
      </a>
    </div>
  );
}

// ── Q12 ─────────────────────────────────────────────────────────────────────

function Trust({ data, bs, cur, nameOf, periodEnd }: { data: Overview; bs: string[]; cur: Agg; nameOf: Map<string, string>; periodEnd: string }) {
  const chips: [tone: "ok" | "warn" | "bad", label: string, value: string][] = [];
  for (const b of bs) {
    const c = data.counts.filter((x) => x.branchId === b && x.date <= periodEnd).at(-1);
    const later = data.counts.find((x) => x.branchId === b && x.date > periodEnd);
    chips.push([c ? "ok" : "bad", `${nameOf.get(b)} นับสต๊อกล่าสุด`, c ? c.dateLabel : later ? `ยังไม่ได้นับถึงช่วงนี้ (ครั้งแรก ${later.dateLabel})` : "ยังไม่เคยนับ"]);
  }
  if (cur.rev !== null && cur.coverage !== null)
    chips.push([cur.coverage >= FULL ? "ok" : "warn", "ตัดสต๊อกตามยอดขาย", `${cur.daysPosted}/${cur.salesDays} วัน · ${Math.round(cur.coverage * 100)}% ของยอดขาย`]);
  if (data.method === "PERIODIC_INVENTORY") chips.push(["ok", "วิธีคิดต้นทุน", "นับสต๊อก (ต้นงวด + ซื้อ − ปลายงวด) · แม่นเท่าที่นับ"]);
  if (cur.rev !== null) chips.push([cur.labor === null ? "bad" : "ok", "ค่าแรง", cur.labor === null ? cur.laborMissing ?? "ยังไม่มี" : "มีแล้ว"]);
  const dot = { ok: "bg-good", warn: "bg-warn", bad: "bg-bad" };
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(([t, l, v], i) => (
        <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs">
          <i className={`h-2 w-2 rounded-full ${dot[t]}`} />
          {l}: <b>{v}</b>
        </span>
      ))}
    </div>
  );
}

// ── popups ──────────────────────────────────────────────────────────────────

function TargetsPopup({ targets, onClose, onSaved }: { targets: CostTargets; onClose: () => void; onSaved: (t: CostTargets) => void }) {
  const [v, setV] = useState({
    food: String(targets.food),
    prime: String(targets.prime),
    variance: String(targets.variance),
    coverageMin: String(Math.round(targets.coverageMin * 100)),
    slowDays: String(targets.slowDays),
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (k: keyof typeof v, label: ReactNode, suffix: string, step = "1") => (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      {label}
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
        className="input w-20 text-right"
      />
      {suffix}
    </label>
  );
  const save = async () => {
    setBusy(true);
    setErr(null);
    const t = {
      food: Number(v.food),
      prime: Number(v.prime),
      variance: Number(v.variance),
      coverageMin: Number(v.coverageMin),
      slowDays: Number(v.slowDays),
    };
    const res = await orStale(saveCostTargetsAction(t));
    setBusy(false);
    if (!res.ok) return setErr(res.formError ?? "บันทึกไม่สำเร็จ");
    onSaved({ ...t, coverageMin: t.coverageMin / 100 });
  };
  return (
    <ModalShell onClose={onClose} labelledBy="co-targets-title" narrow>
      <h3 id="co-targets-title" className="pr-10 text-lg font-semibold">
        เป้าของร้าน
      </h3>
      <p className="mt-0.5 text-sm text-muted-foreground">ค่าเริ่มต้นจากเกณฑ์ร้านอาหารทั่วไป · ใช้ทุกสาขา · แก้ได้อีกที่ ตั้งค่าร้าน</p>
      <div className="mt-4 space-y-3">
        {field("food", "ต้นทุนอาหาร ไม่เกิน", "% ของยอดขาย", "0.5")}
        {field("prime", "Prime cost (อาหาร + ค่าแรง) ไม่เกิน", "%", "0.5")}
        {field("variance", "ไม่ตรงกับระบบ ไม่เกิน", "% ของยอดขาย", "0.1")}
        <hr className="border-border" />
        {field("coverageMin", "เทียบกับเป้าเมื่อตัดสต๊อกแล้วอย่างน้อย", "% ของยอดขาย")}
        <p className="-mt-1 text-xs text-muted-foreground">ต่ำกว่านี้ ต้นทุนยังไม่ครบ ตัวเลขจะดูดีเกินจริง ระบบจึงไม่บอกว่าอยู่ในเป้า</p>
        {field("slowDays", "ของค้างนาน เมื่อเก่ากว่า", "วัน")}
      </div>
      {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          ยกเลิก
        </button>
        <button type="button" className="btn" disabled={busy} onClick={save}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </ModalShell>
  );
}

"use client";

// ============================================================
// Mise — A against B (Kong's questions 2 and 3, 2026-09-28)
// ============================================================
// "เดือนนี้กับเดือนที่แล้ว พฤติกรรมลูกค้าเปลี่ยนไปยังไง" and "เทียบเสาร์ที่ 29
// กับเสาร์ที่ 15". Each side is a date range, optionally narrowed to some
// weekdays — which covers a month, one day, "Saturdays in August" and
// "weekdays against weekends" with one shape.
//
// EVERYTHING IS PER DAY (rule SI1). August had 19 days of data and September
// 26; set side by side in totals August looks a third smaller when it was the
// better month. Each side says how many days it averaged over.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { TONES } from "@/components/charts/chart-theme";
import { METRIC_LABELS_TH, type CompareSide, type Metric, type PeriodStats } from "@/lib/sales-insight";
import type { CompareResult } from "../insight-reads";
import { readApi } from "@/lib/read-api";
import { ActionError, STALE_TAB_MESSAGE } from "./Breakdown";
import { ModalShell, baht, fmtMetric, type ToneMap } from "./Breakdown";
import { useMenuInsight } from "./insight-context";

type MonthOpt = { key: string; label: string; from: string; to: string };
const WEEKDAY_SHORT = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

function labelOf(s: Omit<CompareSide, "label">, months: MonthOpt[]): string {
  const m = months.find((x) => x.from === s.from && x.to === s.to);
  const range = s.from === s.to ? fmtDate(s.from) : m ? m.label : `${fmtDate(s.from)} – ${fmtDate(s.to)}`;
  if (!s.weekdays || s.weekdays.length === 7) return range;
  const w = s.weekdays.slice().sort().join();
  const name =
    w === WEEKDAYS.slice().sort().join() ? "จ.–ศ." : w === WEEKEND.slice().sort().join() ? "ส.–อา." : s.weekdays.map((d) => WEEKDAY_SHORT[d]).join(" ");
  return `${name} ${range}`;
}

export default function CompareButton({
  months,
  from,
  to,
  branchId,
  by,
  tones,
  canProfit,
}: {
  months: MonthOpt[];
  from: string;
  to: string;
  branchId?: string;
  by: Metric;
  tones: ToneMap;
  /** False for someone who may not see cost — profit is not offered (rule A8). */
  canProfit: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-deep"
      >
        <span aria-hidden>⇄</span> เปรียบเทียบ
      </button>
      {open && (
        <CompareModal months={months} from={from} to={to} branchId={branchId} by={by} tones={tones} canProfit={canProfit} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function CompareModal({
  months,
  from,
  to,
  branchId,
  by: initialBy,
  tones,
  canProfit,
  onClose,
}: {
  months: MonthOpt[];
  from: string;
  to: string;
  branchId?: string;
  by: Metric;
  tones: ToneMap;
  canProfit: boolean;
  onClose: () => void;
}) {
  const thisMonth = months[months.length - 1];
  const lastMonth = months[months.length - 2] ?? thisMonth;
  const presets: { label: string; a: Omit<CompareSide, "label">; b: Omit<CompareSide, "label"> }[] = [
    { label: "เดือนนี้ vs เดือนก่อน", a: { ...span(thisMonth), weekdays: null }, b: { ...span(lastMonth), weekdays: null } },
    { label: "เสาร์–อาทิตย์ vs จันทร์–ศุกร์", a: { from, to, weekdays: WEEKEND }, b: { from, to, weekdays: WEEKDAYS } },
    { label: "วันเสาร์ เดือนนี้ vs เดือนก่อน", a: { ...span(thisMonth), weekdays: [6] }, b: { ...span(lastMonth), weekdays: [6] } },
    { label: "วันธรรมดา เดือนนี้ vs เดือนก่อน", a: { ...span(thisMonth), weekdays: WEEKDAYS }, b: { ...span(lastMonth), weekdays: WEEKDAYS } },
  ];
  const [a, setA] = useState(presets[0].a);
  const [b, setB] = useState(presets[0].b);
  const [by, setBy] = useState<Metric>(initialBy);
  const [res, setRes] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    (sa: typeof a, sb: typeof b, m: Metric) => {
      setBusy(true);
      readApi<CompareResult>("/api/sales", "compare", {
        a: { ...sa, label: labelOf(sa, months) },
        b: { ...sb, label: labelOf(sb, months) },
        branchId,
        by: m,
      })
        // `undefined` = the server no longer has this action (a tab older than
        // the app) — same answer as a throw: ask for a refresh.
        .then((r) => setRes(r ?? { ok: false, formError: STALE_TAB_MESSAGE, stale: true }))
        .catch(() => setRes({ ok: false, formError: STALE_TAB_MESSAGE, stale: true }))
        .finally(() => setBusy(false));
    },
    [branchId, months]
  );
  useEffect(() => {
    run(a, b, by);
    // Re-run whenever either side or the measure changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, by]);

  const la = labelOf(a, months);
  const lb = labelOf(b, months);

  return (
    <ModalShell onClose={onClose} labelledBy="compare-title" wide>
      <div className="pr-10">
        <h3 id="compare-title" className="text-lg font-semibold">
          เปรียบเทียบ
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">ทุกตัวเลขเป็นค่าเฉลี่ยต่อวันที่มีข้อมูล — สองช่วงที่ยาวไม่เท่ากันจึงเทียบกันได้ตรง ๆ</p>
      </div>

      {/* ---------- what against what ---------- */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setA(p.a);
              setB(p.b);
            }}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              labelOf(p.a, months) === la && labelOf(p.b, months) === lb
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border-strong hover:bg-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 self-center text-xs text-muted-foreground">·</span>
        {(["net", "qty", "profit"] as Metric[]).filter((m) => m !== "profit" || canProfit).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setBy(m)}
            className={`rounded-full px-3 py-1 text-xs ${by === m ? "bg-foreground text-surface" : "text-muted-foreground hover:bg-muted"}`}
          >
            {METRIC_LABELS_TH[m]}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SideEditor name="ก" tone={TONES.clay[0]} side={a} onChange={setA} months={months} />
        <SideEditor name="ข" tone={TONES.teal[0]} side={b} onChange={setB} months={months} />
      </div>

      {/* ---------- the answer ---------- */}
      <div className={`mt-5 transition-opacity ${busy ? "opacity-50" : ""}`}>
        {res === null ? (
          <div className="h-48 animate-pulse rounded-xl bg-muted" />
        ) : !res.ok ? (
          <ActionError message={res.formError} stale={Boolean(res.stale)} />
        ) : res.a.days === 0 || res.b.days === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {res.a.days === 0 ? `“${la}”` : `“${lb}”`} ไม่มียอดขายในช่วงนั้น — เลือกช่วงอื่น
          </p>
        ) : (
          <CompareResultView a={res.a} b={res.b} la={la} lb={lb} by={by} labels={res.labels} tones={tones} />
        )}
      </div>
    </ModalShell>
  );
}

const span = (m: MonthOpt) => ({ from: m.from, to: m.to });

function SideEditor({
  name,
  tone,
  side,
  onChange,
  months,
}: {
  name: string;
  tone: string;
  side: Omit<CompareSide, "label">;
  onChange: (s: Omit<CompareSide, "label">) => void;
  months: MonthOpt[];
}) {
  const monthKey = months.find((m) => m.from === side.from && m.to === side.to)?.key ?? "";
  const toggleDay = (w: number) => {
    const cur = side.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w];
    onChange({ ...side, weekdays: next.length === 0 || next.length === 7 ? null : next });
  };
  return (
    <div className="rounded-xl border-2 p-3" style={{ borderColor: tone }}>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs text-white" style={{ background: tone }}>
          {name}
        </span>
        {labelOf(side, months)}
      </p>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label>
          <span className="text-muted-foreground">ทั้งเดือน</span>
          <select
            className="input mt-0.5 block py-1 text-xs"
            value={monthKey}
            onChange={(e) => {
              const m = months.find((x) => x.key === e.target.value);
              if (m) onChange({ ...side, from: m.from, to: m.to });
            }}
          >
            <option value="">—</option>
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-muted-foreground">วันเดียว</span>
          <input
            type="date"
            className="input mt-0.5 block py-1 text-xs"
            value={side.from === side.to ? side.from : ""}
            onChange={(e) => e.target.value && onChange({ from: e.target.value, to: e.target.value, weekdays: null })}
          />
        </label>
        <span className="self-center pb-1 text-muted-foreground">หรือ</span>
        <label>
          <span className="text-muted-foreground">ตั้งแต่</span>
          <input type="date" className="input mt-0.5 block py-1 text-xs" value={side.from} onChange={(e) => e.target.value && onChange({ ...side, from: e.target.value, to: side.to < e.target.value ? e.target.value : side.to })} />
        </label>
        <label>
          <span className="text-muted-foreground">ถึง</span>
          <input type="date" className="input mt-0.5 block py-1 text-xs" value={side.to} min={side.from} onChange={(e) => e.target.value && onChange({ ...side, to: e.target.value })} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {MON_FIRST.map((w) => {
          const on = side.weekdays === null || side.weekdays.includes(w);
          return (
            <button
              key={w}
              type="button"
              onClick={() => toggleDay(w)}
              className={`h-7 w-9 rounded-md border text-xs ${on ? "border-transparent text-white" : "border-border text-muted-foreground"}`}
              style={on ? { background: tone } : undefined}
            >
              {WEEKDAY_SHORT[w]}
            </button>
          );
        })}
        <button type="button" onClick={() => onChange({ ...side, weekdays: null })} className="ml-1 text-xs text-primary underline">
          ทุกวัน
        </button>
      </div>
    </div>
  );
}

function Diff({ v, pp = false }: { v: number | null; pp?: boolean }) {
  if (v === null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={`text-xs font-medium tabular-nums ${v >= 0 ? "text-good" : "text-bad"}`}>
      {v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}
      {pp ? " จุด" : "%"}
    </span>
  );
}

type ResultProps = {
  a: PeriodStats;
  b: PeriodStats;
  la: string;
  lb: string;
  by: Metric;
  labels: Record<string, string>;
  tones: ToneMap;
};

function CompareResultView(props: ResultProps) {
  const [q, setQ] = useState("");
  return <CompareResultViewInner {...props} q={q} setQ={setQ} />;
}

function CompareResultViewInner({
  a,
  b,
  la,
  lb,
  by,
  labels,
  tones,
  q,
  setQ,
}: {
  q: string;
  setQ: (v: string) => void;
  a: PeriodStats;
  b: PeriodStats;
  la: string;
  lb: string;
  by: Metric;
  labels: Record<string, string>;
  tones: ToneMap;
}) {
  const kpis: { label: string; a: number | null; b: number | null; fmt: (n: number) => string }[] = [
    { label: "ยอดขายต่อวัน", a: a.perDay.net, b: b.perDay.net, fmt: baht },
    { label: "จำนวนจานต่อวัน", a: a.perDay.qty, b: b.perDay.qty, fmt: (n) => `${n.toFixed(0)} จาน` },
    { label: "ราคาเฉลี่ยต่อจาน", a: a.perDay.qty ? a.perDay.net / a.perDay.qty : null, b: b.perDay.qty ? b.perDay.net / b.perDay.qty : null, fmt: (n) => `฿${n.toFixed(1)}` },
    ...(by === "profit" ? [{ label: "กำไรจากสูตรต่อวัน", a: a.perDay.profit, b: b.perDay.profit, fmt: baht }] : []),
  ];
  const catKeys = [...new Set([...a.categories.map((c) => c.key), ...b.categories.map((c) => c.key)])];
  const catA = new Map(a.categories.map((c) => [c.key, c]));
  const catB = new Map(b.categories.map((c) => [c.key, c]));
  const maxShare = Math.max(1, ...a.categories.map((c) => c.share ?? 0), ...b.categories.map((c) => c.share ?? 0));
  const menuB = new Map(b.menus.map((m) => [m.id, m]));
  const menuA = new Map(a.menus.map((m) => [m.id, m]));
  const menuDiffs = [...new Set([...a.menus.map((m) => m.id), ...b.menus.map((m) => m.id)])]
    .map((id) => {
      const x = menuA.get(id);
      const y = menuB.get(id);
      return { id, name: x?.name ?? y?.name ?? "", categoryKey: x?.categoryKey ?? y?.categoryKey ?? "none", a: x?.perDay ?? 0, b: y?.perDay ?? 0 };
    })
    .sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b));
  const maxMenu = Math.max(1e-9, ...menuDiffs.flatMap((m) => [Math.abs(m.a), Math.abs(m.b)]));
  const insight = useMenuInsight();
  const needle = q.trim().toLowerCase();
  const shownMenus = needle ? menuDiffs.filter((m) => m.name.toLowerCase().includes(needle)) : menuDiffs;

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium" style={{ color: TONES.clay[0] }}>ก</span> {la} — เฉลี่ยจาก {a.days} วัน ·{" "}
        <span className="font-medium" style={{ color: TONES.teal[0] }}>ข</span> {lb} — เฉลี่ยจาก {b.days} วัน · ลูกศร = ก เทียบกับ ข
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="mt-1 font-display text-base font-semibold tabular-nums" style={{ color: TONES.clay[0] }}>
              {k.a === null ? "—" : k.fmt(k.a)}
            </p>
            <p className="text-sm tabular-nums" style={{ color: TONES.teal[0] }}>
              {k.b === null ? "—" : k.fmt(k.b)}
            </p>
            <Diff v={pct(k.a, k.b)} />
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border p-3">
          <p className="mb-3 text-xs font-medium text-muted-foreground">สัดส่วนหมวด ({METRIC_LABELS_TH[by]}) · ก บน · ข ล่าง</p>
          <ul className="space-y-3">
            {catKeys.map((k, i) => {
              const x = catA.get(k);
              const y = catB.get(k);
              const tone = TONES[tones[k] ?? "olive"][0];
              return (
                <li key={k} className="text-sm">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: tone }} />
                      {labels[k] ?? "ยังไม่ระบุหมวด"}
                    </span>
                    <span className="tabular-nums">
                      {(x?.share ?? 0).toFixed(1)}% <span className="text-muted-foreground">vs</span> {(y?.share ?? 0).toFixed(1)}%{" "}
                      <Diff v={(x?.share ?? 0) - (y?.share ?? 0)} pp />
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-2 origin-left animate-grow-x rounded-full" style={{ width: `${((x?.share ?? 0) / maxShare) * 100}%`, background: TONES.clay[0], animationDelay: `${i * 50}ms` }} />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-2 origin-left animate-grow-x rounded-full" style={{ width: `${((y?.share ?? 0) / maxShare) * 100}%`, background: TONES.teal[0], animationDelay: `${i * 50 + 25}ms` }} />
                    </div>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    ต่อวัน {fmtMetric(by, x?.perDay ?? 0)} vs {fmtMetric(by, y?.perDay ?? 0)} · <Diff v={pct(x?.perDay ?? 0, y?.perDay ?? 0)} />
                  </p>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            ทุกเมนู เรียงจากต่างกันมากที่สุด ({METRIC_LABELS_TH[by]}ต่อวัน)
          </p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาเมนู เช่น เบียร์"
            className="input mb-3 w-full py-1.5 text-sm"
            aria-label="ค้นหาเมนูที่จะเทียบ"
          />
          <ul className="-mx-1 max-h-96 space-y-0.5 overflow-y-auto pr-1">
            {shownMenus.length === 0 && <li className="text-sm text-muted-foreground">ไม่พบเมนูที่ค้นหา</li>}
            {shownMenus.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => insight?.open(m.id)}
                  title="ดู insight ของเมนูนี้"
                  className="group block w-full rounded-lg px-1 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONES[tones[m.categoryKey] ?? "olive"][0] }} />
                    <span className="truncate font-medium group-hover:text-primary">{m.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {fmtMetric(by, m.a)} <span className="text-muted-foreground">vs</span> {fmtMetric(by, m.b)} <Diff v={pct(m.a, m.b)} />
                  </span>
                </div>
                <div className="space-y-0.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-1.5 origin-left animate-grow-x rounded-full" style={{ width: `${(Math.abs(m.a) / maxMenu) * 100}%`, background: TONES.clay[0], animationDelay: `${Math.min(i, 10) * 45}ms` }} />
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-1.5 origin-left animate-grow-x rounded-full" style={{ width: `${(Math.abs(m.b) / maxMenu) * 100}%`, background: TONES.teal[0], animationDelay: `${Math.min(i, 10) * 45 + 20}ms` }} />
                  </div>
                </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {by === "profit" && (a.unknownNetPerDay > 0 || b.unknownNetPerDay > 0) && (
        <p className="text-xs text-muted-foreground">
          กำไรไม่นับยอดขายของเมนูที่ยังไม่มีสูตร: ก {baht(a.unknownNetPerDay)}/วัน · ข {baht(b.unknownNetPerDay)}/วัน
        </p>
      )}
    </div>
  );
}

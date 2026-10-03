"use client";

// ============================================================
// Mise — category × day of week (Kong's question 1, 2026-09-28)
// ============================================================
// "วันเสาร์โดยเฉลี่ย ยอดขายหมวดต้ม ยำ ส้มตำ คิดเป็นกี่เปอร์เซ็นต์ แล้วเยอะหรือ
// น้อยกว่าเครื่องดื่ม หรือเบียร์" — one glance down the Saturday column.
//
// Two readings of the same table, switchable:
//   % ของวันนั้น   — the category's share of THAT weekday (columns sum to 100)
//   เฉลี่ยต่อวัน     — the category's average per such day (rule SI1: a total
//                   over three Saturdays is divided by three)
// A cell's depth is its value against the table's largest, so the eye finds
// the strong cells first; the row's best day is bold. A cell opens the menus
// behind it.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { TONES } from "@/components/charts/chart-theme";
import { METRIC_LABELS_TH, type Metric } from "@/lib/sales-insight";
import { ModalShell, fmtMetric, type ToneMap } from "./Breakdown";
import { useMenuInsight } from "./insight-context";
import { PopupMetricSwitch } from "./MetricSwitch";

const WEEKDAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const WEEKDAY_SHORT = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

/**
 * ONE sequential scale for the whole table (Kong, 2026-09-28: tinting each
 * row in its category's colour read "like it was made by different vendors").
 * Light cream to deep olive, the brand's own family; the category's colour
 * survives only as the dot before its name.
 */
const SCALE = ["#F6F3E4", "#E6E8CB", "#CDD4A0", "#A9B566", "#7E8B35", "#56621B"];
const shade = (t: number) => SCALE[Math.min(SCALE.length - 1, Math.max(0, Math.round(t * (SCALE.length - 1))))];

export type HeatCell = { perDay: number; share: number | null };
export type HeatRow = { key: string; label: string; cells: Record<number, HeatCell> };
export type HeatMenus = Record<string, { id: string; name: string; perDay: number; qtyPerDay: number }[]>;

export default function CategoryWeekdayHeatmap({
  rows,
  weekdays,
  daysPerWeekday,
  menusByCell,
  tones,
  by,
}: {
  rows: HeatRow[];
  weekdays: number[];
  daysPerWeekday: Record<number, number>;
  /** Keyed `${categoryKey}|${weekday}`. */
  menusByCell: HeatMenus;
  tones: ToneMap;
  by: Metric;
}) {
  const [view, setView] = useState<"share" | "perDay">("share");
  const insight = useMenuInsight();
  const [open, setOpen] = useState<{ cat: string; wd: number } | null>(null);
  const read = (c: HeatCell) => (view === "share" ? c.share : c.perDay);

  // ---- focus (Kong, 2026-10-03) ----
  // Pointing at a weekday header reads the table DOWN (that day's ranking of
  // categories); pointing at a category name or its "ทั้งสัปดาห์" cell reads it
  // ACROSS (that category's ranking of days); pointing at a cell shows a card
  // with both rankings. On a touch screen a tap on a header or a row toggles the
  // same focus, and a tap on a cell keeps opening its menus — the popup says the
  // same things the card does.
  type Focus = { kind: "col"; wd: number } | { kind: "row"; cat: string } | { kind: "cell"; cat: string; wd: number };
  const [focus, setFocus] = useState<Focus | null>(null);
  const [card, setCard] = useState<{ cat: string; wd: number; x: number; y: number; above: boolean } | null>(null);
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    setCanHover(window.matchMedia("(hover: hover)").matches);
  }, []);
  const live = weekdays.filter((w) => daysPerWeekday[w]);
  const rankInDay = (cat: string, wd: number) =>
    [...rows].sort((a, b) => (read(b.cells[wd]) ?? -1) - (read(a.cells[wd]) ?? -1)).findIndex((r) => r.key === cat) + 1;
  const rankInWeek = (r: HeatRow, wd: number) =>
    [...live].sort((a, b) => (read(r.cells[b]) ?? -1) - (read(r.cells[a]) ?? -1)).indexOf(wd) + 1;
  const inFocus = (cat: string, wd: number | null) =>
    focus === null
      ? true
      : focus.kind === "col"
        ? wd === focus.wd
        : focus.kind === "row"
          ? cat === focus.cat
          : cat === focus.cat || wd === focus.wd;
  const rankShown = (r: HeatRow, wd: number) =>
    focus?.kind === "col" && focus.wd === wd
      ? rankInDay(r.key, wd)
      : focus?.kind === "row" && focus.cat === r.key
        ? rankInWeek(r, wd)
        : null;
  const hoverTo = (f: Focus | null) => {
    if (!canHover) return;
    setFocus(f);
    if (f?.kind !== "cell") setCard(null);
  };
  const tapTo = (f: Focus) => {
    if (canHover) return;
    setFocus((cur) => (cur && JSON.stringify(cur) === JSON.stringify(f) ? null : f));
  };
  const showCard = (cat: string, wd: number, el: HTMLElement) => {
    if (!canHover) return;
    const r = el.getBoundingClientRect();
    const above = r.bottom + 190 > window.innerHeight;
    setFocus({ kind: "cell", cat, wd });
    setCard({ cat, wd, x: Math.min(Math.max(8, r.left + r.width / 2 - 150), window.innerWidth - 308), y: above ? r.top - 8 : r.bottom + 8, above });
  };
  const measure = METRIC_LABELS_TH[by];
  const weekShare = (r: HeatRow) => {
    const all = live.reduce((t, w) => t + rows.reduce((u, x) => u + x.cells[w].perDay * daysPerWeekday[w], 0), 0);
    const mine = live.reduce((t, w) => t + r.cells[w].perDay * daysPerWeekday[w], 0);
    return all ? (mine / all) * 100 : null;
  };
  const weekPerDayOf = (r: HeatRow) => {
    const n = live.reduce((t, w) => t + daysPerWeekday[w], 0);
    return n ? live.reduce((t, w) => t + r.cells[w].perDay * daysPerWeekday[w], 0) / n : 0;
  };
  // Each ROW is shaded against itself: the question this table answers is
  // "which day is good for THIS category", so the darkest cell in a row is that
  // category's best day. The numbers carry the comparison between categories.
  const rowRange = useMemo(
    () =>
      new Map(
        rows.map((r) => {
          const vs = weekdays.filter((w) => daysPerWeekday[w]).map((w) => read(r.cells[w]) ?? 0);
          return [r.key, { min: Math.min(...vs), max: Math.max(...vs) }];
        })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, weekdays, view]
  );
  const text = (c: HeatCell) =>
    view === "share"
      ? c.share === null
        ? "—"
        : `${c.share.toFixed(1)}%`
      : by === "qty"
        ? c.perDay.toFixed(1)
        : new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 }).format(c.perDay);

  const openRow = open ? rows.find((r) => r.key === open.cat) : null;
  const openMenus = open ? menusByCell[`${open.cat}|${open.wd}`] ?? [] : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-full border border-border bg-muted/40 p-0.5 text-xs">
          {(["share", "perDay"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {v === "share" ? "% ของวันนั้น" : `${measure}เฉลี่ยต่อวัน`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            น้อย
            {SCALE.map((c) => (
              <span key={c} className="h-3 w-4 rounded-sm" style={{ background: c }} />
            ))}
            มาก
          </span>
          <span>เทียบในแถว ←→</span>
          <span>
            <span style={{ color: "#C0692B" }}>★</span>{" "}
            {view === "share" ? "วันที่หมวดนั้นมีสัดส่วนสูงสุด" : `วันที่หมวดนั้น${by === "qty" ? "ขายได้หลายจาน" : by === "profit" ? "ได้กำไรมาก" : "ขายได้มาก"}ที่สุด`}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto" onMouseLeave={() => hoverTo(null)}>
        <table className="w-full min-w-[560px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-2 py-1 text-left align-bottom font-medium">
                หมวด
                <span className="block text-[10px] font-normal text-muted-foreground">
                  {view === "share" ? "ตัวเลข = % ของยอดวันนั้น" : `ตัวเลข = ${measure}ต่อวัน (เฉลี่ย)`}
                </span>
              </th>
              {weekdays.map((w) => (
                <th
                  key={w}
                  onMouseEnter={() => hoverTo({ kind: "col", wd: w })}
                  onClick={() => tapTo({ kind: "col", wd: w })}
                  className={`cursor-pointer rounded-md px-1 py-1 text-center font-medium transition-colors hover:bg-muted ${focus?.kind === "col" && focus.wd === w ? "bg-muted" : ""} ${w === 0 || w === 6 ? "text-foreground" : ""}`}
                >
                  {WEEKDAY_SHORT[w]}
                  <span className="block text-[10px] font-normal text-muted-foreground">{daysPerWeekday[w]} วัน</span>
                </th>
              ))}
              <th className="px-2 py-1 text-right align-bottom font-medium">ทั้งสัปดาห์</th>
            </tr>
          </thead>
          <tbody key={`${view}-${by}`}>
            {rows.map((r, ri) => {
              const tone = TONES[tones[r.key] ?? "olive"][0];
              const best = weekdays.reduce((a, w) => ((read(r.cells[w]) ?? -1) > (read(r.cells[a]) ?? -1) ? w : a), weekdays[0]);
              const range = rowRange.get(r.key) ?? { min: 0, max: 0 };
              const rowOn = (focus?.kind === "row" || focus?.kind === "cell") && focus.cat === r.key;
              const rowDim = focus !== null && focus.kind !== "col" && !rowOn;
              const rowHandle = {
                onMouseEnter: () => hoverTo({ kind: "row", cat: r.key }),
                onClick: () => tapTo({ kind: "row", cat: r.key }),
              };
              return (
                <tr key={r.key}>
                  <td
                    {...rowHandle}
                    className={`cursor-pointer whitespace-nowrap rounded-md px-2 py-1 font-medium transition ${rowOn ? "bg-muted" : "hover:bg-muted"} ${rowDim ? "opacity-40" : ""}`}
                  >
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: tone }} />
                    {r.label}
                  </td>
                  {weekdays.map((w, wi) => {
                    const c = r.cells[w];
                    const v = read(c) ?? 0;
                    const depth = range.max > range.min ? (v - range.min) / (range.max - range.min) : 0.5;
                    const dark = depth > 0.6;
                    const rank = daysPerWeekday[w] ? rankShown(r, w) : null;
                    const hit = focus?.kind === "cell" && focus.cat === r.key && focus.wd === w;
                    return (
                      // Dimmed on the CELL, not the button: the button's fade-in
                      // animation holds its opacity at 1 and would win.
                      <td key={w} className={`p-0 transition-opacity ${inFocus(r.key, w) ? "" : "opacity-30"}`}>
                        <button
                          type="button"
                          onClick={() => setOpen({ cat: r.key, wd: w })}
                          onMouseEnter={(e) => daysPerWeekday[w] && showCard(r.key, w, e.currentTarget)}
                          onFocus={(e) => daysPerWeekday[w] && showCard(r.key, w, e.currentTarget)}
                          onBlur={() => hoverTo(null)}
                          disabled={!daysPerWeekday[w]}
                          aria-label={`${r.label} วัน${WEEKDAY_TH[w]} ${text(c)}`}
                          className={`relative h-11 w-full animate-fade-in rounded-md text-center text-[13px] font-medium tabular-nums transition disabled:cursor-default ${hit ? "ring-2 ring-primary" : "ring-primary/40 hover:ring-2"}`}
                          style={{
                            background: daysPerWeekday[w] ? shade(depth) : "transparent",
                            color: dark ? "#FFFFFF" : "#262811",
                            animationDelay: `${(ri * weekdays.length + wi) * 12}ms`,
                          }}
                        >
                          {daysPerWeekday[w] ? text(c) : "·"}
                          {w === best && daysPerWeekday[w] ? (
                            <span aria-label="วันที่ดีที่สุด" className={`absolute right-1 top-0.5 text-[10px] ${dark ? "text-white" : "text-[#C0692B]"}`}>
                              ★
                            </span>
                          ) : null}
                          {rank !== null ? (
                            <span className="absolute left-1 top-1 min-w-[15px] rounded-full bg-foreground px-1 text-[10px] font-semibold leading-[15px] text-background">
                              {rank}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                  <td
                    {...rowHandle}
                    className={`cursor-pointer whitespace-nowrap rounded-md px-2 py-1 text-right text-[13px] font-medium tabular-nums text-muted-foreground transition ${rowOn ? "bg-muted" : "hover:bg-muted"} ${rowDim ? "opacity-40" : ""}`}
                  >
                    {view === "share"
                      ? (() => {
                          const s = weekShare(r);
                          return s === null ? "—" : `${s.toFixed(1)}%`;
                        })()
                      : fmtMetric(by, weekPerDayOf(r))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {card && (() => {
        const r = rows.find((x) => x.key === card.cat);
        if (!r) return null;
        const c = r.cells[card.wd];
        const rd = rankInDay(r.key, card.wd);
        const rw = rankInWeek(r, card.wd);
        const day = WEEKDAY_TH[card.wd];
        const ws = weekShare(r);
        const dayLine =
          view === "share"
            ? `${by === "net" ? "ขายดี" : by === "qty" ? "ขายได้จานมาก" : "ทำกำไรได้"}อันดับ ${rd} จาก ${rows.length} หมวดของวัน${day} · ${c.share === null ? "—" : `${c.share.toFixed(1)}%`} ของ${measure}ทั้งวัน`
            : `${by === "net" ? "ขายดี" : by === "qty" ? "ขายได้จานมาก" : "ทำกำไรได้"}อันดับ ${rd} จาก ${rows.length} หมวดของวัน${day} · ${fmtMetric(by, c.perDay)}/วัน`;
        const weekLine =
          view === "share"
            ? `วัน${day}เป็นวันที่${r.label}มีสัดส่วนสูงอันดับ ${rw} จาก ${live.length} วัน (เฉลี่ยทั้งสัปดาห์ ${ws === null ? "—" : `${ws.toFixed(1)}%`})`
            : `วัน${day}เป็นวันที่${r.label}${by === "qty" ? "ขายได้จานมาก" : by === "profit" ? "ทำกำไรได้" : "ขายดี"}อันดับ ${rw} จาก ${live.length} วัน (เฉลี่ยทั้งสัปดาห์ ${fmtMetric(by, weekPerDayOf(r))}/วัน)`;
        return (
          <div
            role="tooltip"
            className="pointer-events-none fixed z-40 w-[300px] max-w-[calc(100vw-16px)] animate-fade-in rounded-xl border border-border bg-surface p-3 text-xs shadow-card"
            style={{ left: card.x, top: card.y, transform: card.above ? "translateY(-100%)" : undefined }}
          >
            <p className="mb-2 font-display text-sm font-semibold">
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: TONES[tones[r.key] ?? "olive"][0] }} />
              {r.label} · วัน{day}
            </p>
            <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 border-t border-border py-1.5">
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">ในวัน{day}</span>
              <span><span className="mr-1 rounded-full bg-foreground px-1.5 font-semibold text-background">#{rd}</span>{dayLine}</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 border-t border-border py-1.5">
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">ในสัปดาห์</span>
              <span><span className="mr-1 rounded-full bg-foreground px-1.5 font-semibold text-background">#{rw}</span>{weekLine}</span>
            </div>
            <p className="border-t border-border pt-1.5 text-[11px] text-muted-foreground">
              เฉลี่ยจาก {daysPerWeekday[card.wd]} วัน{day}ในช่วงนี้ · กดเพื่อดูเมนู
            </p>
          </div>
        );
      })()}

      <p className="mt-2 text-[11px] text-muted-foreground">
        ชี้ชื่อวันเพื่อดูอันดับในวันนั้น · ชี้ชื่อหมวดหรือ “ทั้งสัปดาห์” เพื่อดูอันดับของวันในหมวดนั้น · กดช่องเพื่อดูเมนู
      </p>

      {open && openRow && (
        <ModalShell onClose={() => setOpen(null)} labelledBy="heat-title">
          <div className="mb-4 pr-10">
            <h3 id="heat-title" className="text-lg font-semibold">
              {openRow.label} · วัน{WEEKDAY_TH[open.wd]}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              เฉลี่ยจาก {daysPerWeekday[open.wd]} วัน{WEEKDAY_TH[open.wd]}ในช่วงนี้ ·{" "}
              <span className="font-medium text-foreground">{fmtMetric(by, openRow.cells[open.wd].perDay)}</span> ต่อวัน
              {openRow.cells[open.wd].share !== null && <> · {openRow.cells[open.wd].share!.toFixed(1)}% ของทั้งวัน</>}
            </p>
            <div className="mt-2">
              <PopupMetricSwitch />
            </div>
          </div>
          {/* The same category on every weekday — so "is Saturday special?" is one look. */}
          <div className="mb-4 grid grid-cols-7 gap-1 text-center text-xs">
            {openRow &&
              Object.keys(openRow.cells)
                .map(Number)
                .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
                .map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setOpen({ cat: open.cat, wd: w })}
                    className={`rounded-lg border px-1 py-1.5 ${w === open.wd ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                  >
                    {WEEKDAY_SHORT[w]}
                    <span className="block tabular-nums">{openRow.cells[w].share === null ? "—" : `${openRow.cells[w].share!.toFixed(0)}%`}</span>
                  </button>
                ))}
          </div>
          <ul key={`${open.cat}-${open.wd}`} className="-mx-2 space-y-0.5">
            {openMenus.map((m, i) => {
              const top = Math.max(1e-9, ...openMenus.map((x) => Math.max(0, x.perDay)));
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => insight?.open(m.id)}
                    title="ดู insight ของเมนูนี้"
                    className="group block w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium group-hover:text-primary">{m.name}</span>
                    <span className="tabular-nums">
                      {fmtMetric(by, m.perDay)} <span className="text-xs text-muted-foreground">/วัน · {m.qtyPerDay.toFixed(1)} จาน</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-2 origin-left animate-grow-x rounded-full"
                      style={{
                        width: `${(Math.max(0, m.perDay) / top) * 100}%`,
                        background: TONES[tones[open.cat] ?? "olive"][0],
                        animationDelay: `${i * 35}ms`,
                      }}
                    />
                  </div>
                  </button>
                </li>
              );
            })}
            {openMenus.length === 0 && <li className="text-sm text-muted-foreground">ไม่มีเมนูของหมวดนี้ขายในวันนี้</li>}
          </ul>
        </ModalShell>
      )}
    </div>
  );
}

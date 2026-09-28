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

import { useMemo, useState } from "react";
import { TONES } from "@/components/charts/chart-theme";
import { METRIC_LABELS_TH, type Metric } from "@/lib/sales-insight";
import { ModalShell, fmtMetric, type ToneMap } from "./Breakdown";
import { MenuLink } from "./insight-context";

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
  const [open, setOpen] = useState<{ cat: string; wd: number } | null>(null);
  const read = (c: HeatCell) => (view === "share" ? c.share : c.perDay);
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
              {v === "share" ? "% ของวันนั้น" : `${METRIC_LABELS_TH[by]}เฉลี่ยต่อวัน`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            น้อย
            {SCALE.map((c) => (
              <span key={c} className="h-3 w-4 rounded-sm" style={{ background: c }} />
            ))}
            มาก
          </span>
          <span>(เทียบวันอื่นของหมวดเดียวกัน)</span>
          <span><span style={{ color: "#C0692B" }}>★</span> วันที่ดีที่สุดของหมวด</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-2 py-1 text-left font-medium">หมวด</th>
              {weekdays.map((w) => (
                <th key={w} className={`px-1 py-1 text-center font-medium ${w === 0 || w === 6 ? "text-foreground" : ""}`}>
                  {WEEKDAY_SHORT[w]}
                  <span className="block text-[10px] font-normal text-muted-foreground">{daysPerWeekday[w]} วัน</span>
                </th>
              ))}
              <th className="px-2 py-1 text-right font-medium">ทั้งสัปดาห์</th>
            </tr>
          </thead>
          <tbody key={`${view}-${by}`}>
            {rows.map((r, ri) => {
              const tone = TONES[tones[r.key] ?? "olive"][0];
              const best = weekdays.reduce((a, w) => ((read(r.cells[w]) ?? -1) > (read(r.cells[a]) ?? -1) ? w : a), weekdays[0]);
              const range = rowRange.get(r.key) ?? { min: 0, max: 0 };
              // The whole week for this category: share of all days, or per day.
              const weekDays = weekdays.reduce((t, w) => t + daysPerWeekday[w], 0);
              const weekPerDay = weekDays ? weekdays.reduce((t, w) => t + r.cells[w].perDay * daysPerWeekday[w], 0) / weekDays : 0;
              return (
                <tr key={r.key}>
                  <td className="whitespace-nowrap px-2 py-1 font-medium">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: tone }} />
                    {r.label}
                  </td>
                  {weekdays.map((w, wi) => {
                    const c = r.cells[w];
                    const v = read(c) ?? 0;
                    const depth = range.max > range.min ? (v - range.min) / (range.max - range.min) : 0.5;
                    const dark = depth > 0.6;
                    return (
                      <td key={w} className="p-0">
                        <button
                          type="button"
                          onClick={() => setOpen({ cat: r.key, wd: w })}
                          disabled={!daysPerWeekday[w]}
                          className="relative h-11 w-full animate-fade-in rounded-md text-center text-[13px] font-medium tabular-nums ring-primary/40 transition hover:ring-2 disabled:cursor-default disabled:hover:ring-0"
                          style={{
                            background: daysPerWeekday[w] ? shade(depth) : "transparent",
                            color: dark ? "#FFFFFF" : "#262811",
                            animationDelay: `${(ri * weekdays.length + wi) * 12}ms`,
                          }}
                          title={`${r.label} · วัน${WEEKDAY_TH[w]} · ${c.share === null ? "—" : `${c.share.toFixed(1)}% ของวัน`} · เฉลี่ย ${fmtMetric(by, c.perDay)} ต่อวัน`}
                        >
                          {daysPerWeekday[w] ? text(c) : "·"}
                          {w === best && daysPerWeekday[w] ? (
                            <span aria-label="วันที่ดีที่สุด" className={`absolute right-1 top-0.5 text-[10px] ${dark ? "text-white" : "text-[#C0692B]"}`}>
                              ★
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-2 py-1 text-right text-[13px] font-medium tabular-nums text-muted-foreground">
                    {view === "share" ? "" : fmtMetric(by, weekPerDay)}
                    {view === "share" && rows.length > 0 && (() => {
                      const all = weekdays.reduce((t, w) => t + rows.reduce((u, x) => u + x.cells[w].perDay * daysPerWeekday[w], 0), 0);
                      const mine = weekPerDay * weekDays;
                      return all ? `${((mine / all) * 100).toFixed(1)}%` : "—";
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
          <ul key={`${open.cat}-${open.wd}`} className="space-y-1.5">
            {openMenus.map((m, i) => {
              const top = Math.max(1e-9, ...openMenus.map((x) => Math.max(0, x.perDay)));
              return (
                <li key={m.id} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <MenuLink id={m.id}>{m.name}</MenuLink>
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

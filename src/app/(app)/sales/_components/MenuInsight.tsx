"use client";

// ============================================================
// Mise — one dish, as a popup (Kong, 2026-09-28)
// ============================================================
// "กดเข้าไปแต่ละจานเห็น insight ของแต่ละเมนู COGS เท่าไหร่ กำไรต่อจานเท่าไหร่
// รูปที่ใช้ของเมนู". Opened from anywhere on /sales that names a dish — the
// menu table, the movers, the category and day popups — through one context,
// because a Server Component cannot hand a Client Component a function.
//
// What it answers, top to bottom: is it a big seller (per day, against last
// period), does it make money (price after discount, recipe cost with its
// confidence, profit and margin per plate), where does it stand in its
// category, and when does it sell (by day, by weekday).
//
// The photo: `menu` has no image column yet and uploads wait for object
// storage (Tigris, after the UI pass — Kong 2026-09-28), so the slot is here
// and says so, rather than the layout changing the day photos arrive.
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { InsightContext } from "./insight-context";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ANIM, ChartGradients, ChartTooltip, INK_MUTED, cursorFill, grad } from "@/components/charts/chart-theme";
import { METRIC_LABELS_TH, WEEK_ORDER, type Metric } from "@/lib/sales-insight";
import { RECIPE_CONFIDENCE_HINTS_TH, RECIPE_CONFIDENCE_LABELS_TH } from "@/lib/validations/recipe";
import { getMenuInsightAction, type MenuInsightResult } from "../insight-actions";
import { ModalShell, baht, fmtMetric } from "./Breakdown";

const WEEKDAY_SHORT = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const CONF_TONE: Record<string, string> = {
  HIGH: "border-good-border bg-good-bg text-good",
  MEDIUM: "border-warn-border bg-warn-bg text-warn",
  LOW: "border-bad-border bg-bad-bg text-bad",
};

export function MenuInsightProvider({
  from,
  to,
  branchId,
  by,
  children,
}: {
  from: string;
  to: string;
  branchId?: string;
  by: Metric;
  children: ReactNode;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const open = useCallback((id: string) => setMenuId(id), []);
  const close = useCallback(() => setMenuId(null), []);
  return (
    <InsightContext.Provider value={{ open }}>
      {children}
      {menuId && <MenuInsightModal menuId={menuId} from={from} to={to} branchId={branchId} by={by} onClose={close} />}
    </InsightContext.Provider>
  );
}

function MenuInsightModal({
  menuId,
  from,
  to,
  branchId,
  by,
  onClose,
}: {
  menuId: string;
  from: string;
  to: string;
  branchId?: string;
  by: Metric;
  onClose: () => void;
}) {
  const [res, setRes] = useState<MenuInsightResult | null>(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    getMenuInsightAction({ menuId, from, to, branchId, by }).then((r) => live && setRes(r));
    return () => {
      live = false;
    };
  }, [menuId, from, to, branchId, by]);

  return (
    <ModalShell onClose={onClose} labelledBy="menu-insight-title" wide>
      {res === null ? (
        <div className="space-y-4 py-2" aria-busy>
          <div className="h-7 w-64 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
          <div className="h-48 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : !res.ok ? (
        <p className="py-10 text-center text-sm text-bad">{res.formError}</p>
      ) : (
        <InsightBody r={res} by={by} />
      )}
    </ModalShell>
  );
}

const change = (cur: number, prev: number | undefined | null) =>
  prev === null || prev === undefined || prev === 0 ? null : ((cur - prev) / prev) * 100;

function Delta({ v }: { v: number | null }) {
  if (v === null) return <span className="text-xs text-muted-foreground">ไม่มีช่วงก่อนให้เทียบ</span>;
  const up = v >= 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-good" : "text-bad"}`}>
      {up ? "▲" : "▼"} {Math.abs(v).toFixed(1)}% จากช่วงก่อน
    </span>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      {sub ? <div className="mt-0.5">{sub}</div> : null}
    </div>
  );
}

function InsightBody({ r, by }: { r: Extract<MenuInsightResult, { ok: true }>; by: Metric }) {
  const m = r.insight;
  const noRecipe = m.costPerDish === null;
  const best = m.weekday.reduce((a, b) => (b.qtyPerDay > a.qtyPerDay ? b : a), m.weekday[0]);
  const dailyMax = Math.max(...m.daily.map((d) => d.value ?? 0));

  return (
    <div className="space-y-5">
      {/* ---------- header ---------- */}
      <div className="flex items-start gap-4 pr-10">
        <div
          className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-muted/40 text-center text-[10px] leading-tight text-muted-foreground"
          title="เพิ่มรูปเมนูได้เมื่อเปิดระบบรูปภาพ"
        >
          <span className="text-2xl">🍽</span>
          ยังไม่มีรูป
        </div>
        <div className="min-w-0">
          <h3 id="menu-insight-title" className="text-xl font-semibold">
            {m.name}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {m.categoryName} · อันดับ <span className="font-medium text-foreground">{m.rankInCategory}</span> จาก{" "}
            {m.categorySize} ในหมวด ({METRIC_LABELS_TH[by]})
            {m.shareOfCategory !== null && <> · {m.shareOfCategory.toFixed(1)}% ของหมวด</>}
            {m.shareOfAll !== null && <> · {m.shareOfAll.toFixed(1)}% ของทั้งร้าน</>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {m.days} วันที่มีข้อมูล · ขายดีสุดวัน{WEEKDAY_SHORT[best.weekday]} เฉลี่ย {best.qtyPerDay.toFixed(1)} จาน
          </p>
        </div>
      </div>

      {/* ---------- sells? ---------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="ยอดขายต่อวัน" value={baht(m.netPerDay)} sub={<Delta v={change(m.netPerDay, m.prev?.netPerDay)} />} />
        <Kpi
          label="จำนวนต่อวัน"
          value={`${m.qtyPerDay.toFixed(1)} จาน`}
          sub={<Delta v={change(m.qtyPerDay, m.prev?.qtyPerDay)} />}
        />
        <Kpi label="ยอดขายรวม" value={baht(m.net)} sub={<span className="text-xs text-muted-foreground">{m.qty.toLocaleString("th-TH")} จาน</span>} />
        <Kpi
          label="ราคาเฉลี่ยต่อจาน"
          value={m.avgPrice === null ? "—" : baht(m.avgPrice)}
          sub={<span className="text-xs text-muted-foreground">หลังหักส่วนลด ไม่รวม VAT</span>}
        />
      </div>

      {/* ---------- makes money? ---------- */}
      {r.canSeeCost && (
        <div className="rounded-xl border border-border bg-muted/20 p-3">
          {noRecipe ? (
            <p className="text-sm">
              <span className="font-medium">ยังคิดกำไรไม่ได้</span> — เมนูนี้ยังไม่มีสูตรอาหาร ระบบจึงไม่รู้ต้นทุนต่อจาน ·{" "}
              <a href={`/recipes/new?menu=${m.id}`} className="font-medium text-primary underline">
                เขียนสูตร
              </a>
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi
                  label="ต้นทุนต่อจาน (COGS)"
                  value={baht(m.costPerDish!)}
                  sub={
                    m.confidence && (
                      <span
                        title={RECIPE_CONFIDENCE_HINTS_TH[m.confidence as keyof typeof RECIPE_CONFIDENCE_HINTS_TH]}
                        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${CONF_TONE[m.confidence] ?? ""}`}
                      >
                        {RECIPE_CONFIDENCE_LABELS_TH[m.confidence as keyof typeof RECIPE_CONFIDENCE_LABELS_TH] ?? m.confidence}
                      </span>
                    )
                  }
                />
                <Kpi
                  label="กำไรต่อจาน"
                  value={m.profitPerDish === null ? "—" : baht(m.profitPerDish)}
                  tone={m.profitPerDish !== null && m.profitPerDish < 0 ? "text-bad" : "text-good"}
                />
                <Kpi
                  label="อัตรากำไรขั้นต้น"
                  value={m.marginPercent === null ? "—" : `${m.marginPercent.toFixed(1)}%`}
                  sub={
                    m.marginPercent !== null && (
                      <span className="text-xs text-muted-foreground">food cost {(100 - m.marginPercent).toFixed(1)}%</span>
                    )
                  }
                />
                <Kpi
                  label="กำไรรวมในช่วงนี้"
                  value={m.profitPerDish === null ? "—" : baht(m.profitPerDish * m.qty)}
                  sub={<span className="text-xs text-muted-foreground">{m.qty.toLocaleString("th-TH")} จาน × กำไรต่อจาน</span>}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                ต้นทุนจากสูตรอาหาร ณ {r.costAsOf} (ราคาวัตถุดิบตามที่ซื้อเข้ามาจริง) ไม่ใช่ต้นทุนรายวัน ·{" "}
                {m.recipeId && (
                  <a href={`/recipes/${m.recipeId}`} className="text-primary underline">
                    ดูสูตรและต้นทุนแต่ละวัตถุดิบ
                  </a>
                )}
              </p>
            </>
          )}
        </div>
      )}

      {/* ---------- when does it sell? ---------- */}
      <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">รายวัน · {METRIC_LABELS_TH[by]}</p>
          <div className="h-40">
            <ResponsiveContainer>
              <BarChart data={m.daily} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <ChartGradients />
                <XAxis dataKey="day" tickFormatter={(d: string) => String(Number(d.slice(8)))} tick={{ fill: INK_MUTED, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={8} />
                <Tooltip
                  cursor={cursorFill}
                  content={({ active, payload }) => {
                    const p = active && payload?.length ? (payload[0].payload as (typeof m.daily)[number]) : null;
                    return p ? (
                      <ChartTooltip
                        title={new Date(`${p.day}T00:00:00Z`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                        rows={[
                          { label: METRIC_LABELS_TH[by], value: fmtMetric(by, p.value) },
                          ...(by === "qty" ? [] : [{ label: "จำนวน", value: `${p.qty} จาน` }]),
                        ]}
                      />
                    ) : null;
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} {...ANIM}>
                  {m.daily.map((d) => (
                    <Cell key={d.day} fill={grad(d.value === dailyMax ? "clay" : "olive")} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">เฉลี่ยตามวันในสัปดาห์ · จาน</p>
          <ul className="space-y-1.5">
            {WEEK_ORDER.map((w, i) => {
              const row = m.weekday.find((x) => x.weekday === w)!;
              const max = Math.max(...m.weekday.map((x) => x.qtyPerDay), 1);
              return (
                <li key={w} className="flex items-center gap-2 text-xs">
                  <span className="w-7 text-muted-foreground">{WEEKDAY_SHORT[w]}</span>
                  <span className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-3 origin-left animate-grow-x rounded-full"
                      style={{
                        width: `${(row.qtyPerDay / max) * 100}%`,
                        background: w === best.weekday ? "linear-gradient(90deg,#E8A76F,#C0692B)" : "linear-gradient(90deg,#9DAA55,#5E6B14)",
                        animationDelay: `${i * 40}ms`,
                      }}
                    />
                  </span>
                  <span className="w-12 text-right tabular-nums">{row.qtyPerDay.toFixed(1)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">เทียบกับช่วงก่อน {r.prevLabel} · เฉลี่ยต่อวันที่มีข้อมูล</p>
    </div>
  );
}

"use client";

// ============================================================
// Mise — เมนูที่น่าจับตา as ONE chart (Kong, 2026-10-03)
// ============================================================
// Replaces the three cards (ตัวชูโรง · กำลังขึ้น · เฝ้าระวัง). Those confused in
// two ways: the "ตัวชูโรง" card showed red arrows under a title that meant
// "good", and +2.4% sat under "กำลังขึ้น" as if it were news. Here every dish
// is a bar from the zero line — right is up, left is down, length is how much,
// colour means direction and nothing else — and ±CHANGE_STEADY_BAND% is a grey
// band labelled as normal. Per day with data, against the period the page is
// comparing with (rules SI1/SI3).
// ============================================================

import { useMemo, useState } from "react";
import { TONES } from "@/components/charts/chart-theme";
import { CHANGE_STEADY_BAND, fmtMetric, type MenuChanges as Changes, type Metric, type Mover } from "@/lib/sales-insight";
import type { ToneMap } from "./Breakdown";
import { useMenuInsight } from "./insight-context";

type Mode = "all" | "up" | "down";
const SCALE = 30; // the bars' full width is ±30%; beyond that they touch the edge

export default function MenuChanges({
  changes,
  by,
  tones,
  curLabel,
  prevLabel,
}: {
  changes: Changes;
  by: Metric;
  tones: ToneMap;
  curLabel: string;
  prevLabel: string;
}) {
  const ctx = useMenuInsight();
  const [mode, setMode] = useState<Mode>("all");
  const [tip, setTip] = useState<{ m: Mover; x: number; y: number } | null>(null);

  const rows = useMemo(
    () =>
      changes.changed.filter((m) =>
        mode === "all" ? true : mode === "up" ? (m.change ?? 0) >= CHANGE_STEADY_BAND : (m.change ?? 0) <= -CHANGE_STEADY_BAND
      ),
    [changes.changed, mode]
  );
  const pos = (pct: number) => 50 + (Math.max(-SCALE, Math.min(SCALE, pct)) / SCALE) * 50;
  const toneOf = (key: string) => TONES[tones[key] ?? "olive"][0];
  const cls = (c: number) => (Math.abs(c) < CHANGE_STEADY_BAND ? "text-muted-subtle" : c > 0 ? "text-good" : "text-bad");
  const pct = (c: number) => `${c >= 0 ? "▲" : "▼"} ${Math.abs(c).toFixed(1)}%`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-good align-[-1px]" />ขายต่อวันมากขึ้น</span>
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-bad align-[-1px]" />ขายต่อวันน้อยลง</span>
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm border border-border-strong bg-muted align-[-1px]" />เปลี่ยนไม่ถึง ±{CHANGE_STEADY_BAND}% ถือว่าปกติ</span>
        </div>
        <div className="inline-flex rounded-full border border-border bg-muted/40 p-0.5 text-xs" role="group" aria-label="แสดง">
          {(["all", "up", "down"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {m === "all" ? "ทุกเมนู" : m === "up" ? "ขึ้นชัด" : "ลงชัด"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(110px,200px)_1fr_96px] gap-3 px-2 text-[11px] text-muted-subtle">
        <span>เมนู</span>
        <span className="flex justify-between">
          <span>−{SCALE}%</span>
          <span>0</span>
          <span>+{SCALE}%</span>
        </span>
        <span className="text-right">ต่อวัน · {curLabel}</span>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {changes.changed.length === 0
            ? `ยังไม่มีเมนูที่ขายทั้ง ${curLabel} และ ${prevLabel} ให้เทียบ`
            : `ไม่มีเมนูที่${mode === "up" ? "ขึ้น" : "ลง"}เกิน ${CHANGE_STEADY_BAND}% ในช่วงนี้`}
        </p>
      ) : (
        <div className="grid gap-px" onMouseLeave={() => setTip(null)}>
          {rows.map((m, i) => {
            const c = m.change ?? 0;
            const a = pos(0);
            const b = pos(c);
            const colour = Math.abs(c) < CHANGE_STEADY_BAND ? "#D2CBA4" : c > 0 ? "#5A7333" : "#A83A22";
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => ctx?.open(m.id)}
                onMouseMove={(e) => setTip({ m, x: e.clientX, y: e.clientY })}
                className="grid grid-cols-[minmax(110px,200px)_1fr_96px] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
              >
                <span className="truncate text-sm">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: toneOf(m.categoryKey) }} />
                  {m.name}
                </span>
                <span className="relative h-[18px]">
                  <span
                    className="absolute inset-y-0 rounded bg-muted"
                    style={{ left: `${pos(-CHANGE_STEADY_BAND)}%`, width: `${pos(CHANGE_STEADY_BAND) - pos(-CHANGE_STEADY_BAND)}%` }}
                  />
                  <span className="absolute -inset-y-1 left-1/2 w-px bg-border-strong" />
                  <span
                    className="absolute top-1 h-2.5 animate-grow-x rounded-sm"
                    style={{
                      left: `${Math.min(a, b)}%`,
                      width: `${Math.max(0.6, Math.abs(b - a))}%`,
                      background: colour,
                      transformOrigin: c < 0 ? "right" : "left",
                      animationDelay: `${i * 25}ms`,
                    }}
                  />
                </span>
                <span className="text-right text-xs leading-tight tabular-nums text-muted-foreground">
                  <span className={cls(c)}>{pct(c)}</span>
                  <br />
                  {fmtMetric(by, m.perDay)}/วัน
                </span>
              </button>
            );
          })}
        </div>
      )}

      {(changes.fresh.length > 0 || changes.gone.length > 0) && (
        <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          {changes.gone.length > 0 && (
            <p>
              <span className="font-medium text-bad">ไม่มียอดขายใน {curLabel}</span> (เคยขายใน {prevLabel}):{" "}
              {changes.gone.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && " · "}
                  <button type="button" onClick={() => ctx?.open(m.id)} className="underline decoration-dotted underline-offset-2 hover:text-primary">
                    {m.name}
                  </button>
                </span>
              ))}
            </p>
          )}
          {changes.fresh.length > 0 && (
            <p>
              <span className="font-medium text-good">ขายใน {curLabel} แต่ไม่มีใน {prevLabel}</span>:{" "}
              {changes.fresh.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && " · "}
                  <button type="button" onClick={() => ctx?.open(m.id)} className="underline decoration-dotted underline-offset-2 hover:text-primary">
                    {m.name}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-40 w-[270px] animate-fade-in rounded-xl border border-border bg-surface p-3 text-xs shadow-card"
          style={{ left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 280), top: tip.y + 14 }}
        >
          <p className="mb-1.5 font-display text-sm font-semibold">{tip.m.name}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 tabular-nums">
            <dt className="text-muted-subtle">{curLabel}</dt>
            <dd className="text-right">{fmtMetric(by, tip.m.perDay)}/วัน</dd>
            <dt className="text-muted-subtle">{prevLabel}</dt>
            <dd className="text-right">{tip.m.prevPerDay === null ? "—" : `${fmtMetric(by, tip.m.prevPerDay)}/วัน`}</dd>
            <dt className="text-muted-subtle">เปลี่ยน</dt>
            <dd className={`text-right ${cls(tip.m.change ?? 0)}`}>{pct(tip.m.change ?? 0)}</dd>
          </dl>
          <p className="mt-1.5 border-t border-border pt-1.5 text-muted-foreground">
            {Math.abs(tip.m.change ?? 0) < CHANGE_STEADY_BAND ? `เปลี่ยนไม่ถึง ${CHANGE_STEADY_BAND}% ถือว่าปกติ` : "กดเพื่อดู insight ของเมนูนี้"}
          </p>
        </div>
      )}
    </div>
  );
}

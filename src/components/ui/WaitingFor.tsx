"use client";

// ============================================================
// คิดครัว — a figure that is waiting for the shop's data (queue item 10)
// ============================================================
// Kong 2026-11-02: every figure that needs data the shop has not entered yet
// says what it is, shows an example, and goes to where the data is entered —
// "เอาให้ครบๆ". Round 3 of the design (mockup UqiLTa77CSent1W8HuoQoC, "เอา
// แบบที่ 1"): the figure is drawn as its own OUTLINE — dashed, no colour, no
// numbers — with one row above it saying what it fills in from. Never a blur:
// blurred numbers read as "it is there and we are hiding it" (Kong), the look
// of a paywall, which the Standard teaser keeps for itself.
//
//   <WaitingFor>   a card's body while nothing is known: the row + the outline
//   <WaitingSlot>  a small number card's value: a dashed blank "รอ…"
//   <WhatIsThis>   a link in a table cell that opens the same window
//
// The window shows the figure in focus with SAMPLE numbers (a made-up shop,
// labelled — never this shop's data, Kong 2026-10-30), how it is worked out,
// and what THIS shop has entered so far, read from GET /api/readiness when it
// opens. The page names the needs, in order, because only the page knows why
// its number is missing (a blocker, a method, a coverage); `reason` carries
// that page's own sentence.
//
// Overlays go to <body> (mise-ui-review §7: `fixed` inside the animated page
// frame is fixed to the frame).
// ============================================================

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChartColumn, ChartLine, ChartPie, ChartScatter, LayoutGrid, List, Waypoints, X, type LucideIcon } from "lucide-react";
import { FIGURES, NEEDS, needStatus, type FigureCopy, type FigureKey, type NeedKey, type OutlineShape, type Readiness, type SampleKey } from "@/lib/data-needs";

const ICONS: Record<OutlineShape, LucideIcon> = {
  bars: ChartColumn,
  line: ChartLine,
  quadrant: ChartScatter,
  donut: ChartPie,
  heat: LayoutGrid,
  list: List,
  flow: Waypoints,
};

type Common = {
  figure: FigureKey;
  /** In order: the first is the one this figure is waiting on now. */
  needs: readonly NeedKey[];
  /** The page's own sentence about why — e.g. "ยังไม่ได้นับสต็อกต้นงวด". */
  reason?: string;
  /** The branch the page is looking at, so the checklist counts that branch. */
  branchId?: string;
  /** False when this reader cannot enter the data (no capability) — the way-in buttons go. */
  act?: boolean;
};

// ------------------------------------------------------------
// The card body
// ------------------------------------------------------------

export default function WaitingFor({
  figure,
  needs,
  reason,
  branchId,
  act = true,
  shape,
  outline = true,
}: Common & {
  /** Overrides the figure's own shape. */
  shape?: OutlineShape;
  /** False for a short strip (a banner) — the row alone. */
  outline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const f: FigureCopy = FIGURES[figure];
  const s = shape ?? f.shape;
  const Icon = ICONS[s];
  const first = NEEDS[needs[0]];
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface-sunk px-3 py-2.5">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#EEF0DC] text-[#7D8550]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-[1_1_220px]">
          <p className="font-display text-sm font-semibold leading-snug">เติมเอง{first.when}</p>
          <p className="text-xs text-muted-foreground">{reason ?? f.question}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-sm">
            <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full border-[1.5px] border-current text-[10px] font-bold">?</span>
            นี่คืออะไร
          </button>
          {act ? (
            <a href={first.href} className="btn btn-sm">
              {first.cta} ›
            </a>
          ) : null}
        </div>
      </div>
      {outline ? <Ghost shape={s} sample={f.sample} /> : null}
      {open ? <NeedsDialog figure={figure} needs={needs} reason={reason} branchId={branchId} act={act} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------
// A small number card's value
// ------------------------------------------------------------

export function WaitingSlot({ figure, needs, reason, branchId, act }: Common) {
  const [open, setOpen] = useState(false);
  const example = (FIGURES[figure] as FigureCopy).example;
  return (
    <>
      {example ? (
        // The figure's own place, holding a made-up value — same size as the real
        // one, so the card keeps its shape (Kong 2026-11-05, review item 2).
        <span className="flex items-center gap-2">
          <span className="rounded-lg border-[1.5px] border-dashed border-primary-line px-1.5 font-display text-[1.45rem] font-semibold leading-tight text-muted-subtle tabular-nums">
            {example}
          </span>
          <ExampleTag />
        </span>
      ) : null}
      <span className="flex min-h-[38px] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[11px] border-[1.5px] border-dashed border-primary-line bg-[repeating-linear-gradient(-45deg,rgb(174_183_132/0.08)_0_7px,transparent_7px_14px)] px-2.5 py-1.5 font-sans text-[13px] font-normal leading-normal text-muted-foreground">
        <span className="min-w-0">
          {reason ?? (
            <>
              รอ<b className="font-display font-semibold text-foreground">{NEEDS[needs[0]].label}</b>
            </>
          )}
        </span>
        <button type="button" onClick={() => setOpen(true)} className="ml-auto whitespace-nowrap text-xs font-semibold text-primary underline underline-offset-[3px]">
          ดูวิธี ›
        </button>
      </span>
      {open ? <NeedsDialog figure={figure} needs={needs} reason={reason} branchId={branchId} act={act} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// ------------------------------------------------------------
// A cell's "—" with its reason, opening the same window
// ------------------------------------------------------------

export function WhatIsThis({ children = "นี่คืออะไร", ...props }: Common & { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // A cell's link sits inside a clickable row (mise-ui-review §1).
          e.stopPropagation();
          setOpen(true);
        }}
        className="relative z-10 text-xs font-medium text-primary underline underline-offset-[3px]"
      >
        {children}
      </button>
      {open ? <NeedsDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// ------------------------------------------------------------
// Some of it is known: the real figure stays, this says how much
// ------------------------------------------------------------

/**
 * Under a figure worked out from PART of the data (recipes for 41% of sales):
 * a bar of how much, the page's sentence, and the same window. The figure
 * itself carries "อย่างน้อย" / "ไม่เกิน" — that is the page's to print.
 */
export function Coverage({ share, children, ...common }: Common & { share: number; children: ReactNode }) {
  const pct = Math.max(0, Math.min(100, Math.round(share * 100)));
  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-border">
        <span className="block h-full rounded-full bg-[#7D8550]" style={{ width: `${pct}%` }} />
      </span>
      <span>
        {children} · <WhatIsThis {...common}>ดูว่ายังขาดอะไร ›</WhatIsThis>
      </span>
    </div>
  );
}

// ------------------------------------------------------------
// The window
// ------------------------------------------------------------

/** One read per branch per page view; a write elsewhere reloads the page anyway. */
const readinessCache = new Map<string, Promise<Readiness | null>>();
function loadReadiness(branchId?: string): Promise<Readiness | null> {
  const key = branchId ?? "";
  let p = readinessCache.get(key);
  if (!p) {
    p = fetch(`/api/readiness${branchId ? `?branch=${encodeURIComponent(branchId)}` : ""}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) return null;
        const body = (await res.json()) as { ok: boolean; readiness?: Readiness };
        return body.ok && body.readiness ? body.readiness : null;
      })
      .catch(() => null);
    readinessCache.set(key, p);
    // A failed read is not remembered — the next open tries again.
    void p.then((r) => r === null && readinessCache.delete(key));
  }
  return p;
}

/** What the shop has entered (undefined while loading, null when it could not be read). */
export function useReadiness(branchId?: string): Readiness | null | undefined {
  const [ready, setReady] = useState<Readiness | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadReadiness(branchId).then((r) => live && setReady(r));
    return () => {
      live = false;
    };
  }, [branchId]);
  return ready;
}

function NeedsDialog({ figure, needs, reason, branchId, act = true, onClose }: Common & { onClose: () => void }) {
  const f = FIGURES[figure];
  const Icon = ICONS[f.shape];
  const titleId = useId();
  const ready = useReadiness(branchId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const statuses = ready ? needs.map((k) => needStatus(k, ready)) : null;
  const doneCount = statuses?.filter((s) => s.done).length ?? 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-foreground/40 p-4 max-sm:place-items-end max-sm:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="grid max-h-[88vh] w-full max-w-[780px] animate-pop-in grid-cols-1 overflow-y-auto rounded-[20px] bg-background shadow-lg max-sm:max-h-[92vh] max-sm:animate-slide-up max-sm:rounded-b-none"
      >
        <div className="flex items-start gap-3 px-5 pb-1 pt-4">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#EEF0DC] text-[#7D8550]">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-lg font-semibold leading-snug">
              {f.title}
            </h2>
            <p className="text-sm text-muted-foreground">{f.question}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="icon-btn shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid items-start gap-4 px-5 pb-4 pt-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="grid gap-2 rounded-2xl border border-border bg-surface p-3">
            <span className="justify-self-start rounded-full border border-[#E2CE97] bg-[#F8EFD6] px-2 font-display text-[11px] font-semibold text-gold-ink">
              ตัวอย่าง · ร้านสมมุติ
            </span>
            <Example shape={f.shape} sample={"sample" in f ? f.sample : undefined} />
            <p className="text-xs text-muted-foreground">{f.how}</p>
          </div>

          <div className="grid content-start gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-display text-sm font-semibold">ต้องมีอะไรบ้าง</h3>
              {statuses ? (
                <span className="text-xs text-muted-foreground">
                  ร้านนี้มีแล้ว {doneCount} จาก {needs.length}
                </span>
              ) : null}
            </div>
            {reason ? <p className="rounded-xl bg-surface-sunk px-3 py-2 text-[13px] text-muted-foreground">{reason}</p> : null}
            <ol className="grid">
              {needs.map((k, i) => {
                const need = NEEDS[k];
                const st = statuses?.[i];
                const showCta = act && (i === 0 || (st !== undefined && !st.done));
                const isNow = i === 0;
                return (
                  <li key={k} className="relative grid grid-cols-[26px_minmax(0,1fr)] gap-2.5 pb-3.5">
                    {i < needs.length - 1 ? <span aria-hidden className="absolute bottom-0.5 left-3 top-7 w-0.5 bg-border" /> : null}
                    <span
                      aria-hidden
                      className={`grid h-[26px] w-[26px] place-items-center rounded-full font-display text-xs font-bold ${
                        st?.done ? "bg-good text-white" : isNow ? "bg-primary text-primary-foreground" : "border-2 border-border-strong bg-surface text-muted-foreground"
                      }`}
                    >
                      {st?.done ? "✓" : i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-sm font-semibold leading-snug">{need.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {st ? st.text : ready === null ? "อ่านสถานะไม่ได้ ลองเปิดใหม่อีกครั้ง" : <span className="inline-block h-3 w-28 animate-pulse rounded bg-border" />}
                      </p>
                      {showCta ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <a href={need.href} className={isNow ? "btn btn-sm" : "btn-secondary btn-sm"}>
                            {need.cta} ›
                          </a>
                          {need.alt ? (
                            <a href={need.alt.href} className="btn-secondary btn-sm">
                              {need.alt.cta} ›
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>{act ? "ใส่ครบแล้ว ส่วนนี้ขึ้นตัวเลขจริงของร้านเอง" : "เจ้าของร้านหรือผู้จัดการเป็นคนใส่ข้อมูลเหล่านี้ · ใส่ครบแล้วส่วนนี้ขึ้นเอง"}</span>
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">
            ปิด
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ------------------------------------------------------------
// The outlines — the chart's own shape, nothing filled in
// ------------------------------------------------------------

const STROKE = "#AEB784";
const FILL = "#FBF8EE";
const FAINT = "#B9B48F";
const AXIS = "#E9E3C8";
const dash = { fill: FILL, stroke: STROKE, strokeWidth: 1.4, strokeDasharray: "4 3" } as const;

const BAR_H = [62, 72, 56, 68, 88, 110, 102, 60, 66, 54, 74, 92, 106, 98];
/** A month of days for a full-width daily chart: the fortnight twice over, Sat–Sun higher. */
const MONTH_H = [...BAR_H, 64, 58, 70, 66, 84, 104, 96, 62, 56, 68, 72, 90, 108, 100];
/** Monday to Sunday, the weekend busiest — the shape most Thai shops see. */
const WEEK_H = [70, 66, 64, 68, 74, 104, 98];
const WEEK_LABELS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
const MUSTARD = ["#B8900F", "#E7C860"] as const;

/** The small "ตัวอย่าง" tag on anything made up. */
export function ExampleTag() {
  return <span className="shrink-0 rounded-full border border-[#E2CE97] bg-[#F8EFD6] px-2 font-display text-[11px] font-semibold text-gold-ink">ตัวอย่าง</span>;
}

/**
 * A place on the page that waits for data, holding a made-up example of what
 * will go there (Kong 2026-11-05: "layout มันต้องเหมือนกันกับตอนที่มีข้อมูล แล้ว
 * ต้องมีตัวอย่างให้ดูทุกองค์ประกอบ"). The dashed edge says WAITING — the same
 * edge as a WaitingSlot (Kong 2026-11-02: missing data is a dashed slot, never
 * blur); the pale content and the tag say EXAMPLE, never this shop's figures.
 */
export function ExampleFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`relative rounded-xl border-[1.5px] border-dashed border-primary-line bg-[repeating-linear-gradient(-45deg,rgb(174_183_132/0.06)_0_7px,transparent_7px_14px)] p-3 ${className}`}
    >
      <span className="absolute right-2 top-2 z-10">
        <ExampleTag />
      </span>
      <div aria-hidden className="pointer-events-none select-none opacity-50 saturate-[0.6]">
        {children}
      </div>
      <p className="sr-only">ตัวอย่างจากร้านสมมุติ ไม่ใช่ข้อมูลของร้านนี้</p>
    </div>
  );
}

/** The chart as it WILL look, from a made-up shop. It replaced a bare dashed outline. */
export function Ghost({ shape, sample }: { shape: OutlineShape; sample?: SampleKey }) {
  return (
    <ExampleFrame className="pt-8">
      <svg viewBox={viewOf(shape, sample)} className="mx-auto block h-auto max-h-[200px] w-full">
        <Shape shape={shape} filled sample={sample} />
      </svg>
    </ExampleFrame>
  );
}

export function Outline({ shape }: { shape: OutlineShape }) {
  return (
    // Capped: in a full-width card the outline would otherwise grow to half the screen.
    <svg viewBox={VIEW[shape]} className="block h-auto max-h-[200px] w-full" role="img" aria-label="โครงของกราฟ ยังไม่มีข้อมูล">
      <Shape shape={shape} filled={false} />
    </svg>
  );
}

function Example({ shape, sample }: { shape: OutlineShape; sample?: SampleKey }) {
  return (
    <svg viewBox={viewOf(shape, sample)} className="block h-auto w-full" role="img" aria-label="ภาพตัวอย่างจากร้านสมมุติ">
      <Shape shape={shape} filled sample={sample} />
    </svg>
  );
}

/** Made-up rows for a list example — every one names its own shop, never this one. */
const LIST_SAMPLES: Record<string, [string, number, string, boolean][]> = {
  movers: [
    ["ข้าวกะเพราหมูกรอบ", 1, "+฿420/วัน", true],
    ["ต้มยำกุ้งน้ำข้น", 0.74, "+฿310/วัน", true],
    ["ผัดซีอิ๊วหมู", 0.52, "−฿180/วัน", false],
    ["ชาเย็น", 0.33, "−฿95/วัน", false],
  ],
  stock: [
    ["หมูสับ", 1, "฿4,800 · 12 วัน", true],
    ["กุ้งขาว", 0.81, "฿3,900 · 3 วัน", true],
    ["น้ำมันพืช", 0.25, "฿1,200 · 48 วัน", false],
    ["ไข่ไก่", 0.18, "฿860 · 2 วัน", true],
  ],
  days: [
    ["ข้าวสาร", 1, "อีก 21 วัน", true],
    ["น้ำมันพืช", 0.62, "อีก 13 วัน", true],
    ["หมูสับ", 0.19, "อีก 4 วัน", false],
    ["กุ้งขาว", 0.1, "อีก 2 วัน", false],
  ],
  dish: [
    ["ไข่ไก่ 2 ฟอง", 0.43, "฿8.40", true],
    ["หมูสับ 60 g", 0.49, "฿9.60", true],
    ["ข้าวสวย 1 จาน", 0.2, "฿4.00", true],
    ["น้ำมันพืช 30 ml", 0.08, "฿1.50", true],
  ],
  over: [
    ["ต้มยำกุ้งน้ำข้น", 1, "42% · เป้า 35%", false],
    ["ผัดไทยกุ้งสด", 0.86, "39% · เป้า 35%", false],
    ["ข้าวกะเพราหมูกรอบ", 0.62, "28% · ในเป้า", true],
    ["ชาเย็น", 0.4, "18% · ในเป้า", true],
  ],
  posted: [
    ["1 ต.ค. · ครอบคลุม 96%", 0.96, "ตัดแล้ว", true],
    ["2 ต.ค. · ครอบคลุม 94%", 0.94, "ตัดแล้ว", true],
    ["3 ต.ค. · ครอบคลุม 61%", 0.61, "ตัดแล้ว", true],
    ["4 ต.ค.", 0.3, "ยังไม่ได้ตัด", false],
  ],
};

const viewOf = (shape: OutlineShape, sample?: SampleKey) => (shape === "bars" && sample === "month" ? "0 0 660 150" : VIEW[shape]);
const VIEW: Record<OutlineShape, string> = {
  bars: "0 0 340 150",
  line: "0 0 340 150",
  quadrant: "0 0 340 210",
  donut: "0 0 340 150",
  heat: "0 0 340 170",
  list: "0 0 340 150",
  flow: "0 0 340 160",
};

const OLIVE = ["#5E6B14", "#9DAA55"] as const;
const CLAY = "#C0692B";

function Shape({ shape, filled, sample }: { shape: OutlineShape; filled: boolean; sample?: SampleKey }) {
  const text = { fontFamily: "Noto Sans Thai, sans-serif", fontSize: 10.5, fill: filled ? "#5A5C31" : FAINT } as const;
  const head = { fontFamily: "Prompt, sans-serif", fontSize: 10.5, fontWeight: 600, fill: filled ? "#8B8D63" : FAINT } as const;
  switch (shape) {
    case "bars": {
      // sample "month": the daily chart (weekends mustard, as SalesCharts draws them);
      // "week": วันไหนขายดี; otherwise a fortnight of days.
      const month = sample === "month";
      const week = sample === "week";
      const hs = month ? MONTH_H : week ? WEEK_H : BAR_H;
      const step = week ? 44 : 22;
      const barW = week ? 30 : 16;
      const right = month ? 650 : 330;
      const best = hs.indexOf(Math.max(...hs));
      return (
        <>
          {filled ? (
            <defs>
              <linearGradient id="wf-olive" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={OLIVE[0]} />
                <stop offset="1" stopColor={OLIVE[1]} />
              </linearGradient>
              <linearGradient id="wf-mustard" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={MUSTARD[0]} />
                <stop offset="1" stopColor={MUSTARD[1]} />
              </linearGradient>
            </defs>
          ) : null}
          <line x1="10" y1="132" x2={right} y2="132" stroke={AXIS} strokeWidth="1.5" />
          {hs.map((h, i) => {
            const x = (week ? 26 : 16) + i * step;
            if (!filled) return <rect key={i} x={x} y={132 - h} width={barW} height={h} rx="4" {...dash} />;
            const weekend = month && (i % 7 === 5 || i % 7 === 6);
            const fill = i === best ? CLAY : weekend ? "url(#wf-mustard)" : "url(#wf-olive)";
            return <rect key={i} x={x} y={132 - h} width={barW} height={h} rx="4" fill={fill} />;
          })}
          {week ? (
            WEEK_LABELS.map((d, i) => (
              <text key={d} x={26 + i * step + barW / 2} y="146" textAnchor="middle" {...text}>
                {d}
              </text>
            ))
          ) : (
            <>
              <text x="16" y="146" {...text}>
                1
              </text>
              <text x={right - 12} y="146" textAnchor="end" {...text}>
                {filled ? (month ? "28 ต.ค." : "26 ต.ค.") : "วันที่"}
              </text>
            </>
          )}
        </>
      );
    }
    case "line": {
      const pts = [100, 92, 96, 80, 70, 74, 58, 62, 48, 54, 40, 44, 34].map((y, i) => `${16 + i * 25},${y}`).join(" ");
      return (
        <>
          {[40, 70, 100].map((y) => (
            <line key={y} x1="10" y1={y} x2="330" y2={y} stroke={AXIS} strokeDasharray="2 4" />
          ))}
          <line x1="10" y1="130" x2="330" y2="130" stroke={AXIS} strokeWidth="1.5" />
          <polyline points={pts} fill="none" stroke={filled ? OLIVE[0] : STROKE} strokeWidth={filled ? 2.2 : 1.6} strokeDasharray={filled ? undefined : "5 4"} />
          {filled ? <circle cx={16 + 12 * 25} cy="34" r="4.5" fill={CLAY} /> : null}
        </>
      );
    }
    case "quadrant": {
      const dots: [number, number, number, string?][] = [
        [268, 52, 10, "ข้าวผัดกุ้ง"],
        [222, 84, 8],
        [292, 142, 9, "ไข่เจียวหมูสับ"],
        [98, 58, 7, "ต้มยำกุ้ง"],
        [74, 150, 6],
        [132, 132, 6],
        [214, 126, 7],
        [122, 86, 6],
        [196, 156, 6],
        [150, 62, 5],
      ];
      return (
        <>
          <path d="M30 10 V186 H330" fill="none" stroke={AXIS} strokeWidth="1.5" />
          <line x1="180" y1="14" x2="180" y2="184" stroke="#E1DAB9" strokeDasharray="3 5" />
          <line x1="32" y1="98" x2="328" y2="98" stroke="#E1DAB9" strokeDasharray="3 5" />
          {/* The same four names as the real chart (MenuEngineering.tsx). */}
          <text x="40" y="26" {...head}>
            ? ปริศนา
          </text>
          <text x="322" y="26" textAnchor="end" {...head}>
            ★ ดาวเด่น
          </text>
          <text x="40" y="178" {...head}>
            ✕ ทบทวน
          </text>
          <text x="322" y="178" textAnchor="end" {...head}>
            ♞ ม้างาน
          </text>
          {dots.map(([x, y, r, name], i) =>
            filled ? (
              <g key={i}>
                <circle cx={x} cy={y} r={r} fill={i === 0 ? CLAY : OLIVE[0]} stroke="#fff" strokeWidth="2" />
                {name ? (
                  <text x={x - r - 4} y={y + 4} textAnchor="end" {...text} fill="#262811">
                    {name}
                  </text>
                ) : null}
              </g>
            ) : (
              <circle key={i} cx={x} cy={y} r={r} fill="none" stroke={STROKE} strokeWidth="1.6" strokeDasharray="3 3" />
            )
          )}
          <text x="180" y="204" textAnchor="middle" {...text}>
            จานต่อวัน →
          </text>
          <text x="14" y="98" transform="rotate(-90 14 98)" textAnchor="middle" {...text}>
            กำไรต่อจาน →
          </text>
        </>
      );
    }
    case "donut": {
      // sample "expense": where a month's bills went, not menu categories.
      const parts: [number, string, string][] =
        sample === "expense"
          ? [
              [0.46, "ค่าแรง", "#5E6B14"],
              [0.24, "ค่าเช่า", "#C0692B"],
              [0.17, "ค่าน้ำไฟ", "#00857B"],
              [0.13, "อื่น ๆ", "#8A4F9E"],
            ]
          : [
              [0.38, "ข้าว", "#5E6B14"],
              [0.24, "เส้น", "#C0692B"],
              [0.21, "ต้ม / แกง", "#00857B"],
              [0.17, "เครื่องดื่ม", "#8A4F9E"],
            ];
      const R = 52;
      const C = 2 * Math.PI * R;
      let acc = 0;
      return (
        <>
          <circle cx="80" cy="75" r={R} fill="none" stroke={filled ? "#F3EFDF" : FILL} strokeWidth="22" />
          {parts.map(([p, , col], i) => {
            const seg = (
              <circle
                key={i}
                cx="80"
                cy="75"
                r={R}
                fill="none"
                stroke={filled ? col : STROKE}
                strokeWidth={filled ? 22 : 1.6}
                strokeDasharray={filled ? `${p * C - 2} ${C}` : "4 4"}
                strokeDashoffset={filled ? -acc * C : undefined}
                transform="rotate(-90 80 75)"
              />
            );
            acc += p;
            return filled ? seg : i === 0 ? seg : null;
          })}
          {!filled ? <circle cx="80" cy="75" r={R - 22} fill="none" stroke={STROKE} strokeWidth="1.4" strokeDasharray="4 4" /> : null}
          {parts.map(([p, name, col], i) => (
            <g key={name}>
              <rect x="170" y={32 + i * 24} width="10" height="10" rx="3" fill={filled ? col : FILL} stroke={filled ? "none" : STROKE} strokeDasharray="3 2" />
              {filled ? (
                <text x="188" y={41 + i * 24} {...text} fill="#262811">
                  {name} · {Math.round(p * 100)}%
                </text>
              ) : (
                <rect x="188" y={33 + i * 24} width={90 - i * 12} height="8" rx="4" {...dash} />
              )}
            </g>
          ))}
        </>
      );
    }
    case "heat": {
      const days = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
      const rows = filled ? ["ข้าว", "เส้น", "ต้ม/แกง", "เครื่องดื่ม"] : ["", "", "", ""];
      const v = [
        [3, 3, 4, 3, 5, 7, 6],
        [2, 3, 2, 3, 4, 6, 5],
        [2, 2, 3, 2, 3, 4, 4],
        [1, 2, 2, 2, 3, 5, 4],
      ];
      const shade = (x: number) => ["#F8F3E1", "#EEF0DC", "#DCE1BE", "#C3CC94", "#A6B26C", "#86934A", "#5E6B14"][x - 1] ?? "#F8F3E1";
      return (
        <>
          {days.map((d, j) => (
            <text key={d} x={86 + j * 36 + 14} y="16" textAnchor="middle" {...text}>
              {d}
            </text>
          ))}
          {rows.map((name, i) => (
            <g key={i}>
              {filled ? (
                <text x="76" y={44 + i * 34} textAnchor="end" {...text} fill="#262811">
                  {name}
                </text>
              ) : (
                <rect x="20" y={34 + i * 34} width="52" height="8" rx="4" {...dash} />
              )}
              {days.map((d, j) =>
                filled ? (
                  <g key={d}>
                    <rect x={86 + j * 36} y={26 + i * 34} width="30" height="28" rx="6" fill={shade(v[i][j])} />
                    {i === 0 && j === 5 ? (
                      <text x={86 + j * 36 + 15} y={26 + i * 34 + 18} textAnchor="middle" fontSize="12" fill="#F8F3E1">
                        ★
                      </text>
                    ) : null}
                  </g>
                ) : (
                  <rect key={d} x={86 + j * 36} y={26 + i * 34} width="30" height="28" rx="6" {...dash} />
                )
              )}
            </g>
          ))}
        </>
      );
    }
    case "list": {
      const rows = LIST_SAMPLES[sample ?? "movers"] ?? LIST_SAMPLES.movers;
      return (
        <>
          {rows.map(([name, w, val, good], i) => (
            <g key={name}>
              {filled ? (
                <>
                  <text x="12" y={30 + i * 32} {...text} fill="#262811">
                    {name}
                  </text>
                  <rect x="140" y={20 + i * 32} width={110 * w} height="14" rx="5" fill={good ? OLIVE[0] : "#DD8A74"} />
                  <text x="330" y={31 + i * 32} textAnchor="end" {...text}>
                    {val}
                  </text>
                </>
              ) : (
                <>
                  <rect x="12" y={22 + i * 32} width={96 - i * 8} height="9" rx="4.5" {...dash} />
                  <rect x="140" y={20 + i * 32} width={110 * w} height="14" rx="5" {...dash} />
                </>
              )}
            </g>
          ))}
        </>
      );
    }
    case "flow": {
      // A waterfall: sales down to profit, or (sample "cogs") the stock equation.
      const steps: [string, number, number, string, string][] =
        sample === "cogs"
          ? [
              // To scale: 42,300 + 61,800 = 104,100 fills the 120px column.
              ["ต้นงวด", 91, 49, "฿42,300", "#9DAA55"],
              ["ซื้อเข้า", 20, 71, "+฿61,800", OLIVE[0]],
              ["ปลายงวด", 20, 45, "−฿38,900", "#C7CC9B"],
              ["ใช้ไป", 65, 75, "฿65,200", CLAY],
            ]
          : [
              ["ยอดขาย", 20, 120, "฿186,240", OLIVE[0]],
              ["ต้นทุนอาหาร", 20, 42, "−฿65,200", "#DD8A74"],
              ["ค่าใช้จ่าย", 62, 64, "−฿99,180", "#E8A76F"],
              ["กำไร", 126, 14, "฿21,860", "#5A7333"],
            ];
      return (
        <>
          <line x1="10" y1="140" x2="330" y2="140" stroke={AXIS} strokeWidth="1.5" />
          {steps.map(([name, top, h, val, col], i) => (
            <g key={name}>
              <rect x={24 + i * 80} y={top} width="52" height={h} rx="5" {...(filled ? { fill: col } : dash)} />
              <text x={50 + i * 80} y="154" textAnchor="middle" {...text}>
                {name}
              </text>
              {filled ? (
                <text x={50 + i * 80} y={top - 4} textAnchor="middle" {...text} fill="#262811">
                  {val}
                </text>
              ) : null}
            </g>
          ))}
        </>
      );
    }
  }
}

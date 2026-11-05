"use client";

// ============================================================
// คิดครัว — the "?" window, round 2: the page explained by the page itself
// ============================================================
// Kong 2026-11-05 on round 1 (a text window): "แค่นั้นหรอที่ทำ ง่อยไปป่าว".
// This window shows the page it sits on:
//   ในหน้านี้มีอะไร  — a map of the page's parts and a list of them, each with
//                     what it answers and whether its data is there; "ดูบนหน้า"
//                     closes the window and rings that part on the real page
//                     (Spotlight), "ดูทีละส่วน" walks all of them — skippable,
//                     never forced (NN/g: overlays stay short and optional)
//   วิธีคิดตัวเลข     — how each headline number is worked out
//   ที่มาของข้อมูล    — the data it reads, with THIS shop's status and newest
//                     date, and the pages that use its numbers next
//   ความสำคัญ        — a worked example from a made-up shop, labelled so
//
// A part is listed only when the page drew it (data-help="<id>"): a reader
// without cost access, or another view, simply has fewer parts. A part whose
// data is there but whose period is empty carries data-waiting inside it.
// ============================================================

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { NEEDS, NEED_KEYS, needPartial, needStatus, type NeedKey, type Readiness } from "@/lib/data-needs";
import type { HelpSection, PageHelpCopy } from "@/lib/page-help";

type Tab = "map" | "calc" | "data" | "why";
type Part = HelpSection & { no: number; state: "ready" | "partial" | "needs" | "empty"; missing: NeedKey[] };

const isNeed = (u: string): u is NeedKey => (NEED_KEYS as readonly string[]).includes(u);
const CLAY = "#C0692B";

/** The parts the page actually drew, numbered in page order, with their state. */
function useParts(sections: HelpSection[], ready: Readiness | null | undefined): Part[] {
  const [present, setPresent] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const p: Record<string, boolean> = {};
    for (const s of sections) {
      const el = document.querySelector(`[data-help="${s.id}"]`);
      p[s.id] = !!el;
      p[`${s.id}:waiting`] = !!el?.querySelector("[data-waiting]");
    }
    setPresent(p);
  }, [sections]);
  return useMemo(() => {
    let no = 0;
    return sections
      .filter((s) => present[s.id])
      .map((s) => {
        const missing = ready ? s.needs.filter((k) => !needStatus(k, ready).done) : [];
        // Partly there (19 of 29 recipes) is usable; none at all is waiting.
        const none = ready ? missing.filter((k) => !needPartial(k, ready)) : [];
        const state: Part["state"] = none.length
          ? "needs"
          : present[`${s.id}:waiting`]
            ? "empty"
            : missing.length
              ? "partial"
              : "ready";
        return { ...s, no: ++no, state, missing: none.length ? none : missing };
      });
  }, [sections, present, ready]);
}

const stateChip = (p: Part) =>
  p.state === "ready" ? (
    <span className="chip chip-good">พร้อม</span>
  ) : p.state === "partial" ? (
    <span className="chip chip-warn">{NEEDS[p.missing[0]].label}ยังไม่ครบ</span>
  ) : p.state === "empty" ? (
    <span className="chip chip-warn">ช่วงนี้ยังไม่มีข้อมูล</span>
  ) : (
    <span className="chip chip-bad">รอ{NEEDS[p.missing[0]].label}</span>
  );

export function GuideDialog({ h, ready, onClose }: { h: PageHelpCopy; ready: Readiness | null | undefined; onClose: () => void }) {
  const titleId = useId();
  const [tab, setTab] = useState<Tab>("map");
  const [hot, setHot] = useState<string | null>(null);
  const [spot, setSpot] = useState<{ index: number; tour: boolean } | null>(null);
  const parts = useParts(h.sections ?? [], ready);
  // Usable = ready or partly there; the rest wait for data or for this period.
  const readyCount = parts.filter((p) => p.state === "ready" || p.state === "partial").length;
  const waiting = parts.filter((p) => p.state === "needs" || p.state === "empty");
  const partial = parts.filter((p) => p.state === "partial");

  useEffect(() => {
    if (spot) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, spot]);

  if (spot) {
    return (
      <Spotlight
        parts={parts}
        index={spot.index}
        tour={spot.tour}
        onIndex={(index) => setSpot({ ...spot, index })}
        onBack={() => setSpot(null)}
        onClose={onClose}
      />
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-foreground/40 p-4 font-sans text-base font-normal tracking-normal max-sm:place-items-end max-sm:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-[880px] animate-pop-in flex-col overflow-hidden rounded-[20px] bg-background shadow-lg max-sm:max-h-[94vh] max-sm:animate-slide-up max-sm:rounded-b-none"
      >
        <header className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-border bg-surface px-5 pb-3 pt-4">
          <h2 id={titleId} className="font-display text-lg font-semibold leading-snug">
            หน้านี้คืออะไร · {h.title}
          </h2>
          <button type="button" onClick={onClose} aria-label="ปิด" className="icon-btn row-span-2">
            <X className="h-4 w-4" />
          </button>
          <p className="text-sm text-muted-foreground">{h.question}</p>
          {parts.length > 0 ? (
            <div className="col-span-2 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <span className="flex gap-[3px]" aria-hidden>
                {parts.map((p) => (
                  <i key={p.id} className={`h-2 w-5 rounded ${p.state === "ready" ? "bg-good" : p.state === "partial" ? "bg-[#D9AC42]" : "border-[1.4px] border-dashed border-sage"}`} />
                ))}
              </span>
              <span>
                <b className="font-display font-semibold">
                  ใช้ได้ {readyCount} จาก {parts.length} ส่วน
                </b>
                {statusLine(parts)}
              </span>
              {waiting.some((p) => p.state === "needs") || partial.length ? (
                <button type="button" className="link text-[13px]" onClick={() => setTab("data")}>
                  ดูว่าขาดอะไร ›
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        <div className="px-5 pt-3">
          <div className="seg max-w-full flex-nowrap overflow-x-auto" role="tablist" aria-label="หัวข้อ">
            {(
              [
                ["map", "ในหน้านี้มีอะไร"],
                ["calc", "วิธีคิดตัวเลข"],
                ["data", "ที่มาของข้อมูล"],
                ["why", "ความสำคัญ"],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`seg-item whitespace-nowrap ${tab === k ? "is-on" : ""}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
          {tab === "map" ? (
            <div className="grid gap-4">
              <div className="grid items-start gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
                <div className="max-md:max-w-[220px] md:sticky md:top-0">
                  <PageMap layout={h.layout ?? []} parts={parts} hot={hot} setHot={setHot} onPick={(i) => setSpot({ index: i, tour: false })} />
                  <p className="mt-1.5 text-xs text-muted-foreground">ผังของหน้านี้ · กดช่องเพื่อดูบนหน้า</p>
                </div>
                <ol className="grid gap-2">
                  {parts.map((p, i) => (
                    <li
                      key={p.id}
                      onMouseEnter={() => setHot(p.id)}
                      onMouseLeave={() => setHot(null)}
                      className={`grid grid-cols-[26px_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 rounded-2xl border bg-surface px-3 py-2.5 transition-colors ${hot === p.id ? "border-[#C0692B]" : "border-border"}`}
                    >
                      <span
                        aria-hidden
                        className={`row-span-2 mt-0.5 grid h-6 w-6 place-items-center rounded-full font-display text-xs font-bold ${p.state === "ready" || p.state === "partial" ? "bg-primary text-primary-foreground" : "border-[1.4px] border-dashed border-sage text-muted-subtle"}`}
                      >
                        {p.no}
                      </span>
                      <b className="font-display text-sm font-semibold">{p.title}</b>
                      <span className="row-span-2 grid justify-items-end gap-1">
                        {stateChip(p)}
                        <button type="button" className="link text-xs" onClick={() => setSpot({ index: i, tour: false })}>
                          ดูบนหน้า ›
                        </button>
                      </span>
                      <span className="text-[13px] text-muted-foreground">{p.answers}</span>
                    </li>
                  ))}
                </ol>
              </div>
              {parts.length > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <p className="text-[13px] text-muted-foreground">ดูทีละส่วนตั้งแต่ต้นจนจบ ข้ามหรือหยุดได้ทุกเมื่อ</p>
                  <button type="button" className="btn btn-sm" onClick={() => setSpot({ index: 0, tour: true })}>
                    ดูทีละส่วน ({parts.length})
                  </button>
                </div>
              ) : null}
            </div>
          ) : tab === "calc" ? (
            <div className="grid gap-3 md:grid-cols-2">
              {(h.formulas ?? []).map((f) => (
                <div key={f.name} className="grid content-start gap-1.5 rounded-2xl border border-border bg-surface p-3.5">
                  <b className="font-display text-[0.95rem] font-semibold">{f.name}</b>
                  <span className="rounded-xl bg-surface-sunk px-3 py-1.5 font-display text-sm text-primary">{f.formula}</span>
                  {f.includes?.length || f.excludes?.length ? (
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {f.includes?.map((x) => (
                        <span key={x}>
                          <b className="text-good">✓</b> {x}
                        </span>
                      ))}
                      {f.excludes?.map((x) => (
                        <span key={x}>
                          <b className="text-bad">✕</b> ไม่รวม{/^[A-Za-z]/.test(x) ? ` ${x}` : x}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {f.note ? <span className="text-[13px] text-muted-foreground">{f.note}</span> : null}
                </div>
              ))}
            </div>
          ) : tab === "data" ? (
            <DataFlow h={h} ready={ready} />
          ) : (
            <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              {h.example ? (
                <div className="grid gap-1.5 rounded-2xl border border-border bg-surface p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="font-display text-[0.95rem] font-semibold">{h.example.title}</b>
                    <span className="rounded-full border border-[#E2CE97] bg-[#F8EFD6] px-2 font-display text-[11px] font-semibold text-gold-ink">ตัวอย่าง · ร้านสมมุติ</span>
                  </div>
                  {h.example.rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-dashed border-border pb-1 text-[13px]">
                      <span>{k}</span>
                      <b className="font-display font-semibold tabular-nums">{v}</b>
                    </div>
                  ))}
                  <p className="text-[13px] text-muted-foreground">{h.example.note}</p>
                </div>
              ) : null}
              <div className="grid gap-1.5 rounded-2xl border border-border bg-surface p-3.5">
                <b className="font-display text-[0.95rem] font-semibold">ร้านเห็นอะไรจากหน้านี้</b>
                <p className="text-[13px] text-muted-foreground">{h.why}</p>
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-5 py-3 text-xs text-muted-foreground">
          <span>เปิดได้ทุกเมื่อจากปุ่ม ? ข้างชื่อหน้า</span>
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">
            ปิด
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

/** " · 7 ส่วนยังไม่มีข้อมูลในช่วงที่เลือก · 1 ส่วนรอสูตรของเมนู" — each reason with its own count. */
function statusLine(parts: Part[]): string {
  const labels = (ps: Part[]) => [...new Set(ps.flatMap((p) => p.missing))].map((k) => NEEDS[k].label).join(" และ");
  const needs = parts.filter((p) => p.state === "needs");
  const empty = parts.filter((p) => p.state === "empty");
  const partial = parts.filter((p) => p.state === "partial");
  const bits = [
    needs.length ? `${needs.length} ส่วนรอ${labels(needs)}` : "",
    empty.length ? `${empty.length} ส่วนยังไม่มีข้อมูลในช่วงที่เลือก` : "",
    partial.length ? `${partial.length} ส่วนคิดจากข้อมูลเท่าที่มี (${labels(partial)}ยังไม่ครบ)` : "",
  ].filter(Boolean);
  return bits.length ? ` · ${bits.join(" · ")}` : " · ครบทุกส่วน";
}

/** The page drawn small: one box per part, where it sits. */
function PageMap({ layout, parts, hot, setHot, onPick }: { layout: string[][]; parts: Part[]; hot: string | null; setHot: (id: string | null) => void; onPick: (index: number) => void }) {
  const byId = new Map(parts.map((p, i) => [p.id, { p, i }]));
  const rows = layout.map((r) => r.filter((id) => byId.has(id))).filter((r) => r.length);
  return (
    <div className="grid gap-1.5 rounded-2xl border border-border bg-surface p-2" aria-label="ผังของหน้า">
      {rows.map((r) => (
        <div key={r.join()} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${r.length}, minmax(0, 1fr))` }}>
          {r.map((id) => {
            const { p, i } = byId.get(id)!;
            return (
              <button
                key={id}
                type="button"
                title={p.title}
                onClick={() => onPick(i)}
                onMouseEnter={() => setHot(id)}
                onMouseLeave={() => setHot(null)}
                className={`rounded-md font-display text-[11px] font-bold transition-colors ${p.tall ? "h-10" : "h-6"} ${
                  hot === id
                    ? "border-[1.4px] border-[#C0692B] bg-[#C0692B] text-white"
                    : p.state === "ready" || p.state === "partial"
                      ? "border-[1.4px] border-border-strong bg-surface-sunk text-muted-foreground"
                      : "border-[1.4px] border-dashed border-sage bg-[#FBF8EE] text-muted-subtle"
                }`}
              >
                {p.no}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** What the page reads (with this shop's status) → the page → where its numbers go next. */
function DataFlow({ h, ready }: { h: PageHelpCopy; ready: Readiness | null | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  const ins = useRef<(HTMLDivElement | null)[]>([]);
  const outs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [wires, setWires] = useState<{ d: string; dashed: boolean }[]>([]);

  useLayoutEffect(() => {
    const draw = () => {
      const b = box.current?.getBoundingClientRect();
      const c = hub.current?.getBoundingClientRect();
      if (!b || !c || window.innerWidth < 768) return setWires([]);
      const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
      const hy = c.top - b.top + c.height / 2;
      const next: { d: string; dashed: boolean }[] = [];
      ins.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const u = h.uses[i];
        const dashed = isNeed(u) && !!ready && !needStatus(u, ready).done && !needPartial(u, ready);
        next.push({ d: curve(r.right - b.left, r.top - b.top + r.height / 2, c.left - b.left, hy), dashed });
      });
      outs.current.forEach((el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        next.push({ d: curve(c.right - b.left, hy, r.left - b.left, r.top - b.top + r.height / 2), dashed: false });
      });
      setWires(next);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [h, ready]);

  return (
    <div className="grid gap-3">
      <div ref={box} className="relative grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible max-md:hidden">
          {wires.map((w, i) => (
            <path key={i} d={w.d} fill="none" stroke={w.dashed ? "#AEB784" : "#7D8550"} strokeWidth={1.8} strokeDasharray={w.dashed ? "5 4" : undefined} />
          ))}
        </svg>
        <div className="grid gap-2">
          <span className="font-display text-xs font-semibold text-muted-subtle">ข้อมูลที่หน้านี้ใช้ (สถานะของร้านนี้)</span>
          {h.uses.map((u, i) => {
            if (!isNeed(u))
              return (
                <div key={u} ref={(el) => void (ins.current[i] = el)} className="rounded-2xl border border-border bg-surface px-3 py-2 text-[13px]">
                  <b className="font-display text-sm font-semibold">{u}</b>
                </div>
              );
            const st = ready ? needStatus(u, ready) : null;
            const some = !!ready && needPartial(u, ready);
            const need = NEEDS[u];
            return (
              <div
                key={u}
                ref={(el) => void (ins.current[i] = el)}
                className={`grid gap-1 rounded-2xl border px-3 py-2 ${st && !st.done && !some ? "border-dashed border-sage bg-[#FBF8EE]" : "border-border bg-surface"}`}
              >
                <b className="font-display text-sm font-semibold">{need.label}</b>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {st ? (
                    <span className={`chip ${st.done ? "chip-good" : some ? "chip-warn" : "chip-bad"}`}>{st.done ? "มีแล้ว" : some ? "มีบางส่วน" : "ยังไม่มี"}</span>
                  ) : (
                    <span className="inline-block h-5 w-14 animate-pulse rounded-full bg-border" />
                  )}
                  {st ? st.text : ready === null ? "อ่านสถานะไม่ได้ ลองเปิดใหม่อีกครั้ง" : null}
                  {st && !st.done ? (
                    <a href={need.href} className="link text-xs">
                      {need.cta} ›
                    </a>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
        <div ref={hub} className="grid place-items-center gap-0.5 rounded-2xl bg-primary px-3 py-4 text-center font-display text-primary-foreground max-md:order-first">
          <b className="text-base font-bold">{h.title}</b>
          <small className="text-xs opacity-80">หน้านี้</small>
        </div>
        <div className="grid gap-2">
          <span className="font-display text-xs font-semibold text-muted-subtle">ตัวเลขของหน้านี้ใช้ต่อที่</span>
          {(h.feeds ?? []).map((f, i) => (
            <a
              key={f.to}
              ref={(el) => void (outs.current[i] = el)}
              href={f.href}
              className="grid gap-0.5 rounded-2xl border border-border bg-surface px-3 py-2 transition-colors hover:border-primary-line hover:bg-surface-sunk"
            >
              <b className="font-display text-sm font-semibold">{f.to} ›</b>
              <span className="text-xs text-muted-foreground">{f.what}</span>
            </a>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">ข้อมูลที่ยังไม่มีเป็นกรอบเส้นประ พร้อมปุ่มไปเพิ่ม · สถานะและวันที่ล่าสุดอ่านจากร้านนี้ทุกครั้งที่เปิด</p>
    </div>
  );
}

/**
 * Rings one part of the real page and says what it is. Opened from the
 * window, one part at a time or as a walk through all of them; Esc, a click
 * outside the card, or "ปิด" ends it.
 */
function Spotlight({
  parts,
  index,
  tour,
  onIndex,
  onBack,
  onClose,
}: {
  parts: Part[];
  index: number;
  tour: boolean;
  onIndex: (i: number) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const p = parts[index];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-help="${p.id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Follow the part while the page scrolls to it (and if the reader scrolls).
    let raf = 0;
    const tick = () => {
      setRect(el.getBoundingClientRect());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (tour && e.key === "ArrowRight" && index < parts.length - 1) onIndex(index + 1);
      if (tour && e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, onClose, onIndex, parts.length, tour]);

  const pad = 6;
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const cardW = Math.min(360, vw - 24);
  const cardH = card.current?.offsetHeight ?? 150;
  let top = 0;
  let left = 12;
  if (rect) {
    left = Math.min(Math.max(12, rect.left), vw - cardW - 12);
    const below = rect.bottom + pad + 12;
    top = below + cardH < vh - 8 ? below : Math.max(8, rect.top - pad - 12 - cardH);
    // A part taller than the screen: keep the card inside the view, over the part.
    if (top + cardH > vh - 8) top = vh - cardH - 8;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 font-sans text-base font-normal tracking-normal" onMouseDown={(e) => !card.current?.contains(e.target as Node) && onClose()}>
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-[20px] transition-[top,left,width,height] duration-300 ease-out"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: `0 0 0 3px ${CLAY}, 0 0 0 9999px rgb(38 40 17 / 0.55)`,
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-foreground/50" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-live="polite"
        aria-label={p.title}
        className="fixed grid animate-pop-in gap-1.5 rounded-2xl bg-surface p-3.5 shadow-lg"
        style={{ top, left, width: cardW }}
      >
        <span className="font-display text-xs font-semibold text-gold-ink">{tour ? `ส่วนที่ ${p.no} จาก ${parts.length}` : `ส่วนที่ ${p.no}`}</span>
        <div className="flex flex-wrap items-center gap-2">
          <b className="font-display text-[0.95rem] font-semibold">{p.title}</b>
          {stateChip(p)}
        </div>
        <p className="text-[13px] text-muted-foreground">{p.answers}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="link text-xs" onClick={onBack}>
            ‹ กลับไปที่หน้าต่าง
          </button>
          <span className="flex gap-1.5">
            {tour && index > 0 ? (
              <button type="button" className="btn-secondary btn-sm" onClick={() => onIndex(index - 1)}>
                ก่อนหน้า
              </button>
            ) : null}
            {tour && index < parts.length - 1 ? (
              <button type="button" className="btn btn-sm" onClick={() => onIndex(index + 1)}>
                ถัดไป
              </button>
            ) : (
              <button type="button" className="btn btn-sm" onClick={onClose}>
                {tour ? "จบ" : "เข้าใจแล้ว"}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}

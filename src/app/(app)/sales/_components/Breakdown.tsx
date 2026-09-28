"use client";

// ============================================================
// Mise — the pieces every sales popup is built from (Kong, 2026-09-28)
// ============================================================
// Two popups share them: one DAY (from the daily chart or table) and one
// CATEGORY SHARE (from สัดส่วนหมวดเมนู). Both are the shape of Kong's own sheet —
// categories on the left, the chosen category's menus on the right — so the
// shell, the panes and the colours live here once.
//
// A category keeps ONE colour everywhere on the page: the page assigns tones
// in the period's order and hands the same map to every piece, so the olive
// "อาหารจานเดียว" in the share bar is the olive one in the popup too.
// ============================================================

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TONES, toneOf, type Tone } from "@/components/charts/chart-theme";

export type BreakdownCategory = { key: string; label: string; net: number; qty: number };
export type BreakdownMenu = { id: string; name: string; categoryKey: string; net: number; qty: number };
export type ToneMap = Record<string, Tone>;

export const ALL = "__all__";
export const baht = (v: number) => `฿${v.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;

const toneFor = (tones: ToneMap, key: string, i: number): Tone => tones[key] ?? toneOf(i);
const gradientCss = (t: Tone) => `linear-gradient(90deg, ${TONES[t][1]}, ${TONES[t][0]})`;

// ------------------------------------------------------------
// The window
// ------------------------------------------------------------
export function ModalShell({
  onClose,
  labelledBy,
  onKey,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  /** Extra keys (the day popup's ← →). Esc always closes. */
  onKey?: (e: KeyboardEvent) => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else onKey?.(e);
    };
    window.addEventListener("keydown", handler);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = overflow;
    };
  }, [onClose, onKey]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-black/50 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div className="relative w-full max-w-4xl animate-pop-in rounded-2xl border border-border bg-surface p-4 shadow-2xl sm:p-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Categories left, menus right
// ------------------------------------------------------------
export function BreakdownPanes({
  categories,
  menus,
  tones,
  total,
  initial = ALL,
  resetKey,
}: {
  categories: BreakdownCategory[];
  menus: BreakdownMenu[];
  tones: ToneMap;
  total: number;
  initial?: string;
  /** Changing it (a new day) starts again from `initial`. */
  resetKey?: string;
}) {
  const [cat, setCat] = useState<string>(initial);
  useEffect(() => setCat(initial), [initial, resetKey]);

  const only = categories.length === 1 ? categories[0].key : null;
  const effective = cat === ALL && only ? only : cat;
  const shown = useMemo(
    () => (effective === ALL ? menus : menus.filter((m) => m.categoryKey === effective)),
    [effective, menus]
  );
  const shownTotal = shown.reduce((t, m) => t + m.net, 0);
  const maxCat = Math.max(1, ...categories.map((c) => c.net));
  const maxMenu = Math.max(1, ...shown.map((m) => m.net));
  const catIndex = categories.findIndex((c) => c.key === effective);
  const menuTone: Tone = effective === ALL ? "ink" : toneFor(tones, effective, catIndex);
  const catLabel = effective === ALL ? "ทุกหมวด" : categories[catIndex]?.label ?? "";

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground">หมวดเมนู</p>
        <p className="mb-2 text-[11px] text-muted-foreground">กดหมวดเพื่อดูเมนูในหมวดนั้น · กดซ้ำเพื่อดูทุกหมวด</p>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {/* No "ทุกหมวด" row (Kong, 2026-09-28): a 100% bar says nothing the
              title does not. Pressing the chosen category again goes back. */}
          {categories.map((c, i) => (
            <CatButton
              key={c.key}
              active={effective === c.key}
              onClick={() => setCat(effective === c.key && !only ? ALL : c.key)}
              label={c.label}
              value={c.net}
              share={total > 0 ? (c.net / total) * 100 : 0}
              width={(c.net / maxCat) * 100}
              tone={toneFor(tones, c.key, i)}
              index={i + 1}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border p-3">
        <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: TONES[menuTone][0] }} />
          {effective === ALL ? "ทุกเมนู" : `เมนูใน “${catLabel}”`} · {shown.length} เมนู · {baht(shownTotal)}
          {effective !== ALL && !only && (
            <button type="button" onClick={() => setCat(ALL)} className="ml-auto text-primary underline">
              ดูทุกหมวด
            </button>
          )}
        </p>
        {/* Keyed by category so switching replays the grow-in. */}
        <ul key={effective} className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {shown.map((m, i) => (
            <li key={m.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">
                  <span className="mr-1.5 inline-block w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  {m.name}
                </span>
                <span className="shrink-0 tabular-nums">
                  {baht(m.net)}{" "}
                  <span className="text-xs text-muted-foreground">
                    · {m.qty.toLocaleString("th-TH")} จาน · {shownTotal > 0 ? ((m.net / shownTotal) * 100).toFixed(1) : "0.0"}%
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-2 origin-left animate-grow-x rounded-full"
                  style={{
                    width: `${(m.net / maxMenu) * 100}%`,
                    background: gradientCss(menuTone),
                    animationDelay: `${Math.min(i, 12) * 35}ms`,
                  }}
                />
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="text-sm text-muted-foreground">ไม่มีเมนูในหมวดนี้</li>}
        </ul>
      </div>
    </div>
  );
}

function CatButton({
  active,
  onClick,
  label,
  value,
  share,
  width,
  tone,
  index,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: number;
  share: number;
  width: number;
  tone: Tone;
  index: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-all ${
        active ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-surface"
      }`}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONES[tone][0], boxShadow: active ? "0 0 0 2px rgb(255 255 255 / 0.6)" : undefined }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        <span className={`mt-1 block h-1.5 overflow-hidden rounded-full ${active ? "bg-primary-foreground/25" : "bg-muted"}`}>
          <span
            className="block h-1.5 origin-left animate-grow-x rounded-full"
            style={{
              width: `${width}%`,
              background: active ? "rgb(255 255 255 / 0.9)" : gradientCss(tone),
              animationDelay: `${index * 40}ms`,
            }}
          />
        </span>
      </span>
      <span className={`shrink-0 text-right text-xs tabular-nums ${active ? "" : "text-muted-foreground"}`}>
        {baht(value)}
        <br />
        {share.toFixed(1)}%
      </span>
    </button>
  );
}

// ------------------------------------------------------------
// สัดส่วนหมวดเมนู — the share, and a popup per category
// ------------------------------------------------------------
export function CategoryShare({
  categories,
  menus,
  tones,
  total,
  periodLabel,
  filterHref,
}: {
  categories: BreakdownCategory[];
  menus: BreakdownMenu[];
  tones: ToneMap;
  total: number;
  periodLabel: string;
  /** Link that narrows the whole PAGE to one category (the old click). */
  filterHref: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const close = useMemo(() => () => setOpen(null), []);

  if (total <= 0 || categories.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลในช่วงนี้</p>;
  }

  return (
    <div>
      {/* The whole period as one bar — every category's slice at a glance. */}
      <div className="mb-4 flex h-4 w-full overflow-hidden rounded-full bg-muted">
        {categories.map((c, i) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setOpen(c.key)}
            title={`${c.label} ${((c.net / total) * 100).toFixed(1)}%`}
            className="h-full origin-left animate-grow-x transition-opacity hover:opacity-80"
            style={{
              width: `${(c.net / total) * 100}%`,
              background: gradientCss(toneFor(tones, c.key, i)),
              animationDelay: `${i * 60}ms`,
            }}
          />
        ))}
      </div>

      <ul className="space-y-1">
        {categories.map((c, i) => {
          const t = toneFor(tones, c.key, i);
          const pct = (c.net / total) * 100;
          return (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => setOpen(c.key)}
                className="group relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-left transition-shadow hover:ring-1 hover:ring-border-strong"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 origin-left animate-grow-x rounded-lg opacity-25 transition-opacity group-hover:opacity-40"
                  style={{ width: `${Math.max(2, (c.net / categories[0].net) * 100)}%`, background: gradientCss(t), animationDelay: `${i * 60}ms` }}
                />
                <span className="relative h-3 w-3 shrink-0 rounded-full" style={{ background: TONES[t][0] }} />
                <span className="relative min-w-0 flex-1">
                  <span className="block text-sm font-medium">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.qty.toLocaleString("th-TH")} จาน</span>
                </span>
                <span className="relative w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span>
                <span className="relative w-24 shrink-0 text-right text-sm font-medium tabular-nums">{baht(c.net)}</span>
                <span className="relative shrink-0 rounded-full border border-primary-line bg-surface px-2 py-0.5 text-xs font-medium text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  ดูเมนู
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {open !== null && (
        <ModalShell onClose={close} labelledBy="cat-modal-title">
          <div className="mb-4 pr-10">
            <h3 id="cat-modal-title" className="text-lg font-semibold">
              สัดส่วนหมวดเมนู · {periodLabel}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              ยอดขาย <span className="font-medium text-foreground tabular-nums">{baht(total)}</span> · {categories.length} หมวด
              {filterHref[open] && (
                <>
                  {" · "}
                  <a href={filterHref[open]} className="text-primary underline">
                    ดูทั้งหน้าเฉพาะหมวดนี้
                  </a>
                </>
              )}
            </p>
          </div>
          <BreakdownPanes categories={categories} menus={menus} tones={tones} total={total} initial={open} />
        </ModalShell>
      )}
    </div>
  );
}

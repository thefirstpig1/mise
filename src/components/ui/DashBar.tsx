import type { CSSProperties } from "react";

/**
 * One dashed bar standing in for a word or a number that has not arrived — the
 * same stroke as the chart outlines (WaitingFor's `Outline`), for lists, tables
 * and number cards. Kong 2026-11-05: an empty page keeps the filled layout, but
 * nothing on it may look like data — so a slot is drawn, never filled.
 *
 * A plain module, not "use client", so server pages draw it without a client
 * boundary.
 */
export default function DashBar({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`block max-w-full rounded-full border-[1.4px] border-dashed border-sage bg-[#FBF8EE] ${className}`} style={style} />;
}

/**
 * A ranked list's rows, dashed: a name, and (with `bar`) the bar beside it, and
 * a value at the end — the shape every "เรียงตามเงิน" list on these pages has.
 */
export function DashRows({ widths = [0.85, 0.6, 0.4], bar = true, label }: { widths?: number[]; bar?: boolean; label?: string }) {
  return (
    <ul aria-label={label} className="space-y-2.5 py-1">
      {widths.map((w) => (
        <li key={w} className={`grid items-center gap-3 ${bar ? "grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]"}`}>
          <DashBar className="h-3" style={bar ? { width: "80%" } : { width: `${w * 100}%` }} />
          {bar && <DashBar className="h-3" style={{ width: `${w * 100}%` }} />}
          <DashBar className="h-3 w-14" />
        </li>
      ))}
    </ul>
  );
}

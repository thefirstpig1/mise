// ============================================================
// Mise — the dashboard's period and branch selection (Part 35 L5)
// ============================================================
// Everything the dashboard shows is decided by two things in the URL, so a
// view can be refreshed, bookmarked or sent to a partner and says the same
// thing: `?p=` a period preset and `?b=` the branches switched on.
//
// Dates are Bangkok business days (Decision #60) as date-only UTC midnights —
// the same shape every period query in Mise takes.
// ============================================================

import { addDays, computeBangkokToday } from "@/lib/bangkok-date";

export const PERIOD_PRESETS = ["month", "last-month", "7d", "30d", "90d"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS_TH: Record<PeriodPreset, string> = {
  month: "เดือนนี้",
  "last-month": "เดือนที่แล้ว",
  "7d": "7 วัน",
  "30d": "30 วัน",
  "90d": "90 วัน",
};

export interface Period {
  preset: PeriodPreset;
  from: Date;
  to: Date;
  /** The same number of days immediately before — what the ↑↓ compares against. */
  prevFrom: Date;
  prevTo: Date;
  days: number;
}

const DAY = 24 * 60 * 60 * 1000;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export function parsePreset(raw: string | undefined): PeriodPreset {
  return (PERIOD_PRESETS as readonly string[]).includes(raw ?? "") ? (raw as PeriodPreset) : "month";
}

/** Pure: `today` is injected so a test can pin it. */
export function periodFor(preset: PeriodPreset, today: Date = computeBangkokToday()): Period {
  let from: Date;
  let to: Date;
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  switch (preset) {
    case "month":
      from = utc(y, m, 1);
      to = today;
      break;
    case "last-month":
      from = utc(y, m - 1, 1);
      to = utc(y, m, 0);
      break;
    default: {
      const n = Number(preset.replace("d", ""));
      from = addDays(today, -(n - 1));
      to = today;
    }
  }
  const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
  // "This month so far" compares with the same days of last month, not the
  // whole of it — 27 days against 31 would show every month as a fall.
  const prevTo = preset === "month" ? utc(y, m - 1, Math.min(today.getUTCDate(), utc(y, m, 0).getUTCDate())) : addDays(from, -1);
  const prevFrom = preset === "month" ? utc(y, m - 1, 1) : addDays(from, -days);
  return { preset, from, to, prevFrom, prevTo, days };
}

/** `?b=a,b,c` → ids, kept only when the reader may see them. Empty = all. */
export function parseBranchParam(raw: string | undefined, visible: readonly string[]): string[] {
  if (!raw) return [];
  const want = raw.split(",").filter(Boolean);
  return want.filter((id) => visible.includes(id));
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

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

/** A preset, or one calendar month picked on the monthly chart ("2026-08"). */
export type PeriodChoice = PeriodPreset | `${number}-${number}`;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface Period {
  preset: PeriodChoice;
  /** Set when a single calendar month is on screen — the chart highlights it. */
  month: string | null;
  from: Date;
  to: Date;
  /**
   * What the ↑↓ compares against. A whole calendar month compares with the whole
   * month before it (Kong, 2026-10-01: "เทียบกับทั้งเดือนสิ"); this month so far
   * compares with the same days of last month; a rolling window with the same
   * number of days immediately before.
   */
  prevFrom: Date;
  prevTo: Date;
  days: number;
}

const DAY = 24 * 60 * 60 * 1000;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export function parsePreset(raw: string | undefined): PeriodChoice {
  if (raw && MONTH_RE.test(raw)) return raw as PeriodChoice;
  return (PERIOD_PRESETS as readonly string[]).includes(raw ?? "") ? (raw as PeriodPreset) : "month";
}

export const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** The calendar months ending with the one `today` falls in, oldest first. */
export function recentMonths(count: number, today: Date = computeBangkokToday()): { key: string; from: Date; to: Date }[] {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const out: { key: string; from: Date; to: Date }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const from = utc(y, m - i, 1);
    const end = utc(y, m - i + 1, 0);
    const to = end.getTime() > today.getTime() ? today : end;
    out.push({ key: monthKey(from), from, to });
  }
  return out;
}

/** Pure: `today` is injected so a test can pin it. */
export function periodFor(preset: PeriodChoice, today: Date = computeBangkokToday()): Period {
  let from: Date;
  let to: Date;
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const picked = MONTH_RE.exec(preset);
  if (picked) {
    // One calendar month, compared with the one before it in full.
    const py = Number(picked[1]);
    const pm = Number(picked[2]) - 1;
    from = utc(py, pm, 1);
    const end = utc(py, pm + 1, 0);
    to = end.getTime() > today.getTime() ? today : end;
    const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    return { preset, month: monthKey(from), from, to, prevFrom: utc(py, pm - 1, 1), prevTo: utc(py, pm, 0), days };
  }
  switch (preset as PeriodPreset) {
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
  let prevFrom: Date;
  let prevTo: Date;
  if (preset === "month") {
    prevFrom = utc(y, m - 1, 1);
    prevTo = utc(y, m - 1, Math.min(today.getUTCDate(), utc(y, m, 0).getUTCDate()));
  } else if (preset === "last-month") {
    // A finished month against the finished month before it — September
    // against all of August, not against "the 30 days before September 1".
    prevFrom = utc(y, m - 2, 1);
    prevTo = utc(y, m - 1, 0);
  } else {
    prevFrom = addDays(from, -days);
    prevTo = addDays(from, -1);
  }
  const month = preset === "month" || preset === "last-month" ? monthKey(from) : null;
  return { preset, month, from, to, prevFrom, prevTo, days };
}

/** `?b=a,b,c` → ids, kept only when the reader may see them. Empty = all. */
export function parseBranchParam(raw: string | undefined, visible: readonly string[]): string[] {
  if (!raw) return [];
  const want = raw.split(",").filter(Boolean);
  return want.filter((id) => visible.includes(id));
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

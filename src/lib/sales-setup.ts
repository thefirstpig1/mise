// ============================================================
// Mise — the first sales import, one question at a time (Kong 2026-11-01)
// ============================================================
// Kong, round 2 of the friend's-shop feedback: "เลือก pos dropdown แล้วมัน
// เลือกแล้วเลือกเลย แล้วมีอะไรไม่รู้ พวก @ หรือ ผัดกะเพรา เข้ามาได้ยังไง".
// Mockup 225p68BDqKAZTpd9MqDeph: five pages, Back on every one, nothing saved
// until the last. This module is the part of that wizard that is arithmetic
// rather than screen, so it is tested on its own and the browser and the
// server read the same answers.
//
// The date is no longer a list of format strings to pick from. Every format
// the system accepts is tried against the column's real values, and the
// person is asked about what came OUT: "28 ต.ค. 2569 ถูกไหม". When two
// formats read every value and disagree (5/6 could be 5 June or 6 May), both
// readings are shown on the value that tells them apart and the person
// chooses — the system never picks between them (rule P13).
// ============================================================

import { SALES_DATE_FORMATS, parseSalesDate, type SalesDateFormat } from "@/lib/sales-file";

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export type DateReading = {
  format: SalesDateFormat;
  isBuddhistYear: boolean;
  /** Whether any value carried a time of day. */
  hasTime: boolean;
  /** Each sample's day (UTC midnight) and minutes, in sample order. Blank samples are skipped. */
  days: { raw: string; day: Date; minutes: number | null }[];
};

/** "28 ต.ค. 2569 13:45" — written in the calendar the file itself uses. */
export function thaiDateLabel(day: Date, isBuddhistYear: boolean, minutes: number | null = null): string {
  const y = day.getUTCFullYear() + (isBuddhistYear ? 543 : 0);
  const time = minutes === null ? "" : ` ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return `${day.getUTCDate()} ${TH_MONTHS[day.getUTCMonth()]} ${y}${time}`;
}

/**
 * Every (format, calendar) that reads ALL the samples, one per distinct
 * reading. Formats that differ only in their separator read identically and
 * collapse into one; the kept one matches the file's own separator.
 */
export function readDateCandidates(samples: readonly string[]): DateReading[] {
  const values = samples.map((s) => s.trim()).filter((s) => s !== "");
  if (values.length === 0) return [];
  const dash = values[0].includes("-");
  // Same-reading formats in preference order, so the kept one looks like the file.
  const order: SalesDateFormat[] = dash
    ? ["dd-MM-yyyy", "dd/MM/yyyy", "d/M/yyyy", "yyyy-MM-dd", "yyyy/MM/dd", "MM/dd/yyyy"]
    : ["dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "yyyy/MM/dd", "yyyy-MM-dd", "MM/dd/yyyy"];
  const out: DateReading[] = [];
  const seen = new Set<string>();
  for (const format of order.filter((f) => (SALES_DATE_FORMATS as readonly string[]).includes(f))) {
    for (const isBuddhistYear of [false, true]) {
      const days: DateReading["days"] = [];
      let ok = true;
      for (const raw of values) {
        const r = parseSalesDate(raw, { format, isBuddhistYear });
        if (!r.ok) {
          ok = false;
          break;
        }
        days.push({ raw, day: r.day, minutes: r.minutesOfDay });
      }
      if (!ok) continue;
      const key = days.map((d) => d.day.getTime()).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ format, isBuddhistYear, hasTime: days.some((d) => d.minutes !== null), days });
    }
  }
  return out;
}

/** The sample on which two readings disagree — the one worth showing. Index into `days`. */
export function tellingSample(candidates: readonly DateReading[]): number {
  if (candidates.length < 2) return 0;
  const n = candidates[0].days.length;
  for (let i = 0; i < n; i++) {
    const t = candidates[0].days[i].day.getTime();
    if (candidates.some((c) => c.days[i]?.day.getTime() !== t)) return i;
  }
  return 0;
}

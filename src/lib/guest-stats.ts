// ============================================================
// Mise — customers and revenue per head (Kong 2026-10-25, mockup
// VWdJuHyN6YBZqaA2EtbpuH). Pure, so the dashboard, /sales and /closing all
// compute the same figure the same way.
//
// Rule GH-HEAD: per head = Σ revenue ÷ Σ customers over the branch-days that
// have BOTH (revenue = after discount, excl VAT & service charge — the /sales
// figure). A day with sales and no guest count is left out of both sides,
// never counted as zero customers.
// Rule GH-COV: the figure is shown only when at least GUEST_COVERAGE_MIN of
// the sales branch-days carry a guest count; below that it is a handful of
// days dressed up as a month.
// ============================================================

export const GUEST_COVERAGE_MIN = 0.8;

export type GuestDay = { day: string; branchId: string; net: number; plates: number; guests: number | null };

export type GuestStats = {
  /** Branch-days with sales. */
  salesDays: number;
  /** Of those, the ones with a guest count. */
  guestDays: number;
  coverage: number | null;
  enough: boolean;
  /** Σ guests ÷ distinct dates with a count (the "per day" of rule SI1). */
  guestsPerDay: number | null;
  guests: number;
  perHead: number | null;
  platesPerGuest: number | null;
};

export function guestStats(rows: readonly GuestDay[]): GuestStats {
  const sales = rows.filter((r) => r.net > 0 || r.plates > 0);
  const counted = sales.filter((r) => r.guests !== null && r.guests > 0);
  const guests = counted.reduce((t, r) => t + (r.guests ?? 0), 0);
  const net = counted.reduce((t, r) => t + r.net, 0);
  const plates = counted.reduce((t, r) => t + r.plates, 0);
  const dates = new Set(counted.map((r) => r.day)).size;
  const coverage = sales.length ? counted.length / sales.length : null;
  return {
    salesDays: sales.length,
    guestDays: counted.length,
    coverage,
    enough: coverage !== null && coverage >= GUEST_COVERAGE_MIN,
    guestsPerDay: dates ? guests / dates : null,
    guests,
    perHead: guests ? net / guests : null,
    platesPerGuest: guests ? plates / guests : null,
  };
}

/** Per head by weekday, Monday first (0 = Sunday in getUTCDay). */
export function perHeadByWeekday(rows: readonly GuestDay[]): { weekday: number; perHead: number | null; days: number }[] {
  return [1, 2, 3, 4, 5, 6, 0].map((w) => {
    const s = guestStats(rows.filter((r) => new Date(`${r.day}T00:00:00Z`).getUTCDay() === w));
    return { weekday: w, perHead: s.perHead, days: s.guestDays };
  });
}

/** Monday-start weeks inside the rows, oldest first. */
export function guestWeeks(rows: readonly GuestDay[]): { from: string; to: string; stats: GuestStats }[] {
  const byWeek = new Map<string, GuestDay[]>();
  for (const r of rows) {
    const d = new Date(`${r.day}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    const a = byWeek.get(monday) ?? [];
    a.push(r);
    byWeek.set(monday, a);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, a]) => {
      const days = a.map((r) => r.day).sort();
      return { from: days[0], to: days[days.length - 1], stats: guestStats(a) };
    });
}

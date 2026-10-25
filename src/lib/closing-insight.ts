// ============================================================
// Mise — the daily-close month, folded (ADR 0042, Kong 2026-10-25 mockup
// VWdJuHyN6YBZqaA2EtbpuH). Pure: the server's month read and the page's
// weekday/weekend split use the SAME weighting.
//
// Rule DC-MIX: each day's tenths become fractions of that day's guests (1 when
// the count is missing), summed over every estimated day's whole weight — the
// unassigned tenths stay "ไม่แน่ใจ" rather than inflating the rest.
// Rule DC-DOM: "on days when a group was more than half, what did a head
// spend" — real revenue ÷ real guests, grouped by the closer's estimate; a
// group needs at least DOMINANT_MIN_DAYS such days before a figure is shown.
// Mixing people-share with revenue ("office brought ฿200k") is refused: it
// would assume every group spends the same.
// ============================================================

export const DOMINANT_MIN_DAYS = 5;

export type MixDay = { date: string; guests: number | null; netRevenue: number | null; plates: number | null; mix: { customerTypeId: string; parts: number }[] };

export function mixShares(days: readonly MixDay[]): { shares: Map<string, number>; days: number } {
  const weight = new Map<string, number>();
  let total = 0;
  let n = 0;
  for (const d of days) {
    if (d.mix.length === 0) continue;
    n++;
    const w = d.guests || 1;
    for (const m of d.mix) weight.set(m.customerTypeId, (weight.get(m.customerTypeId) ?? 0) + (m.parts / 10) * w);
    total += w;
  }
  return { shares: new Map([...weight].map(([k, v]) => [k, total > 0 ? v / total : 0])), days: n };
}

export const isWeekend = (iso: string) => {
  const w = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
};

export function dominantPerHead(days: readonly MixDay[], typeIds: readonly string[]) {
  const usable = days.filter((d) => d.mix.length > 0 && d.guests && d.netRevenue !== null);
  const group = (pick: (d: MixDay) => boolean) => {
    const a = usable.filter(pick);
    const g = a.reduce((t, d) => t + (d.guests ?? 0), 0);
    const net = a.reduce((t, d) => t + (d.netRevenue ?? 0), 0);
    const pl = a.reduce((t, d) => t + (d.plates ?? 0), 0);
    return { days: a.length, perHead: a.length >= DOMINANT_MIN_DAYS && g ? net / g : null, platesPerGuest: a.length >= DOMINANT_MIN_DAYS && g ? pl / g : null };
  };
  return {
    byType: typeIds.map((id) => ({ customerTypeId: id, ...group((d) => (d.mix.find((m) => m.customerTypeId === id)?.parts ?? 0) >= 5) })),
    mixed: group((d) => d.mix.every((m) => m.parts < 5)),
  };
}

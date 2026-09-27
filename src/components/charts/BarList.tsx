// ============================================================
// Mise — a ranked bar list (Part 35, after Kong's review 2026-09-28)
// ============================================================
// Replaced the dashboard's spend donut. Kong: the labels were cut off
// ("ต้นทุ…", "สาธาร…") and nobody could read which category was which. A
// donut asks the eye to compare ANGLES and needs a legend to name them; a
// ranked bar list names every row in full, lines the money up in one column,
// and compares LENGTHS — the thing eyes are best at. It is the shape Stripe,
// Tremor and Kong's own expense sheet use for "where did the money go".
//
// One hue: this is magnitude, not identity (dataviz: sequential job, one
// colour). Text wears ink tokens; the bar carries only length. Server
// component — no JavaScript, every figure is visible without hovering.
// ============================================================

export type BarListRow = {
  key: string;
  label: string;
  /** A second line — e.g. the groups inside a section. */
  detail?: string;
  value: number;
  href?: string;
};

export type BarListGroup = { heading?: string; note?: string; rows: BarListRow[] };

const baht = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);

export default function BarList({
  groups,
  total,
  emptyText = "ยังไม่มีข้อมูลในช่วงนี้",
  barClassName = "bg-sage",
}: {
  groups: BarListGroup[];
  /** The 100% every row's share is measured against. */
  total: number;
  emptyText?: string;
  barClassName?: string;
}) {
  const max = Math.max(0, ...groups.flatMap((g) => g.rows.map((r) => r.value)));
  if (total <= 0 || max <= 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-5">
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g, gi) => (
          <div key={g.heading ?? gi}>
            {g.heading ? (
              <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-border pb-1">
                <p className="text-sm font-semibold">{g.heading}</p>
                <p className="tabular-nums text-sm text-muted-foreground">
                  {baht(g.rows.reduce((s, r) => s + r.value, 0))}
                </p>
              </div>
            ) : null}
            {g.note ? <p className="-mt-1 mb-2 text-xs text-muted-foreground">{g.note}</p> : null}
            <ul className="space-y-1">
              {g.rows.map((r) => {
                const pct = (r.value / total) * 100;
                const body = (
                  <>
                    {/* The bar sits BEHIND the text, so a long Thai label never
                        has to share a line with it and is never truncated. */}
                    <span
                      aria-hidden
                      className={`absolute inset-y-0 left-0 rounded-md ${barClassName} opacity-45 transition-opacity group-hover:opacity-70`}
                      style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }}
                    />
                    <span className="relative min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{r.label}</span>
                      {r.detail ? <span className="block text-xs text-muted-foreground">{r.detail}</span> : null}
                    </span>
                    <span className="relative w-12 shrink-0 text-right tabular-nums text-xs text-muted-foreground">
                      {pct < 0.1 ? "<0.1" : pct.toFixed(pct < 10 ? 1 : 0)}%
                    </span>
                    <span className="relative w-28 shrink-0 text-right tabular-nums text-sm font-medium">{baht(r.value)}</span>
                  </>
                );
                const cls = "group relative flex items-center gap-3 overflow-hidden rounded-md px-3 py-2";
                return (
                  <li key={r.key}>
                    {r.href ? (
                      <a href={r.href} className={`${cls} hover:ring-1 hover:ring-border-strong`}>
                        {body}
                      </a>
                    ) : (
                      <div className={cls}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </div>
  );
}

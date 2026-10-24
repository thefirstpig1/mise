// Customer-type estimate as a bar — a plain module (no "use client"), so the
// server pages and the form share it (mise-ui-review §7). Always says ประมาณ:
// it is the closer's impression, never a head count (ADR 0042 Q3).

export const MIX_COLORS = ["#41431B", "#7D8450", "#AEB784", "#C0692B", "#8B8D63", "#D9B26A", "#5A7333", "#A87C1C", "#6B6F3A", "#E3DBBB", "#9C6B3F", "#3B4A2A"];

export type MixSlice = { id: string; name: string; share: number };

export function colorOf(ids: string[], id: string): string {
  const i = ids.indexOf(id);
  return MIX_COLORS[(i < 0 ? 0 : i) % MIX_COLORS.length];
}

export function MixBar({ slices, order }: { slices: MixSlice[]; order: string[] }) {
  const known = slices.reduce((t, s) => t + s.share, 0);
  if (slices.length === 0) return <p className="text-sm text-muted-foreground">ยังไม่ได้ประเมิน</p>;
  return (
    <div className="space-y-1.5">
      <div className="flex h-3.5 overflow-hidden rounded-full bg-muted">
        {slices.map((s, i) => (
          <span
            key={s.id}
            className="block h-full origin-left animate-grow-x"
            style={{ width: `${s.share * 100}%`, background: colorOf(order, s.id), animationDelay: `${i * 40}ms` }}
            title={`${s.name} ~${Math.round(s.share * 100)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {slices.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(order, s.id) }} />
            {s.name} ~{Math.round(s.share * 100)}%
          </span>
        ))}
        {known < 0.995 && <span className="text-muted-subtle">ไม่แน่ใจ ~{Math.round((1 - known) * 100)}%</span>}
      </div>
    </div>
  );
}

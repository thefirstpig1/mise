// Every receipt of one product as a dot, with each calendar month's
// quantity-weighted average as a line (Kong 2026-10-24, duplication review B8:
// the product sheet and the price-volatility popup drew the same receipts two
// ways — now one). Optional dashed line: the price the menus can bear
// (rule PV-ALLOW). Pure SVG, no client state, so a server or client parent can
// render it.

const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const dayTh = (iso: string) => `${+iso.slice(8, 10)} ${MTH[+iso.slice(5, 7) - 1]}`;
const f2 = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type ReceiptPoint = { date: string; price: number; qty?: number };
export type MonthAverage = { key: string; label: string; avg: number };

/** Calendar-month averages, weighted by quantity when the points carry it (rule CO-PRICE v2). */
export function monthAverages(points: readonly ReceiptPoint[]): MonthAverage[] {
  const by = new Map<string, { v: number; q: number }>();
  for (const p of points) {
    const k = p.date.slice(0, 7);
    const w = p.qty && p.qty > 0 ? p.qty : 1;
    const cur = by.get(k) ?? { v: 0, q: 0 };
    cur.v += p.price * w;
    cur.q += w;
    by.set(k, cur);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, x]) => ({ key, label: `${MTH[+key.slice(5, 7) - 1]} ${String((+key.slice(0, 4) + 543) % 100).padStart(2, "0")}`, avg: x.v / x.q }));
}

export default function ReceiptPriceChart({ points, months, allowed }: { points: readonly ReceiptPoint[]; months?: readonly MonthAverage[]; allowed?: number | null }) {
  if (points.length === 0) return null;
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const avgs = months ?? monthAverages(pts);
  const vals = [...pts.map((p) => p.price), ...(allowed ? [allowed] : [])];
  const lo = Math.min(...vals) * 0.96;
  const hi = Math.max(...vals) * 1.04 || 1;
  const W = 640, H = 210, L = 56;
  const t = (s: string) => Date.parse(s);
  const t0 = t(pts[0].date), t1 = t(pts.at(-1)!.date);
  const x = (s: string) => L + ((t(s) - t0) / (t1 - t0 || 1)) * (W - L - 12);
  const y = (v: number) => 12 + (H - 40) * (1 - (v - lo) / (hi - lo || 1));
  const step = Math.max(1, Math.ceil(pts.length / 8));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="ราคาทุกใบและราคาเฉลี่ยรายเดือน">
      {[0, 1, 2, 3].map((i) => {
        const v = lo + ((hi - lo) * i) / 3;
        return (
          <g key={i}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="#ECE6CC" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#8B8D63">
              ฿{v.toFixed(v < 20 ? 2 : 0)}
            </text>
          </g>
        );
      })}
      {avgs.map((m, i) => {
        const inM = pts.filter((p) => p.date.startsWith(m.key));
        if (!inM.length) return null;
        const rising = i > 0 && m.avg > avgs[i - 1].avg;
        const color = i === 0 ? "#5E6B14" : rising ? "#A83A22" : "#5A7333";
        return (
          <g key={m.key}>
            <line x1={x(inM[0].date)} x2={x(inM.at(-1)!.date)} y1={y(m.avg)} y2={y(m.avg)} stroke={color} strokeWidth={2.5} />
            <text x={x(inM[0].date) + 6} y={y(m.avg) - 6} fontSize={10.5} fill={color}>
              เฉลี่ย {m.label} ฿{f2(m.avg)}
            </text>
          </g>
        );
      })}
      {allowed ? (
        <g>
          <line x1={L} x2={W} y1={y(allowed)} y2={y(allowed)} stroke="#A83A22" strokeDasharray="6 4" strokeWidth={2} />
          <text x={W - 4} y={y(allowed) - 6} textAnchor="end" fontSize={10.5} fontWeight={700} fill="#A83A22">
            ราคาที่เมนูรับได้ ฿{f2(allowed)}
          </text>
        </g>
      ) : null}
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.date)} cy={y(p.price)} r={4.2} fill="#C0692B" opacity={0.85}>
          <title>{`${dayTh(p.date)} ฿${f2(p.price)}`}</title>
        </circle>
      ))}
      {pts.map((p, i) =>
        i % step === 0 ? (
          <text key={`l${i}`} x={x(p.date)} y={H - 8} textAnchor="middle" fontSize={10} fill="#5A5C31">
            {dayTh(p.date)}
          </text>
        ) : null
      )}
    </svg>
  );
}

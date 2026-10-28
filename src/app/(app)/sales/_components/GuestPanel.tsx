// Customers and per head on /sales (Kong 2026-10-25, mockup
// VWdJuHyN6YBZqaA2EtbpuH tab ③). Plain module — no client state — so the
// server page renders it directly. Shown only when the period has enough
// guest counts (rule GH-COV); the page decides that.

import { guestWeeks, perHeadByWeekday, type GuestDay } from "@/lib/guest-stats";

const WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const short = (iso: string) => `${+iso.slice(8, 10)} ${MTH[+iso.slice(5, 7) - 1]}`;

export default function GuestPanel({ rows, periodLabel }: { rows: GuestDay[]; periodLabel: string }) {
  const byWd = perHeadByWeekday(rows);
  const vals = byWd.filter((w) => w.perHead !== null).map((w) => w.perHead!);
  const best = vals.length ? Math.max(...vals) : null;
  const W = 520, H = 200, L = 16, B = 26, T = 18;
  const hi = vals.length ? Math.max(...vals) * 1.08 : 1;
  const lo = vals.length ? Math.min(...vals) * 0.85 : 0;
  const bw = (W - L * 2) / 7;
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const weeks = guestWeeks(rows).filter((w) => w.stats.guestDays > 0);

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="font-semibold">ต่อหัวตามวันในสัปดาห์</h3>
        <p className="text-xs text-muted-subtle">{periodLabel} · ยอดขายรวมของวันนั้น ÷ ลูกค้ารวม · ★ = สูงสุด</p>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="ต่อหัวตามวันในสัปดาห์" className="mt-2">
          {byWd.map((w, i) => {
            const we = w.weekday === 0 || w.weekday === 6;
            const x = L + i * bw;
            return (
              <g key={w.weekday}>
                {w.perHead !== null && (
                  <>
                    <rect
                      x={x + 6}
                      y={y(w.perHead)}
                      width={bw - 12}
                      height={H - B - y(w.perHead)}
                      rx={4}
                      fill={w.perHead === best ? "#C0692B" : we ? "#41431B" : "#AEB784"}
                    >
                      <title>{`${WD[w.weekday]} ฿${w.perHead.toFixed(0)} · ${w.days} วัน`}</title>
                    </rect>
                    <text x={x + bw / 2} y={y(w.perHead) - 5} fontSize={11} textAnchor="middle" fill="currentColor">
                      {w.perHead === best ? "★ " : ""}฿{w.perHead.toFixed(0)}
                    </text>
                  </>
                )}
                <text x={x + bw / 2} y={H - 8} fontSize={11} textAnchor="middle" fill="#5A5C31">
                  {WD[w.weekday]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="font-semibold">จานต่อลูกค้า และต่อหัว รายสัปดาห์</h3>
        <p className="text-xs text-muted-subtle">ต่อหัวขึ้นเพราะสั่งเยอะขึ้น หรือเพราะราคาขึ้น — จานต่อคนแยกสองเรื่องนี้ออกจากกัน</p>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 font-medium">สัปดาห์</th>
              <th className="py-1.5 text-right font-medium">ลูกค้า/วัน</th>
              <th className="py-1.5 text-right font-medium">จาน/คน</th>
              <th className="py-1.5 text-right font-medium">ต่อหัว</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {weeks.map((w) => (
              <tr key={w.from}>
                <td className="py-1.5">
                  {short(w.from)}
                  {w.to !== w.from ? `–${short(w.to)}` : ""}
                </td>
                <td className="py-1.5 text-right">{w.stats.guestsPerDay === null ? "—" : Math.round(w.stats.guestsPerDay).toLocaleString("th-TH")}</td>
                <td className="py-1.5 text-right">{w.stats.platesPerGuest === null ? "—" : w.stats.platesPerGuest.toFixed(2)}</td>
                <td className="py-1.5 text-right">{w.stats.perHead === null ? "—" : `฿${w.stats.perHead.toFixed(0)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// The daily-close month as pictures (Kong 2026-10-25, mockup VWdJuHyN6YBZqaA2EtbpuH
// tab ①): customers a day with per head on the second axis, a sentence the
// numbers write, the customer mix weekday vs weekend, per head on days a group
// dominated (rule DC-DOM), and the mix month by month. Plain module (no
// client state) — the server page renders it; bars are links to the day.

import { DOMINANT_MIN_DAYS, dominantPerHead, isWeekend, mixShares, type MixDay } from "@/lib/closing-insight";
import { MixBar, colorOf } from "./mix";

const fmt = (n: number) => Math.round(n).toLocaleString("th-TH");

export default function MonthInsight({
  days,
  types,
  branchId,
  monthLabel,
  seeMoney,
  trend,
}: {
  days: MixDay[];
  types: { id: string; name: string }[];
  branchId: string;
  monthLabel: string;
  seeMoney: boolean;
  trend: { label: string; shares: Map<string, number>; days: number }[];
}) {
  const order = types.map((t) => t.id);
  const name = (id: string) => types.find((t) => t.id === id)?.name ?? "";
  const withGuests = [...days].filter((d) => d.guests).sort((a, b) => a.date.localeCompare(b.date));
  const slices = (m: Map<string, number>) =>
    [...m].map(([id, share]) => ({ id, name: name(id), share })).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const weekday = mixShares(days.filter((d) => !isWeekend(d.date)));
  const weekend = mixShares(days.filter((d) => isWeekend(d.date)));
  const dom = dominantPerHead(days, order);

  // Customers a day + per head (right axis).
  const W = 1000, H = 230, L = 40, R = 52, B = 26, T = 14;
  const n = withGuests.length;
  const bw = n ? (W - L - R) / n : 0;
  const gMax = Math.max(1, ...withGuests.map((d) => d.guests!)) * 1.1;
  const heads = withGuests.filter((d) => d.netRevenue !== null).map((d) => d.netRevenue! / d.guests!);
  const hMin = heads.length ? Math.min(...heads) * 0.92 : 0;
  const hMax = heads.length ? Math.max(...heads) * 1.05 : 1;
  const y = (v: number) => T + (H - T - B) * (1 - v / gMax);
  const yh = (v: number) => T + (H - T - B) * (1 - (v - hMin) / (hMax - hMin || 1));
  const avg = n ? withGuests.reduce((t, d) => t + d.guests!, 0) / n : 0;

  // The sentence the numbers write.
  const part = (a: MixDay[]) => {
    const g = a.reduce((t, d) => t + d.guests!, 0);
    const money = a.filter((d) => d.netRevenue !== null);
    const mg = money.reduce((t, d) => t + d.guests!, 0);
    return { perDay: a.length ? g / a.length : null, head: mg ? money.reduce((t, d) => t + d.netRevenue!, 0) / mg : null };
  };
  const wd = part(withGuests.filter((d) => !isWeekend(d.date)));
  const we = part(withGuests.filter((d) => isWeekend(d.date)));
  const sentence =
    wd.perDay && we.perDay
      ? `เสาร์–อาทิตย์ลูกค้า${we.perDay >= wd.perDay ? "มากกว่า" : "น้อยกว่า"}วันธรรมดา ${Math.abs(Math.round((we.perDay / wd.perDay - 1) * 100))}% (${fmt(we.perDay)} เทียบ ${fmt(wd.perDay)} คน/วัน)` +
        (seeMoney && wd.head && we.head ? ` และต่อหัว${we.head >= wd.head ? "สูงกว่า" : "ต่ำกว่า"} (฿${fmt(we.head)} เทียบ ฿${fmt(wd.head)})` : "")
      : null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">ลูกค้าต่อวัน{seeMoney ? " และยอดต่อหัว" : ""} · {monthLabel}</h3>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>
              <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#AEB784]" />
              วันธรรมดา
            </span>
            <span>
              <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#41431B]" />
              เสาร์–อาทิตย์
            </span>
            {seeMoney && (
              <span>
                <i className="mr-1 inline-block h-0.5 w-3 bg-[#C0692B] align-middle" />
                ยอดต่อหัว (แกนขวา)
              </span>
            )}
            <span>- - เฉลี่ยลูกค้าต่อวัน</span>
          </div>
        </div>
        {n === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีวันที่กรอกจำนวนลูกค้าในเดือนนี้</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="ลูกค้าต่อวัน" className="mt-2">
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={L} x2={W - R} y1={y(gMax * f)} y2={y(gMax * f)} stroke="#ECE6CC" />
                <text x={L - 5} y={y(gMax * f) + 4} fontSize={10} textAnchor="end" fill="#8B8D63">
                  {fmt(gMax * f)}
                </text>
              </g>
            ))}
            {withGuests.map((d, i) => (
              <a key={d.date} href={`/closing/day?branch=${branchId}&date=${d.date}`}>
                <rect x={L + i * bw + 2} y={y(d.guests!)} width={Math.max(1, bw - 4)} height={H - B - y(d.guests!)} rx={3} fill={isWeekend(d.date) ? "#41431B" : "#AEB784"}>
                  <title>{`${+d.date.slice(8)} · ${d.guests} คน${seeMoney && d.netRevenue !== null ? ` · ต่อหัว ฿${fmt(d.netRevenue / d.guests!)}` : ""}`}</title>
                </rect>
                {(n <= 16 || i % 2 === 0) && (
                  <text x={L + i * bw + bw / 2} y={H - 8} fontSize={9.5} textAnchor="middle" fill="#5A5C31">
                    {+d.date.slice(8)}
                  </text>
                )}
              </a>
            ))}
            <line x1={L} x2={W - R} y1={y(avg)} y2={y(avg)} stroke="#5A5C31" strokeDasharray="5 4" />
            <text x={L + 4} y={y(avg) - 5} fontSize={10} fill="#5A5C31">
              เฉลี่ย {fmt(avg)} คน
            </text>
            {seeMoney && heads.length > 1 && (
              <>
                <polyline
                  fill="none"
                  stroke="#C0692B"
                  strokeWidth={2.2}
                  points={withGuests
                    .map((d, i) => (d.netRevenue === null ? null : `${L + i * bw + bw / 2},${yh(d.netRevenue / d.guests!)}`))
                    .filter(Boolean)
                    .join(" ")}
                />
                {[hMin, (hMin + hMax) / 2, hMax].map((v) => (
                  <text key={v} x={W - R + 5} y={yh(v) + 4} fontSize={10} fill="#C0692B">
                    ฿{fmt(v)}
                  </text>
                ))}
              </>
            )}
          </svg>
        )}
        {sentence && <p className="mt-2 border-l-2 border-[#C0692B] pl-3 text-sm text-muted-foreground">{sentence} · กดแท่งเพื่อเปิดใบของวันนั้น</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <div>
            <h3 className="font-semibold">
              ลูกค้าส่วนใหญ่เป็นใคร <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-[11px] font-normal text-warn">ประมาณ</span>
            </h3>
            <p className="text-xs text-muted-subtle">แยกวันธรรมดา / เสาร์–อาทิตย์ · ถ่วงด้วยจำนวนลูกค้าของแต่ละวัน</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-subtle">วันธรรมดา ({weekday.days} วันที่ประเมิน)</p>
            <MixBar slices={slices(weekday.shares)} order={order} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-subtle">เสาร์–อาทิตย์ ({weekend.days} วันที่ประเมิน)</p>
            <MixBar slices={slices(weekend.shares)} order={order} />
          </div>
        </section>

        {seeMoney && (
          <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
            <h3 className="font-semibold">วันที่กลุ่มไหนเยอะ ร้านได้ต่อหัวเท่าไหร่</h3>
            <p className="text-xs text-muted-subtle">
              ยอดขายจริง ÷ ลูกค้าจริง ของวันที่กลุ่มนั้นเกินครึ่ง (ตามที่คนปิดร้านประเมิน) · ต้องมีอย่างน้อย {DOMINANT_MIN_DAYS} วันถึงจะแสดง
            </p>
            <table>
              <thead>
                <tr>
                  <th className="py-1.5 font-medium">วันที่กลุ่มนี้เกินครึ่ง</th>
                  <th className="py-1.5 text-right font-medium">วัน</th>
                  <th className="py-1.5 text-right font-medium">ต่อหัว</th>
                  <th className="py-1.5 text-right font-medium">จาน/คน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {dom.byType.map((r) => (
                  <tr key={r.customerTypeId} className={r.perHead === null ? "text-muted-subtle" : ""}>
                    <td className="py-1.5">
                      <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(order, r.customerTypeId) }} />
                      {name(r.customerTypeId)}
                    </td>
                    <td className="py-1.5 text-right">{r.days}</td>
                    {r.perHead === null ? (
                      <td colSpan={2} className="py-1.5 text-right text-xs">
                        ข้อมูลไม่พอ (ต้อง {DOMINANT_MIN_DAYS} วัน)
                      </td>
                    ) : (
                      <>
                        <td className="py-1.5 text-right font-semibold">฿{fmt(r.perHead)}</td>
                        <td className="py-1.5 text-right">{r.platesPerGuest?.toFixed(2)}</td>
                      </>
                    )}
                  </tr>
                ))}
                <tr className="text-muted-subtle">
                  <td className="py-1.5">ไม่มีกลุ่มไหนเกินครึ่ง</td>
                  <td className="py-1.5 text-right">{dom.mixed.days}</td>
                  <td className="py-1.5 text-right" colSpan={2}>
                    {dom.mixed.perHead === null ? "—" : `฿${fmt(dom.mixed.perHead)}`}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-muted-subtle">ไม่เอาสัดส่วนคนไปคูณยอดขาย — นั่นคือการสมมติว่าทุกกลุ่มจ่ายเท่ากัน</p>
          </section>
        )}
      </div>

      <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
        <h3 className="font-semibold">
          สัดส่วนประเภทลูกค้าย้อนหลัง <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-[11px] font-normal text-warn">ประมาณ</span>
        </h3>
        {trend.filter((t) => t.days > 0).length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีการประเมิน</p>
        ) : (
          trend
            .filter((t) => t.days > 0)
            .map((t) => (
              <div key={t.label}>
                <p className="mb-1 text-xs text-muted-subtle">
                  {t.label} ({t.days} วันที่ประเมิน)
                </p>
                <MixBar slices={slices(t.shares)} order={order} />
              </div>
            ))
        )}
        <p className="text-xs text-muted-subtle">เป็นความรู้สึกของคนปิดร้าน ดูเป็นแนวโน้มดีกว่าตัวเลขเป๊ะ</p>
      </section>
    </div>
  );
}

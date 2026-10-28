// บัตรสต๊อก — one product at one branch (Kong 2026-10-25, mockup
// XYYyUgNP18V4HL3vUwrUf1 tab ③). Plain module: the server page renders it.
// Every row opens its document (stretched link, mise-ui-review §1).

import type { StockCard } from "@/server/stock-card";
import { MOVEMENT_TYPE_LABELS_TH, SOURCE_TYPE_LABELS_TH } from "@/lib/validations/stock-movement";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";

const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const day = (iso: string) => `${+iso.slice(8, 10)} ${MTH[+iso.slice(5, 7) - 1]} ${String((+iso.slice(0, 4) + 543) % 100).padStart(2, "0")}`;
const q = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const label = (m: Record<string, string>, k: string) => m[k] ?? k;

export default function StockCardTable({
  card,
  from,
  to,
  onHandNow,
  showCost,
  originSources,
}: {
  card: StockCard;
  from: string;
  to: string;
  /** The live balance, to say whether the closing figure matches today. */
  onHandNow: number | null;
  showCost: boolean;
  /** Source types the "เกิดจาก" filter keeps; null = all. Balances still count every row (SC-BAL). */
  originSources: readonly string[] | null;
}) {
  const u = unitTh(card.product.unit);
  const shown = originSources ? card.rows.filter((r) => originSources.includes(r.sourceType)) : card.rows;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["ยกมา", `${q(card.opening)} ${u}`, ""],
            ["เข้ารวม", `+${q(card.totalIn)} ${u}`, "text-good"],
            ["ออกรวม", `−${q(card.totalOut)} ${u}`, "text-bad"],
            ["ปลายช่วง", `${q(card.closing)} ${u}`, ""],
          ] as const
        ).map(([k, v, tone]) => (
          <div key={k} className="rounded-xl bg-muted/60 px-3 py-2">
            <span className="text-xs text-muted-subtle">{k}</span>
            <b className={`block font-display tabular-nums ${tone}`}>{v}</b>
          </div>
        ))}
      </div>
      {card.bySource.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {card.bySource.map((s) => (
            <span key={s.sourceType} className="rounded-full border border-border bg-surface px-3 py-1">
              {label(SOURCE_TYPE_LABELS_TH, s.sourceType)} ({s.count}) <b className={`tabular-nums ${s.qty < 0 ? "text-bad" : "text-good"}`}>{s.qty > 0 ? "+" : ""}{q(s.qty)} {u}</b>
            </span>
          ))}
        </div>
      )}
      <div className="data-table">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>เกิดจาก</th>
              <th className="text-right">เข้า</th>
              <th className="text-right">ออก</th>
              <th className="text-right">คงเหลือ</th>
              {showCost && <th className="text-right">มูลค่าที่ออก ฿</th>}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="bg-muted/30">
              <td colSpan={4}>
                ยอดยกมา {day(from)}
              </td>
              <td className="text-right font-semibold">{q(card.opening)}</td>
              {showCost && <td />}
            </tr>
            {shown.map((r) => (
              <tr key={r.id} className="group relative hover:bg-muted/50">
                <td className="whitespace-nowrap">
                  {r.doc?.href ? (
                    <a href={r.doc.href} className="after:absolute after:inset-0 after:content-['']">
                      {day(r.date)}
                    </a>
                  ) : (
                    day(r.date)
                  )}
                </td>
                <td>
                  {label(MOVEMENT_TYPE_LABELS_TH, r.type)}
                  <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{r.doc?.label ?? label(SOURCE_TYPE_LABELS_TH, r.sourceType)}</span>
                  {r.by && <span className="ml-1.5 text-xs text-muted-subtle">· {r.by}</span>}
                </td>
                <td className="text-right text-good">{r.qty > 0 ? `+${q(r.qty)}` : ""}</td>
                <td className="text-right text-bad">{r.qty < 0 ? q(-r.qty) : ""}</td>
                <td className="text-right font-semibold">{q(r.balance)}</td>
                {showCost && <td className="text-right text-muted-foreground">{r.value === null ? "" : r.value.toLocaleString("th-TH", { maximumFractionDigits: 0 })}</td>}
              </tr>
            ))}
            <tr className="bg-muted/30">
              <td colSpan={4}>
                ยอดปลายช่วง {day(to)}
              </td>
              <td className="text-right font-semibold">{q(card.closing)}</td>
              {showCost && <td />}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-subtle">
        หน่วย: {u} · กดแถวเพื่อเปิดเอกสารต้นทาง
        {originSources ? " · กรอง “เกิดจาก” ซ่อนบางแถว แต่ยอดคงเหลือยังนับทุกรายการ" : ""}
        {onHandNow !== null &&
          (Math.abs(onHandNow - card.closing) < 0.0005
            ? ` · ยอดปลายช่วงตรงกับคงเหลือตอนนี้ (${q(onHandNow)} ${u})`
            : ` · คงเหลือตอนนี้ ${q(onHandNow)} ${u} (มีรายการหลังวันที่ ${day(to)})`)}
      </p>
    </div>
  );
}

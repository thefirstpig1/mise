// What a recurring bill actually came to, month by month (expense review
// 2026-10-27, Kong) — so "is electricity going up?" is answered on the page
// that already holds the template, instead of by opening six bills.
//
// Every % names what it is compared with (mise-ui-review §5): the previous
// recorded month, or the template's starting amount for the first one. Up is
// bad here — this is money leaving the shop.

import { monthLabelTh } from "@/lib/expense-labels";
import { formatMoney } from "@/app/(app)/cost/_components/cost-view";
import { TONES } from "@/components/charts/chart-theme";

/** Olive for the months, clay for the one the page points at (chart theme). */
const bar = (tone: readonly string[]) => `linear-gradient(90deg, ${tone[1]}, ${tone[0]})`;

export type HistoryMonth = {
  period: string;
  /** null = not recorded yet. */
  bill: { id: string; total: number; paid: boolean } | null;
};

export default function RecurringHistory({
  months,
  defaultAmount,
  recurringId,
  canRecord,
}: {
  /** Oldest first. */
  months: HistoryMonth[];
  defaultAmount: number;
  recurringId: string;
  canRecord: boolean;
}) {
  const recorded = months.filter((m) => m.bill);
  const max = Math.max(defaultAmount, ...recorded.map((m) => m.bill!.total), 1);
  const latest = recorded.at(-1)?.period;
  const defaultAt = (defaultAmount / max) * 100;
  let prev: { period: string; total: number } | null = null;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">ยอดจริงแต่ละงวด</h3>
        <span className="text-sm text-muted-foreground">
          {months.length} งวดล่าสุด · มีบันทึก {recorded.length} งวด
        </span>
      </div>

      <div className="space-y-3">
        {months.map((m, i) => {
          if (!m.bill) {
            return (
              <div key={m.period} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_19rem]">
                <span className="text-sm text-muted-foreground">{monthLabelTh(m.period)}</span>
                <div className="flex h-8 items-center rounded-lg border border-dashed border-border-strong pl-3 text-xs text-muted-subtle">
                  ยังไม่ได้บันทึก
                </div>
                <div className="col-span-2 sm:col-span-1 sm:text-right">
                  {canRecord && (
                    <a
                      href={`/expenses/new?recurring=${recurringId}&period=${m.period}`}
                      className="inline-flex h-8 items-center whitespace-nowrap rounded-full border border-warn-border bg-warn-bg px-3 text-xs font-semibold text-warn hover:brightness-95"
                    >
                      บันทึกงวด {monthLabelTh(m.period)}
                    </a>
                  )}
                </div>
              </div>
            );
          }
          const total = m.bill.total;
          const base = prev ?? { period: null as string | null, total: defaultAmount };
          const pct = base.total > 0 ? ((total - base.total) / base.total) * 100 : null;
          const vs = base.period ? `เทียบ ${monthLabelTh(base.period)}` : "จากยอดตั้งต้น";
          prev = { period: m.period, total };
          const isLatest = m.period === latest;
          return (
            <a
              key={m.period}
              href={`/expenses/${m.bill.id}`}
              className="group grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg transition-colors hover:bg-muted/50 sm:grid-cols-[4.5rem_minmax(0,1fr)_19rem]"
            >
              <span className={`text-sm ${isLatest ? "font-semibold" : "text-muted-foreground"}`}>
                {monthLabelTh(m.period)}
              </span>
              <div className="relative h-8">
                <div
                  className="h-8 origin-left animate-grow-x rounded-r-lg"
                  style={{
                    width: `${(total / max) * 100}%`,
                    backgroundImage: bar(isLatest ? TONES.clay : TONES.olive),
                    animationDelay: `${i * 60}ms`,
                  }}
                />
                <div
                  aria-hidden
                  className="absolute -bottom-1.5 -top-1.5 border-l-2 border-dashed border-muted-subtle"
                  style={{ left: `${defaultAt}%` }}
                />
              </div>
              <div className="col-span-2 flex justify-between gap-2 text-sm sm:col-span-1">
                <span className="tabular-nums font-semibold">{formatMoney(String(total))}</span>
                <span className="whitespace-nowrap text-xs">
                  {pct === null || Math.abs(pct) < 0.05 ? (
                    <span className="text-muted-foreground">เท่ากับ{base.period ? monthLabelTh(base.period) : "ยอดตั้งต้น"}</span>
                  ) : (
                    <span className={pct > 0 ? "text-bad" : "text-good"}>
                      {pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% {vs}
                    </span>
                  )}
                  {!m.bill.paid && <span className="ml-2 text-warn">ยังไม่จ่าย</span>}
                </span>
              </div>
            </a>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-muted-subtle" />
          ยอดตั้งต้น ฿{formatMoney(String(defaultAmount))}
        </span>
        {latest && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TONES.clay[0] }} />
            งวดล่าสุดที่บันทึก
          </span>
        )}
        <span>กดแถวเพื่อเปิดบิลงวดนั้น</span>
      </div>
    </section>
  );
}

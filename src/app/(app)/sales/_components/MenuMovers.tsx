"use client";

// ============================================================
// Mise — which dishes carry the shop, rise, or need watching (Kong's Q4)
// ============================================================
// Against the previous period, PER DAY (rule SI1), and only for dishes that
// sell at least a plate a day in both periods (rule SI3) — otherwise 1 → 2
// plates is +100% and heads the list. A dish that sold last period and not at
// all this one is its own group, because "absent from the list" is not a
// warning anybody notices.
// ============================================================

import { TONES } from "@/components/charts/chart-theme";
import { METRIC_LABELS_TH, type Metric, type Mover, type Movers } from "@/lib/sales-insight";
import { fmtMetric, type ToneMap } from "./Breakdown";
import { MenuLink, useMenuInsight } from "./insight-context";

export default function MenuMovers({
  movers,
  by,
  tones,
  prevLabel,
}: {
  movers: Movers;
  by: Metric;
  tones: ToneMap;
  prevLabel: string;
}) {
  const ctx = useMenuInsight();
  const col = (title: string, hint: string, accent: string, list: Mover[], empty: string, showChange: boolean) => (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <p className="-mt-2 mb-3 text-xs text-muted-foreground">{hint}</p>
      {list.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="-mx-2 space-y-0.5">
          {list.map((m, i) => (
            <li key={m.id}>
              {/* The whole row opens the dish; the hover and the pointer say so. */}
              <button
                type="button"
                onClick={() => ctx?.open(m.id)}
                title="ดู insight ของเมนูนี้"
                className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              >
              <span className="w-4 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONES[tones[m.categoryKey] ?? "olive"][0] }} />
              <span className="min-w-0 flex-1 truncate font-medium group-hover:text-primary">{m.name}</span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block text-xs">{fmtMetric(by, m.perDay)}/วัน</span>
                {showChange && m.change !== null && (
                  <span className={`block text-xs font-medium ${m.change >= 0 ? "text-good" : "text-bad"}`}>
                    {m.change >= 0 ? "▲" : "▼"} {Math.abs(m.change).toFixed(1)}%
                  </span>
                )}
              </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {col(
          "ตัวชูโรง",
          `${METRIC_LABELS_TH[by]}ต่อวันสูงสุด · % เทียบ ${prevLabel}`,
          TONES.clay[0],
          movers.stars,
          "ยังไม่มีข้อมูล",
          true
        )}
        {col(
          "กำลังขึ้น",
          `โตขึ้นมากที่สุด เทียบ ${prevLabel} (ต่อวัน)`,
          TONES.good[0],
          movers.rising,
          "ไม่มีเมนูไหนโตขึ้นเทียบช่วงก่อน",
          true
        )}
        {col(
          "เฝ้าระวัง",
          `ลดลงมากที่สุด เทียบ ${prevLabel} (ต่อวัน)`,
          TONES.bad[0],
          movers.watch,
          "ไม่มีเมนูไหนลดลง",
          true
        )}
      </div>
      {movers.gone.length > 0 && (
        <p className="mt-3 rounded-lg border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
          ขายได้ใน {prevLabel} แต่ช่วงนี้ไม่มีเลย:{" "}
          {movers.gone.map((m, i) => (
            <span key={m.id}>
              {i > 0 && ", "}
              <MenuLink id={m.id} className="font-medium underline">
                {m.name}
              </MenuLink>
            </span>
          ))}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        เทียบกับ {prevLabel} · เฉลี่ยต่อวันที่มีข้อมูล · นับเฉพาะเมนูที่ขายอย่างน้อย 1 จานต่อวันทั้งสองช่วง
      </p>
    </div>
  );
}

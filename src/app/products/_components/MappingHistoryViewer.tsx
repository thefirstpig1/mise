"use client";

// Sprint 1 Part 8 L5a — price history viewer for one product (read-only).
//
// The page builds one PriceHistorySeries per (supplier, branch) tuple by calling
// getPriceHistoryLogic — each series carries ALL rows incl. soft-deleted, newest
// first. This component shows them as chronological timelines, highlighting the
// open/current row (effectiveTo === null) and flagging removed rows. When there
// is more than one series a select narrows to one tuple. No edit/delete — this
// is a historical reference (Q9).

import { useState } from "react";
import type { PriceHistorySeries } from "./mapping-view";

const badgeBase =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

/** "ซัพพลายเออร์ · สาขา" (or "ทุกสาขา" for the tenant-default scope). */
function seriesLabel(s: PriceHistorySeries): string {
  const supplier = s.supplier?.name ?? "(ไม่ทราบซัพพลายเออร์)";
  const branch = s.branch ? s.branch.name : "ทุกสาขา";
  return `${supplier} · ${branch}`;
}

export default function MappingHistoryViewer({
  series,
}: {
  series: PriceHistorySeries[];
}) {
  // "all" = show every series stacked; otherwise narrow to one tuple's key.
  const [selected, setSelected] = useState<string>("all");

  if (series.length === 0) {
    return (
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h3 className="text-sm font-medium">ประวัติราคา</h3>
        <p className="text-sm text-muted-foreground">ยังไม่มีประวัติราคา</p>
      </section>
    );
  }

  const shown =
    selected === "all" ? series : series.filter((s) => s.key === selected);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium">ประวัติราคา</h3>
        {series.length > 1 && (
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
          >
            <option value="all">ทุกซัพพลายเออร์/สาขา</option>
            {series.map((s) => (
              <option key={s.key} value={s.key}>
                {seriesLabel(s)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-5">
        {shown.map((s) => (
          <div key={s.key} className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {seriesLabel(s)}
            </p>
            <ol className="space-y-1.5">
              {s.rows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {r.effectiveFrom} – {r.effectiveTo ?? "ปัจจุบัน"}
                  </span>
                  <span className="tabular-nums font-medium">
                    {r.currentUnitPrice === null
                      ? "—"
                      : `฿${r.currentUnitPrice}`}
                    {r.orderUnit ? ` / ${r.orderUnit.name}` : ""}
                  </span>
                  {r.isOpen && (
                    <span className={`${badgeBase} bg-sky-100 text-sky-700`}>
                      ปัจจุบัน
                    </span>
                  )}
                  {r.deleted && (
                    <span
                      className={`${badgeBase} bg-rose-100 text-rose-700`}
                    >
                      ถูกลบ
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

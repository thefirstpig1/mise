"use client";

// Sprint 1 Part 8 L5a — price history viewer for one product (read-only).
// Sprint 1 Part 9 L5c — generalized: the same viewer also serves a SUPPLIER's
// price history. The page builds one PriceHistorySeries per tuple — (supplier,
// branch) on a product page, (product, branch) on a supplier page — via
// getPriceHistoryLogic; each series carries ALL rows incl. soft-deleted, newest
// first. The `perspective` prop only flips the series LABEL (supplier ↔ product).
// This component shows series as chronological timelines, highlighting the
// open/current row (effectiveTo === null) and flagging removed rows. When there
// is more than one series a select narrows to one tuple. No edit/delete — this
// is a historical reference (Q9).

import { useState } from "react";
import type { PriceHistorySeries } from "./mapping-view";

type Perspective = "product" | "supplier";

const badgeBase =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

/** "<other side> · สาขา" — supplier name on a product page, product name on a
 *  supplier page; branch is "ทุกสาขา" for the tenant-default scope. */
function seriesLabel(s: PriceHistorySeries, perspective: Perspective): string {
  const primary =
    perspective === "product"
      ? (s.supplier?.name ?? "(ไม่ทราบซัพพลายเออร์)")
      : (s.product?.name ?? "(ไม่ทราบสินค้า)");
  const branch = s.branch ? s.branch.name : "ทุกสาขา";
  return `${primary} · ${branch}`;
}

export default function MappingHistoryViewer({
  series,
  perspective = "product",
}: {
  series: PriceHistorySeries[];
  /** "product" (default) = history per supplier; "supplier" = history per
   *  product. Only changes the series label source. */
  perspective?: Perspective;
}) {
  // "all" = show every series stacked; otherwise narrow to one tuple's key.
  const [selected, setSelected] = useState<string>("all");

  if (series.length === 0) {
    return (
      <section className="space-y-4 rounded-lg border border-border bg-surface p-6">
        <h3 className="text-sm font-medium">ประวัติราคา</h3>
        <p className="text-sm text-muted-foreground">ยังไม่มีประวัติราคา</p>
      </section>
    );
  }

  const shown =
    selected === "all" ? series : series.filter((s) => s.key === selected);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-6">
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
                {seriesLabel(s, perspective)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-5">
        {shown.map((s) => (
          <div key={s.key} className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {seriesLabel(s, perspective)}
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
                    <span className={`${badgeBase} bg-muted text-muted-foreground`}>
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

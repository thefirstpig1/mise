"use client";

// Sprint 2 Part 10 L5c — the ledger history feed.
//
// The first page is rendered on the server (so the list is there without JS and
// the filters are a plain GET form); "โหลดเพิ่ม" continues from `nextCursor`
// through getStockMovementHistoryAction. The same filter object the server used
// is passed down and replayed with each cursor — otherwise page 2 would quietly
// widen the query the user filtered.
//
// Every row is immutable by design (ADR 0011 Q7): there is no edit or delete
// affordance here, and there never should be. A mistake is corrected by
// recording a compensating adjustment, which then appears as its own row — the
// history is the audit trail, so hiding the mistake would defeat the point.

import { useState } from "react";
import { getStockMovementHistoryAction } from "@/app/stock/actions";
import {
  ADJUSTMENT_REASON_LABELS_TH,
  MOVEMENT_TYPE_LABELS_TH,
  SOURCE_TYPE_LABELS_TH,
} from "@/lib/validations/stock-movement";
import type { StockMovementView } from "./stock-view";

/** Filters as they go back to the action — same keys the schema parses. */
export type HistoryFilter = {
  productId?: string;
  branchId?: string;
  type?: string;
  sourceType?: string;
  dateFrom?: string;
  dateTo?: string;
};

/** Enum values arrive as plain strings from the serializer; fall back to the raw
 *  value so a type added in Sprint 3+ renders readably instead of blank. */
const label = (map: Record<string, string>, key: string): string =>
  map[key] ?? key;

/** Green for stock in, red for stock out — the sign is the whole story. */
function QtyCell({ qty }: { qty: string }) {
  const isOut = qty.startsWith("-");
  return (
    <span
      className={`font-medium tabular-nums ${isOut ? "text-red-700" : "text-green-700"}`}
    >
      {isOut ? qty : `+${qty}`}
    </span>
  );
}

export default function StockMovementHistory({
  initialRows,
  initialCursor,
  filter,
}: {
  initialRows: StockMovementView[];
  initialCursor: string | null;
  filter: HistoryFilter;
}) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setLoadError(null);
    const res = await getStockMovementHistoryAction({ ...filter, cursor });
    if (res.ok) {
      setRows((prev) => [...prev, ...res.data.rows]);
      setCursor(res.data.nextCursor);
    } else {
      setLoadError(res.formError);
    }
    setLoading(false);
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        ไม่พบรายการเคลื่อนไหวตามเงื่อนไขนี้
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((m) => (
          <li key={m.id} className="p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="font-medium">{m.product.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {m.product.sku} · {m.branch.name}
                </span>
              </div>
              <div>
                <QtyCell qty={m.qty} />
                <span className="ml-1 text-xs text-muted-foreground">
                  {m.product.baseUnitName ?? ""}
                </span>
              </div>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">
                {label(MOVEMENT_TYPE_LABELS_TH, m.type)}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5">
                {label(SOURCE_TYPE_LABELS_TH, m.sourceType)}
              </span>
              {m.adjustment && (
                <span className="rounded bg-muted px-1.5 py-0.5">
                  {label(ADJUSTMENT_REASON_LABELS_TH, m.adjustment.reason)}
                </span>
              )}
              <span>{m.occurredAtLabel}</span>
              <span>· {m.createdBy.name ?? m.createdBy.email}</span>
            </div>

            {/* As-entered qty, when it differs from the base unit stored above. */}
            {m.adjustment &&
              m.adjustment.inputUnitName !== m.product.baseUnitName && (
                <div className="mt-1 text-xs text-muted-foreground">
                  กรอกเป็น {m.adjustment.inputQty} {m.adjustment.inputUnitName}
                </div>
              )}

            {m.notes && <p className="mt-1 text-xs">{m.notes}</p>}
          </li>
        ))}
      </ul>

      {loadError && <p className="text-xs text-red-600">{loadError}</p>}

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="w-full rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40 disabled:opacity-50"
        >
          {loading ? "กำลังโหลด…" : "โหลดเพิ่ม"}
        </button>
      )}
    </div>
  );
}

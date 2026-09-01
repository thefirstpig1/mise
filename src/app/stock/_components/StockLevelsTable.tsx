"use client";

// Sprint 2 Part 10 L5b — the stock-levels grid for one branch.
//
// Pure presentation + client-side filtering over rows the server already
// resolved. Two deliberate choices:
//
//  - Dates arrive PRE-FORMATTED from the server (`lastMovementLabel`). Formatting
//    a date in the component would run once in Node during SSR and again in the
//    browser after hydration, with different default locales/timezones between
//    them — a classic hydration mismatch. The server owns the Bangkok rendering.
//  - Balances stay strings end to end (Pitfall #20 + the precision reason in
//    stock-view.ts). Nothing here does arithmetic on them; `negative` is decided
//    server-side by Decimal comparison, not by parsing the string.
//
// There is no "low stock" filter: the schema has no reorder point / par level
// on Product, so any threshold would be invented rather than configured. The
// filters below use only facts the ledger actually knows. A real par level is a
// schema change (Sprint 3+).

import { useMemo, useState } from "react";

export type StockLevelRow = {
  productId: string;
  name: string;
  sku: string;
  /** Signed, base unit, as a string. */
  balance: string;
  baseUnitName: string | null;
  negative: boolean;
  movementCount: number;
  /** Server-rendered Bangkok date, or null when nothing ever moved. */
  lastMovementLabel: string | null;
  /** Soft-deleted product still holding stock — surfaced, never hidden. */
  deleted: boolean;
  /**
   * Part 14: value of the stock on hand, summed LAYER BY LAYER (ADR 0014 Q3b).
   * Never `cost x balance` — with two layers at different prices that product is
   * a different, wrong number.
   */
  inventoryValue: string | null;
  /** true = some of this stock was priced by guesswork, or not at all. */
  costUncertain: boolean;
};

type Filter = "all" | "negative" | "zero" | "untouched";

const FILTER_LABELS: Record<Filter, string> = {
  all: "ทั้งหมด",
  negative: "ติดลบ",
  zero: "หมด (0)",
  untouched: "ยังไม่เคยเคลื่อนไหว",
};

export default function StockLevelsTable({ rows }: { rows: StockLevelRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const negativeCount = rows.filter((r) => r.negative).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.name} ${r.sku}`.toLowerCase().includes(q)) return false;
      switch (filter) {
        case "negative":
          return r.negative;
        case "zero":
          // "Sold down to nothing" — distinct from never having moved at all.
          return !r.negative && r.movementCount > 0 && Number(r.balance) === 0;
        case "untouched":
          return r.movementCount === 0;
        default:
          return true;
      }
    });
  }, [rows, query, filter]);

  return (
    <div className="space-y-4">
      {negativeCount > 0 && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          มี {negativeCount} รายการที่ยอดติดลบ — ตรวจสอบว่าลืมบันทึกรับของหรือนับผิด
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชื่อหรือรหัส"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <div className="flex gap-1">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                filter === f
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">วัตถุดิบ</th>
              <th className="px-3 py-2 text-right font-medium">ยอดคงเหลือ</th>
              <th className="px-3 py-2 text-right font-medium">มูลค่า</th>
              <th className="px-3 py-2 font-medium">เคลื่อนไหวล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  ไม่พบรายการตามเงื่อนไขนี้
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.productId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <a
                      href={`/products/${r.productId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.name}
                    </a>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {r.sku}
                    </span>
                    {r.deleted && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        ถูกลบแล้ว — ยังมีของค้าง
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={r.negative ? "font-medium text-bad" : ""}>
                      {r.balance}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      {r.baseUnitName ?? ""}
                    </span>
                    {r.negative && (
                      <span className="ml-2 rounded bg-bad-bg px-1.5 py-0.5 text-xs font-medium text-bad">
                        ต้องตรวจสอบ
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.inventoryValue === null ? (
                      // Not ฿0 and not a dash: both read as claims about the
                      // stock, and this is a fact about the reader (rule A8).
                      // The link is dropped with the figure — /cost is behind
                      // the same capability, so offering it would send someone
                      // to a refusal.
                      <span className="text-muted-foreground">ไม่มีสิทธิ์ดู</span>
                    ) : (
                      <a
                        href={`/cost/${r.productId}`}
                        className="text-primary hover:underline"
                      >
                        {Number(r.inventoryValue).toLocaleString("th-TH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </a>
                    )}
                    {r.costUncertain && (
                      <span
                        className="ml-1 text-warn"
                        title="ต้นทุนบางส่วนยังไม่ทราบ"
                      >
                        *
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.lastMovementLabel ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        แสดง {visible.length} จาก {rows.length} รายการ
      </p>
    </div>
  );
}

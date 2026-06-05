"use client";

// Sprint 1 Part 8 L5a — supplier price list for one product (read side).
//
// The page fetches the product's mappings in "all" mode (live rows, incl. those
// whose supplier is soft-deleted = orphans, sorted last) and serializes them to
// MappingView[]. This component renders them with a client-side Active/All
// toggle: "active" hides orphan rows, "all" shows them flagged. L5a-2 adds the
// "เพิ่มรายการราคา" CTA + a per-row "แก้ไข" link to the write routes; the delete
// control lives on the edit page (mirrors DeleteProductButton).

import { useState } from "react";
import type { MappingView } from "./mapping-view";

type FilterMode = "active" | "all";

const badgeBase =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

/** "ทุกสาขา" for the tenant-default scope (null branch), else the branch name. */
function branchLabel(m: MappingView): string {
  return m.branch ? m.branch.name : "ทุกสาขา";
}

/** "฿25.00 / กก." — price with its order unit; "—" when no price captured. */
function priceLabel(m: MappingView): string {
  if (m.currentUnitPrice === null) return "—";
  const unit = m.orderUnit ? ` / ${m.orderUnit.name}` : "";
  return `฿${m.currentUnitPrice}${unit}`;
}

export default function MappingListSection({
  mappings,
  productId,
}: {
  mappings: MappingView[];
  productId: string;
}) {
  const [mode, setMode] = useState<FilterMode>("active");

  // "active" hides orphan rows (supplier soft-deleted); "all" keeps the server's
  // orphans-last order. No re-sort here — the page already ordered them.
  const visible =
    mode === "active" ? mappings.filter((m) => !m.supplierDeleted) : mappings;
  const orphanCount = mappings.filter((m) => m.supplierDeleted).length;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium">รายการราคาซัพพลายเออร์</h3>
        <div className="flex items-center gap-4">
          {/* Active / All toggle (Q6) */}
          <div className="flex gap-3 text-sm">
            {(["active", "all"] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="mapping_filter_mode"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="h-4 w-4"
                />
                {m === "active"
                  ? "เฉพาะที่ใช้งาน"
                  : `ทั้งหมด${orphanCount > 0 ? ` (${orphanCount} กำพร้า)` : ""}`}
              </label>
            ))}
          </div>
          {/* L5a-2 write CTA → separate create page (Q9 product-centric). */}
          <a
            href={`/products/${productId}/mappings/new`}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
          >
            + เพิ่มรายการราคา
          </a>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีรายการราคาซัพพลายเออร์สำหรับสินค้านี้
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">ซัพพลายเออร์</th>
                <th className="py-2 pr-4 font-medium">สาขา</th>
                <th className="py-2 pr-4 font-medium">ราคา/หน่วย</th>
                <th className="py-2 pr-4 font-medium">ขั้นต่ำ</th>
                <th className="py-2 pr-4 font-medium">Lead (วัน)</th>
                <th className="py-2 pr-4 font-medium">ช่วงเวลา</th>
                <th className="py-2 pr-4 font-medium">สถานะ</th>
                <th className="py-2 font-medium text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="py-2 pr-4">
                    <span className="font-medium">
                      {m.supplier?.name ?? "(ไม่ทราบ)"}
                    </span>
                    {m.supplierItemCode && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        · {m.supplierItemCode}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{branchLabel(m)}</td>
                  <td className="py-2 pr-4 tabular-nums">{priceLabel(m)}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {m.minOrderQty ?? "—"}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {m.leadTimeDays ?? "—"}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {m.effectiveFrom} – {m.effectiveTo ?? "ปัจจุบัน"}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {m.isPreferred && (
                        <span
                          className={`${badgeBase} bg-emerald-100 text-emerald-700`}
                        >
                          แนะนำ
                        </span>
                      )}
                      {m.isOpen && (
                        <span
                          className={`${badgeBase} bg-sky-100 text-sky-700`}
                        >
                          ปัจจุบัน
                        </span>
                      )}
                      {m.supplierDeleted && (
                        <span
                          className={`${badgeBase} bg-amber-100 text-amber-700`}
                        >
                          ซัพพลายเออร์ถูกลบ
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <a
                      href={`/products/${productId}/mappings/${m.id}/edit`}
                      className="text-sm text-primary hover:underline"
                    >
                      แก้ไข
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

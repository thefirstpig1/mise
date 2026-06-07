"use client";

// Sprint 1 Part 8 L5a — supplier price list for one product (read side).
// Sprint 1 Part 9 L5c — generalized to a second perspective: the SAME table now
// also renders one SUPPLIER's price list (rows of products) on the supplier
// detail page. The `perspective` prop is the only switch — it flips the labelled
// "other side" (supplier ↔ product), the orphan flag (supplierDeleted ↔
// productDeleted), and the section copy. The write surface stays product-centric
// (decision iii): the create CTA shows only on the product perspective, and every
// edit link points at the product-centric edit route regardless of perspective.
//
// The page fetches mappings in "all" mode (live rows, incl. those whose other
// side is soft-deleted = orphans, sorted last) and serializes them to
// MappingView[]. This component renders them with a client-side Active/All
// toggle: "active" hides orphan rows, "all" shows them flagged.

import { useState } from "react";
import type { MappingView } from "./mapping-view";

type FilterMode = "active" | "all";
type Perspective = "product" | "supplier";

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

// Per-perspective copy/flags. The product page lists a product's SUPPLIERS; the
// supplier page lists a supplier's PRODUCTS. Everything else about the row is
// identical, so the difference collapses to these few strings + accessors.
const COPY: Record<
  Perspective,
  {
    title: string;
    nameHeader: string;
    empty: string;
    orphanBadge: string;
    nameOf: (m: MappingView) => string;
    isOrphan: (m: MappingView) => boolean;
  }
> = {
  product: {
    title: "รายการราคาซัพพลายเออร์",
    nameHeader: "ซัพพลายเออร์",
    empty: "ยังไม่มีรายการราคาซัพพลายเออร์สำหรับสินค้านี้",
    orphanBadge: "ซัพพลายเออร์ถูกลบ",
    nameOf: (m) => m.supplier?.name ?? "(ไม่ทราบ)",
    isOrphan: (m) => m.supplierDeleted,
  },
  supplier: {
    title: "รายการราคาสินค้า",
    nameHeader: "สินค้า/วัตถุดิบ",
    empty: "ยังไม่มีรายการราคาสินค้าสำหรับซัพพลายเออร์นี้",
    orphanBadge: "สินค้าถูกลบ",
    nameOf: (m) => m.product?.name ?? "(ไม่ทราบ)",
    isOrphan: (m) => m.productDeleted,
  },
};

export default function MappingListSection({
  mappings,
  perspective = "product",
  productId,
}: {
  mappings: MappingView[];
  /** "product" (default) = a product's supplier list; "supplier" = a supplier's
   *  product list. Drives labels, orphan flag, and the create-CTA visibility. */
  perspective?: Perspective;
  /** The page's product id — required for the product perspective (create CTA +
   *  edit-link base). Unused on the supplier perspective (per-row m.productId). */
  productId?: string;
}) {
  const [mode, setMode] = useState<FilterMode>("active");
  const copy = COPY[perspective];

  // "active" hides orphan rows (other side soft-deleted); "all" keeps the
  // server's orphans-last order. No re-sort here — the page already ordered them.
  const visible =
    mode === "active" ? mappings.filter((m) => !copy.isOrphan(m)) : mappings;
  const orphanCount = mappings.filter((m) => copy.isOrphan(m)).length;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium">{copy.title}</h3>
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
          {/* L5a-2 write CTA → product-centric create page (Q9). Product
              perspective only — the supplier view is read-only (decision iii). */}
          {perspective === "product" && productId && (
            <a
              href={`/products/${productId}/mappings/new`}
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
            >
              + เพิ่มรายการราคา
            </a>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{copy.nameHeader}</th>
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
              {visible.map((m) => {
                // Edit always lands on the product-centric route (decision iii):
                // its base is the page's productId (product view) or the row's
                // own productId (supplier view).
                const editProductId =
                  perspective === "product" ? productId : m.productId;
                return (
                  <tr
                    key={m.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-2 pr-4">
                      <span className="font-medium">{copy.nameOf(m)}</span>
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
                        {copy.isOrphan(m) && (
                          <span
                            className={`${badgeBase} bg-amber-100 text-amber-700`}
                          >
                            {copy.orphanBadge}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {editProductId && (
                        <a
                          href={`/products/${editProductId}/mappings/${m.id}/edit`}
                          className="text-sm text-primary hover:underline"
                        >
                          แก้ไข
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

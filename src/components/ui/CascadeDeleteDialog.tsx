"use client";

// Sprint 1 Part 8 L5b — generic blast-radius confirm dialog for a cascade
// soft-delete (Q6 cascade-with-user-control). Shared by DeleteProductButton and
// DeleteSupplierButton: each passes the live mappings that would be affected,
// and the user reviews/unchecks before confirming. Default = ALL checked (Q6
// hybrid lock — the safe assumption is "delete the dependent price rows too");
// unchecking one leaves that mapping live (an orphan of the deleted parent).
//
// Dumb/generic by design: it knows nothing about products vs suppliers. The
// caller builds CascadeMappingItem[] with a context-appropriate primaryLabel
// (supplier name on the product page, product name on the supplier page) so the
// same component serves both sides. Decimal formatting (priceLabel) is done by
// the caller server-side (Pitfall #20) — items here are plain strings.

import { useEffect, useRef, useState } from "react";

/** One affected mapping, pre-formatted by the caller (no Decimal crosses here). */
export type CascadeMappingItem = {
  id: string;
  /** The "other side" of the mapping (supplier name / product name). */
  primaryLabel: string;
  /** Branch scope: a branch name or "ทุกสาขา". */
  secondaryLabel: string;
  /** "฿25.00 / กก." or "—". */
  priceLabel: string;
};

export default function CascadeDeleteDialog({
  open,
  title,
  warning,
  items,
  confirmLabel,
  isPending,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  warning: string;
  items: CascadeMappingItem[];
  confirmLabel: string;
  isPending: boolean;
  error?: string;
  onConfirm: (selectedIds: string[]) => void;
  onCancel: () => void;
}) {
  // Selected ids to cascade. Re-seed to "all checked" each time the dialog opens
  // (items is a stable server-passed prop; re-seeding on open keeps the default
  // honest if the underlying list ever changes between opens).
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.map((i) => i.id))
  );
  useEffect(() => {
    if (open) setSelected(new Set(items.map((i) => i.id)));
  }, [open, items]);

  const allChecked = items.length > 0 && selected.size === items.length;
  const indeterminate = selected.size > 0 && !allChecked;

  // Native indeterminate is a DOM-only property (no React attribute).
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  if (!open) return null;

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(items.map((i) => i.id)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 shadow-lg">
        <h3 className="text-base font-semibold">{title}</h3>

        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {warning}
        </p>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">
            รายการราคาที่เชื่อมอยู่ ({items.length})
          </span>
          <label className="flex items-center gap-2 text-sm">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-border"
            />
            {allChecked ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
          </label>
        </div>

        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleItem(item.id)}
                  className="h-4 w-4 rounded border-border"
                />
                <span className="flex-1">
                  <span className="font-medium">{item.primaryLabel}</span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    · {item.secondaryLabel}
                  </span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {item.priceLabel}
                </span>
              </label>
            </li>
          ))}
        </ul>

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => onConfirm([...selected])}
            disabled={isPending}
            className="rounded-lg border border-red-300 bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "กำลังลบ..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

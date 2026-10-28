"use client";

// ============================================================
// คิดครัว — "are you sure?" in the app's own words (2026-10-29)
// ============================================================
// Replaces the browser's confirm(), which is grey, half-English ("OK /
// Cancel"), cannot say what will happen, and looks like the site broke.
// Rendered into <body> through a portal: `position: fixed` inside the page
// frame is fixed to the FRAME, which animates in with a transform
// (mise-ui-review §7), so an overlay there starts below the top.
// Esc and a click outside cancel.
// ============================================================

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "ยกเลิก",
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** What happens if they go ahead — one or two plain sentences. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-sm animate-pop-in space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-lg">
        <h3 id="confirm-title" className="text-base font-semibold">{title}</h3>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={pending} className={`${danger ? "btn-danger" : "btn"} btn-sm`}>
            {pending ? "กำลังทำ…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

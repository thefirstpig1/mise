"use client";

// Small pieces the control page's new screens share (ADR 0045 part B): the
// popup frame, the toast, and a Thai date. The shops table keeps its own copies
// from ADR 0043.

import { useEffect, type ReactNode } from "react";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import { shortDate } from "@/lib/advance-labels";

/** "7 พ.ย. 2569" */
export const fullDate = (ymd: string) => `${shortDate(ymd)} ${Number(ymd.slice(0, 4)) + 543}`;

export function Frame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useTopLayer(onClose);
  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 animate-fade-in bg-black/25" onMouseDown={onClose} aria-hidden />
        <div role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[90dvh] w-full max-w-lg animate-pop-in space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="icon-btn text-xl leading-none" aria-label="ปิด">
              ×
            </button>
          </div>
          {children}
        </div>
      </div>
    </Portal>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(t);
  }, [text, onDone]);
  return (
    <Portal>
      <div role="status" className="fixed inset-x-0 bottom-6 z-[70] mx-auto w-fit max-w-[90vw] animate-pop-in rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg">
        {text}
      </div>
    </Portal>
  );
}

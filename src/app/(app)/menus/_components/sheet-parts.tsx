"use client";

// The frames the menu-management screen is built from (Kong, 2026-10-04):
// a sheet that slides in from the right, a second one stacked over it, and the
// short second look before a recipe changes.
//
// Esc and the scrim close the TOP layer only — a stack, not a race between
// listeners — so Esc on the confirmation never also closes the sheet under it.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Rendered into <body>: the page frame animates in with a transform, and a
 * `position: fixed` element inside a transformed ancestor is fixed to THAT box,
 * not to the window — the sheet would start below the page's top edge.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? createPortal(children, document.body) : null;
}

const layers: string[] = [];
function useTopLayer(onClose: () => void) {
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    layers.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && layers[layers.length - 1] === id) {
        e.preventDefault();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const at = layers.lastIndexOf(id);
      if (at >= 0) layers.splice(at, 1);
    };
  }, [id]);
}

export function Sheet({
  onClose,
  labelledBy,
  stacked = false,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  useTopLayer(onClose);
  useEffect(() => {
    if (stacked) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [stacked]);

  return (
    <Portal>
    <div className={`fixed inset-0 ${stacked ? "z-[60]" : "z-50"}`}>
      <div className={`absolute inset-0 animate-fade-in ${stacked ? "bg-black/10" : "bg-black/25"}`} onMouseDown={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`absolute inset-y-0 right-0 flex w-full flex-col bg-background shadow-2xl animate-slide-in-right ${stacked ? "sm:w-[620px]" : "sm:w-[720px]"}`}
      >
        {children}
      </aside>
    </div>
    </Portal>
  );
}

export function PhotoSlot({ size, label }: { size: number; label: string }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-xl border-[1.5px] border-dashed border-border-strong bg-surface-sunk text-center text-[10px] leading-tight text-muted-subtle"
      style={{ width: size, height: size }}
      title="รูปเพิ่มได้เร็ว ๆ นี้"
    >
      <span>
        <svg width="22" height="18" viewBox="0 0 26 22" fill="none" stroke="currentColor" strokeWidth="1.6" className="mx-auto mb-0.5" aria-hidden>
          <rect x="1" y="4" width="24" height="17" rx="3" />
          <circle cx="13" cy="12.5" r="4.5" />
          <path d="M8 4l2-3h6l2 3" />
        </svg>
        {label}
        <br />
        เร็ว ๆ นี้
      </span>
    </div>
  );
}

/**
 * The second look before a recipe changes (Kong 2026-10-04). Short on purpose:
 * WHAT changed (three lines at most), what it COSTS, WHO gets it, FROM WHEN.
 * The confirm button names the consequence, never "ตกลง", and focus starts on
 * "กลับไปแก้" so a reflexive Enter does not go through — a box people learn to
 * press past is a box that protects nothing.
 */
export type ConfirmSpec = {
  title: string;
  lines: string[];
  money: string | null;
  who: string;
  go: string;
  onGo: () => void;
};

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  useTopLayer(onClose);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    back.current?.focus();
  }, []);
  const shown = spec.lines.slice(0, 3);
  const more = spec.lines.length - shown.length;
  return (
    <Portal>
    <div className="fixed inset-0 z-[70] grid animate-fade-in place-items-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cfm-title" className="w-full max-w-sm animate-pop-in space-y-3 rounded-2xl bg-surface p-5 shadow-2xl">
        <h3 id="cfm-title" className="text-base font-semibold">
          {spec.title}
        </h3>
        {shown.length > 0 && (
          <ul className="space-y-1 text-sm">
            {shown.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
                <span>{l}</span>
              </li>
            ))}
            {more > 0 && <li className="pl-3.5 text-xs text-muted-foreground">และอีก {more} รายการ</li>}
          </ul>
        )}
        {spec.money && <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm tabular-nums">{spec.money}</p>}
        <p className="text-xs text-muted-foreground">{spec.who}</p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button ref={back} autoFocus type="button" onClick={onClose} className="rounded-full border border-border-strong px-4 py-1.5 text-sm hover:bg-muted">
            กลับไปแก้
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              spec.onGo();
            }}
            className="btn"
          >
            {spec.go}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

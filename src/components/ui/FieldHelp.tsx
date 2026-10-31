"use client";

// ============================================================
// Mise — the "?" beside a setting (friend's-shop feedback, Kong 2026-10-31)
// ============================================================
// Mockup 1wgaH9Jfx8L7CxqfNHtdn3: "% ของอะไร", "บรรทัดนี้คืออะไร" — a shop
// setting up for the first time could not tell. One press opens the four
// answers from src/lib/setting-help.ts: what it is, an example in baht, the
// pages it moves, and what changing it does to what is already recorded.
//
// On a computer it is a small box beside the button and the page stays
// usable (a press anywhere else closes it). On a phone it is a sheet from the
// bottom with a "เข้าใจแล้ว" — a box beside a 24px button does not fit a
// 400px screen. Both render into <body> (Portal): the page frame animates in
// with a transform, which would make `fixed` relative to the frame.
// ============================================================

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import type { SettingHelp } from "@/lib/setting-help";

/** Below this width the help opens as a bottom sheet. */
const PHONE = 640;
const WIDTH = 360;

export default function FieldHelp({ help }: { help: SettingHelp }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`คำอธิบาย: ${help.title}`}
        className="relative inline-grid h-6 w-6 shrink-0 place-items-center rounded-full border border-primary/40 bg-surface font-display text-[13px] font-semibold leading-none text-primary transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-primary-soft aria-expanded:border-primary aria-expanded:bg-primary aria-expanded:text-primary-foreground"
      >
        ?
      </button>
      {open && (
        <HelpLayer
          help={help}
          anchor={button}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}

type Place = { phone: true } | { phone: false; left: number; top?: number; bottom?: number; maxHeight: number };

function HelpLayer({ help, anchor, onClose }: { help: SettingHelp; anchor: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  useTopLayer(onClose);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);

  // Beside the button: below it when there is room, above it when not; kept
  // in place while the page scrolls under it.
  useLayoutEffect(() => {
    const measure = () => {
      const a = anchor.current;
      if (!a) return;
      if (window.innerWidth < PHONE) return setPlace({ phone: true });
      const r = a.getBoundingClientRect();
      const left = Math.min(Math.max(16, r.left - 12), window.innerWidth - WIDTH - 16);
      const below = window.innerHeight - r.bottom;
      setPlace(
        below >= 320 || below >= r.top
          ? { phone: false, left, top: r.bottom + 8, maxHeight: below - 24 }
          : { phone: false, left, bottom: window.innerHeight - r.top + 8, maxHeight: r.top - 24 }
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor]);

  // A press outside closes the box — but not a press on its own button,
  // which toggles it.
  const isPhone = place?.phone === true;
  useEffect(() => {
    if (isPhone) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isPhone, anchor, onClose]);

  // The sheet holds the page still while it is open.
  useEffect(() => {
    if (!isPhone) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isPhone]);

  if (!place) return null;
  if (place.phone) {
    return (
      <Portal>
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 animate-fade-in bg-black/25" onClick={onClose} aria-hidden />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-x-0 bottom-0 max-h-[85vh] animate-slide-up space-y-3 overflow-y-auto rounded-t-[22px] bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-sm text-muted-foreground shadow-2xl"
          >
            <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-border-strong" />
            <Body help={help} titleId={titleId} />
            <button type="button" onClick={onClose} className="btn h-11 w-full">
              เข้าใจแล้ว
            </button>
          </div>
        </div>
      </Portal>
    );
  }
  return (
    <Portal>
      <div
        ref={panel}
        role="dialog"
        aria-labelledby={titleId}
        style={{ left: place.left, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight, width: WIDTH }}
        className="fixed z-50 animate-pop-in space-y-3 overflow-y-auto rounded-2xl border border-border/70 bg-surface p-4 text-sm text-muted-foreground shadow-2xl"
      >
        <Body help={help} titleId={titleId} />
      </div>
    </Portal>
  );
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="font-display text-[11px] font-semibold tracking-[0.1em] text-gold-ink">{label}</p>
      {children}
    </div>
  );
}

function Body({ help, titleId }: { help: SettingHelp; titleId: string }) {
  return (
    <>
      <h3 id={titleId} className="text-balance font-display text-[15px] font-semibold leading-snug text-foreground">
        {help.title}
      </h3>
      <Part label="คืออะไร">
        <p>{help.what}</p>
      </Part>
      <Part label="ตัวอย่าง">
        <p className="rounded-xl bg-[#EEF0DC] px-3 py-2 text-foreground">{help.example}</p>
      </Part>
      <Part label="มีผลกับหน้า">
        <ul className="space-y-1">
          {help.affects.map(([page, what]) => (
            <li key={page}>
              <span className="font-semibold text-primary">{page}</span> · {what}
            </li>
          ))}
        </ul>
      </Part>
      <Part label="เปลี่ยนแล้ว">
        <p>{help.change}</p>
      </Part>
    </>
  );
}

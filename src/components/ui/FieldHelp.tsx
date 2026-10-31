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
//
// Round 2 (Kong 2026-11-01): "ใช้รูปภาพประกอบ … แบบหนังสือเรียน เอาง่ายๆ" —
// a picture first (src/components/ui/help-pictures.tsx) with the example as
// its caption, then one sentence each, and the pages as tags. It takes the
// setting's NAME, not its words: a picture is a component, and a component
// cannot be handed from a server page to this one.
// ============================================================

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import { SETTING_HELP, type HelpKey, type SettingHelp } from "@/lib/setting-help";
import { HELP_PICTURES } from "@/components/ui/help-pictures";

/** Below this width the help opens as a bottom sheet. */
const PHONE = 640;
const WIDTH = 380;

export default function FieldHelp({ name }: { name: HelpKey }) {
  const help: SettingHelp = SETTING_HELP[name];
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
          name={name}
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

function HelpLayer({ name, help, anchor, onClose }: { name: HelpKey; help: SettingHelp; anchor: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  useTopLayer(onClose);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);

  // Beside the button: below it when the whole box fits there, above it when
  // it fits there instead. With a picture the box is taller than half a
  // laptop screen, so when it fits neither side the page is scrolled ONCE to
  // make room below (the button stays on screen); only if the page cannot
  // move does the box scroll inside itself. Kept in place while the page
  // scrolls under it.
  const nudged = useRef(false);
  const measureRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const measure = () => {
      const a = anchor.current;
      if (!a) return;
      if (window.innerWidth < PHONE) return setPlace({ phone: true });
      const r = a.getBoundingClientRect();
      const left = Math.min(Math.max(16, r.left - 12), window.innerWidth - WIDTH - 16);
      const below = window.innerHeight - r.bottom - 24;
      const above = r.top - 24;
      const need = panel.current?.scrollHeight ?? 0;
      if (need > 0 && need > below && need > above && !nudged.current) {
        nudged.current = true;
        const room = Math.min(need - below, r.top - 72);
        if (room > 0) {
          window.scrollBy({ top: room });
          return; // the scroll event measures again
        }
      }
      setPlace(
        need <= below || below >= above
          ? { phone: false, left, top: r.bottom + 8, maxHeight: below }
          : { phone: false, left, bottom: window.innerHeight - r.top + 8, maxHeight: above }
      );
    };
    measureRef.current = measure;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor]);
  // Once the box exists its real height is known: place it again.
  const placed = place !== null;
  useLayoutEffect(() => {
    if (placed) measureRef.current();
  }, [placed]);

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
            <Body name={name} help={help} titleId={titleId} />
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
        <Body name={name} help={help} titleId={titleId} />
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

function Body({ name, help, titleId }: { name: HelpKey; help: SettingHelp; titleId: string }) {
  const Picture = HELP_PICTURES[name];
  return (
    <>
      <h3 id={titleId} className="text-balance font-display text-[15px] font-semibold leading-snug text-foreground">
        {help.title}
      </h3>
      <figure className="space-y-2 rounded-xl border border-border bg-surface-sunk p-3 text-[12px] text-foreground">
        <Picture />
        <figcaption className="text-[11.5px] leading-snug text-muted-foreground">{help.example}</figcaption>
      </figure>
      <Part label="คืออะไร">
        <p>{help.what}</p>
      </Part>
      <Part label="มีผลกับหน้า">
        <ul className="flex flex-wrap gap-1.5">
          {help.affects.map(([page, what]) => (
            <li key={page} title={what} className="rounded-full border border-border-strong bg-surface px-2 text-xs leading-5 text-primary">
              {page}
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

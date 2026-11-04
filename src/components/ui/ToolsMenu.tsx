"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import IconTile from "@/components/ui/IconTile";

// ============================================================
// คิดครัว — the page's secondary tools behind one button (queue item 9)
// ============================================================
// Kong 2026-11-04 ("เอาตามแนะนำ"): a page head carries ONE main action. The
// rest go here, each with one line saying what it is for, because a tool you
// have to open a menu to find is harder to discover (ServiceTitan Anvil, SAP
// Fiori) — the line is what makes up for that. A tool the page also needs at a
// particular moment (merging duplicates) keeps its own button there too.
// Closes on a click outside or Esc.
// ============================================================

export type Tool = { href: string; icon: LucideIcon; label: string; hint: string };

export default function ToolsMenu({ tools, label = "เครื่องมือ" }: { tools: Tool[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (tools.length === 0) return null;
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} className="btn-secondary gap-1.5">
        <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        {label}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.8} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-30 mt-1.5 grid w-[min(20rem,calc(100vw-2rem))] animate-pop-in rounded-2xl border border-border bg-surface p-1.5 shadow-lg sm:left-auto sm:right-0">
          {tools.map((t) => (
            <a key={t.href} role="menuitem" href={t.href} onClick={() => setOpen(false)} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-xl p-2 transition-colors hover:bg-muted">
              <IconTile icon={t.icon} />
              <span>
                <b className="block font-display text-[13.5px] font-semibold">{t.label}</b>
                <span className="block text-xs leading-snug text-muted-foreground">{t.hint}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

// ADR 0045 part B — คิดครัว's announcement, at the top of every page of every
// shop for as long as the operator set. "แจ้งให้ทราบ" may be closed (that
// browser remembers, a per-viewer convenience); "สำคัญ" stays until it ends.

import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import type { LiveAnnouncement } from "@/server/announcements";

const KEY = "kitkrua.announcements.closed";

function readClosed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export default function AnnouncementBar({ items }: { items: LiveAnnouncement[] }) {
  const [closed, setClosed] = useState<string[] | null>(null);
  useEffect(() => setClosed(readClosed()), []);
  const shown = items.filter((a) => a.tone === "important" || !(closed ?? []).includes(a.id));
  if (shown.length === 0) return null;
  const close = (id: string) => {
    const next = [...(closed ?? []), id].slice(-50);
    setClosed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private window: it closes for this visit only */
    }
  };
  return (
    <div className="space-y-px" role="region" aria-label="ประกาศจากคิดครัว">
      {shown.map((a) => (
        <div
          key={a.id}
          className={`flex items-start gap-2.5 px-4 py-2 text-sm lg:px-8 ${
            a.tone === "important" ? "bg-warn-bg text-foreground [&_svg]:text-warn" : "bg-surface-sunk text-foreground [&_svg]:text-primary"
          } animate-fade-in`}
        >
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            <b className="font-display font-semibold">{a.tone === "important" ? "ประกาศสำคัญจากคิดครัว · " : "จากคิดครัว · "}</b>
            {a.message}
          </p>
          {a.tone === "info" && closed !== null && (
            <button type="button" onClick={() => close(a.id)} className="icon-btn -my-1 shrink-0" aria-label="ปิดประกาศนี้">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

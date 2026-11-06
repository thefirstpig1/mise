"use client";

// ADR 0045 Q2 — the orange number on the dark strip: how many things are in
// ต้องทำ. Read after the page paints (a GET, mise-ui-review §5c), so no page of
// Kong's waits on two dozen cross-shop queries to draw.

import { useEffect, useState } from "react";
import { readApi } from "@/lib/read-api";

export default function AdminTodoBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let on = true;
    void readApi<{ ok: true; count: number }>("/api/platform", "todo").then((r) => {
      if (on && r.ok) setCount(r.count);
    });
    return () => {
      on = false;
    };
  }, []);
  if (count <= 0) return null;
  return (
    <span
      className="ml-1.5 inline-grid h-[18px] min-w-[18px] animate-pop-in place-items-center rounded-full bg-[#C9734F] px-1.5 text-[11px] font-bold leading-none text-white tabular-nums"
      aria-label={`ต้องทำ ${count} เรื่อง`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

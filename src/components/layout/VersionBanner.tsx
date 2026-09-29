"use client";

// ============================================================
// Mise — "มีเวอร์ชันใหม่" banner, for every signed-in page
// ============================================================
// Kong (2026-09-28): "แถบเตือน มีเวอร์ชันใหม่ กรุณารีเฟรช ทั้งระบบ". A tab left
// open across a deploy still runs the old code; its next button press calls a
// Server Action the server no longer has. This notices first — when the tab
// comes back into view and every few minutes — and also shows when any screen
// reports a stale call (`announceStale`, src/lib/stale-tab.ts).
// ============================================================

import { useEffect, useState } from "react";
import { CLIENT_BUILD_ID, onStaleAnnounced } from "@/lib/stale-tab";

const EVERY_MS = 5 * 60 * 1000;

export default function VersionBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { id } = (await r.json()) as { id?: string };
        // A failed or odd answer is not a new version: only a DIFFERENT id is.
        if (id && CLIENT_BUILD_ID && id !== CLIENT_BUILD_ID) setStale(true);
      } catch {
        // Offline or the server restarting — ask again next time.
      }
    };
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const t = window.setInterval(onVisible, EVERY_MS);
    const off = onStaleAnnounced(() => setStale(true));
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(t);
      off();
    };
  }, []);

  if (!stale) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 border-b border-warn-border bg-warn-bg px-4 py-2 text-sm text-warn"
    >
      <span>มีเวอร์ชันใหม่ของระบบ กรุณารีเฟรชหน้านี้ก่อนทำรายการต่อ</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
      >
        รีเฟรชหน้า
      </button>
    </div>
  );
}

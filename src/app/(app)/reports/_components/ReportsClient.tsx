"use client";

// The two things /reports does in the browser: open the sidebar's report form
// (one form in the frame — OPEN_REPORT_EVENT), and mark the answers seen once
// the list has been shown, so the sidebar's clay count clears.

import { useEffect } from "react";
import { Flag } from "lucide-react";
import { openReportDialog } from "@/lib/problem-report";
import { refreshNavBadges } from "@/lib/nav-badges";
import { markReportsSeenAction } from "../actions";

export function NewReportButton({ secondary = false }: { secondary?: boolean }) {
  return (
    <button type="button" onClick={openReportDialog} className={secondary ? "btn-secondary btn-sm" : "btn"}>
      <Flag className="h-4 w-4" strokeWidth={1.9} aria-hidden />
      แจ้งเรื่องใหม่
    </button>
  );
}

export function MarkSeen({ any }: { any: boolean }) {
  useEffect(() => {
    if (!any) return;
    void markReportsSeenAction()
      .then(() => refreshNavBadges())
      .catch(() => undefined);
  }, [any]);
  return null;
}

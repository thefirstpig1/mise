"use client";

// ============================================================
// Mise — มื้อพนักงาน as tabs, one per job (Kong 2026-10-28)
// ============================================================
// Mockup RkKwhwCmh4akz2QvgeMcis. The page used to be one long scroll that
// everyone shared; each person used a different part of it. Now:
//   ขอเบิก        — everyone, phone-first: a menu, a ticket number to show.
//   รออนุมัติ      — approvers; the count on the tab is work waiting.
//   บันทึกหม้อใหญ่ — the big pot cooked from the store, or on behalf of a part-timer.
//   สรุป          — the month per person (staff:view) and the list.
// It opens on the tab the reader most likely came for. The chosen tab rides
// in `?tab=` so a filter on the list (a GET form) lands back on it.
// ============================================================

import { useCallback, useState, type ComponentProps, type ReactNode } from "react";
import Tabs from "@/components/ui/Tabs";
import TicketBoard from "./TicketBoard";
import StaffMealSummary from "./StaffMealSummary";

export type StaffMealTab = "request" | "pending" | "pot" | "summary";

export default function StaffMealsScreen({
  initialTab,
  isApprover,
  seesPeople,
  ticket,
  potForm,
  history,
  branches,
  todayIso,
}: {
  initialTab: StaffMealTab;
  isApprover: boolean;
  seesPeople: boolean;
  ticket: Omit<ComponentProps<typeof TicketBoard>, "view" | "onPendingCount">;
  potForm: ReactNode;
  history: ReactNode;
  branches: { id: string; name: string }[];
  todayIso: string;
}) {
  const [tab, setTabState] = useState<StaffMealTab>(initialTab);
  const [pending, setPending] = useState(ticket.initial.pending?.length ?? 0);
  const onPendingCount = useCallback((n: number) => setPending(n), []);
  const setTab = (t: StaffMealTab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  const items = [
    { key: "request" as const, label: "ขอเบิก" },
    ...(isApprover ? [{ key: "pending" as const, label: "รออนุมัติ", count: pending }] : []),
    { key: "pot" as const, label: isApprover ? "บันทึกหม้อใหญ่ / แทนพาร์ทไทม์" : "บันทึกหม้อใหญ่" },
    { key: "summary" as const, label: seesPeople ? "สรุป" : "รายการ" },
  ];

  return (
    <div className="space-y-5">
      <Tabs label="มื้อพนักงาน" items={items} value={tab} onChange={setTab} />
      {(tab === "request" || tab === "pending") && <TicketBoard {...ticket} view={tab} onPendingCount={onPendingCount} />}
      {tab === "pot" && potForm}
      {tab === "summary" && (
        <div className="space-y-6">
          {seesPeople && <StaffMealSummary todayIso={todayIso} branches={branches} />}
          {history}
        </div>
      )}
    </div>
  );
}

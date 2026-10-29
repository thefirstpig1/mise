// ============================================================
// ปิดเดือน · ส่งให้บัญชี (Kong 2026-10-29, mockup
// https://claude.ai/artifact/VpfS5hv6vgDEsYmZGiujtT)
// ============================================================
// Replaces the raw branch table at /cost/detail (which now redirects here).
// One job: at the end of a month, give the accountant the stock value and
// cost of sales, in the file their accounting program reads.
//
// The read is one FIFO replay (~3 s on the demo shop), so it is started here
// and streamed — the header and month chips paint at once. A month is a
// link (FilterLink), so it is shareable and the back button works.
// `searchParams` is a PROMISE in Next 15.
// ============================================================

import { Suspense } from "react";
import { requireTenant } from "@/lib/require-tenant";
import PageHeader from "@/components/ui/PageHeader";
import FilterLink from "@/components/ui/FilterLink";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { monthParamSchema } from "@/lib/validations/accounting-export";
import { getMonthEndLogic, lastClosedMonth } from "@/server/month-end";
import { getAccountingExportSettingsLogic } from "@/server/accounting-export-settings";
import { monthChipTh, monthTitleTh, shiftMonth, toMonthEndView } from "@/lib/month-end-view";
import MonthEndView, { MonthEndSkeleton } from "./_components/MonthEndView";

export default async function MonthEndPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { tenantId, reach, can } = await requireTenant("cost:view");
  const { month: asked } = await searchParams;

  const today = computeBangkokToday();
  const current = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const closed = lastClosedMonth(today);
  // A month from the address bar is used only if it is a real month and not in the future.
  const month = asked && monthParamSchema.safeParse(asked).success && asked <= current ? asked : closed;
  const chips = [shiftMonth(closed, -2), shiftMonth(closed, -1), closed, current];
  if (!chips.includes(month)) chips.unshift(month);

  const data = getMonthEndLogic(tenantId, month, reach, { withBills: true })
    .then((d) => (d ? toMonthEndView(d) : null))
    .catch((e) => {
      console.error("[month-end] read failed", e);
      return null;
    });
  const settings = getAccountingExportSettingsLogic(tenantId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`ปิดเดือน ${monthTitleTh(month)}`}
        description="มูลค่าสต๊อกและต้นทุนขายของเดือน สำหรับลงบัญชี — ส่งออกเป็นไฟล์ตามโปรแกรมบัญชีที่ร้านใช้"
        actions={
          <nav aria-label="เลือกเดือน" className="flex flex-wrap gap-1.5">
            {chips.map((m) => (
              <FilterLink key={m} href={`/month-end?month=${m}`} className={`pill ${m === month ? "is-on" : ""}`}>
                {monthChipTh(m)}
                {m === current && <span className="ml-1 text-[11px] opacity-70">ยังไม่จบเดือน</span>}
              </FilterLink>
            ))}
          </nav>
        }
      />
      <Suspense key={month} fallback={<MonthEndSkeleton />}>
        <MonthEndView data={data} settings={settings} canEditSettings={can("settings:write")} />
      </Suspense>
    </div>
  );
}

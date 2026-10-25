// /cost/departments — ต้นทุนตามแผนก, built from the questions owners ask
// (Kong 2026-10-25 "เริ่มเลย"; mockup X2ShNU69NhR3VdeTBm1Fnf, brief
// UquT29bbnRBaE6bkTuRsoP). The figures stream in after the frame paints; the
// trend (question 3) loads itself over GET once the page is up.
//
// Opens on the branch that sells and the period that holds its latest sales —
// not "the last 30 days", which was an empty table on the demo shop.
//
// `searchParams` is a PROMISE in Next 15.

import { Suspense } from "react";
import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic, liveliestBranchId } from "@/server/branch";
import { monthRanges, weekRanges } from "@/server/cost-overview";
import { getDepartmentOverviewLogic } from "@/server/department-overview";
import DepartmentOverview from "./_components/DepartmentOverview";

export default async function DepartmentCostPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; view?: string; p?: string }>;
}) {
  const { tenantId, reach, membership } = await requireTenant("cost:view");
  const sp = await searchParams;
  const branches = await getBranchesLogic(tenantId, reach);
  if (branches.length === 0) return <p className="text-sm text-muted-foreground">ยังไม่มีสาขา</p>;
  const fallback = sp.branch ? undefined : await liveliestBranchId(tenantId, branches.map((b) => b.id));
  const branch = branches.find((b) => b.id === sp.branch) ?? branches.find((b) => b.id === fallback) ?? branches[0];

  const view: "month" | "week" = sp.view === "week" ? "week" : "month";
  const today = computeBangkokToday();
  // One extra in front, so the first bucket shown still has a "period before".
  const all = view === "week" ? weekRanges(today, 13) : monthRanges(today, 7);
  const shown = all.slice(1);

  const latest = await withTenantContext(tenantId, (tx) =>
    tx.salesLine.findFirst({ where: { tenantId, branchId: branch.id, supersededAt: null }, orderBy: { businessDate: "desc" }, select: { businessDate: true } })
  );
  const holding = latest ? shown.findLast((b) => b.from.getTime() <= latest.businessDate.getTime()) : undefined;
  const selected = shown.find((b) => b.key === sp.p) ?? holding ?? shown[shown.length - 1];
  const idx = all.findIndex((b) => b.key === selected.key);
  const previous = all[idx - 1];

  const overview = getDepartmentOverviewLogic(tenantId, branch.id, selected, previous, selected.label).catch(() => null);

  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-border bg-muted/30" aria-label="กำลังคำนวณ…" />}>
      <DepartmentOverview
        data={overview}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        branchId={branch.id}
        view={view}
        buckets={shown.map((b) => ({ key: b.key, label: b.label, partial: b.partial }))}
        selectedKey={selected.key}
        previousLabel={previous.label}
        coverageMin={membership.tenant.costCoverageMinPct}
        departmentsOn={membership.tenant.enableDepartments}
      />
    </Suspense>
  );
}

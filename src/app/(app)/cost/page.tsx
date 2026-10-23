// /cost — ต้นทุน, question-first (Kong 2026-10-23, mockup v7
// https://claude.ai/artifact/T9zrVfBMAChWBaaZgEaYj5).
//
// The page awaits nothing slow. The overview (one ledger replay + fourteen
// period summaries, ~3 s on the demo shop) is STARTED here and streamed to the
// client, which paints its frame at once and fills in when it lands. Branch,
// period, week/month and baht/% are all switched in the browser: every figure
// for every choice arrives in that one read, so no press goes back to the
// server. The old branch table lives on at /cost/detail.

import { Suspense } from "react";
import { requireTenant } from "@/lib/require-tenant";
import { getCostOverviewLogic } from "@/server/cost-overview";
import CostOverview, { CostOverviewSkeleton } from "./_components/CostOverview";

export default async function CostPage() {
  const { tenantId, reach, can } = await requireTenant("cost:view");
  const overview = getCostOverviewLogic(tenantId, reach).catch((e) => {
    console.error("[cost] overview failed", e);
    return null;
  });
  return (
    <Suspense fallback={<CostOverviewSkeleton />}>
      <CostOverview overview={overview} canEditTargets={can("settings:write")} />
    </Suspense>
  );
}

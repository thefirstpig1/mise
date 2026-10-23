// ของหายไปไหน — question-first (Kong 2026-10-24, mockup
// https://claude.ai/artifact/3Agisejn3ERh1AXMZgkphj). One closed count at a
// time; see src/server/leak-overview.ts for every figure. The read (~3 s, one
// FIFO replay) is started here and streamed, so the frame paints at once.
//
// `searchParams` is a PROMISE in Next 15.

import { Suspense } from "react";
import { requireTenant } from "@/lib/require-tenant";
import { getLeakOverviewLogic } from "@/server/leak-overview";
import LeakOverview, { LeakOverviewSkeleton } from "./_components/LeakOverview";

export default async function LeakPage({ searchParams }: { searchParams: Promise<{ count?: string }> }) {
  const { tenantId, reach } = await requireTenant("cost:view");
  const { count } = await searchParams;
  const overview = getLeakOverviewLogic(tenantId, reach).catch((e) => {
    console.error("[leaks] overview failed", e);
    return null;
  });
  return (
    <Suspense fallback={<LeakOverviewSkeleton />}>
      <LeakOverview overview={overview} initialCountId={count ?? null} />
    </Suspense>
  );
}

// การผันผวนราคาวัตถุดิบ (Kong 2026-10-24, mockup round 3
// https://claude.ai/artifact/GdWVDbQEZerSWLgWSd3Ago). The read (~2.5 s: receipts
// + one recipe walk) is started here and streamed; every switch on the page is
// arithmetic in the browser. See src/server/price-volatility.ts.

import { Suspense } from "react";
import { requireTenant } from "@/lib/require-tenant";
import { getPriceVolatilityLogic } from "@/server/price-volatility";
import PriceVolatility, { PriceVolatilitySkeleton } from "./_components/PriceVolatility";

export default async function PricesPage() {
  const { tenantId, reach, can } = await requireTenant("cost:view");
  const data = getPriceVolatilityLogic(tenantId, reach).catch((e) => {
    console.error("[prices] volatility failed", e);
    return null;
  });
  return (
    <Suspense fallback={<PriceVolatilitySkeleton />}>
      <PriceVolatility data={data} canEditTargets={can("master:write")} />
    </Suspense>
  );
}

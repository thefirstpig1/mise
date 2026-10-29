// ADR 0040 step 7 — /production: what the kitchen made, and the door to record it.
//
// Server Component. The list and the "ระบบตัดแทน" card are cheap reads and
// paint first; the cost per unit (a FIFO replay) is STARTED here and streams
// into the client after paint (mise-ui-review §5c), only for cost:view.
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import {
  getProductionCostsLogic,
  getProductionListLogic,
  getProductionPickablesLogic,
  getShortfallReportLogic,
} from "@/server/production-read";
import ProductionScreen from "./_components/ProductionScreen";

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenantId, reach, costAccess, can } = await requireTenant("stock:write");
  const sp = await searchParams;
  const today = computeBangkokToday();

  const branches = await getBranchesLogic(tenantId, reach);
  // A branch from the URL is never trusted: it must be one this person reaches.
  const branchId = sp.branch && branches.some((b) => b.id === sp.branch) ? sp.branch : null;

  const [rows, shortfalls, pickables] = await Promise.all([
    getProductionListLogic(tenantId, reach, { branchId, from: addDays(today, -30) }),
    getShortfallReportLogic(tenantId, reach, { branchId, today }),
    getProductionPickablesLogic(tenantId),
  ]);

  const costs = costAccess === null ? null : getProductionCostsLogic(tenantId, rows).catch(() => ({}));

  return (
    <ProductionScreen
      rows={rows}
      shortfalls={shortfalls}
      costs={costs}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      defaultBranchId={branchId ?? branches[0]?.id ?? ""}
      make={pickables.make}
      trim={pickables.trim}
      today={today.toISOString().slice(0, 10)}
      canRecord={can("stock:write")}
    />
  );
}

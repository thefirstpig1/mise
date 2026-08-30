// Sprint 2 Part 10 L5b — stock levels for one branch.
//
// Server Component. The branch lives in the URL (`?branch=<id>`) rather than in
// component state so the view is linkable and revalidatePath("/stock") from the
// L4 write path refreshes whatever the user is actually looking at.
//
// `searchParams` is a PROMISE in Next 15 — see the login-page fix (`a669e05`):
// the plain-object signature type-checks under `pnpm tsc` and fails `pnpm build`.
//
// Dates are formatted HERE, not in the client table: formatting in the component
// would run once in Node during SSR and again in the browser after hydration,
// with different default locale/timezone between them.

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getStockBalancesByBranchLogic } from "@/server/stock-movement";
import { getProductCostsLogic } from "@/server/stock-cost";
import { getProductCostsQuerySchema } from "@/lib/validations/stock-cost";
import { getParLevelsLogic } from "@/server/par-level";
import { getParLevelsQuerySchema } from "@/lib/validations/par-level";
import { toProductStockBalanceView } from "./_components/stock-view";
import { toParLevelRowView } from "./_components/par-level-view";
import BelowParList from "./_components/BelowParList";
import { getIncomingTransfersLogic } from "@/server/transfer";
import { toTransferView } from "@/app/transfers/_components/transfer-view";
import IncomingTransfers from "@/app/transfers/_components/IncomingTransfers";
import StockLevelsTable, {
  type StockLevelRow,
} from "./_components/StockLevelsTable";

/** Bangkok-rendered date label, computed server-side (stable across hydration). */
const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export default async function StockLevelsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenantId, reach} = await requireTenant("any:member");
  const { branch: branchParam } = await searchParams;

  const branches = await getBranchesLogic(tenantId, reach);

  if (branches.length === 0) {
    // Onboarding guarantees ≥1 branch (ADR 0011 Q6 pre-task), so this is a
    // defensive empty state, not an expected flow.
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
        ยังไม่มีสาขาในระบบ
      </div>
    );
  }

  // An unknown/foreign branch id in the URL falls back to the first branch
  // rather than erroring — the id never reaches the query unvalidated.
  const activeBranch =
    branches.find((b) => b.id === branchParam) ?? branches[0];

  const incoming = (
    await getIncomingTransfersLogic(tenantId, activeBranch.id)
  ).map(toTransferView);

  const balances = await getStockBalancesByBranchLogic(tenantId, activeBranch.id);

  // Part 14: one BATCHED cost read for the whole grid. Never one per product —
  // 200 products x a round trip to Neon Singapore is 6-16 seconds, which is risk
  // R1 in ADR 0014's register and the reason the read layer exposes no
  // per-product query to loop over.
  const costs = await getProductCostsLogic(
    tenantId,
    getProductCostsQuerySchema.parse({
      productIds: balances.map((b) => b.productId),
      branchId: activeBranch.id,
    })
  );

  // Part 17 (ADR 0017 Q6): what is under its par at THIS branch.
  //
  // Read WITHOUT belowOnly and narrowed here, so the page can tell three states
  // apart — nobody has set a par, everything is above par, or these are short.
  // Collapsing the first two into "render nothing" is exactly the failure
  // Consequence 4 warns about: the list is only as good as the pars being filled
  // in, and a screen that never mentions the feature is how it goes unused.
  // The read is per-branch and bounded by how many pars exist, so the extra rows
  // cost nothing.
  const allPar = (
    await getParLevelsLogic(
      tenantId,
      getParLevelsQuerySchema.parse({ branchId: activeBranch.id })
    )
  ).map((r) => toParLevelRowView(r));
  const belowPar = allPar.filter((r) => r.isBelow);

  const rows: StockLevelRow[] = balances
    .map(toProductStockBalanceView)
    .map((b) => ({
      productId: b.product.id,
      name: b.product.name,
      sku: b.product.sku,
      balance: b.balance,
      baseUnitName: b.product.baseUnitName,
      negative: b.negative,
      movementCount: b.movementCount,
      lastMovementLabel: b.lastMovementAt
        ? BANGKOK_DATE.format(new Date(b.lastMovementAt))
        : null,
      deleted: b.product.deleted,
      // Summed layer by layer by the replay — NOT cost x balance (ADR 0014 Q3b).
      inventoryValue: costs.get(b.product.id)?.inventoryValue.toString() ?? "0",
      costUncertain: costs.get(b.product.id)?.hasUnpricedLayers ?? false,
    }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">ยอดคงเหลือ</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ยอดคำนวณสดจากรายการเคลื่อนไหวทั้งหมด ไม่ใช่ตัวเลขที่เก็บไว้
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/stock/history"
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
          >
            ประวัติการเคลื่อนไหว
          </a>
          {/* Beside ปรับสต๊อก on purpose (Part 17 Q4, "one door per kind of
              loss"): this is where someone stands when they notice stock is
              wrong, and the adjust form no longer offers ของเสีย as a reason. */}
          <a
            href="/waste"
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
          >
            บันทึกของเสีย
          </a>
          {/* Part 18: this is where someone stands when they realise another
              branch needs some of what is in front of them. `?from=` carries the
              shelf they are looking at, the same courtesy /stock-counts/new got
              in Part 17. */}
          <a
            href={`/transfers/new?from=${activeBranch.id}`}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
          >
            โอนไปสาขาอื่น
          </a>
          <a
            href="/stock/adjust"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            ปรับสต๊อก
          </a>
        </div>
      </div>

      {branches.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {branches.map((b) => (
            <a
              key={b.id}
              href={`/stock?branch=${b.id}`}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                b.id === activeBranch.id
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {b.name}
            </a>
          ))}
        </div>
      )}

      {/* Part 18 Q8: the receiving half of a transfer is somebody else's work in
          another branch, so it has to appear on the page this branch already
          opens every day. `always` because "nothing on the way" is itself worth
          knowing when you are standing at the shelf deciding whether to order. */}
      <IncomingTransfers
        transfers={incoming}
        branchName={activeBranch.name}
        variant="always"
      />

      <BelowParList
        rows={belowPar}
        branchId={activeBranch.id}
        parCount={allPar.length}
      />

      <StockLevelsTable rows={rows} />
    </div>
  );
}

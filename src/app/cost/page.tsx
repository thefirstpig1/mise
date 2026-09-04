// Sprint 2 Part 14 L5a — the business-wide cost view (ADR 0014 Q9b).
//
// Server Component. The period lives in the URL (`?from=&to=`) so the view is
// linkable and a revalidatePath("/cost") refreshes what the user is looking at —
// the same rule /stock follows for its branch.
//
// `searchParams` is a PROMISE in Next 15: the plain-object signature type-checks
// under `pnpm tsc` and fails `pnpm build` (the Part 10 L5a discovery).

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday, addDays } from "@/lib/bangkok-date";
import { getBranchCostSummaryLogic } from "@/server/stock-cost";
import { getBranchCostSummaryQuerySchema } from "@/lib/validations/stock-cost";
import { toBranchCostSummaryView } from "./_components/cost-view";
import BranchCostTable from "./_components/BranchCostTable";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function CostOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { tenantId, reach} = await requireTenant("cost:view");
  const { from: fromParam, to: toParam } = await searchParams;

  // Default window: the last 30 Bangkok days. Computed on the SERVER — a browser
  // in another timezone would otherwise disagree with the query's day bounds
  // (Decision #60).
  const today = computeBangkokToday();
  const defaultFrom = iso(addDays(today, -30));
  const defaultTo = iso(today);

  // A malformed range falls back to the default with a notice rather than
  // erroring the page: a query string is navigation, not a form being filled in.
  const parsed = getBranchCostSummaryQuerySchema.safeParse({
    from: fromParam || defaultFrom,
    to: toParam || defaultTo,
  });
  const query = parsed.success
    ? parsed.data
    : getBranchCostSummaryQuerySchema.parse({ from: defaultFrom, to: defaultTo });

  const rows = (await getBranchCostSummaryLogic(tenantId, query, reach)).map(
    toBranchCostSummaryView
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">ภาพรวมทั้งธุรกิจ</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          เปรียบเทียบทุกสาขาในช่วงเวลาเดียวกัน — สาขาไหนใช้เงินไปกับอะไร และรั่วตรงไหน
        </p>
      </div>

      {!parsed.success && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          ช่วงเวลาที่ระบุไม่ถูกต้อง — แสดงข้อมูล 30 วันล่าสุดแทน
        </div>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="from" className="label">
            ตั้งแต่
          </label>
          <input
            type="date"
            id="from"
            name="from"
            defaultValue={iso(query.from)}
            className="input mt-1"
          />
        </div>
        <div>
          <label htmlFor="to" className="label">
            ถึง
          </label>
          <input
            type="date"
            id="to"
            name="to"
            defaultValue={iso(query.to)}
            className="input mt-1"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          ดูช่วงนี้
        </button>
      </form>

      <BranchCostTable rows={rows} />

      <p className="text-xs text-muted-foreground">
        ต้องการดูรายวัตถุดิบ? เปิดหน้า{" "}
        <a href="/stock" className="text-primary hover:underline">
          สต๊อก
        </a>{" "}
        แล้วเลือกวัตถุดิบที่ต้องการ
      </p>
    </div>
  );
}

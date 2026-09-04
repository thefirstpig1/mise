// Sprint 3 Part 15 L5a — the list of count sheets.
//
// Server Component. Filters live in the URL so the view is linkable and the
// action layer's revalidatePath("/stock-counts") refreshes what the user is
// looking at — the rule /stock and /cost already follow.
//
// `searchParams` is a PROMISE in Next 15: the plain-object signature type-checks
// under `pnpm tsc` and fails `pnpm build` (the Part 10 L5a discovery).

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getStockCountsLogic } from "@/server/stock-count";
import {
  getStockCountsQuerySchema,
  STOCK_COUNT_STATUS_LABELS_TH,
  STOCK_COUNT_STATUS_VALUES,
} from "@/lib/validations/stock-count";
import { toStockCountListView } from "./_components/stock-count-view";
import StatusBadge from "./_components/StatusBadge";
import { getIncomingTransfersLogic } from "@/server/transfer";
import { toTransferView } from "@/app/transfers/_components/transfer-view";
import IncomingTransfers from "@/app/transfers/_components/IncomingTransfers";

export default async function StockCountListPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; status?: string }>;
}) {
  const { tenantId, reach, costAccess} = await requireTenant("count:write");
  const { branch, status } = await searchParams;

  const [branches] = await Promise.all([getBranchesLogic(tenantId, reach)]);

  // A malformed filter falls back to the unfiltered list rather than erroring:
  // a query string is navigation, not a form being filled in (Part 10 L5c).
  const parsed = getStockCountsQuerySchema.safeParse({ branchId: branch, status });
  const query = parsed.success ? parsed.data : {};

  const rows = (await getStockCountsLogic(tenantId, query)).map(toStockCountListView);
  const openSheet = rows.find((r) => r.status === "DRAFT");

  // Part 18 Q7: counting a branch while a truck is still moving finds a shortage
  // exactly the size of the truck, and Part 15 posts it as a real ADJUST_LOSS
  // with the counter's name on it. The notice warns; it deliberately does NOT
  // block — a stock take has to end the evening it starts, and a branch across
  // town forgetting to press รับของ must not be able to prevent that.
  //
  // Only when a branch is actually selected: "which branch is the truck heading
  // for" has no answer on the unfiltered list, and a warning that cannot name a
  // place is one people learn to ignore.
  const noticeBranch = query.branchId
    ? (branches.find((b) => b.id === query.branchId) ?? null)
    : null;
  const incoming = noticeBranch
    ? (await getIncomingTransfersLogic(tenantId, noticeBranch.id)).map((t) => toTransferView(t, costAccess))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">ใบนับสต๊อก</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            นับของจริงบนชั้น แล้วให้ระบบปรับส่วนต่างเข้าคลัง
          </p>
        </div>
        <a
          href="/stock-counts/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          เปิดใบนับใหม่
        </a>
      </div>

      {noticeBranch && (
        <IncomingTransfers
          transfers={incoming}
          branchName={noticeBranch.name}
          countWarning
        />
      )}

      {openSheet && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          มีใบนับที่ยังไม่ปิดอยู่ —{" "}
          <a href={`/stock-counts/${openSheet.id}`} className="font-medium underline">
            {openSheet.scNumber} ({openSheet.branchName})
          </a>{" "}
          นับต่อในใบเดิมได้เลย
        </div>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3">
        {branches.length > 1 && (
          <div>
            <label htmlFor="branch" className="label">
              สาขา
            </label>
            <select
              id="branch"
              name="branch"
              defaultValue={query.branchId ?? ""}
              className="input mt-1"
            >
              <option value="">ทุกสาขา</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="status" className="label">
            สถานะ
          </label>
          <select
            id="status"
            name="status"
            defaultValue={query.status ?? ""}
            className="input mt-1"
          >
            <option value="">ทั้งหมด</option>
            {STOCK_COUNT_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {STOCK_COUNT_STATUS_LABELS_TH[s]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          กรอง
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
          ยังไม่มีใบนับสต๊อก — กด &ldquo;เปิดใบนับใหม่&rdquo; เพื่อเริ่มนับครั้งแรก
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[34rem]">
            <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">เลขที่</th>
                <th className="px-3 py-2 font-medium">สาขา</th>
                <th className="px-3 py-2 font-medium">วันที่นับ</th>
                <th className="px-3 py-2 text-right font-medium">รายการ</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <a
                      href={`/stock-counts/${r.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.scNumber}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-sm">{r.branchName}</td>
                  <td className="px-3 py-2 text-sm text-muted-foreground">
                    {r.countDateLabel}
                  </td>
                  <td className="px-3 py-2 text-right text-sm tabular-nums">
                    {r.lineCount}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

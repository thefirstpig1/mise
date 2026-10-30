// Sprint 2 Part 13 L5a — the receipt list.
//
// Server Component. Filters live in the URL rather than component state, for the
// same reasons as /purchase-orders and /stock: the view is linkable, and the L4
// `revalidatePath("/goods-receipts")` refreshes exactly what the user is looking
// at after a confirm or a void.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature type-checks
// under `pnpm tsc` and fails `next build` (see the login-page fix, a669e05).
//
// The "ต้องตรวจสอบ" chip is the whole point of `has_discrepancy` (Q3): a manager
// reviews by exception, not by opening every delivery.

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getGoodsReceiptsLogic } from "@/server/goods-receipt";
import {
  getGoodsReceiptsQuerySchema,
  GOODS_RECEIPT_STATUS_LABELS_TH,
  GOODS_RECEIPT_STATUS_VALUES,
} from "@/lib/validations/goods-receipt";
import { toGoodsReceiptListView } from "./_components/goods-receipt-view";
import StatusBadge from "./_components/StatusBadge";

import EmptyState from "@/components/ui/EmptyState";
import FilterLink from "@/components/ui/FilterLink";
import ExportButton from "@/components/ExportButton";
import { exportBranchScope } from "@/lib/validations/raw-export";
import { computeBangkokToday } from "@/lib/bangkok-date";
export default async function GoodsReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; branch?: string; flagged?: string }>;
}) {
  const { tenantId, reach} = await requireTenant("receive:write");
  const sp = await searchParams;

  const branches = await getBranchesLogic(tenantId, reach);

  // The URL is parsed, not trusted: a malformed filter falls back to the
  // unfiltered list rather than erroring the page (the Part 10 L5c rule).
  const parsed = getGoodsReceiptsQuerySchema.safeParse({
    status: sp.status,
    branchId: sp.branch,
    discrepancyOnly: sp.flagged === "1" ? true : undefined,
  });
  const query = parsed.success ? parsed.data : {};

  const receipts = (await getGoodsReceiptsLogic(tenantId, query, reach)).map(
    toGoodsReceiptListView
  );

  const linkFor = (next: { status?: string; branch?: string; flagged?: string }) => {
    const params = new URLSearchParams();
    const status = next.status ?? (parsed.success ? query.status : undefined);
    const branch = next.branch ?? (parsed.success ? query.branchId : undefined);
    const flagged =
      next.flagged ?? (query.discrepancyOnly ? "1" : undefined);
    if (status) params.set("status", status);
    if (branch) params.set("branch", branch);
    if (flagged) params.set("flagged", flagged);
    const qs = params.toString();
    return qs ? `/goods-receipts?${qs}` : "/goods-receipts";
  };

  const exportBranch = exportBranchScope(branches, query.branchId);

  const chip = (active: boolean) =>
    `seg-item ${active ? "is-on" : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">ใบรับสินค้า</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ร่างยังไม่เข้าคลัง — กดยืนยันรับของแล้วสต๊อกจะเพิ่มทันที และแก้ไม่ได้อีก
          </p>
        </div>
        <a
          href="/goods-receipts/new"
          className="btn"
        >
          รับสินค้า
        </a>
      </div>

      {!parsed.success && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          ตัวกรองใน URL ไม่ถูกต้อง — แสดงรายการทั้งหมดแทน
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="seg">
        <FilterLink href={linkFor({ status: "", flagged: "" })} className={chip(!query.status && !query.discrepancyOnly)}>
          ทั้งหมด
        </FilterLink>
        {GOODS_RECEIPT_STATUS_VALUES.map((s) => (
          <FilterLink key={s} href={linkFor({ status: s })} className={chip(query.status === s)}>
            {GOODS_RECEIPT_STATUS_LABELS_TH[s]}
          </FilterLink>
        ))}
        <FilterLink
          href={linkFor({ flagged: query.discrepancyOnly ? "" : "1" })}
          className={chip(Boolean(query.discrepancyOnly))}
        >
          ต้องตรวจสอบ
        </FilterLink>
      </div>
        <ExportButton
          dataset="goods-receipts"
          params={{ branch: query.branchId, status: query.status, flagged: query.discrepancyOnly ? "1" : undefined }}
          scope={[
            exportBranch.line,
            ...(query.status ? [`สถานะ: ${GOODS_RECEIPT_STATUS_LABELS_TH[query.status]}`] : []),
            ...(query.discrepancyOnly ? ["เฉพาะใบที่ต้องตรวจสอบ"] : []),
          ]}
          branchName={exportBranch.name}
          today={computeBangkokToday().toISOString().slice(0, 10)}
        />
      </div>

      {branches.length > 1 && (
        <div className="seg">
          <FilterLink href={linkFor({ branch: "" })} className={chip(!query.branchId)}>
            ทุกสาขา
          </FilterLink>
          {branches.map((b) => (
            <FilterLink
              key={b.id}
              href={linkFor({ branch: b.id })}
              className={chip(query.branchId === b.id)}
            >
              {b.name}
            </FilterLink>
          ))}
        </div>
      )}

      {receipts.length === 0 ? (
        <EmptyState art="none">
          ยังไม่มีใบรับสินค้าตามเงื่อนไขนี้
        </EmptyState>
      ) : (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>ผู้ขาย</th>
                <th>ใบสั่งซื้อ</th>
                <th>สาขา</th>
                <th className="text-right">รายการ</th>
                <th>รับเมื่อ</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((gr) => (
                // Kong (2026-09-28): the whole row opens the receipt. A stretched
                // link (its ::after covers the row) keeps the PO number its own link.
                <tr
                  key={gr.id}
                  className="group relative transition-colors hover:bg-surface-sunk"
                >
                  <td>
                    <a
                      href={`/goods-receipts/${gr.id}`}
                      className="whitespace-nowrap font-semibold text-foreground after:absolute after:inset-0 after:content-['']"
                    >
                      {gr.grNumber}
                    </a>
                    {gr.invoiceNo && (
                      <div className="text-xs text-muted-foreground">
                        ใบส่งของ {gr.invoiceNo}
                      </div>
                    )}
                  </td>
                  <td>
                    {gr.supplierName}
                    {gr.supplierDeleted && (
                      <span className="ml-1 text-xs text-warn">(ถูกลบแล้ว)</span>
                    )}
                  </td>
                  <td className="text-muted-foreground">
                    {gr.poNumber ? (
                      <a
                        href={`/purchase-orders/${gr.purchaseOrderId}`}
                        className="relative z-10 hover:underline"
                      >
                        {gr.poNumber}
                      </a>
                    ) : (
                      <span title="รับของโดยไม่มีใบสั่งซื้อ">ซื้อสด</span>
                    )}
                  </td>
                  <td className="text-muted-foreground">{gr.branchName}</td>
                  <td className="text-right tabular-nums">{gr.lineCount}</td>
                  <td className="text-muted-foreground">
                    {gr.receivedAtLabel}
                  </td>
                  <td className="space-x-1 px-3 py-2">
                    <StatusBadge status={gr.status} />
                    {gr.hasDiscrepancy && (
                      <span className="chip chip-warn">
                        ต้องตรวจสอบ
                      </span>
                    )}
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

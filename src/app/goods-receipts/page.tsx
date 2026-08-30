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

  const receipts = (await getGoodsReceiptsLogic(tenantId, query)).map(
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

  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm ${
      active
        ? "border-primary bg-primary/10 font-medium text-primary"
        : "border-border text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">ใบรับสินค้า</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ร่างยังไม่เข้าคลัง — กดยืนยันรับของแล้วสต๊อกจะเพิ่มทันที และแก้ไม่ได้อีก
          </p>
        </div>
        <a
          href="/goods-receipts/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          รับสินค้า
        </a>
      </div>

      {!parsed.success && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          ตัวกรองใน URL ไม่ถูกต้อง — แสดงรายการทั้งหมดแทน
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        <a href={linkFor({ status: "", flagged: "" })} className={chip(!query.status && !query.discrepancyOnly)}>
          ทั้งหมด
        </a>
        {GOODS_RECEIPT_STATUS_VALUES.map((s) => (
          <a key={s} href={linkFor({ status: s })} className={chip(query.status === s)}>
            {GOODS_RECEIPT_STATUS_LABELS_TH[s]}
          </a>
        ))}
        <a
          href={linkFor({ flagged: query.discrepancyOnly ? "" : "1" })}
          className={chip(Boolean(query.discrepancyOnly))}
        >
          ต้องตรวจสอบ
        </a>
      </div>

      {branches.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <a href={linkFor({ branch: "" })} className={chip(!query.branchId)}>
            ทุกสาขา
          </a>
          {branches.map((b) => (
            <a
              key={b.id}
              href={linkFor({ branch: b.id })}
              className={chip(query.branchId === b.id)}
            >
              {b.name}
            </a>
          ))}
        </div>
      )}

      {receipts.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          ยังไม่มีใบรับสินค้าตามเงื่อนไขนี้
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">เลขที่</th>
                <th className="px-3 py-2 font-medium">ผู้ขาย</th>
                <th className="px-3 py-2 font-medium">ใบสั่งซื้อ</th>
                <th className="px-3 py-2 font-medium">สาขา</th>
                <th className="px-3 py-2 text-right font-medium">รายการ</th>
                <th className="px-3 py-2 font-medium">รับเมื่อ</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((gr) => (
                <tr key={gr.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <a
                      href={`/goods-receipts/${gr.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {gr.grNumber}
                    </a>
                    {gr.invoiceNo && (
                      <div className="text-xs text-muted-foreground">
                        ใบส่งของ {gr.invoiceNo}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {gr.supplierName}
                    {gr.supplierDeleted && (
                      <span className="ml-1 text-xs text-amber-700">(ถูกลบแล้ว)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {gr.poNumber ? (
                      <a
                        href={`/purchase-orders/${gr.purchaseOrderId}`}
                        className="hover:underline"
                      >
                        {gr.poNumber}
                      </a>
                    ) : (
                      <span title="รับของโดยไม่มีใบสั่งซื้อ">ซื้อสด</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{gr.branchName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gr.lineCount}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {gr.receivedAtLabel}
                  </td>
                  <td className="space-x-1 px-3 py-2">
                    <StatusBadge status={gr.status} />
                    {gr.hasDiscrepancy && (
                      <span className="inline-block whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
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

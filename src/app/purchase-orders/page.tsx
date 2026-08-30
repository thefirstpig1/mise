// Sprint 2 Part 11 L5a — the order list.
//
// Server Component. Filters live in the URL (`?status=`, `?branch=`) rather than
// component state, for the same reasons as /stock: the view is linkable, and the
// L4 `revalidatePath("/purchase-orders")` refreshes exactly what the user is
// looking at after a send or a cancel.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature type-checks
// under `pnpm tsc` and fails `next build` (see the login-page fix, a669e05).
//
// Money and dates arrive pre-rendered from the serializer; nothing here parses a
// Decimal string back into a number.

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getPurchaseOrdersLogic } from "@/server/purchase-order";
import {
  getPurchaseOrdersQuerySchema,
  PURCHASE_ORDER_STATUS_LABELS_TH,
  PURCHASE_ORDER_STATUS_VALUES,
} from "@/lib/validations/purchase-order";
import { toPurchaseOrderListView } from "./_components/purchase-order-view";
import StatusBadge from "./_components/StatusBadge";

const THB = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a Decimal STRING for display without ever making it a JS number. */
function formatMoney(value: string): string {
  const [whole, frac = ""] = value.split(".");
  const grouped = THB.format(Number(whole || "0")).split(".")[0];
  return `${grouped}.${(frac + "00").slice(0, 2)}`;
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; branch?: string }>;
}) {
  const { tenantId, reach} = await requireTenant("purchase:write");
  const sp = await searchParams;

  const branches = await getBranchesLogic(tenantId, reach);

  // The URL is parsed, not trusted: a malformed filter falls back to the
  // unfiltered list rather than erroring the page (the Part 10 L5c rule).
  const parsed = getPurchaseOrdersQuerySchema.safeParse({
    status: sp.status,
    branchId: sp.branch,
  });
  const query = parsed.success ? parsed.data : {};

  const orders = (await getPurchaseOrdersLogic(tenantId, query)).map(
    toPurchaseOrderListView
  );

  const linkFor = (next: { status?: string; branch?: string }) => {
    const params = new URLSearchParams();
    const status = next.status ?? (parsed.success ? query.status : undefined);
    const branch = next.branch ?? (parsed.success ? query.branchId : undefined);
    if (status) params.set("status", status);
    if (branch) params.set("branch", branch);
    const qs = params.toString();
    return qs ? `/purchase-orders?${qs}` : "/purchase-orders";
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
          <h2 className="text-xl font-bold">ใบสั่งซื้อ</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ร่างแก้ไขได้ — เมื่อส่งแล้วจะล็อกทันที หากต้องแก้ให้ยกเลิกแล้วออกใบใหม่
          </p>
        </div>
        <a
          href="/purchase-orders/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          สร้างใบสั่งซื้อ
        </a>
      </div>

      {!parsed.success && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          ตัวกรองใน URL ไม่ถูกต้อง — แสดงรายการทั้งหมดแทน
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        <a href={linkFor({ status: "" })} className={chip(!query.status)}>
          ทุกสถานะ
        </a>
        {PURCHASE_ORDER_STATUS_VALUES.map((s) => (
          <a key={s} href={linkFor({ status: s })} className={chip(query.status === s)}>
            {PURCHASE_ORDER_STATUS_LABELS_TH[s]}
          </a>
        ))}
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

      {orders.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          ยังไม่มีใบสั่งซื้อตามเงื่อนไขนี้
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">เลขที่</th>
                <th className="px-3 py-2 font-medium">ผู้ขาย</th>
                <th className="px-3 py-2 font-medium">สาขา</th>
                <th className="px-3 py-2 text-right font-medium">รายการ</th>
                <th className="px-3 py-2 text-right font-medium">ยอดรวม</th>
                <th className="px-3 py-2 font-medium">กำหนดรับ</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <a
                      href={`/purchase-orders/${po.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {po.poNumber}
                    </a>
                    <div className="text-xs text-muted-foreground">
                      สร้าง {po.createdAtLabel}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {po.supplierName}
                    {po.supplierDeleted && (
                      <span className="ml-1 text-xs text-amber-700">(ถูกลบแล้ว)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{po.branchName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{po.lineCount}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(po.totalAmount)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {po.expectedDeliveryLabel}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={po.status} />
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

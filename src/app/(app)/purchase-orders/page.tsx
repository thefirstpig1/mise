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

import EmptyState from "@/components/ui/EmptyState";
import FilterLink from "@/components/ui/FilterLink";
import PageHeader from "@/components/ui/PageHeader";
import Stat, { StatGrid } from "@/components/ui/Stat";
import { computeBangkokToday } from "@/lib/bangkok-date";
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

  // Fetched for the BRANCH only: the number cards count every status, and the
  // status filter narrows the table in memory (one read instead of two).
  const all = (await getPurchaseOrdersLogic(tenantId, { branchId: query.branchId }, reach)).map(toPurchaseOrderListView);
  const orders = query.status ? all.filter((o) => o.status === query.status) : all;

  const today = computeBangkokToday().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const sum = (xs: typeof all) => xs.reduce((t, o) => t + Number(o.totalAmount), 0);
  const drafts = all.filter((o) => o.status === "DRAFT");
  const waiting = all.filter((o) => o.status === "SENT" || o.status === "PARTIALLY_RECEIVED");
  const overdue = waiting.filter((o) => o.expectedDeliveryIso !== null && o.expectedDeliveryIso < today);
  const thisMonth = all.filter((o) => o.status !== "DRAFT" && o.status !== "CANCELLED" && o.createdAtIso >= monthStart);
  const daysLate = (iso: string) => Math.round((Date.parse(today) - Date.parse(iso)) / 86_400_000);
  const baht = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;

  const linkFor = (next: { status?: string; branch?: string }) => {
    const params = new URLSearchParams();
    const status = next.status ?? (parsed.success ? query.status : undefined);
    const branch = next.branch ?? (parsed.success ? query.branchId : undefined);
    if (status) params.set("status", status);
    if (branch) params.set("branch", branch);
    const qs = params.toString();
    return qs ? `/purchase-orders?${qs}` : "/purchase-orders";
  };

  const seg = (active: boolean) => `seg-item ${active ? "is-on" : ""}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="ใบสั่งซื้อ"
        description="ร่างแก้ไขได้ · ส่งแล้วล็อกทันที ถ้าต้องแก้ให้ยกเลิกแล้วออกใบใหม่"
        actions={
          <a href="/purchase-orders/new" className="btn">
            + สร้างใบสั่งซื้อ
          </a>
        }
      />

      {!parsed.success && (
        <div className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          ตัวกรองใน URL ไม่ถูกต้อง — แสดงรายการทั้งหมดแทน
        </div>
      )}

      <StatGrid>
        <Stat label="ร่าง ยังไม่ส่ง" value={`${drafts.length} ใบ`} sub={drafts.length ? baht(sum(drafts)) : "ไม่มีใบค้าง"} href={linkFor({ status: "DRAFT" })} />
        <Stat label="รอรับของ" value={`${waiting.length} ใบ`} sub={waiting.length ? baht(sum(waiting)) : "ไม่มีของค้างส่ง"} href={linkFor({ status: "SENT" })} />
        <Stat
          label="เลยกำหนดรับ"
          value={`${overdue.length} ใบ`}
          tone={overdue.length ? "bad" : undefined}
          sub={
            overdue.length === 0
              ? "ทุกใบยังไม่ถึงกำหนด"
              : overdue.length === 1
                ? `${overdue[0].poNumber} · ${overdue[0].supplierName}`
                : `เก่าสุดเลยมา ${Math.max(...overdue.map((o) => daysLate(o.expectedDeliveryIso!)))} วัน`
          }
        />
        <Stat
          label="สั่งซื้อเดือนนี้"
          value={thisMonth.length ? baht(sum(thisMonth)) : "—"}
          sub={thisMonth.length ? `${thisMonth.length} ใบ · ไม่นับร่างและที่ยกเลิก` : "ยังไม่มีใบที่ส่งในเดือนนี้"}
        />
      </StatGrid>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="seg">
          <FilterLink href={linkFor({ status: "" })} className={seg(!query.status)}>
            ทุกสถานะ
          </FilterLink>
          {PURCHASE_ORDER_STATUS_VALUES.map((s) => (
            <FilterLink key={s} href={linkFor({ status: s })} className={seg(query.status === s)}>
              {PURCHASE_ORDER_STATUS_LABELS_TH[s]}
            </FilterLink>
          ))}
        </div>
        {branches.length > 1 && (
          <div className="seg">
            <FilterLink href={linkFor({ branch: "" })} className={seg(!query.branchId)}>
              ทุกสาขา
            </FilterLink>
            {branches.map((b) => (
              <FilterLink key={b.id} href={linkFor({ branch: b.id })} className={seg(query.branchId === b.id)}>
                {b.name}
              </FilterLink>
            ))}
          </div>
        )}
      </div>

      {orders.length === 0 ? (
        <EmptyState art="none">
          ยังไม่มีใบสั่งซื้อตามเงื่อนไขนี้
        </EmptyState>
      ) : (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>เลขที่</th>
                <th className="hidden sm:table-cell">ผู้ขาย</th>
                {branches.length > 1 && <th className="hidden md:table-cell">สาขา</th>}
                <th className="hidden text-right md:table-cell">รายการ</th>
                <th className="text-right">ยอดรวม</th>
                <th className="hidden sm:table-cell">กำหนดรับ</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => {
                const late = (po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") && po.expectedDeliveryIso !== null && po.expectedDeliveryIso < today;
                return (
                // Kong (2026-09-28): the whole row opens the order — its ::after
                // stretches the number's link across the row.
                <tr key={po.id} className="group relative transition-colors hover:bg-surface-sunk">
                  <td>
                    <a
                      href={`/purchase-orders/${po.id}`}
                      className="whitespace-nowrap font-semibold text-foreground after:absolute after:inset-0 after:content-['']"
                    >
                      {po.poNumber}
                    </a>
                    <div className="text-xs text-muted-foreground">สร้าง {po.createdAtLabel}</div>
                    {/* On a phone the supplier and lateness ride under the number. */}
                    <div className="text-xs text-muted-foreground sm:hidden">{po.supplierName}</div>
                    {late && <span className="chip chip-bad mt-1 sm:hidden">เลยกำหนด {daysLate(po.expectedDeliveryIso!)} วัน</span>}
                  </td>
                  <td className="hidden sm:table-cell">
                    {po.supplierName}
                    {po.supplierDeleted && <span className="ml-1 text-xs text-warn">(ถูกลบแล้ว)</span>}
                  </td>
                  {branches.length > 1 && <td className="hidden text-muted-foreground md:table-cell">{po.branchName}</td>}
                  <td className="hidden text-right tabular-nums md:table-cell">{po.lineCount}</td>
                  <td className="text-right font-medium tabular-nums">{formatMoney(po.totalAmount)}</td>
                  <td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                    {po.expectedDeliveryLabel}
                    {late && <span className="chip chip-bad ml-1.5">เลย {daysLate(po.expectedDeliveryIso!)} วัน</span>}
                  </td>
                  <td>
                    <StatusBadge status={po.status} />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

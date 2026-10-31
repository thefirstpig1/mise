// Sprint 2 Part 11 L5c — the order itself: the document, and what can be done to it.
//
// This page IS the thing that gets sent (Q7). There is no PDF and no email — a
// Thai SME sends orders over LINE, so the requirement is a page that screenshots
// and prints cleanly. Everything that is not the document (nav, buttons) carries
// `print:hidden`, and the layout header does too.
//
// `params` is a PROMISE in Next 15 (a669e05).
//
// Every number on this page is rendered from a Decimal STRING. The quantities and
// the unit ratio shown are the LINE'S OWN frozen values (ADR 0012 Q3), not the
// product's current ones — that is the whole point of the snapshot, and the page
// says so where it could surprise someone.
//
// Document-page review (Kong 2026-10-27, mockup 58mU74dLaAMwH6nF3AC6zw): one
// header shape shared with receipts and transfers (`DocHeader`), the next step
// in it, the documents this order led to as chips, an overdue delivery said in
// days, ordered / received / outstanding in the order's own table, the unit
// details folded, and cancelling at the bottom.
//
// Kong 2026-10-30: the order a supplier receives names each item the way THAT
// supplier does ("หมูบดอนามัย", remembered from imported bills), with a switch
// back to the shop's own names for checking it in-house (`?names=shop`). A
// label only — every quantity and price is the line's own frozen value.

import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getDeliveryPromisesLogic, getPurchaseOrderByIdLogic } from "@/server/purchase-order";
import { getGoodsReceiptsForPurchaseOrderLogic } from "@/server/goods-receipt";
import { getExpenseByGoodsReceiptLogic } from "@/server/expense";
import { getSupplierItemNamesLogic } from "@/server/supplier-product-mapping";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { DocHeader, HeaderChip, RelatedDocs, type RelatedDoc } from "@/components/ui/DocHeader";
import {
  cancelPurchaseOrderAction,
  deletePurchaseOrderDraftAction,
  sendPurchaseOrderAction,
} from "../actions";
import { closePurchaseOrderShortAction } from "@/app/(app)/goods-receipts/actions";
import { toGoodsReceiptListView } from "@/app/(app)/goods-receipts/_components/goods-receipt-view";
import CloseShortForm from "@/app/(app)/goods-receipts/_components/CloseShortForm";
import GrStatusBadge from "@/app/(app)/goods-receipts/_components/StatusBadge";
import { toPurchaseOrderDetailView } from "../_components/purchase-order-view";
import PurchaseOrderActions from "../_components/PurchaseOrderActions";
import StatusBadge from "../_components/StatusBadge";
import DeliveryPromise from "../_components/DeliveryPromise";

const THB = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a Decimal STRING without ever making it a JS number. */
function money(value: string): string {
  const [whole, frac = ""] = value.split(".");
  const grouped = THB.format(Number(whole || "0")).split(".")[0];
  return `${grouped}.${(frac + "00").slice(0, 2)}`;
}

/** Quantities print without trailing zeros — "4" reads better than "4.000". */
function qty(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ names?: string }>;
}) {
  const { tenantId, membership, can, assertBranch, reach } = await requireTenant("purchase:write");
  const { id } = await params;
  const shopNames = (await searchParams).names === "shop";

  const order = await getPurchaseOrderByIdLogic(tenantId, id);
  if (!order) notFound();
  // Rule A5: reachable by URL, so the document's branch is checked here too.
  assertBranch(order.branchId);

  const po = toPurchaseOrderDetailView(order);
  const tenant = membership.tenant;

  // Part 13: the receiving side of the order. VOIDED receipts are shown too —
  // "this arrived and was then reversed" is part of the order's story, and
  // hiding it would make qty_received look unexplained.
  const [receiptRows, promises, supplierNames] = await Promise.all([
    getGoodsReceiptsForPurchaseOrderLogic(tenantId, po.id, reach),
    getDeliveryPromisesLogic(tenantId, po.id),
    getSupplierItemNamesLogic(tenantId, order.supplierId, [...new Set(po.lines.map((l) => l.productId))], order.branchId, order.sentAt ?? order.createdAt),
  ]);
  const namedBySupplier = po.lines.filter((l) => supplierNames.has(l.productId)).length;
  const useSupplierNames = namedBySupplier > 0 && !shopNames;
  const receipts = receiptRows.map(toGoodsReceiptListView);
  // The bill each confirmed receipt wrote (ADR 0016 Q7) — the link the page
  // never had: an order did not say what it ended up costing on the books.
  const bills = await Promise.all(
    receiptRows.map((r) => getExpenseByGoodsReceiptLogic(tenantId, r.id))
  );
  const canReceive =
    po.status === "SENT" ||
    po.status === "PARTIALLY_RECEIVED" ||
    po.status === "RECEIVED";
  const anyOutstanding = po.lines.some(
    (l) => Number(l.qtyReceived) < Number(l.qtyOrdered)
  );
  const waiting = po.status === "SENT" || po.status === "PARTIALLY_RECEIVED";
  const today = computeBangkokToday().toISOString().slice(0, 10);
  const due = po.expectedDeliveryDate?.slice(0, 10) ?? null;
  const daysLate =
    waiting && due && due < today
      ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000)
      : 0;

  const related: RelatedDoc[] = [
    ...(receipts.length === 0
      ? po.status === "DRAFT" || po.status === "CANCELLED"
        ? []
        : [{ label: "ใบรับของ", note: "ยังไม่มี" }]
      : receipts.map((r) => ({
          label: `ใบรับของ ${r.grNumber}`,
          href: `/goods-receipts/${r.id}`,
          note: r.status === "VOIDED" ? "ยกเลิกแล้ว" : r.receivedAtLabel,
        }))),
    ...bills.flatMap((b) =>
      b ? [{ label: "บิลค่าใช้จ่าย", href: `/expenses/${b.id}`, note: b.paymentStatus === "PAID" ? "จ่ายแล้ว" : "ยังไม่จ่าย" }] : []
    ),
    ...(receipts.length === 0 && waiting ? [{ label: "บิลค่าใช้จ่าย", note: "สร้างให้เองเมื่อยืนยันใบรับของ" }] : []),
  ];

  return (
    <div className="space-y-6">
      <DocHeader
        trail={{ href: "/purchase-orders", label: "ใบสั่งซื้อ" }}
        number={po.poNumber}
        badges={
          <>
            <StatusBadge status={po.status} />
            {daysLate > 0 && <HeaderChip tone="warn">เลยนัดส่ง {daysLate} วัน</HeaderChip>}
          </>
        }
        meta={`${po.supplier.nameFull} · ${po.branch.name} · ${po.sentAtLabel ? `ส่ง ${po.sentAtLabel}` : `สร้าง ${po.createdAtLabel}`} โดย ${po.createdByName}`}
        actions={
          <>
            <PurchaseOrderActions
              part="head"
              id={po.id}
              poNumber={po.poNumber}
              supplierName={po.supplier.nameFull}
              status={po.status}
              onSend={sendPurchaseOrderAction}
              onCancel={cancelPurchaseOrderAction}
              onDiscard={deletePurchaseOrderDraftAction}
            />
            {canReceive && anyOutstanding && (
              <a href={`/goods-receipts/new?po=${po.id}`} className="btn">
                รับของ
              </a>
            )}
          </>
        }
      />
      <RelatedDocs items={related} />

      {po.status === "DRAFT" && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground print:hidden">
          ยังเป็นร่าง — ยังไม่ได้ส่งให้ผู้ขาย
        </div>
      )}
      {/* ADR 0036 Q8 — what the supplier promised, set after the order is out. */}
      <DeliveryPromise
        purchaseOrderId={po.id}
        promises={promises}
        canSet={can("purchase:approve")}
        open={po.status === "SENT" || po.status === "PARTIALLY_RECEIVED"}
      />
      {daysLate > 0 && (
        <p className="-mt-3 text-sm font-medium text-warn print:hidden">
          เลยวันนัดมา {daysLate} วัน ยังไม่ได้รับของครบ — ถ้าผู้ขายเลื่อน บันทึกวันนัดใหม่ด้านบน
        </p>
      )}

      {po.status === "CANCELLED" && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          ใบสั่งซื้อนี้ถูกยกเลิกเมื่อ {po.cancelledAtLabel}
          {po.cancelReason ? ` — ${po.cancelReason}` : ""}
        </div>
      )}

      {namedBySupplier > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
          <span className="text-muted-foreground">ชื่อรายการในใบสั่งซื้อ</span>
          <div className="seg" role="group" aria-label="ชื่อรายการในใบสั่งซื้อ">
            <Link href={`/purchase-orders/${po.id}` as Route} replace scroll={false} className={`seg-item ${useSupplierNames ? "is-on" : ""}`}>
              ชื่อที่ผู้ขายใช้
            </Link>
            <Link href={`/purchase-orders/${po.id}?names=shop` as Route} replace scroll={false} className={`seg-item ${useSupplierNames ? "" : "is-on"}`}>
              ชื่อในร้าน
            </Link>
          </div>
          <span className="text-[13px] text-muted-subtle">
            ผู้ขายรายนี้มีชื่อเรียก {namedBySupplier} จาก {po.lines.length} รายการ (จำจากบิลที่นำเข้า) · รายการที่เหลือใช้ชื่อในร้าน
          </span>
        </div>
      )}

      {/* ---------- the document ---------- */}
      <article className="rounded-lg border border-border bg-surface p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-bold">ใบสั่งซื้อ / Purchase Order</h2>
            <p className="mt-1 text-2xl font-bold tabular-nums">{po.poNumber}</p>
            <div className="mt-2 print:hidden">
              <StatusBadge status={po.status} />
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{tenant.name}</p>
            {tenant.taxId && (
              <p className="text-muted-foreground">เลขผู้เสียภาษี {tenant.taxId}</p>
            )}
            <p className="text-muted-foreground">สาขา {po.branch.name}</p>
          </div>
        </header>

        <div className="grid gap-4 py-4 sm:grid-cols-2">
          <div className="text-sm">
            <p className="text-xs text-muted-foreground">ผู้ขาย</p>
            <p className="font-medium">
              {po.supplier.nameFull}
              {po.supplier.deleted && (
                <span className="ml-1 text-xs text-warn">(ถูกลบแล้ว)</span>
              )}
            </p>
            {po.supplier.address && (
              <p className="text-muted-foreground">{po.supplier.address}</p>
            )}
            {po.supplier.contactPhone && (
              <p className="text-muted-foreground">โทร {po.supplier.contactPhone}</p>
            )}
            {po.supplier.contactEmail && (
              <p className="text-muted-foreground">{po.supplier.contactEmail}</p>
            )}
          </div>
          <div className="text-sm sm:text-right">
            <p>
              <span className="text-muted-foreground">วันที่สั่ง: </span>
              {po.sentAtLabel ?? po.createdAtLabel}
            </p>
            <p>
              <span className="text-muted-foreground">กำหนดรับ: </span>
              {po.expectedDeliveryLabel}
            </p>
            <p>
              <span className="text-muted-foreground">ผู้สั่ง: </span>
              {po.createdByName}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">รายการ</th>
                <th className="py-2 pr-2 text-right font-medium">จำนวน</th>
                {canReceive && (
                  <>
                    <th className="py-2 pr-2 text-right font-medium print:hidden">รับแล้ว</th>
                    <th className="py-2 pr-2 text-right font-medium print:hidden">ค้างรับ</th>
                  </>
                )}
                <th className="py-2 pr-2 font-medium">หน่วย</th>
                <th className="py-2 pr-2 text-right font-medium">
                  ราคา/หน่วย{po.pricesIncludeVat ? " (รวม VAT)" : ""}
                </th>
                <th className="py-2 text-right font-medium">รวม{po.pricesIncludeVat ? " (รวม VAT)" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-b border-border align-top">
                  <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                    {l.lineNo}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{(useSupplierNames && supplierNames.get(l.productId)) || l.productName}</div>
                    <div className="text-xs text-muted-foreground">
                      {/* The order is screenshotted into LINE — in the supplier's names it carries none of ours. */}
                      {useSupplierNames && supplierNames.has(l.productId) ? null : l.productSku}
                      {l.productDeleted && (
                        <span className="ml-1 text-warn">(ถูกลบแล้ว)</span>
                      )}
                    </div>
                    {l.notes && (
                      <div className="mt-1 text-xs text-muted-foreground">{l.notes}</div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {qty(l.qtyOrdered)}
                  </td>
                  {canReceive && (() => {
                    const outstanding = Number(l.qtyOrdered) - Number(l.qtyReceived);
                    return (
                      <>
                        <td className="py-2 pr-2 text-right tabular-nums print:hidden">{qty(l.qtyReceived)}</td>
                        <td
                          className={`py-2 pr-2 text-right tabular-nums print:hidden ${
                            outstanding !== 0 ? "font-semibold text-warn" : "text-muted-foreground"
                          }`}
                        >
                          {outstanding === 0 ? "—" : outstanding.toLocaleString("th-TH")}
                        </td>
                      </>
                    );
                  })()}
                  <td className="py-2 pr-2">{l.orderUnitName}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {/* Rule PR3 — printed in the supplier's own terms, so it matches their bill. */}
                    {money(l.unitPriceQuoted ?? l.unitPrice)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(l.lineTotalQuoted ?? l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">ยอดก่อน VAT</dt>
              <dd className="tabular-nums">{money(po.subtotalExclVat)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                VAT {po.vatRatePercent ? `${po.vatRatePercent}%` : "(ไม่มี)"}
              </dt>
              <dd className="tabular-nums">{money(po.vatAmount)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1 text-base font-bold">
              <dt>ยอดรวมทั้งสิ้น</dt>
              <dd className="tabular-nums">{money(po.totalAmount)}</dd>
            </div>
            {po.pricesIncludeVat && (
              <p className="pt-1 text-xs text-muted-foreground">ราคาในใบนี้รวม VAT แล้ว · VAT คำนวณจากยอดรวม</p>
            )}
          </dl>
        </div>

        {po.notes && (
          <div className="mt-4 border-t border-border pt-3 text-sm">
            <p className="text-xs text-muted-foreground">หมายเหตุ</p>
            <p className="whitespace-pre-wrap">{po.notes}</p>
          </div>
        )}
      </article>

      {/* Q8: only a partially-received order can be declared finished. */}
      {po.status === "PARTIALLY_RECEIVED" && anyOutstanding && (
        <section className="rounded-xl border border-border p-4 print:hidden">
          <CloseShortForm purchaseOrderId={po.id} onClose={closePurchaseOrderShortAction} />
        </section>
      )}
      {receipts.some((r) => r.hasDiscrepancy) && (
        <p className="flex flex-wrap items-center gap-2 text-sm print:hidden">
          {receipts
            .filter((r) => r.hasDiscrepancy)
            .map((r) => (
              <a key={r.id} href={`/goods-receipts/${r.id}`} className="inline-flex items-center gap-2 text-primary hover:underline">
                {r.grNumber} <GrStatusBadge status={r.status} />
                <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-xs text-warn">ต้องตรวจสอบ</span>
              </a>
            ))}
        </p>
      )}

      {/* ---------- what only we need to know, in the shop's words, folded ---------- */}
      <details className="group rounded-[18px] border border-border/70 bg-surface shadow-card print:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
          รายละเอียดการแปลงหน่วยและแผนก
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">กดเพื่อดู</span>
          <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">ย่อ</span>
        </summary>
        <div className="space-y-1.5 px-4 pb-4 text-sm">
          <p className="text-xs text-muted-foreground">
            ราคาและหน่วยในใบนี้ล็อกไว้ตอนบันทึก ถ้าแก้หน่วยหรือราคาของวัตถุดิบภายหลัง ใบนี้ไม่เปลี่ยนตาม
          </p>
          <ul className="space-y-1">
            {po.lines.map((l) => (
              <li key={l.id}>
                {l.productName} — 1 {l.orderUnitName} = {qty(l.toBaseRatio)} {l.baseUnitName ?? "หน่วยหลัก"}
                {l.allocations.length > 0 &&
                  ` · ${l.allocations.map((a) => `แผนก${a.departmentName} ${qty(a.qtyAllocated)}`).join(", ")}`}
                {l.supplierProductMappingId ? "" : " · ราคาที่กรอกเอง"}
              </li>
            ))}
          </ul>
        </div>
      </details>

      <PurchaseOrderActions
        part="foot"
        id={po.id}
        poNumber={po.poNumber}
        supplierName={po.supplier.nameFull}
        status={po.status}
        onSend={sendPurchaseOrderAction}
        onCancel={cancelPurchaseOrderAction}
        onDiscard={deletePurchaseOrderDraftAction}
      />
    </div>
  );
}

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

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getPurchaseOrderByIdLogic } from "@/server/purchase-order";
import { getGoodsReceiptsForPurchaseOrderLogic } from "@/server/goods-receipt";
import {
  cancelPurchaseOrderAction,
  deletePurchaseOrderDraftAction,
  sendPurchaseOrderAction,
} from "../actions";
import { closePurchaseOrderShortAction } from "@/app/goods-receipts/actions";
import { toGoodsReceiptListView } from "@/app/goods-receipts/_components/goods-receipt-view";
import CloseShortForm from "@/app/goods-receipts/_components/CloseShortForm";
import GrStatusBadge from "@/app/goods-receipts/_components/StatusBadge";
import { toPurchaseOrderDetailView } from "../_components/purchase-order-view";
import PurchaseOrderActions from "../_components/PurchaseOrderActions";
import StatusBadge from "../_components/StatusBadge";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, membership } = await requireTenant("purchase:write");
  const { id } = await params;

  const order = await getPurchaseOrderByIdLogic(tenantId, id);
  if (!order) notFound();

  const po = toPurchaseOrderDetailView(order);
  const tenant = membership.tenant;

  // Part 13: the receiving side of the order. VOIDED receipts are shown too —
  // "this arrived and was then reversed" is part of the order's story, and
  // hiding it would make qty_received look unexplained.
  const receipts = (await getGoodsReceiptsForPurchaseOrderLogic(tenantId, po.id)).map(
    toGoodsReceiptListView
  );
  const canReceive =
    po.status === "SENT" ||
    po.status === "PARTIALLY_RECEIVED" ||
    po.status === "RECEIVED";
  const anyOutstanding = po.lines.some(
    (l) => Number(l.qtyReceived) < Number(l.qtyOrdered)
  );

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <a
          href="/purchase-orders"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับรายการใบสั่งซื้อ
        </a>
      </div>

      <PurchaseOrderActions
        id={po.id}
        poNumber={po.poNumber}
        status={po.status}
        onSend={sendPurchaseOrderAction}
        onCancel={cancelPurchaseOrderAction}
        onDiscard={deletePurchaseOrderDraftAction}
      />

      {po.status === "DRAFT" && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground print:hidden">
          ยังเป็นร่าง — ยังไม่ได้ส่งให้ผู้ขาย
        </div>
      )}
      {po.status === "CANCELLED" && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          ใบสั่งซื้อนี้ถูกยกเลิกเมื่อ {po.cancelledAtLabel}
          {po.cancelReason ? ` — ${po.cancelReason}` : ""}
        </div>
      )}

      {/* ---------- the document ---------- */}
      <article className="rounded-lg border border-border bg-card p-6 print:border-0 print:p-0">
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
                <th className="py-2 pr-2 font-medium">หน่วย</th>
                <th className="py-2 pr-2 text-right font-medium">ราคา/หน่วย</th>
                <th className="py-2 text-right font-medium">รวม</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-b border-border align-top">
                  <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                    {l.lineNo}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{l.productName}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.productSku}
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
                  <td className="py-2 pr-2">{l.orderUnitName}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {money(l.unitPrice)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(l.lineTotal)}</td>
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
          </dl>
        </div>

        {po.notes && (
          <div className="mt-4 border-t border-border pt-3 text-sm">
            <p className="text-xs text-muted-foreground">หมายเหตุ</p>
            <p className="whitespace-pre-wrap">{po.notes}</p>
          </div>
        )}
      </article>

      {/* ---------- receiving (Part 13) ---------- */}
      {canReceive && (
        <section className="space-y-3 rounded-lg border border-border p-4 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">การรับของ</h3>
            <a
              href={`/goods-receipts/new?po=${po.id}`}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              รับของ
            </a>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2 font-medium">#</th>
                  <th className="py-2 pr-2 font-medium">รายการ</th>
                  <th className="py-2 pr-2 text-right font-medium">สั่ง</th>
                  <th className="py-2 pr-2 text-right font-medium">รับแล้ว</th>
                  <th className="py-2 pr-2 text-right font-medium">ค้างรับ</th>
                  <th className="py-2 pr-2 font-medium">หน่วย</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => {
                  const outstanding =
                    Number(l.qtyOrdered) - Number(l.qtyReceived);
                  return (
                    <tr key={l.id} className="border-b border-border">
                      <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                        {l.lineNo}
                      </td>
                      <td className="py-2 pr-2">{l.productName}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {qty(l.qtyOrdered)}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {qty(l.qtyReceived)}
                      </td>
                      <td
                        className={`py-2 pr-2 text-right tabular-nums ${
                          outstanding > 0
                            ? "text-warn"
                            : outstanding < 0
                              ? "text-warn"
                              : "text-muted-foreground"
                        }`}
                      >
                        {outstanding === 0 ? "—" : outstanding.toLocaleString("th-TH")}
                      </td>
                      <td className="py-2 pr-2">{l.orderUnitName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {receipts.length > 0 && (
            <ul className="space-y-1 text-sm">
              {receipts.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/goods-receipts/${r.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.grNumber}
                  </a>
                  <span className="text-muted-foreground">{r.receivedAtLabel}</span>
                  <GrStatusBadge status={r.status} />
                  {r.hasDiscrepancy && (
                    <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-xs text-warn">
                      ต้องตรวจสอบ
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Q8: only a partially-received order can be declared finished. */}
          {po.status === "PARTIALLY_RECEIVED" && anyOutstanding && (
            <CloseShortForm
              purchaseOrderId={po.id}
              onClose={closePurchaseOrderShortAction}
            />
          )}
        </section>
      )}

      {/* ---------- what only we need to know ---------- */}
      <section className="rounded-lg border border-border p-4 text-xs text-muted-foreground print:hidden">
        <h3 className="mb-2 text-sm font-medium text-foreground">ข้อมูลภายใน</h3>
        <p>
          ราคาและหน่วยในใบนี้ถูก “ตรึง” ไว้ตั้งแต่ตอนบันทึก
          หากมีการแก้หน่วยหรือราคาของวัตถุดิบภายหลัง ใบนี้จะยังคงเดิม
        </p>
        <ul className="mt-2 space-y-1">
          {po.lines.map((l) => (
            <li key={l.id}>
              #{l.lineNo} {l.productName} — 1 {l.orderUnitName} = {qty(l.toBaseRatio)}{" "}
              (หน่วยหลัก) · ปันส่วน:{" "}
              {l.allocations
                .map((a) => `${a.departmentName} ${qty(a.qtyAllocated)}`)
                .join(", ")}
              {l.supplierProductMappingId ? "" : " · ราคากรอกเอง"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

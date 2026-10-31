// Sprint 2 Part 13 L5c — the receipt itself: the document, and what can be done to it.
//
// This page IS the printable record, the same call ADR 0012 Q7 made for the
// order: no PDF, no storage. Everything that is not the document carries
// `print:hidden`, and the layout header does too.
//
// `params` is a PROMISE in Next 15 (a669e05).
//
// Every number is rendered from a Decimal STRING. Quantities and the unit ratio
// are the LINE'S OWN frozen values (ADR 0012 Consequence 1) — the page says so
// where that could surprise someone.
//
// A voided receipt keeps BOTH its original lines and their reversals, side by
// side. That is not clutter: it is the only honest way to show that stock came
// in and went back out, and the ledger rows behind them are immortal.
//
// Document-page review (Kong 2026-10-27, mockup 58mU74dLaAMwH6nF3AC6zw): the
// shared header, the order / bill / supplier invoice / stock card as chips,
// "ต่างจากที่สั่ง" only when there IS an order, what entered stock as a folded
// table in the shop's words, and voiding at the bottom.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getGoodsReceiptByIdLogic } from "@/server/goods-receipt";
import { getExpenseByGoodsReceiptLogic } from "@/server/expense";
import {
  confirmGoodsReceiptAction,
  deleteGoodsReceiptDraftAction,
  voidGoodsReceiptAction,
} from "../actions";
import {
  formatMoney,
  formatQty,
  toGoodsReceiptDetailView,
} from "../_components/goods-receipt-view";
import GoodsReceiptActions from "../_components/GoodsReceiptActions";
import StatusBadge from "../_components/StatusBadge";
import { DocHeader, HeaderChip, RelatedDocs, type RelatedDoc } from "@/components/ui/DocHeader";

export default async function GoodsReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, membership, assertBranch } = await requireTenant("receive:write");
  const { id } = await params;

  const row = await getGoodsReceiptByIdLogic(tenantId, id);
  if (!row) notFound();
  // Rule A5: reachable by URL, so the document's branch is checked here too.
  assertBranch(row.branchId);

  const gr = toGoodsReceiptDetailView(row);
  const tenant = membership.tenant;

  // The bill this receipt wrote when it was confirmed (ADR 0016 Q3/Q7). Without
  // a link, a system-created document cannot be found from the document that
  // created it — which is the fastest way to make people distrust automation.
  const expense = await getExpenseByGoodsReceiptLogic(tenantId, gr.id);
  const forward = gr.lines.some((l) => !l.isReversal);
  const related: RelatedDoc[] = [
    gr.purchaseOrder
      ? { label: `ใบสั่งซื้อ ${gr.purchaseOrder.poNumber}`, href: `/purchase-orders/${gr.purchaseOrder.id}` }
      : { label: "ซื้อสด", note: "ไม่มีใบสั่งซื้อ" },
    ...(expense
      ? [{ label: `บิลค่าใช้จ่าย ฿${formatMoney(expense.totalAmount.toString())}`, href: `/expenses/${expense.id}`, note: expense.paymentStatus === "PAID" ? "จ่ายแล้ว" : "ยังไม่จ่าย" }]
      : gr.status === "DRAFT"
        ? [{ label: "บิลค่าใช้จ่าย", note: "สร้างให้เองเมื่อยืนยัน" }]
        : []),
    ...(gr.invoiceNo ? [{ label: `ใบส่งของผู้ขาย ${gr.invoiceNo}` }] : []),
    ...(gr.status !== "DRAFT" && forward ? [{ label: "ดูในบัตรสต๊อก", href: "/stock/history" }] : []),
  ];
  // "ต่างจากที่สั่ง" means nothing on a purchase with no order: every row is "—".
  const fromOrder = gr.purchaseOrder !== null;

  return (
    <div className="space-y-6">
      <DocHeader
        trail={{ href: "/goods-receipts", label: "รับสินค้า" }}
        number={gr.grNumber}
        badges={
          <>
            <StatusBadge status={gr.status} />
            {gr.hasDiscrepancy && gr.status === "CONFIRMED" && <HeaderChip tone="warn">ต้องตรวจสอบ</HeaderChip>}
          </>
        }
        meta={`${gr.supplier.nameFull} · ${gr.branch.name} · รับ ${gr.receivedAtLabel}${
          gr.confirmedByName ? ` · ยืนยันโดย ${gr.confirmedByName}` : ""
        }`}
        actions={
          <GoodsReceiptActions
            part="head"
            id={gr.id}
            grNumber={gr.grNumber}
            status={gr.status}
            onConfirm={confirmGoodsReceiptAction}
            onVoid={voidGoodsReceiptAction}
            onDiscard={deleteGoodsReceiptDraftAction}
          />
        }
      />
      <RelatedDocs items={related} />

      {gr.status === "DRAFT" && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground print:hidden">
          ยังเป็นร่าง — สต๊อกยังไม่ขยับ จนกว่าจะกด &quot;ยืนยันรับของเข้าคลัง&quot;
        </div>
      )}
      {gr.status === "VOIDED" && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          ใบรับนี้ถูกยกเลิกเมื่อ {gr.voidedAtLabel}
          {gr.voidedByName ? ` โดย ${gr.voidedByName}` : ""}
          {gr.voidReason ? ` — ${gr.voidReason}` : ""}
          <div className="mt-1 text-xs">
            รายการเดิมยังอยู่ครบ และมี &quot;รายการกลับรายการ&quot; หักคืนเท่ากัน
          </div>
        </div>
      )}
      {expense && gr.vatRatePercent && (
        <p className="-mt-3 text-xs text-muted-foreground print:hidden">
          VAT {gr.vatRatePercent}%{" "}
          {gr.vatReclaimable ? "ขอคืนได้ ไม่รวมในต้นทุนของ" : "ขอคืนไม่ได้ จึงรวมเป็นต้นทุนของ"}
        </p>
      )}

      {gr.hasDiscrepancy && gr.status === "CONFIRMED" && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn print:hidden">
          ใบนี้ถูกติดธง &quot;ต้องตรวจสอบ&quot; — จำนวนหรือราคาไม่ตรงกับใบสั่งซื้อ
          ดูคอลัมน์ &quot;ต่างจากที่สั่ง&quot; ด้านล่าง
        </div>
      )}

      {/* ---------- the document ---------- */}
      <article className="rounded-lg border border-border bg-surface p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-bold">ใบรับสินค้า / Goods Receipt</h2>
            <p className="mt-1 text-2xl font-bold tabular-nums">{gr.grNumber}</p>
            <div className="mt-2 print:hidden">
              <StatusBadge status={gr.status} />
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{tenant.name}</p>
            {tenant.taxId && (
              <p className="text-muted-foreground">เลขผู้เสียภาษี {tenant.taxId}</p>
            )}
            <p className="text-muted-foreground">สาขา {gr.branch.name}</p>
          </div>
        </header>

        <div className="grid gap-4 py-4 sm:grid-cols-2">
          <div className="text-sm">
            <p className="text-xs text-muted-foreground">ผู้ขาย</p>
            <p className="font-medium">
              {gr.supplier.nameFull}
              {gr.supplier.deleted && (
                <span className="ml-1 text-xs text-warn">(ถูกลบแล้ว)</span>
              )}
            </p>
            {gr.supplier.contactPhone && (
              <p className="text-muted-foreground">โทร {gr.supplier.contactPhone}</p>
            )}
          </div>
          <div className="text-sm sm:text-right">
            <p>
              <span className="text-muted-foreground">รับเมื่อ: </span>
              {gr.receivedAtLabel}
            </p>
            <p>
              <span className="text-muted-foreground">ใบสั่งซื้อ: </span>
              {gr.purchaseOrder ? (
                <a
                  href={`/purchase-orders/${gr.purchaseOrder.id}`}
                  className="text-primary hover:underline print:text-foreground"
                >
                  {gr.purchaseOrder.poNumber}
                </a>
              ) : (
                "ซื้อสด (ไม่มีใบสั่งซื้อ)"
              )}
            </p>
            <p>
              <span className="text-muted-foreground">เลขที่ใบส่งของ: </span>
              {gr.invoiceNo ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">ผู้รับ: </span>
              {gr.receivedByName}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">รายการ</th>
                <th className="py-2 pr-2 text-right font-medium">จำนวนที่รับ</th>
                <th className="py-2 pr-2 font-medium">หน่วย</th>
                {fromOrder && <th className="py-2 pr-2 text-right font-medium">ต่างจากที่สั่ง</th>}
                <th className="py-2 pr-2 text-right font-medium">ราคา/หน่วย</th>
                <th className="py-2 text-right font-medium">รวม</th>
              </tr>
            </thead>
            <tbody>
              {gr.lines.map((l) => (
                <tr
                  key={l.id}
                  className={`border-b border-border align-top ${
                    l.isReversal ? "bg-bad-bg/50 text-bad" : ""
                  }`}
                >
                  <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                    {l.lineNo}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="font-medium">
                      {l.productName}
                      {l.isReversal && (
                        <span className="ml-1 text-xs">(กลับรายการ)</span>
                      )}
                    </div>
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
                    {formatQty(l.qtyReceivedActual)}
                  </td>
                  <td className="py-2 pr-2">{l.receivedUnitName}</td>
                  {fromOrder && <td className="py-2 pr-2 text-right tabular-nums">
                    {l.ordered && !l.isReversal ? (
                      Number(l.ordered.varianceQty) === 0 ? (
                        <span className="text-muted-foreground">ตรงตามสั่ง</span>
                      ) : (
                        <span
                          className={
                            Number(l.ordered.varianceQty) > 0
                              ? "text-warn"
                              : "text-muted-foreground"
                          }
                        >
                          {Number(l.ordered.varianceQty) > 0 ? "+" : ""}
                          {formatQty(l.ordered.varianceQty)}
                        </span>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>}
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatMoney(l.unitPriceActual)}
                    {/* Rule PR3 — the bill's own figure, beside the net one the ledger uses. */}
                    {l.unitPriceQuoted && (
                      <div className="text-xs text-muted-foreground">ตามบิล {formatMoney(l.unitPriceQuoted)} (รวม VAT)</div>
                    )}
                    {l.ordered && Number(l.ordered.variancePrice) !== 0 && (
                      <div className="text-xs text-warn">
                        สั่งที่ {formatMoney(l.ordered.unitPrice)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(l.lineTotalActual)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between border-t border-border pt-1 text-base font-bold">
              <dt>รวมมูลค่าที่รับ</dt>
              <dd className="tabular-nums">{formatMoney(gr.totalAmount)}</dd>
            </div>
          </dl>
        </div>

        {gr.notes && (
          <div className="mt-4 border-t border-border pt-3 text-sm">
            <p className="text-xs text-muted-foreground">หมายเหตุ</p>
            <p className="whitespace-pre-wrap">{gr.notes}</p>
          </div>
        )}
      </article>

      {/* ---------- what entered stock, in the shop's words, folded ---------- */}
      <details className="group rounded-[18px] border border-border/70 bg-surface shadow-card print:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
          ของเข้าคลังเท่าไร (แปลงหน่วยแล้ว)
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">กดเพื่อดู</span>
          <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">ย่อ</span>
        </summary>
        <div className="space-y-2 overflow-x-auto px-4 pb-4">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-2 font-medium">รายการ</th>
                <th className="py-1.5 pr-2 font-medium">รับมา</th>
                <th className="py-1.5 pr-2 text-right font-medium">เข้าคลัง</th>
                <th className="py-1.5 font-medium">แผนก</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {gr.lines.map((l) => (
                <tr key={l.id} className={l.isReversal ? "text-bad" : ""}>
                  <td className="py-1.5 pr-2">
                    {l.productName}
                    {l.isReversal && " (กลับรายการ)"}
                  </td>
                  <td className="py-1.5 pr-2">
                    {formatQty(l.qtyReceivedActual)} {l.receivedUnitName}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatQty(l.qtyBase)} {l.baseUnitName ?? ""}
                  </td>
                  <td className="py-1.5">
                    {l.allocations.map((a) => `${a.departmentName} ${formatQty(a.qtyAllocatedActual)}`).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            ใช้อัตราแปลงหน่วยที่ล็อกไว้ตอนรับของ ถ้าแก้หน่วยของวัตถุดิบภายหลัง ใบนี้ไม่เปลี่ยนตาม
          </p>
        </div>
      </details>

      <GoodsReceiptActions
        part="foot"
        id={gr.id}
        grNumber={gr.grNumber}
        status={gr.status}
        onConfirm={confirmGoodsReceiptAction}
        onVoid={voidGoodsReceiptAction}
        onDiscard={deleteGoodsReceiptDraftAction}
      />
    </div>
  );
}

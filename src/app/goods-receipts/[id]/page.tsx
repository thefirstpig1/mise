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

export default async function GoodsReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, membership } = await requireTenant("receive:write");
  const { id } = await params;

  const row = await getGoodsReceiptByIdLogic(tenantId, id);
  if (!row) notFound();

  const gr = toGoodsReceiptDetailView(row);
  const tenant = membership.tenant;

  // The bill this receipt wrote when it was confirmed (ADR 0016 Q3/Q7). Without
  // a link, a system-created document cannot be found from the document that
  // created it — which is the fastest way to make people distrust automation.
  const expense = await getExpenseByGoodsReceiptLogic(tenantId, gr.id);

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <a
          href="/goods-receipts"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับรายการใบรับสินค้า
        </a>
      </div>

      <GoodsReceiptActions
        id={gr.id}
        grNumber={gr.grNumber}
        status={gr.status}
        onConfirm={confirmGoodsReceiptAction}
        onVoid={voidGoodsReceiptAction}
        onDiscard={deleteGoodsReceiptDraftAction}
      />

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
      {expense && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 print:hidden">
          ใบนี้บันทึกเป็นค่าใช้จ่ายให้อัตโนมัติแล้ว —{" "}
          <a href={`/expenses/${expense.id}`} className="font-medium underline">
            ดูบิลค่าใช้จ่าย
          </a>
          {gr.vatRatePercent && (
            <span className="ml-1 text-xs">
              (VAT {gr.vatRatePercent}%{" "}
              {gr.vatReclaimable
                ? "ขอคืนได้ ไม่รวมในต้นทุนของ"
                : "ขอคืนไม่ได้ จึงรวมเป็นต้นทุนของ"}
              )
            </span>
          )}
        </div>
      )}

      {gr.hasDiscrepancy && gr.status === "CONFIRMED" && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn print:hidden">
          ใบนี้ถูกติดธง &quot;ต้องตรวจสอบ&quot; — จำนวนหรือราคาไม่ตรงกับใบสั่งซื้อ
          ดูคอลัมน์ &quot;ต่างจากที่สั่ง&quot; ด้านล่าง
        </div>
      )}

      {/* ---------- the document ---------- */}
      <article className="rounded-lg border border-border bg-card p-6 print:border-0 print:p-0">
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
                <th className="py-2 pr-2 text-right font-medium">ต่างจากที่สั่ง</th>
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
                  <td className="py-2 pr-2 text-right tabular-nums">
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
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatMoney(l.unitPriceActual)}
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

      {/* ---------- what only we need to know ---------- */}
      <section className="rounded-lg border border-border p-4 text-xs text-muted-foreground print:hidden">
        <h3 className="mb-2 text-sm font-medium text-foreground">ข้อมูลภายใน</h3>
        <p>
          จำนวนที่เข้าคลังคำนวณด้วยอัตราแปลงหน่วยที่ &ldquo;ตรึง&rdquo;
          ไว้บนใบสั่งซื้อ ไม่ใช่ค่าปัจจุบันของวัตถุดิบ —
          หากมีการแก้หน่วยภายหลัง ใบนี้จะยังคงเดิม
        </p>
        <ul className="mt-2 space-y-1">
          {gr.lines.map((l) => (
            <li key={l.id}>
              #{l.lineNo} {l.productName} — 1 {l.receivedUnitName} ={" "}
              {formatQty(l.toBaseRatio)} (หน่วยหลัก) → เข้าคลัง{" "}
              <span className="tabular-nums">{formatQty(l.qtyBase)}</span> · ปันส่วน:{" "}
              {l.allocations
                .map((a) => `${a.departmentName} ${formatQty(a.qtyAllocatedActual)}`)
                .join(", ")}
              {l.purchaseOrderItemId ? "" : " · ไม่ผูกกับใบสั่งซื้อ"}
            </li>
          ))}
        </ul>
        {gr.confirmedAtLabel && (
          <p className="mt-2">
            ยืนยันรับของเมื่อ {gr.confirmedAtLabel}
            {gr.confirmedByName ? ` โดย ${gr.confirmedByName}` : ""} ·{" "}
            <a href="/stock/history" className="text-primary hover:underline">
              ดูในบัญชีคลัง
            </a>
          </p>
        )}
      </section>
    </div>
  );
}

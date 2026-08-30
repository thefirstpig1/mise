// Sprint 2 Part 13 L5b — edit a DRAFT receipt.
//
// Anything that has posted renders an explanation instead of a disabled form:
// a greyed-out form invites the user to look for the way to enable it, and there
// isn't one — a confirmed receipt is voided, never edited (ADR 0013 Q6). Same
// call the Part 11 edit page makes for a sent order.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import {
  addDays,
  bangkokDayEndUtc,
  bangkokDayStartUtc,
  computeBangkokToday,
} from "@/lib/bangkok-date";
import { getGoodsReceiptByIdLogic } from "@/server/goods-receipt";
import {
  GOODS_RECEIPT_STATUS_LABELS_TH,
  MAX_BACKDATE_DAYS,
} from "@/lib/validations/goods-receipt";
import {
  getReceivablePurchaseOrderAction,
  updateGoodsReceiptAction,
} from "../../actions";
import GoodsReceiptForm from "../../_components/GoodsReceiptForm";
import { loadGoodsReceiptFormOptions } from "../../_components/form-options";
import {
  toBangkokDateTimeLocal,
  toGoodsReceiptDetailView,
} from "../../_components/goods-receipt-view";

export default async function EditGoodsReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId } = await requireTenant("receive:write");
  const { id } = await params;

  const row = await getGoodsReceiptByIdLogic(tenantId, id);
  if (!row) notFound();

  const gr = toGoodsReceiptDetailView(row);

  if (gr.status !== "DRAFT") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">{gr.grNumber}</h2>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">
            ใบรับสินค้านี้แก้ไขไม่ได้ (สถานะ:{" "}
            {GOODS_RECEIPT_STATUS_LABELS_TH[
              gr.status as keyof typeof GOODS_RECEIPT_STATUS_LABELS_TH
            ] ?? gr.status}
            )
          </p>
          <p className="mt-1">
            เมื่อยืนยันรับของแล้ว สต๊อกถูกบันทึกลงบัญชีคลังซึ่งแก้ย้อนหลังไม่ได้ —
            หากตัวเลขผิด ให้กด &quot;ยกเลิกใบรับ&quot; แล้วออกใบใหม่
          </p>
        </div>
        <a
          href={`/goods-receipts/${gr.id}`}
          className="inline-block rounded-lg border border-border px-4 py-2 text-sm"
        >
          ← กลับไปหน้าใบรับสินค้า
        </a>
      </div>
    );
  }

  const { products, suppliers, branches, purchaseOrders } =
    await loadGoodsReceiptFormOptions(tenantId);

  const today = computeBangkokToday();
  const nowLocal = toBangkokDateTimeLocal(new Date());
  const minLocal = toBangkokDateTimeLocal(
    bangkokDayStartUtc(addDays(today, -MAX_BACKDATE_DAYS))
  );
  const maxLocal = toBangkokDateTimeLocal(
    new Date(bangkokDayEndUtc(today).getTime() - 60_000)
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">แก้ไขฉบับร่าง {gr.grNumber}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ยังไม่เข้าคลัง — แก้ได้จนกว่าจะกดยืนยันรับของ
        </p>
      </div>

      <GoodsReceiptForm
        action={updateGoodsReceiptAction}
        products={products}
        suppliers={suppliers}
        branches={branches}
        purchaseOrders={purchaseOrders}
        loadPurchaseOrder={getReceivablePurchaseOrderAction}
        nowLocal={nowLocal}
        minLocal={minLocal}
        maxLocal={maxLocal}
        initial={{
          id: gr.id,
          branchId: gr.branch.id,
          supplierId: gr.supplier.id,
          purchaseOrderId: gr.purchaseOrder?.id ?? null,
          invoiceNo: gr.invoiceNo ?? "",
          vatRatePercent: gr.vatRatePercent ?? "",
          receivedAtLocal: gr.receivedAtLocal,
          notes: gr.notes ?? "",
          lines: gr.lines.map((l) => ({
            purchaseOrderItemId: l.purchaseOrderItemId,
            productId: l.productId,
            receivedUnitId: l.receivedUnitId,
            receivedUnitName: l.receivedUnitName,
            toBaseRatio: l.toBaseRatio,
            qtyReceivedActual: l.qtyReceivedActual,
            unitPriceActual: l.unitPriceActual,
            notes: l.notes,
          })),
        }}
      />
    </div>
  );
}

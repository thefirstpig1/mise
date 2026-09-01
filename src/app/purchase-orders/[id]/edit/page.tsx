// Sprint 2 Part 11 L5b — edit a DRAFT order.
//
// `params` is a PROMISE in Next 15, like `searchParams` (a669e05).
//
// Only a DRAFT gets a form: anything sent is immutable (Q4), so this page does
// not render a disabled form for it — it says why and links back to the order.
// The server refuses the write too (PurchaseOrderNotEditableError); this is the
// polite half of the same rule.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getPurchaseOrderByIdLogic } from "@/server/purchase-order";
import { updatePurchaseOrderAction, resolveSupplierPriceAction } from "../../actions";
import PurchaseOrderForm from "../../_components/PurchaseOrderForm";
import { loadPurchaseOrderFormOptions } from "../../_components/form-options";
import { toPurchaseOrderDetailView } from "../../_components/purchase-order-view";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, membership, reach} = await requireTenant("purchase:write");
  const { id } = await params;

  const order = await getPurchaseOrderByIdLogic(tenantId, id);
  if (!order) notFound();

  const view = toPurchaseOrderDetailView(order);

  if (view.status !== "DRAFT") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">แก้ไขไม่ได้</h2>
        <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">
          ใบสั่งซื้อ <strong>{view.poNumber}</strong> ส่งออกไปแล้ว จึงแก้ไขไม่ได้ —
          ผู้ขายถือสำเนาใบเดียวกันอยู่ หากต้องเปลี่ยนให้ยกเลิกใบนี้แล้วออกใบใหม่
        </div>
        <a
          href={`/purchase-orders/${view.id}`}
          className="inline-block rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
        >
          ดูใบสั่งซื้อ
        </a>
      </div>
    );
  }

  const { products, suppliers, branches } =
    await loadPurchaseOrderFormOptions(tenantId, reach);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">แก้ไขใบสั่งซื้อ {view.poNumber}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ยังเป็นร่าง — แก้ได้จนกว่าจะกดส่ง
        </p>
      </div>

      <PurchaseOrderForm
        action={updatePurchaseOrderAction}
        products={products}
        suppliers={suppliers}
        branches={branches}
        tenantDefaultVatRate={membership.tenant.defaultVatRatePercent.toString()}
        resolvePrice={resolveSupplierPriceAction}
        initial={{
          id: view.id,
          branchId: view.branch.id,
          supplierId: view.supplier.id,
          // <input type="date"> wants YYYY-MM-DD, not an ISO instant.
          expectedDeliveryDate: view.expectedDeliveryDate?.slice(0, 10) ?? "",
          vatRatePercent: view.vatRatePercent ?? "",
          notes: view.notes ?? "",
          lines: view.lines.map((l) => ({
            productId: l.productId,
            orderUnitId: l.orderUnitId,
            qtyOrdered: l.qtyOrdered,
            unitPrice: l.unitPrice,
            supplierProductMappingId: l.supplierProductMappingId,
            notes: l.notes,
          })),
        }}
      />
    </div>
  );
}

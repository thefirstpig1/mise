// Sprint 2 Part 13 L5b — record a new delivery.
//
// Server Component: auth, the reference lists, and the three datetime bounds.
//
// The bounds are computed HERE, in Bangkok, not in the browser (Decision #60):
// the zod window is checked against Bangkok today, so a device in another
// timezone would otherwise be offered a time the server then rejects. Same rule
// the Part 10 adjust form follows.
//
// `?po=<id>` deep-links from the purchase-order page's "รับของ" button, so the
// order is already resolved server-side and the form opens with its outstanding
// lines rather than flashing empty and then filling in.

import { requireTenant } from "@/lib/require-tenant";
import {
  addDays,
  bangkokDayEndUtc,
  bangkokDayStartUtc,
  computeBangkokToday,
} from "@/lib/bangkok-date";
import { getReceivablePurchaseOrderLogic } from "@/server/goods-receipt";
import {
  MAX_BACKDATE_DAYS,
  RECEIVABLE_PO_STATUSES,
} from "@/lib/validations/goods-receipt";
import {
  createGoodsReceiptAction,
  getReceivablePurchaseOrderAction,
} from "../actions";
import GoodsReceiptForm from "../_components/GoodsReceiptForm";
import { loadGoodsReceiptFormOptions } from "../_components/form-options";
import {
  toBangkokDateTimeLocal,
  toReceivablePurchaseOrderView,
} from "../_components/goods-receipt-view";

export default async function NewGoodsReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const sp = await searchParams;

  const { products, suppliers, branches, purchaseOrders } =
    await loadGoodsReceiptFormOptions(tenantId);

  const initialPo = sp.po
    ? await getReceivablePurchaseOrderLogic(tenantId, sp.po)
    : null;

  const today = computeBangkokToday();
  const nowLocal = toBangkokDateTimeLocal(new Date());
  const minLocal = toBangkokDateTimeLocal(
    bangkokDayStartUtc(addDays(today, -MAX_BACKDATE_DAYS))
  );
  // One minute before tomorrow starts — the last instant zod accepts.
  const maxLocal = toBangkokDateTimeLocal(
    new Date(bangkokDayEndUtc(today).getTime() - 60_000)
  );

  const blocked =
    suppliers.length === 0
      ? { what: "ผู้ขาย", href: "/suppliers/new", cta: "เพิ่มผู้ขาย" }
      : products.length === 0
        ? { what: "วัตถุดิบ", href: "/products/new", cta: "เพิ่มวัตถุดิบ" }
        : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">รับสินค้า</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          เลือกใบสั่งซื้อเพื่อดึงรายการที่ค้างรับ หรือรับแบบซื้อสดโดยไม่มีใบสั่งซื้อก็ได้
        </p>
      </div>

      {blocked ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
          ยังไม่มี{blocked.what}ในระบบ —{" "}
          <a href={blocked.href} className="text-primary hover:underline">
            {blocked.cta}ก่อน
          </a>
        </div>
      ) : (
        <GoodsReceiptForm
          action={createGoodsReceiptAction}
          products={products}
          suppliers={suppliers}
          branches={branches}
          purchaseOrders={purchaseOrders}
          loadPurchaseOrder={getReceivablePurchaseOrderAction}
          nowLocal={nowLocal}
          minLocal={minLocal}
          maxLocal={maxLocal}
          initialPurchaseOrder={
            initialPo
              ? toReceivablePurchaseOrderView(
                  initialPo,
                  RECEIVABLE_PO_STATUSES.includes(initialPo.status as never)
                )
              : null
          }
        />
      )}
    </div>
  );
}

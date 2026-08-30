// Sprint 2 Part 11 L5b — raise a new DRAFT order.
//
// Server Component: auth + the three reference lists + the tenant's default VAT
// rate, which the form uses to prefill the header when a VAT-registered supplier
// is chosen (Q6).

import { requireTenant } from "@/lib/require-tenant";
import {
  createPurchaseOrderAction,
  resolveSupplierPriceAction,
} from "../actions";
import PurchaseOrderForm from "../_components/PurchaseOrderForm";
import { loadPurchaseOrderFormOptions } from "../_components/form-options";

export default async function NewPurchaseOrderPage() {
  const { tenantId, membership, reach} = await requireTenant("purchase:write");
  const { products, suppliers, branches } =
    await loadPurchaseOrderFormOptions(tenantId, reach);

  const blocked =
    suppliers.length === 0
      ? { what: "ผู้ขาย", href: "/suppliers/new", cta: "เพิ่มผู้ขาย" }
      : products.length === 0
        ? { what: "วัตถุดิบ", href: "/products/new", cta: "เพิ่มวัตถุดิบ" }
        : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">สร้างใบสั่งซื้อ</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ราคาจะดึงจากรายการราคาของผู้ขายให้อัตโนมัติ ถ้ายังไม่มีก็กรอกเองได้
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
        <PurchaseOrderForm
          action={createPurchaseOrderAction}
          products={products}
          suppliers={suppliers}
          branches={branches}
          tenantDefaultVatRate={membership.tenant.defaultVatRatePercent.toString()}
          resolvePrice={resolveSupplierPriceAction}
        />
      )}
    </div>
  );
}

// Kong (2026-09-28) — order from a supplier's catalog.
//
// The supplier page gained a "สั่งซื้อ" button: it opens every product this
// supplier is recorded as selling to the chosen branch, grouped by category,
// and pressing สร้างใบสั่งซื้อ saves an ordinary DRAFT through the same action
// the order form uses — so every check the order form gets, this gets too.
//
// Prices come from getSupplierCatalogLogic, which applies the SAME lookup rule
// as the order form's autofill (pickCurrentPrice); test C6 pins the two to the
// satang. A product with no price-list price is prefilled from what this
// supplier last invoiced (Kong's choice: a shop that never set up a price list
// still gets a catalog). Every Decimal leaves as a string (Pitfall #20).

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getSupplierByIdLogic } from "@/server/supplier";
import { getBranchesLogic } from "@/server/branch";
import { getSupplierCatalogLogic } from "@/server/purchase-order";
import { createPurchaseOrderAction } from "../../../purchase-orders/actions";
import SupplierCatalog, { type CatalogItemView } from "./SupplierCatalog";
import EmptyState from "@/components/ui/EmptyState";

export default async function SupplierOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { id } = await params;
  const { branch } = await searchParams;
  const { tenantId, membership, reach } = await requireTenant("purchase:write");

  const [supplier, branches] = await Promise.all([
    getSupplierByIdLogic(tenantId, id),
    // Rule A5: only branches this person may order for.
    getBranchesLogic(tenantId, reach),
  ]);
  if (!supplier) notFound();

  if (branches.length === 0) {
    return <EmptyState art="setup">คุณยังไม่มีสาขาที่สั่งซื้อได้ — โปรดติดต่อเจ้าของร้าน</EmptyState>;
  }

  // A branch outside the list (typed into the URL, or out of reach) falls back
  // to the first one rather than being trusted.
  const branchId = branches.some((b) => b.id === branch) ? branch! : branches[0].id;
  const catalog = await getSupplierCatalogLogic(tenantId, supplier.id, branchId);

  const items: CatalogItemView[] = catalog.map((c) => ({
    productId: c.productId,
    name: c.name,
    sku: c.sku,
    imageUrl: c.imageUrl,
    section: c.section,
    group: c.group,
    units: c.units.map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase })),
    defaultUnitId: c.defaultUnitId,
    price: c.price
      ? {
          mappingId: c.price.mappingId,
          unitPrice: c.price.unitPrice.toString(),
          orderUnitId: c.price.orderUnitId,
          orderUnitName: c.price.orderUnitName,
          minOrderQty: c.price.minOrderQty?.toString() ?? null,
          scope: c.price.scope,
        }
      : null,
    lastPaid: c.lastPaid
      ? {
          unitPrice: c.lastPaid.unitPrice.toString(),
          unitId: c.lastPaid.unitId,
          unitName: c.lastPaid.unitName,
          receivedOn: c.lastPaid.receivedAt.toLocaleDateString("th-TH", {
            day: "numeric",
            month: "short",
            year: "2-digit",
            timeZone: "Asia/Bangkok",
          }),
          // Named only when it was paid somewhere else — at this branch it goes without saying.
          otherBranchName: c.lastPaid.branchId === branchId ? null : c.lastPaid.branchName,
        }
      : null,
  }));

  // Same VAT prefill as the order form (ADR 0012 Q6): a supplier that is not
  // VAT-registered means this order carries no VAT.
  const vatRate = supplier.isVatRegistered
    ? (supplier.defaultVatRatePercent ?? membership.tenant.defaultVatRatePercent).toString()
    : "";

  return (
    <SupplierCatalog
      supplier={{ id: supplier.id, nameFull: supplier.nameFull }}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      branchId={branchId}
      vatRate={vatRate}
      items={items}
      action={createPurchaseOrderAction}
    />
  );
}

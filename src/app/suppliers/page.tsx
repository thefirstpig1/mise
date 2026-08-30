// Sprint 1 Part 5, Step 7.6 — supplier list (Server Component).
// Loads the tenant's suppliers (active + inactive, soft-deleted excluded),
// serializes each for the client, and hands them to SupplierList for search +
// the active/inactive toggle.
import { requireTenant } from "@/lib/require-tenant";
import { getSuppliersLogic } from "@/server/supplier";
import SupplierList from "./_components/SupplierList";
import { toSupplierView } from "./_components/supplier-view";

export default async function SuppliersPage() {
  const { tenantId } = await requireTenant("any:member");
  const suppliers = await getSuppliersLogic(tenantId);
  return <SupplierList suppliers={suppliers.map(toSupplierView)} />;
}

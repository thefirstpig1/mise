// Sprint 1 Part 5, Step 7.6 — supplier list (Server Component).
// Loads the tenant's suppliers (active + inactive, soft-deleted excluded),
// serializes each for the client, and hands them to SupplierList for search +
// the active/inactive toggle.
import { requireTenant } from "@/lib/require-tenant";
import { hasCapability } from "@/lib/permissions/service";
import { getSuppliersLogic } from "@/server/supplier";
import SupplierList from "./_components/SupplierList";
import { toSupplierView } from "./_components/supplier-view";

export default async function SuppliersPage() {
  const { tenantId, role } = await requireTenant("any:member");
  const suppliers = await getSuppliersLogic(tenantId);
  return (
    <SupplierList
      suppliers={suppliers.map(toSupplierView)}
      // The order catalog's own gate is purchase:write; a button nobody can use is noise.
      canOrder={hasCapability(role, "purchase:write")}
    />
  );
}

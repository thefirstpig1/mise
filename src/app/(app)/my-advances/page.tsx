// ADR 0037 Q5–Q6 — "สำรองจ่ายของฉัน" (mockup L7p9q52ENkn1cwKUPYCwSm, phones 1–3).
// Kong 2026-10-28: mobile first — the person who ran to the market records it
// standing at the stall, and sees for themselves whether the shop paid them back.
//
// Server Component: the claims and the form's reference lists, all cheap reads,
// in parallel. Everything crossing to the client is plain strings and numbers.

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { storageReady } from "@/lib/storage";
import { getBranchesLogic, liveliestBranchId } from "@/server/branch";
import { getCategoriesLogic } from "@/server/category";
import { getProductsLogic } from "@/server/product";
import { getSuppliersLogic } from "@/server/supplier";
import { getMyClaimsLogic } from "@/server/staff-advance";
import MyAdvances from "./_components/MyAdvances";

export default async function MyAdvancesPage() {
  const { tenantId, user, reach } = await requireTenant("purchase:self");
  const [claims, branches, products, categories, suppliers] = await Promise.all([
    getMyClaimsLogic(tenantId, user.id!),
    getBranchesLogic(tenantId, reach),
    getProductsLogic(tenantId),
    getCategoriesLogic(tenantId),
    getSuppliersLogic(tenantId),
  ]);
  const defaultBranchId = (await liveliestBranchId(tenantId, branches.map((b) => b.id))) ?? branches[0]?.id ?? "";

  return (
    <MyAdvances
      claims={claims}
      today={computeBangkokToday().toISOString().slice(0, 10)}
      storageReady={storageReady()}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      defaultBranchId={defaultBranchId}
      products={products
        .filter((p) => p.isActive)
        .map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          imageUrl: p.imageUrl,
          section: p.category?.accountingSection ?? null,
          group: p.category?.groupName ?? null,
          baseUnitName: p.productUnits.find((u) => u.isBase)?.unitName ?? null,
          units: p.productUnits
            .map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase }))
            .sort((a, b) => Number(b.isBase) - Number(a.isBase)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "th"))}
      // Things that do not go on the shelf: running costs first, then food.
      categories={categories
        .map((c) => ({ id: c.id, label: `${c.accountingSection} · ${c.groupName}`, opex: c.account !== "COGS" }))
        .sort((a, b) => Number(b.opex) - Number(a.opex) || a.label.localeCompare(b.label, "th"))}
      suppliers={suppliers.filter((s) => !s.isWalkIn && s.isActive).map((s) => ({ id: s.id, name: s.nameShort ?? s.nameFull }))}
    />
  );
}

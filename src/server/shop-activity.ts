// ============================================================
// Mise — has this shop recorded anything the dashboard's figures are made of?
// ============================================================
// Kong 2026-11-02 ("แก้เลย"): a shop that has just signed up landed on a
// dashboard that ran every P&L, chart and comparison against nothing — 233
// queries in 34 transactions on the dev machine — and pressing "สร้างร้าน"
// took 7–11 s to show it. Its figures are sales, purchases, expenses and
// counts; with none of the four on file there is nothing to compute, so the
// dashboard asks this ONE question first and skips the rest.
//
// Tenant-wide, not per branch in reach: the question is "is the shop brand
// new", and a branch with no figures of its own already reads as "—".
// ============================================================

import { withTenantContext } from "@/lib/db";

export async function hasShopActivityLogic(tenantId: string): Promise<boolean> {
  const rows = await withTenantContext(tenantId, (tx) =>
    tx.$queryRaw<{ any: boolean }[]>`
      select exists (select 1 from sales_day where tenant_id = ${tenantId}::uuid)
          or exists (select 1 from goods_receipt where tenant_id = ${tenantId}::uuid and deleted_at is null)
          or exists (select 1 from expense where tenant_id = ${tenantId}::uuid and deleted_at is null)
          or exists (select 1 from stock_count where tenant_id = ${tenantId}::uuid and deleted_at is null)
        as any`,
  );
  return rows[0]?.any === true;
}

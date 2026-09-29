// ============================================================
// Mise — ใบขอซื้อ, the kitchen's side (Part 38, ADR 0036)
// ============================================================
// Everybody in the branch adds what is running out; each department says
// "พร้อมแล้ว"; the purchaser takes it from there. Nothing on this page sends
// anything to a supplier.
//
// Money: the board comes from getRequestBoardLogic with the reader's own
// CostAccess ticket, so a cook's "ร้าน B ถูกกว่า" carries no figures (R5).
// ============================================================

import Link from "next/link";
import type { Route } from "next";
import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getRequestBoardLogic } from "@/server/purchase-request";
import { loadPurchaseOrderFormOptions } from "../purchase-orders/_components/form-options";
import EmptyState from "@/components/ui/EmptyState";
import RequestBoard from "./_components/RequestBoard";

type SearchParams = Promise<{ b?: string }>;

export default async function PurchaseRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await requireTenant("purchase:request");
  const params = await searchParams;
  const branches = await getBranchesLogic(t.tenantId, t.reach);
  if (branches.length === 0) {
    return <EmptyState art="setup">คุณยังไม่ได้รับสิทธิ์ในสาขาใด — ติดต่อเจ้าของร้าน</EmptyState>;
  }
  // A branch from the URL is only a wish; the reach decides (rule A5).
  const branch = branches.find((b) => b.id === params.b) ?? branches[0];
  const viewer = {
    userId: t.user.id!,
    role: t.role,
    canApprove: t.can("purchase:approve"),
    costAccess: t.costAccess,
  };
  const [board, options] = await Promise.all([
    getRequestBoardLogic(t.tenantId, branch.id, viewer),
    loadPurchaseOrderFormOptions(t.tenantId, t.reach),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ใบขอซื้อ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ของที่ใกล้หมดใส่ไว้ที่นี่ได้ทุกคน · แต่ละแผนกกด “พร้อมแล้ว” เมื่อใส่ครบ · ฝ่ายจัดซื้อจะรวมเป็นใบสั่งซื้อให้เอง
          </p>
        </div>
        {viewer.canApprove && (
          <Link
            href={`/purchase-requests/cut?b=${branch.id}` as Route}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            ตัดรอบสั่งซื้อ
          </Link>
        )}
      </div>

      {branches.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="สาขา">
          {branches.map((b) => (
            <Link
              key={b.id}
              href={`/purchase-requests?b=${b.id}` as Route}
              aria-current={b.id === branch.id ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                b.id === branch.id ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-muted"
              }`}
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}

      <RequestBoard
        board={board}
        branchName={branch.name}
        products={options.products}
        suppliers={options.suppliers.map((s) => ({ id: s.id, name: s.nameFull }))}
        me={{ userId: viewer.userId, canApprove: viewer.canApprove, isHead: t.role === "dept_head" }}
      />
    </div>
  );
}

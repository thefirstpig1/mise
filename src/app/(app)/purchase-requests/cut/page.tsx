// ============================================================
// Mise — ตัดรอบสั่งซื้อ, the purchaser's side (Part 38, ADR 0036 Q4/Q12)
// ============================================================
// The kitchen's waiting lines, every supplier's latest price for each, and who
// is ready. The purchaser picks a supplier per line (the kitchen's note beside
// it), then cuts: one DRAFT order per supplier, reviewed and sent from here.
// ============================================================

import Link from "next/link";
import type { Route } from "next";
import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getCutSheetLogic } from "@/server/purchase-request";
import { getMyPurchaseNotifyLogic } from "@/server/purchase-ready-notify";
import NotifyToggle from "../_components/NotifyToggle";
import EmptyState from "@/components/ui/EmptyState";
import CutSheet from "../_components/CutSheet";

type SearchParams = Promise<{ b?: string }>;

export default async function CutRoundPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await requireTenant("purchase:approve");
  const params = await searchParams;
  const branches = await getBranchesLogic(t.tenantId, t.reach);
  if (branches.length === 0) return <EmptyState art="setup">คุณยังไม่ได้รับสิทธิ์ในสาขาใด</EmptyState>;
  const branch = branches.find((b) => b.id === params.b) ?? branches[0];
  const [sheet, notifyOn] = await Promise.all([
    getCutSheetLogic(t.tenantId, branch.id, {
      userId: t.user.id!,
      role: t.role,
      canApprove: true,
      costAccess: t.costAccess,
    }),
    getMyPurchaseNotifyLogic(t.tenantId, t.user.id!),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="ตำแหน่งของหน้านี้" className="text-sm text-muted-foreground">
            <Link href={`/purchase-requests?b=${branch.id}` as Route} className="hover:text-foreground">
              ใบขอซื้อ
            </Link>
            <span aria-hidden className="mx-1.5">›</span>
            <span className="text-foreground">ตัดรอบสั่งซื้อ</span>
          </nav>
          <h1 className="mt-1 text-2xl font-bold">ตัดรอบสั่งซื้อ · {branch.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            เลือกผู้ขายของแต่ละรายการ แล้วกดสร้างใบสั่งซื้อ — ระบบแยกเป็นใบร่างตามผู้ขายให้ ตรวจแล้วค่อยส่ง
          </p>
        </div>
      </div>
      {branches.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="สาขา">
          {branches.map((b) => (
            <Link
              key={b.id}
              href={`/purchase-requests/cut?b=${b.id}` as Route}
              aria-current={b.id === branch.id ? "page" : undefined}
              className={`pill ${b.id === branch.id ? "is-on" : ""}`}
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}
      <CutSheet sheet={sheet} branchId={branch.id} />
      {/* A personal setting, so it sits under the work, not above it (review 2026-10-27). */}
      <div className="border-t border-border pt-4">
        <NotifyToggle initial={notifyOn} />
      </div>
    </div>
  );
}

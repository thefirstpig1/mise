import { signOut } from "@/lib/auth";
import { withTenantContext } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { getTransfersLogic } from "@/server/transfer";
import { getTransfersQuerySchema } from "@/lib/validations/transfer";
import { toTransferView } from "@/app/transfers/_components/transfer-view";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getPulseDashboardLogic } from "@/server/sales-pulse";
import { toPulseDashboardView } from "@/app/sales/_components/sales-view";
import PulsePanel from "./_components/PulsePanel";

export default async function DashboardPage() {
  const { user, membership, tenantId } = await requireTenant();
  const { tenant } = membership;

  // Layer 2: this membership's branch + dept access (tenant-scoped read).
  const activeMembership = await withTenantContext(tenantId, (tx) =>
    tx.tenantMembership.findUniqueOrThrow({
      where: { id: membership.id },
      include: {
        branchAccess: { include: { branch: true } },
        deptAssignments: { include: { department: true } },
      },
    })
  );

  // Part 18 Q8. Tenant-wide rather than per-branch: the dashboard has no branch
  // selector, and an owner opening it wants to know that ANY truck is unconfirmed
  // — the per-branch version of this lives on /stock, where a branch is chosen.
  const waiting = (
    await getTransfersLogic(
      tenantId,
      getTransfersQuerySchema.parse({ status: "SENT", includeReversalLines: "false" })
    )
  ).map(toTransferView);

  // Part 20a Q4 — the answer to "the shop runs blind between imports". Detail
  // where a file has landed, the typed pulse where it has not, and every figure
  // saying which.
  const pulse = toPulseDashboardView(await getPulseDashboardLogic(tenantId));
  const todayIso = computeBangkokToday().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold">Mise</h1>
            <p className="text-xs text-muted-foreground">{tenant.name}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.email}</span>
            <form action={async () => { "use server"; await signOut(); }}>
              <button type="submit" className="text-primary hover:underline">
                ออกจากระบบ
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <h2 className="mb-2 text-2xl font-bold">ภาพรวม</h2>
        <p className="mb-8 text-muted-foreground">
          ยินดีต้อนรับ, {user.name ?? user.email}
        </p>

        <div className="mb-8">
          <PulsePanel dashboard={pulse} todayIso={todayIso} />
        </div>

        {waiting.length > 0 && (
          <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">
              มีใบโอน {waiting.length} ใบที่ปลายทางยังไม่กดรับ
            </p>
            <p className="mt-1 text-xs text-amber-800">
              ของเข้ายอดของสาขาปลายทางแล้วตั้งแต่ต้นทางกดส่ง — ที่ค้างคือการนับยืนยัน
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {waiting.map((t) => (
                <li key={t.id}>
                  <a href={`/transfers/${t.id}`} className="text-amber-900 hover:underline">
                    {t.tfNumber}
                  </a>{" "}
                  <span className="text-amber-800">
                    {t.fromBranch.name} → {t.toBranch.name} · {t.dispatchedAtLabel}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">บทบาท</p>
            <p className="mt-1 text-2xl font-semibold capitalize">{activeMembership.role}</p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">สาขาที่เข้าถึงได้</p>
            <p className="mt-1 text-2xl font-semibold">
              {activeMembership.branchAccess.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {activeMembership.branchAccess.map((b) => b.branch.name).join(", ")}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">แผนก</p>
            <p className="mt-1 text-2xl font-semibold">
              {tenant.enableDepartments
                ? activeMembership.deptAssignments.length
                : "ปิด"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tenant.enableDepartments
                ? activeMembership.deptAssignments.map((d) => d.department.name).join(", ")
                : "เปิดได้ในตั้งค่า"}
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="mb-2 text-lg font-medium">Sprint 0 — Foundation Complete ✓</p>
          <p className="text-sm text-muted-foreground">
            Authentication, Tenant, Branch, Department + RLS Pre-flight
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Sprint 1+: Master Data, Procurement, Stock, POS Sync, Recipe, Cost Engine, Dashboards
          </p>
        </div>

        <div className="mt-6 flex gap-4">
          <a href="/suppliers" className="text-sm text-primary hover:underline">
            → ซัพพลายเออร์
          </a>
          <a href="/categories" className="text-sm text-primary hover:underline">
            → หมวดบัญชี
          </a>
          <a href="/products" className="text-sm text-primary hover:underline">
            → สินค้า/วัตถุดิบ
          </a>
          <a href="/stock" className="text-sm text-primary hover:underline">
            → สต๊อก
          </a>
          <a href="/purchase-orders" className="text-sm text-primary hover:underline">
            → ใบสั่งซื้อ
          </a>
          <a href="/goods-receipts" className="text-sm text-primary hover:underline">
            → รับสินค้า
          </a>
          <a href="/stock-counts" className="text-sm text-primary hover:underline">
            → นับสต๊อก
          </a>
          <a href="/waste" className="text-sm text-primary hover:underline">
            → ของเสีย
          </a>
          <a href="/transfers" className="text-sm text-primary hover:underline">
            → โอนของระหว่างสาขา
          </a>
          <a href="/sales" className="text-sm text-primary hover:underline">
            → ยอดขาย
          </a>
          <a href="/menus" className="text-sm text-primary hover:underline">
            → เมนู
          </a>
          <a href="/recipes" className="text-sm text-primary hover:underline">
            → สูตรอาหาร
          </a>
          <a href="/menus/lab" className="text-sm text-primary hover:underline">
            → ทดลองเมนู
          </a>
          <a href="/menus/coverage" className="text-sm text-primary hover:underline">
            → เมนูที่ยังไม่มีสูตร
          </a>
          <a href="/consumption" className="text-sm text-primary hover:underline">
            → ตัดสต๊อกตามยอดขาย
          </a>
          <a href="/expenses" className="text-sm text-primary hover:underline">
            → ค่าใช้จ่าย
          </a>
          <a href="/cost" className="text-sm text-primary hover:underline">
            → ต้นทุน
          </a>
          <a href="/settings" className="text-sm text-primary hover:underline">
            → ตั้งค่าร้าน
          </a>
        </div>
      </main>
    </div>
  );
}

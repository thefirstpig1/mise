import { signOut } from "@/lib/auth";
import { withTenantContext } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";

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
          <a href="/settings" className="text-sm text-primary hover:underline">
            → ตั้งค่าร้าน
          </a>
        </div>
      </main>
    </div>
  );
}

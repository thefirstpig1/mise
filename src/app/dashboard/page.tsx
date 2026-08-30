import { signOut } from "@/lib/auth";
import type { Requirement } from "@/lib/permissions/service";
import { withTenantContext } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { getTransfersLogic } from "@/server/transfer";
import { getTransfersQuerySchema } from "@/lib/validations/transfer";
import { toTransferView } from "@/app/transfers/_components/transfer-view";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getPulseDashboardLogic } from "@/server/sales-pulse";
import { toPulseDashboardView } from "@/app/sales/_components/sales-view";
import PulsePanel from "./_components/PulsePanel";

/**
 * Every door in Mise, with the capability its page requires.
 *
 * Order is the order it has always been in: master data, then buying, then
 * what happens to the stock, then what it all cost. A cook sees three of these
 * and an owner sees nineteen, which is the point — nineteen links of which
 * fourteen refuse is not a menu, it is a maze.
 */
const NAV: readonly { href: string; label: string; need: Requirement }[] = [
  { href: "/suppliers", label: "ซัพพลายเออร์", need: "any:member" },
  { href: "/categories", label: "หมวดบัญชี", need: "any:member" },
  { href: "/products", label: "สินค้า/วัตถุดิบ", need: "any:member" },
  { href: "/stock", label: "สต๊อก", need: "any:member" },
  { href: "/purchase-orders", label: "ใบสั่งซื้อ", need: "purchase:write" },
  { href: "/goods-receipts", label: "รับสินค้า", need: "receive:write" },
  { href: "/stock-counts", label: "นับสต๊อก", need: "count:write" },
  { href: "/waste", label: "ของเสีย", need: "stock:write" },
  { href: "/staff-meals", label: "มื้อพนักงาน", need: "staffmeal:write" },
  { href: "/transfers", label: "โอนของระหว่างสาขา", need: "any:member" },
  { href: "/sales", label: "ยอดขาย", need: "sales:view" },
  { href: "/menus", label: "เมนู", need: "any:member" },
  { href: "/recipes", label: "สูตรอาหาร", need: "any:member" },
  { href: "/menus/lab", label: "ทดลองเมนู", need: "recipe:write" },
  { href: "/menus/coverage", label: "เมนูที่ยังไม่มีสูตร", need: "sales:view" },
  { href: "/consumption", label: "ตัดสต๊อกตามยอดขาย", need: "consumption:post" },
  { href: "/expenses", label: "ค่าใช้จ่าย", need: "expense:view" },
  { href: "/cost", label: "ต้นทุน", need: "cost:view" },
  { href: "/settings", label: "ตั้งค่าร้าน", need: "settings:write" },
  { href: "/settings/members", label: "คนในร้าน", need: "member:manage" },
];

export default async function DashboardPage() {
  const { user, membership, tenantId, reach, costAccess, can, membershipCount } =
    await requireTenant("any:member");
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
  ).map((t) => toTransferView(t, costAccess));

  // Part 20a Q4 — the answer to "the shop runs blind between imports". Detail
  // where a file has landed, the typed pulse where it has not, and every figure
  // saying which.
  const pulse = toPulseDashboardView(await getPulseDashboardLogic(tenantId, reach));
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

        {/* The dashboard IS the navigation — there is no shared chrome in
            this project (src/app/layout.tsx renders bare children), so this
            one list is every door in Mise. Filtering it here filters all of
            them.

            The capability beside each link is the SAME one its page declares
            to requireTenant. It has to be, or the menu offers a door that
            refuses — which is worse than no door, because the person cannot
            tell a permission from a bug (rule A8, the /denied page's whole
            reason). tests/permissions-nav.test.ts holds the two lists
            together.

            Hiding is tidiness, not security (rule A7): every page below still
            refuses on its own. */}
        <div className="mt-6 flex flex-wrap gap-4">
          {NAV.filter((item) => can(item.need)).map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-primary hover:underline"
            >
              → {item.label}
            </a>
          ))}
          {/* Only when there is somewhere to switch TO. A person in one shop —
              which is every shop today — never sees this, and never sees the
              chooser either (ADR 0029 Q3). */}
          {membershipCount > 1 && (
            <a href="/choose-shop" className="text-sm text-primary hover:underline">
              → สลับร้าน
            </a>
          )}
        </div>
      </main>
    </div>
  );
}

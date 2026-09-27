// Sprint 7 Part 32 L4 — ต้นทุนและรายได้ต่อแผนก (ADR 0032).
//
// A separate route rather than a section of /cost, and deliberately so: /cost
// is the heaviest page in the system, and this adds a recipe explosion per
// resolution segment on top of it. A shop that does not use departments should
// not pay for one, and one that does should choose when to.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature passes
// `pnpm tsc` and fails `pnpm build` (the Part 10 L5a discovery).

import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday, addDays } from "@/lib/bangkok-date";
import { branchScopeWhere } from "@/lib/permissions/service";
import { getDepartmentReportLogic } from "@/server/department-read";
import DepartmentTable from "./_components/DepartmentTable";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string | undefined, fallback: Date): Date => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? fallback : d;
};

export default async function DepartmentCostPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; branch?: string }>;
}) {
  const { tenantId, reach, membership } = await requireTenant("cost:view");
  const params = await searchParams;

  const today = computeBangkokToday();
  const from = parseDay(params.from, addDays(today, -30));
  const to = parseDay(params.to, today);

  const departmentsOn = membership.tenant.enableDepartments;

  const branches = await withTenantContext(tenantId, (tx) =>
    tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
  );

  // Cost needs a branch (ADR 0014 Q9) — this page never averages across them,
  // it names the one it is showing. First in reach unless the URL says another.
  const branchId =
    branches.find((b) => b.id === params.branch)?.id ?? branches[0]?.id ?? null;

  const report =
    branchId === null
      ? null
      : await getDepartmentReportLogic(tenantId, { branchId, from, to });

  const departmentIds = report
    ? report.rows.map((r) => r.departmentId).filter((d): d is string => d !== null)
    : [];
  const departments = departmentIds.length
    ? await withTenantContext(tenantId, (tx) =>
        tx.department.findMany({
          where: { tenantId, id: { in: departmentIds } },
          select: { id: true, name: true },
        })
      )
    : [];
  const nameOf = new Map(departments.map((d) => [d.id, d.name]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">ต้นทุนและรายได้ต่อแผนก</h2>
        <p className="text-sm text-muted-foreground">
          {iso(from)} – {iso(to)}
          {branchId !== null && (
            <> · {branches.find((b) => b.id === branchId)?.name}</>
          )}
        </p>
      </div>

      {!departmentsOn && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
          ร้านนี้ยังไม่ได้เปิดใช้แผนก — ทุกอย่างจะอยู่ในแถว{" "}
          <span className="font-medium">ไม่ระบุแผนก</span> แถวเดียว
        </div>
      )}

      {branches.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {branches.map((b) => (
            <a
              key={b.id}
              href={`/cost/departments?branch=${b.id}&from=${iso(from)}&to=${iso(to)}`}
              className={`rounded-lg border px-3 py-1 ${
                b.id === branchId
                  ? "border-primary font-medium"
                  : "border-border text-muted-foreground"
              }`}
            >
              {b.name}
            </a>
          ))}
        </nav>
      )}

      {report === null ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีสาขา</p>
      ) : (
        <DepartmentTable
          rows={report.rows.map((r) => ({
            departmentId: r.departmentId,
            name:
              r.departmentId === null
                ? "ไม่ระบุแผนก"
                : nameOf.get(r.departmentId) ?? r.departmentId,
            materialCost: r.materialCost.toFixed(2),
            revenue: r.revenue.toFixed(2),
            grossProfit: r.revenue.minus(r.materialCost).toFixed(2),
          }))}
          materialCostTotal={report.materialCostTotal.toFixed(2)}
          revenueTotal={report.revenueTotal.toFixed(2)}
          grossProfitUnavailable={report.grossProfitUnavailable}
          skippedCount={report.skippedMenuIds.length}
          coveredNetAmount={report.coveredNetAmount.toFixed(2)}
          postedDays={report.postedDays}
        />
      )}
    </div>
  );
}

// Sprint 7 Part 32 L5 — ของหายไปไหน (ADR 0032 Q6/Q7).
//
// §H.8, finally, and much smaller than the spec imagined: the comparison has
// existed since Sprint 3 (`stock_count_item` holds `qty_expected` beside
// `qty_counted`) and Part 22 made the ledger balance BE the theoretical
// balance. Only the view was missing.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature passes
// `pnpm tsc` and fails `pnpm build`.

import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday, addDays } from "@/lib/bangkok-date";
import { branchScopeWhere } from "@/lib/permissions/service";
import { getLeakReportLogic } from "@/server/leak-report";
import LeakTable from "./_components/LeakTable";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string | undefined, fallback: Date): Date => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? fallback : d;
};

export default async function LeakPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; branch?: string }>;
}) {
  const { tenantId, reach } = await requireTenant("cost:view");
  const params = await searchParams;

  const today = computeBangkokToday();
  const from = parseDay(params.from, addDays(today, -30));
  const to = parseDay(params.to, today);

  const branches = await withTenantContext(tenantId, (tx) =>
    tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
  );
  const branchId =
    branches.find((b) => b.id === params.branch)?.id ?? branches[0]?.id ?? null;

  const rows =
    branchId === null
      ? []
      : await getLeakReportLogic(tenantId, { branchId, from, to });

  const departmentIds = [
    ...new Set(
      rows.flatMap((r) =>
        r.usage.map((u) => u.departmentId).filter((d): d is string => d !== null)
      )
    ),
  ];
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
        <h2 className="text-xl font-bold">ของหายไปไหน</h2>
        <p className="text-sm text-muted-foreground">
          {iso(from)} – {iso(to)}
          {branchId !== null && (
            <> · {branches.find((b) => b.id === branchId)?.name}</>
          )}
        </p>
      </div>

      {branches.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {branches.map((b) => (
            <a
              key={b.id}
              href={`/cost/leaks?branch=${b.id}&from=${iso(from)}&to=${iso(to)}`}
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

      <LeakTable
        rows={rows.map((r) => ({
          productId: r.productId,
          productName: r.productName,
          expectedQty: r.expectedQty.toString(),
          countedQty: r.countedQty.toString(),
          varianceQty: r.varianceQty.toString(),
          varianceValue: r.varianceValue.toFixed(2),
          countLines: r.countLines,
          usage: r.usage.map((u) => ({
            name:
              u.departmentId === null
                ? "ไม่ระบุแผนก"
                : nameOf.get(u.departmentId) ?? u.departmentId,
            percent: Math.round(u.share * 100),
          })),
        }))}
      />
    </div>
  );
}

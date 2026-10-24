// GET /api/expenses?what=drill&q={m,branch,section,group,supplier} — the reads
// behind วิเคราะห์รายจ่าย's donut popups (Kong 2026-10-24, duplication review
// B4: drill down in a popup instead of filter rows). One read per level; the
// same requireTenant("expense:view") gate and reach as the page, and the month
// and branch are re-validated here rather than trusted from the client.

import { z } from "zod";
import { guardRead, readInput } from "@/lib/read-api";
import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getExpenseAnalysisLogic } from "@/server/expense-analysis";
import { recentMonths } from "@/app/(app)/dashboard/_components/dashboard-period";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const inputSchema = z.object({
  m: z.string().regex(/^\d{4}-\d{2}$/),
  branch: z.string().uuid().optional(),
  section: z.string().max(120).optional(),
  group: z.string().max(120).optional(),
  supplier: z.string().max(64).optional(),
});

export function GET(req: Request) {
  return guardRead(() => read(req));
}

async function read(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parsed = inputSchema.safeParse(readInput(url));
  if (url.searchParams.get("what") !== "drill" || !parsed.success) return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
  const { tenantId, reach } = await requireTenant("expense:view");
  const q = parsed.data;
  const month = recentMonths(12).find((m) => m.key === q.m);
  if (!month) return json({ ok: false, formError: "เดือนไม่ถูกต้อง" }, 400);
  const branches = await getBranchesLogic(tenantId, reach);
  const branchId = q.branch && branches.some((b) => b.id === q.branch) ? q.branch : undefined;
  const a = await getExpenseAnalysisLogic(
    tenantId,
    { from: month.from, to: month.to, branchId, section: q.section, group: q.group, supplier: q.supplier },
    reach
  );
  const n = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
  return json({
    ok: true,
    total: n(a.total),
    billCount: a.billCount,
    bySection: a.bySection.map((r) => ({ key: r.key, label: r.label, amount: n(r.amount) })),
    byGroup: a.byGroup.map((r) => ({ key: r.key, label: r.label, amount: n(r.amount) })),
    bySupplier: a.bySupplier.map((r) => ({ key: r.key, label: r.label, amount: n(r.amount) })),
    products: a.products.map((p) => ({ productId: p.productId, name: p.name, unitName: p.unitName, qty: n(p.qty), amount: n(p.amount), avgPrice: n(p.avgPrice) })),
    bills: a.bills.slice(0, 60).map((b) => ({
      expenseId: b.expenseId,
      billDate: b.billDate.toISOString().slice(0, 10),
      billNo: b.billNo,
      supplierName: b.supplierName,
      branchName: b.branchName,
      amount: n(b.amount),
      lines: b.lines.length,
    })),
    billsMore: Math.max(0, a.bills.length - 60),
  });
}

// GET /api/cost — cost reads after paint (mise-ui-review §5c), all behind cost:view:
//   what=deptTrend&branch=&view=month|week  ต้นทุนตามแผนก's trend (question 3); the
//     buckets are the server's own, never the client's
//   what=productCost&q={productId,branchId} the cost a gain would take (adjust form)
//   what=declarations&q="movementId"        one movement's cost declarations
// The last two were Server Actions.

import { guardRead, readInput } from "@/lib/read-api";
import { getProductCostQuerySchema } from "@/lib/validations/stock-cost";
import { getProductCostLogic } from "@/server/stock-cost";
import { getCostDeclarationsLogic } from "@/server/cost-declaration";
import { toCostDeclarationView, toProductCostView } from "@/app/(app)/cost/_components/cost-view";
import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { monthRanges, weekRanges } from "@/server/cost-overview";
import { getDepartmentTrendLogic } from "@/server/department-overview";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    const what = url.searchParams.get("what");
    if (what === "productCost") {
      const { tenantId, assertBranch } = await requireTenant("cost:view");
      const parsed = getProductCostQuerySchema.safeParse(readInput(url));
      if (!parsed.success) return json({ ok: false, formError: "เงื่อนไขการค้นหาไม่ถูกต้อง" });
      assertBranch(parsed.data.branchId);
      return json({ ok: true, data: toProductCostView(await getProductCostLogic(tenantId, parsed.data)) });
    }
    if (what === "declarations") {
      const { tenantId } = await requireTenant("cost:view");
      const id = String(readInput(url) ?? "");
      if (!UUID.test(id)) return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
      return json({ ok: true, data: (await getCostDeclarationsLogic(tenantId, id)).map(toCostDeclarationView) });
    }
    const branchId = url.searchParams.get("branch") ?? "";
    const view = url.searchParams.get("view") === "week" ? "week" : "month";
    if (what !== "deptTrend" || !UUID.test(branchId)) return json({ ok: false, error: "คำขอไม่ถูกต้อง" }, 400);
    const { tenantId, assertBranch } = await requireTenant("cost:view");
    assertBranch(branchId);
    const today = computeBangkokToday();
    const buckets = view === "week" ? weekRanges(today, 12) : monthRanges(today, 6);
    const trend = await getDepartmentTrendLogic(tenantId, branchId, buckets);
    return json({ ok: true, trend });
  });
}

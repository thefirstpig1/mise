// GET /api/cost?what=deptTrend&branch=&view=month|week — ต้นทุนตามแผนก's trend
// (question 3), read after the page paints (mise-ui-review §5c). Same gate and
// branch check as the page; the buckets are the server's own, never the client's.

import { guardRead } from "@/lib/read-api";
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
    const branchId = url.searchParams.get("branch") ?? "";
    const view = url.searchParams.get("view") === "week" ? "week" : "month";
    if (url.searchParams.get("what") !== "deptTrend" || !UUID.test(branchId)) return json({ ok: false, error: "คำขอไม่ถูกต้อง" }, 400);
    const { tenantId, assertBranch } = await requireTenant("cost:view");
    assertBranch(branchId);
    const today = computeBangkokToday();
    const buckets = view === "week" ? weekRanges(today, 12) : monthRanges(today, 6);
    const trend = await getDepartmentTrendLogic(tenantId, branchId, buckets);
    return json({ ok: true, trend });
  });
}

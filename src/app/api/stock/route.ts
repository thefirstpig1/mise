// ============================================================
// Mise — stock reads, as GET (mise-ui-review §5c)
// ============================================================
// what=balance&q={productId,branchId}   the adjust form's "คงเหลือตอนนี้"
// what=history&q={…filters, cursor}     "โหลดเพิ่ม" on the movement history
// These were getStockBalanceAction / getStockMovementHistoryAction. Same
// gates: membership, a named branch asserted against reach (rule A5), and a
// history with no branch narrowed inside the read (ADR 0029 Q5).
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead, readInput } from "@/lib/read-api";
import { getStockBalanceQuerySchema, getStockMovementHistoryQuerySchema } from "@/lib/validations/stock-movement";
import { getStockBalanceLogic, getStockMovementHistoryLogic } from "@/server/stock-movement";
import { toStockBalanceView, toStockMovementView } from "@/app/(app)/stock/_components/stock-view";

export const dynamic = "force-dynamic";

const BAD_QUERY_MESSAGE = "เงื่อนไขการค้นหาไม่ถูกต้อง";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    const what = url.searchParams.get("what");
    const { tenantId, reach, assertBranch } = await requireTenant("any:member");

    if (what === "balance") {
      const parsed = getStockBalanceQuerySchema.safeParse(readInput(url));
      if (!parsed.success) return json({ ok: false, formError: BAD_QUERY_MESSAGE });
      assertBranch(parsed.data.branchId);
      return json({ ok: true, data: toStockBalanceView(await getStockBalanceLogic(tenantId, parsed.data)) });
    }

    if (what === "history") {
      const parsed = getStockMovementHistoryQuerySchema.safeParse(readInput(url));
      if (!parsed.success) return json({ ok: false, formError: BAD_QUERY_MESSAGE });
      // Naming a branch is checked; naming none is narrowed inside the read.
      if (parsed.data.branchId) assertBranch(parsed.data.branchId);
      const page = await getStockMovementHistoryLogic(tenantId, parsed.data, reach);
      return json({ ok: true, data: { rows: page.rows.map(toStockMovementView), nextCursor: page.nextCursor } });
    }

    return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
  });
}

// GET /api/sales — the /sales page's background reads (the profit view, one
// dish's insight, A-against-B), moved off Server Actions on 2026-10-04
// (mise-ui-review §5c). Each function validates its own input and calls
// requireTenant itself, exactly as it did as an action.

import { guardRead, readInput } from "@/lib/read-api";
import { readMenuInsight, readSalesCompare, readSalesProfitView } from "@/app/(app)/sales/insight-reads";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const bad = () => json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);

export function GET(req: Request) {
  return guardRead(() => read(req));
}

async function read(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const what = url.searchParams.get("what");
  const input = readInput(url);
  if (input === null || typeof input !== "object") return bad();

  if (what === "profit") return json(await readSalesProfitView(input as Parameters<typeof readSalesProfitView>[0]));
  if (what === "insight") return json(await readMenuInsight(input as Parameters<typeof readMenuInsight>[0]));
  if (what === "compare") return json(await readSalesCompare(input as Parameters<typeof readSalesCompare>[0]));
  return bad();
}

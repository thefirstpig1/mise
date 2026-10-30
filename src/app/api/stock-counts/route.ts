// ============================================================
// Mise — นับสต๊อก's read, as GET (mise-ui-review §5c)
// ============================================================
// what=sheet&q="countId"  the sheet every open device polls (ADR 0034 Q7)
// what=prepped&q="countId" ADR 0040 Q2: for each prepped line counted ABOVE the
//                          ledger, the main ingredients the excess would have
//                          used and what should be left of each
// what=opening&q="countId" rule PG4: an open OPENING count's lines that will
//                          enter stock, with the price the close sheet fills
//                          in. Prices are cost — cost:view only (rule A1);
//                          anyone else gets null and the sheet shows none.
// what=unpriced&q="countId" rule PG6: a CLOSED opening count's gains still
//                          without a price, each with its first later
//                          receipt's price. cost:view only, as above.
// This was getCountSheetAction, handed to the sheet as a prop. A poll through
// the Server Action queue waits behind — and holds up — the counter's own
// saves on the same device; a GET runs beside them.
// Gate: count:write, and the count's branch within reach (rule A5).
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead, readInput } from "@/lib/read-api";
import { getOpeningPricesLogic, getStockCountByIdLogic, getUnpricedOpeningLogic } from "@/server/stock-count";
import { getCountPreppedHintsLogic } from "@/server/production-read";
import { toStockCountDetailView } from "@/app/(app)/stock-counts/_components/stock-count-view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    const id = String(readInput(url) ?? "");
    const what = url.searchParams.get("what");
    if ((what !== "sheet" && what !== "prepped" && what !== "opening" && what !== "unpriced") || !UUID.test(id)) return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
    const { tenantId, assertBranch, can } = await requireTenant("count:write");
    const count = await getStockCountByIdLogic(tenantId, id);
    if (!count) return json(what === "sheet" ? { ok: true, detail: null } : what === "opening" || what === "unpriced" ? { ok: true, lines: null } : { ok: true, hints: [] });
    assertBranch(count.branchId);
    if (what === "prepped") return json({ ok: true, hints: await getCountPreppedHintsLogic(tenantId, id) });
    if (what === "opening") return json({ ok: true, lines: can("cost:view") ? await getOpeningPricesLogic(tenantId, id) : null });
    if (what === "unpriced") return json({ ok: true, lines: can("cost:view") ? await getUnpricedOpeningLogic(tenantId, id) : null });
    return json({ ok: true, detail: toStockCountDetailView(count) });
  });
}

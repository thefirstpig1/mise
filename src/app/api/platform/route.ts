// ADR 0043 — the platform screens' reads, as GET (mise-ui-review §5c).
// what=shop&id=<tenantId>   who is in one shop, and its branches
// what=accuracy             every shop's latest deduction-vs-count figure (Kong 2026-10-31)
// Not an admin → 404, like the pages.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { guardRead } from "@/lib/read-api";
import { getShopDetailLogic, listShopAccuracyLogic } from "@/server/platform";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const actor = await requirePlatformAdmin();
    const url = new URL(req.url);
    if (url.searchParams.get("what") === "accuracy") return json({ ok: true, shops: await listShopAccuracyLogic(actor) });
    if (url.searchParams.get("what") !== "shop") return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
    const id = url.searchParams.get("id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
    const shop = await getShopDetailLogic(actor, id);
    return shop ? json({ ok: true, shop }) : json({ ok: false, formError: "ไม่พบร้านนี้" }, 404);
  });
}

// ADR 0045 part B — the whole shop as one Excel file, for a shop that asked
// for its data back (terms §10). GET ?id=<tenantId>. Not an admin → 404.
// Every dataset the shop's own Excel buttons give, all branches, with money.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { guardRead } from "@/lib/read-api";
import { exportShopWorkbookLogic } from "@/server/platform";
import { computeBangkokToday } from "@/lib/bangkok-date";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return guardRead(async () => {
    const actor = await requirePlatformAdmin();
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("คำขอไม่ถูกต้อง", { status: 400 });
    const out = await exportShopWorkbookLogic(actor, id);
    if (!out) return new Response("ไม่พบร้านนี้", { status: 404 });
    const day = computeBangkokToday().toISOString().slice(0, 10);
    const thai = `คิดครัว-ข้อมูลทั้งร้าน-${out.name}-${Number(day.slice(0, 4)) + 543}${day.slice(4)}.xlsx`;
    return new Response(out.stream, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="kitkrua-shop-${day}.xlsx"; filename*=UTF-8''${encodeURIComponent(thai)}`,
        "Cache-Control": "no-store",
      },
    });
  });
}

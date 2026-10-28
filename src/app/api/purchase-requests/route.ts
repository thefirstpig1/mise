// ============================================================
// Mise — ใบขอซื้อ's reads, as GET (mise-ui-review §5c)
// ============================================================
// what=messages&q={"lineId"}  one request line's conversation
// This was getRequestMessagesAction. Same gate: purchase:request, and the
// line's branch asserted against the reader's reach (rule A5).
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead, readInput } from "@/lib/read-api";
import { lineIdSchema } from "@/lib/validations/purchase-request";
import { getRequestLineBranchLogic, getRequestMessagesLogic, RequestLineNotFoundError } from "@/server/purchase-request";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    if (url.searchParams.get("what") !== "messages") return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
    const t = await requireTenant("purchase:request");
    const parsed = lineIdSchema.safeParse(readInput(url));
    if (!parsed.success) return json({ ok: false, formError: "รายการไม่ถูกต้อง" });
    try {
      t.assertBranch(await getRequestLineBranchLogic(t.tenantId, parsed.data.lineId));
      return json({ ok: true, messages: await getRequestMessagesLogic(t.tenantId, parsed.data.lineId) });
    } catch (e) {
      if (e instanceof RequestLineNotFoundError) return json({ ok: false, formError: "ไม่พบรายการนี้ — อาจถูกลบไปแล้ว กรุณารีเฟรชหน้า" });
      throw e;
    }
  });
}

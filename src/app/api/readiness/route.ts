// ============================================================
// คิดครัว — what the shop has entered so far, for "นี่คืออะไร" (queue item 10)
// ============================================================
// Read when the window opens, never on first paint (mise-ui-review §5c).
// Counts only — no money — so any member may read it; a branch outside the
// reader's reach is refused, not narrowed silently.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead } from "@/lib/read-api";
import { dataReadinessLogic } from "@/server/data-readiness";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function GET(req: Request) {
  return guardRead(async () => {
    const branch = new URL(req.url).searchParams.get("branch") || undefined;
    if (branch !== undefined && !UUID.test(branch)) {
      return Response.json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const { tenantId, reach, assertBranch } = await requireTenant("any:member");
    if (branch) assertBranch(branch);
    const readiness = await dataReadinessLogic(tenantId, reach, branch);
    return Response.json({ ok: true, readiness }, { headers: { "Cache-Control": "no-store" } });
  });
}

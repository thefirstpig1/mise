// ============================================================
// Mise — the sidebar's notification badges, as GET (mise-ui-review §5c)
// ============================================================
// Read after the page paints, so a badge never holds up a page. Everyone in
// the shop sees them (Kong 2026-10-21: "ขึ้นทุกคน") — counts only, no money.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead } from "@/lib/read-api";
import { getParAlertCountsLogic } from "@/server/menu-manager";
import { unseenReplyCountLogic } from "@/server/problem-report";

export const dynamic = "force-dynamic";

export function GET() {
  return guardRead(async () => {
    const { tenantId, reach, user } = await requireTenant("any:member");
    const [products, reportReplies] = await Promise.all([getParAlertCountsLogic(tenantId, reach), unseenReplyCountLogic(tenantId, user.id!)]);
    // ADR 0044: answers to this person's own problem reports they have not opened yet.
    return Response.json({ ok: true, badges: { "/products": products }, reportReplies }, { headers: { "Cache-Control": "no-store" } });
  });
}

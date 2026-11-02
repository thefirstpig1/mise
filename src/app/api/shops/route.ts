// ============================================================
// Mise — the shops this person belongs to, for the switcher (Kong 2026-11-02)
// ============================================================
// Read when the switcher opens, never on page load: most people belong to one
// shop and would pay for a list they never see. The list is this session's own
// memberships (rule A9) — the same read the เลือกร้าน page makes.
// ============================================================

import { requireTenant, listActiveMembershipsForUser } from "@/lib/require-tenant";
import { guardRead } from "@/lib/read-api";
import { ROLE_LABELS_TH } from "@/lib/validations/membership";
import type { Role } from "@/lib/permissions/service";

export const dynamic = "force-dynamic";

export type ShopChoice = { id: string; name: string; role: string; reach: string; current: boolean };

export function GET() {
  return guardRead(async () => {
    const { user, tenantId } = await requireTenant("any:member");
    const rows = await listActiveMembershipsForUser(user.id!);
    const shops: ShopChoice[] = rows.map((m) => {
      const branches = m.branchAccess.filter((a) => a.branch.deletedAt === null).map((a) => a.branch.name);
      return {
        id: m.tenantId,
        name: m.tenant.name,
        role: ROLE_LABELS_TH[m.role as Role] ?? m.role,
        reach: m.allBranches ? "ทุกสาขา" : branches.length ? branches.join(" · ") : "ยังไม่ได้กำหนดสาขา",
        current: m.tenantId === tenantId,
      };
    });
    // The shop in use first, then A→Z in Thai order — a list of twelve is searched by name.
    shops.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name, "th"));
    return Response.json({ ok: true, shops }, { headers: { "Cache-Control": "no-store" } });
  });
}

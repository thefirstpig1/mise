// /menus/merges — two rows, one dish (ADR 0026), redesigned 2026-10-28
// (Kong: "จัดมา" · mockup ULB2J5KLXq6nj8ujyv2emK).
//
// Server Component. It loads every menu once with the facts a merge decision
// needs (branch, POS code, recent sales, recipe) and the suggested groups, and
// the client does the rest — search, the popup, the tabs — without a reload.
// `?menu=<id>` opens the popup on one menu (the link from a menu's sheet);
// `?revoked=true` shows revoked merges too.
//
// **THIS SCREEN NEVER FOLDS** (ADR 0026 Q6). Every row is shown as the row it
// is, with its own sales — the row somebody comes here to un-merge is exactly
// the one a fold would hide.

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getMenuMergesLogic } from "@/server/menu-merge-read";
import { getMergeOverviewLogic } from "@/server/menu-merge-suggest";
import MergeScreen, { type MergeRowView } from "./_components/MergeScreen";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const thDate = (d: Date) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

export default async function MenuMergesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireTenant("master:write");
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);
  const openMenuId = UUID.test(one("menu") ?? "") ? (one("menu") as string) : null;
  const includeRevoked = one("revoked") === "true";

  const [overview, merges] = await Promise.all([
    getMergeOverviewLogic(tenantId),
    getMenuMergesLogic(tenantId, { winningMenuId: undefined, includeRevoked }),
  ]);

  const rows: MergeRowView[] = merges.map((m) => ({
    id: m.id,
    winningMenuId: m.winningMenuId,
    losingMenuId: m.losingMenuId,
    effectiveFrom: thDate(m.effectiveFrom),
    revokedAt: m.revokedAt ? thDate(m.revokedAt) : null,
    // A revoked merge may point at a menu deleted since; carry the names so the
    // history still reads.
    winnerName: m.winningMenu.name,
    winnerBranch: m.winningMenu.posIntegration?.branch.name ?? null,
    loserName: m.losingMenu.name,
    loserBranch: m.losingMenu.posIntegration?.branch.name ?? null,
    loserCode: m.losingMenu.posMenuId,
  }));

  return (
    <MergeScreen
      menus={overview.menus}
      suggestions={overview.suggestions}
      salesWindow={
        overview.salesWindow
          ? { from: thDate(new Date(`${overview.salesWindow.from}T00:00:00Z`)), to: thDate(new Date(`${overview.salesWindow.to}T00:00:00Z`)) }
          : null
      }
      merges={rows}
      includeRevoked={includeRevoked}
      openMenuId={openMenuId}
      todayIso={computeBangkokToday().toISOString().slice(0, 10)}
    />
  );
}

// ADR 0043 Q3 — every shop, its package and the day it stops being free.
// Kong 2026-10-30: the sales work is his, so is deciding who gets how long free.
// Moved from /platform when ภาพรวม took the front (ADR 0045 Q1); `?q=` opens it
// filtered, which is how the overview's lists and to-do items link here.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { listClosedShopsLogic, listShopsLogic } from "@/server/platform";
import ShopsTable from "../_components/ShopsTable";
import ClosedShops from "../_components/ClosedShops";

export default async function PlatformShopsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requirePlatformAdmin();
  const [{ q }, shops, closed] = await Promise.all([searchParams, listShopsLogic(actor), listClosedShopsLogic(actor)]);
  return (
    <div className="space-y-8">
      <ShopsTable shops={shops} today={computeBangkokToday().toISOString().slice(0, 10)} initialQuery={q ?? ""} />
      <ClosedShops shops={closed} />
    </div>
  );
}

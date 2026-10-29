// ADR 0043 Q3 — every shop, its package and the day it stops being free.
// Kong 2026-10-30: the sales work is his, so is deciding who gets how long free.

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { listShopsLogic } from "@/server/platform";
import ShopsTable from "./_components/ShopsTable";

export default async function PlatformShopsPage() {
  const actor = await requirePlatformAdmin();
  const shops = await listShopsLogic(actor);
  return <ShopsTable shops={shops} today={computeBangkokToday().toISOString().slice(0, 10)} />;
}

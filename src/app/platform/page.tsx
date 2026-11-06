// ADR 0045 Q1 — the control page opens on what Kong has to do, then the
// figures he asked for (Kong 2026-11-04: "ขอหน้าข้อมูลสรุปเกี่ยวกับ user กี่บัญชี
// เป็นเจ้าของกี่คน pos อะไรบ้าง พนักงานตำแหน่งไหนเท่าไหร่").

import { requirePlatformAdmin } from "@/lib/platform-admin";
import { ROLE_LABELS_TH } from "@/lib/validations/membership";
import { getPlatformOverviewLogic } from "@/server/platform";
import OverviewView from "./_components/OverviewView";

export default async function PlatformOverviewPage() {
  const actor = await requirePlatformAdmin();
  const { overview, todos } = await getPlatformOverviewLogic(actor);
  return <OverviewView overview={overview} todos={todos} roleLabels={ROLE_LABELS_TH} />;
}

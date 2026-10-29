// ADR 0037 Q5 — "ค้างคืนพนักงาน" (mockup L7p9q52ENkn1cwKUPYCwSm, the desktop frame).
// The accountant's questions, in order: how much do we owe whom, is the proof
// there, and — pay one person back for several bills with one slip.
//
// Server Component: staff claims within reach, open ones plus what was repaid
// in the last 60 days. Cheap reads; nothing here replays FIFO.

import { requireTenant } from "@/lib/require-tenant";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getClaimsBoardLogic } from "@/server/staff-advance";
import AdvancesBoard from "./_components/AdvancesBoard";

export default async function AdvancesPage() {
  const { tenantId, user, reach, can } = await requireTenant("refund:pay");
  const today = computeBangkokToday();
  const claims = await getClaimsBoardLogic(tenantId, reach, { refundedSince: addDays(today, -60) });
  const ymd = today.toISOString().slice(0, 10);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    return d.toISOString().slice(0, 7);
  });
  return <AdvancesBoard claims={claims} today={ymd} months={months} meId={user.id!} canApprove={can("purchase:approve")} />;
}

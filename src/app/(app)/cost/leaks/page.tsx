// ของหายไปไหน — question-first (Kong 2026-10-24, mockup
// https://claude.ai/artifact/3Agisejn3ERh1AXMZgkphj). One closed count at a
// time; see src/server/leak-overview.ts for every figure. The read (~3 s, one
// FIFO replay) is started here and streamed, so the frame paints at once.
//
// `searchParams` is a PROMISE in Next 15.

import { Suspense } from "react";
import { requireTenant } from "@/lib/require-tenant";
import { getLeakOverviewLogic } from "@/server/leak-overview";
import LeakOverview, { LeakOverviewSkeleton } from "./_components/LeakOverview";

export default async function LeakPage({ searchParams }: { searchParams: Promise<{ count?: string }> }) {
  const { tenantId, reach, membership } = await requireTenant("cost:view");
  // Kong 2026-10-30: under นับสต๊อก no sale takes stock out, so EVERY count finds
  // the month's usage short of the ledger. This page tells loss from usage only
  // when sales deduct stock — anything else would paint the whole shop red.
  if (membership.tenant.grossProfitMethod === "PERIODIC_INVENTORY") {
    return (
      <div className="max-w-2xl space-y-3 rounded-[18px] border border-border/70 bg-surface shadow-card p-6 text-sm">
        <h2 className="font-display text-lg font-semibold">ร้านนี้คิดกำไรแบบนับสต๊อก หน้านี้จึงยังบอกไม่ได้ว่าของหายไปไหน</h2>
        <p className="text-muted-foreground">
          วิธีนับสต๊อก ยอดขายไม่ตัดสต๊อก ทุกครั้งที่นับ ส่วนที่นับได้น้อยกว่าระบบจึงคือของที่ใช้ไปทั้งช่วง — ขายและขาดรวมกัน แยกกันไม่ได้ ระบบเรียกตัวเลขนี้ว่า “ใช้ไปตามการนับ” และใช้เป็นต้นทุนขายของเดือน
        </p>
        <p className="text-muted-foreground">
          ถ้าอยากรู้ว่าของหายจริงเท่าไรและหายที่ไหน ร้านต้องคิดกำไรแบบสูตรอาหาร (เขียนสูตรเมนูแล้วระบบตัดสต๊อกตามยอดขาย) จึงจะเทียบได้ว่าที่นับได้ต่างจากที่ควรเหลือเท่าไร
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href="/cost" className="btn">
            ดูต้นทุนที่หน้าต้นทุน
          </a>
          <a href="/settings" className="btn-secondary">
            วิธีคิดกำไรในตั้งค่าร้าน
          </a>
        </div>
      </div>
    );
  }
  const { count } = await searchParams;
  const overview = getLeakOverviewLogic(tenantId, reach).catch((e) => {
    console.error("[leaks] overview failed", e);
    return null;
  });
  return (
    <Suspense fallback={<LeakOverviewSkeleton />}>
      <LeakOverview overview={overview} initialCountId={count ?? null} />
    </Suspense>
  );
}

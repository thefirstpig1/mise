// ============================================================
// Mise — ตัดสต็อกตามยอดขาย (Part 22 L5, ADR 0022)
// ============================================================
// The queue and the coverage report, which are one table (L4a's read).
//
// One branch at a time, chosen in the URL. Posting is per branch by definition —
// a run IS a branch × a day — and a screen that mixed two branches' days would
// make the button ambiguous about which branch it was about to consume.
// ============================================================

import { Suspense } from "react";
import PageFrame from "@/components/layout/PageFrame";
import { requireTenant } from "@/lib/require-tenant";
import { branchScopeWhere } from "@/lib/permissions/service";
import { withTenantContext } from "@/lib/db";
import { liveliestBranchId } from "@/server/branch";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getConsumptionDayStatusLogic } from "@/server/consumption-read";
import { toConsumptionDayView } from "@/app/(app)/consumption/_components/consumption-view";
import { ConsumptionDayTable } from "@/app/(app)/consumption/_components/ConsumptionDayTable";
import FilterLink from "@/components/ui/FilterLink";
import PageHeader from "@/components/ui/PageHeader";
import { getDeductionAccuracyLogic } from "@/server/deduction-accuracy";
import AccuracyPanel, { AccuracySkeleton } from "@/app/(app)/consumption/_components/AccuracyPanel";

/** The window a shop actually works in: this month and the one before it. */
const DEFAULT_DAYS_BACK = 60;

export default async function ConsumptionPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; from?: string; to?: string; count?: string }>;
}) {
  const { tenantId, reach, costAccess } = await requireTenant("consumption:post");
  const params = await searchParams;

  const branches = await withTenantContext(tenantId, (tx) =>
    tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
  );

  const today = computeBangkokToday();
  const branchId =
    branches.find((b) => b.id === params.branch)?.id ?? (await liveliestBranchId(tenantId, branches.map((b) => b.id)));

  // A bad date in the URL falls back and says so, rather than erroring — the
  // same fallback-plus-notice /cost uses.
  const parsed = (v: string | undefined): Date | null => {
    if (!v) return null;
    const d = new Date(`${v}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const to = parsed(params.to) ?? today;
  const from = parsed(params.from) ?? addDays(to, -DEFAULT_DAYS_BACK);

  const days =
    branchId === undefined
      ? []
      : (await getConsumptionDayStatusLogic(tenantId, { branchId, from, to })).map(
          toConsumptionDayView
        );

  // Kong 2026-10-31: did the recipes match the shelf? Streamed — one FIFO
  // replay — so the day table paints first.
  const accuracy =
    branchId === undefined
      ? null
      : getDeductionAccuracyLogic(tenantId, { branchId, withMoney: costAccess !== null }).catch((e) => {
          console.error("[consumption] accuracy failed", e);
          return null;
        });

  return (
    <PageFrame title="ขายและเมนู">
      <div className="space-y-6">
        <PageHeader
        help="consumption"
          title="ตัดสต็อกตามยอดขาย"
          description={
            <>
              ระบบตัดสต็อกให้เองทุกครั้งที่นำเข้ายอดขาย ตาม<strong>สูตรที่มีผลในวันนั้นจริง</strong> · หน้านี้ใช้<strong>ตัดใหม่</strong>หลังเขียนหรือแก้สูตร
              และตัดวันที่ยังไม่ได้ตัด
            </>
          }
          actions={
            branches.length > 1 ? (
              <div data-help="consumption-branch" className="seg">
                {branches.map((b) => (
                  <FilterLink
                    key={b.id}
                    href={`/consumption?branch=${b.id}&from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`}
                    className={`seg-item ${b.id === branchId ? "is-on" : ""}`}
                  >
                    {b.name}
                  </FilterLink>
                ))}
              </div>
            ) : undefined
          }
        />

        {/* Queue item 9: the two yellow boxes live inside the day table now,
            each with the press for its own days, and the accuracy report sits
            between that box and the table. */}
        {branchId === undefined ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีสาขาในระบบ</p>
        ) : (
          <ConsumptionDayTable days={days} branchId={branchId}>
            {accuracy && (
              <Suspense fallback={<AccuracySkeleton />}>
                <AccuracyPanel key={branchId} overview={accuracy} branchName={branches.find((b) => b.id === branchId)?.name ?? ""} initialKey={params.count ?? null} />
              </Suspense>
            )}
          </ConsumptionDayTable>
        )}

        {/* Kong 2026-10-31 ("จัดมาตามนั้น"): the old note said prepped goods had
            no stock of their own "until production is recorded" — ADR 0040
            built that. What posting does now (rule PF1–PF3): */}
        <p className="text-xs text-muted-foreground">
          ของแปรรูปที่มีอยู่บนชั้น ระบบตัดตัวของแปรรูปก่อน ถ้าไม่พอจึงตัดวัตถุดิบตามสูตรการทำแทน ·{" "}
          <a href="/production" className="link">
            บันทึกการผลิต
          </a>
        </p>
      </div>
    </PageFrame>
  );
}

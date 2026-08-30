// ============================================================
// Mise — ตัดสต๊อกตามยอดขาย (Part 22 L5, ADR 0022)
// ============================================================
// The queue and the coverage report, which are one table (L4a's read).
//
// One branch at a time, chosen in the URL. Posting is per branch by definition —
// a run IS a branch × a day — and a screen that mixed two branches' days would
// make the button ambiguous about which branch it was about to consume.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getConsumptionDayStatusLogic } from "@/server/consumption-read";
import { toConsumptionDayView } from "@/app/consumption/_components/consumption-view";
import { ConsumptionDayTable } from "@/app/consumption/_components/ConsumptionDayTable";

/** The window a shop actually works in: this month and the one before it. */
const DEFAULT_DAYS_BACK = 60;

export default async function ConsumptionPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; from?: string; to?: string }>;
}) {
  const { tenantId } = await requireTenant("consumption:post");
  const params = await searchParams;

  const branches = await withTenantContext(tenantId, (tx) =>
    tx.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
  );

  const today = computeBangkokToday();
  const branchId =
    branches.find((b) => b.id === params.branch)?.id ?? branches[0]?.id;

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

  const unposted = days.filter((d) => d.state === "NOT_POSTED").length;
  const stale = days.filter((d) => d.state === "POSTED_STALE").length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-3">
          <a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            ← กลับ
          </a>
          <h1 className="mt-1 text-lg font-bold">ตัดสต๊อกตามยอดขาย</h1>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-6 px-4 py-6">
        <p className="text-sm text-muted-foreground">
          ยอดขายที่นำเข้ามาแล้วยังไม่ทำให้สต๊อกลดลง จนกว่าจะกดตัดที่นี่ ·
          ระบบจะระเบิดสูตรของทุกเมนูที่ขายในวันนั้น{" "}
          <strong>ตามสูตรที่มีผลในวันนั้นจริง</strong> แล้วตัดวัตถุดิบออกจากสต๊อกของสาขา
        </p>

        {branches.length > 1 && (
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              สาขา
              <select
                name="branch"
                defaultValue={branchId}
                className="mt-1 block rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <input type="hidden" name="from" value={from.toISOString().slice(0, 10)} />
            <input type="hidden" name="to" value={to.toISOString().slice(0, 10)} />
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              ดู
            </button>
          </form>
        )}

        {stale > 0 && (
          <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
            <p className="font-medium">
              {stale} วันถูกตัดไว้ก่อนที่สูตรจะเปลี่ยน
            </p>
            <p className="mt-1 text-xs">
              มีสูตรที่มีผลกับวันเหล่านั้นถูกเขียนหรือแก้หลังจากตัดไปแล้ว ·
              ระบบ<strong>ไม่ตัดใหม่ให้เอง</strong> เพราะจะเป็นการเขียนทับงวดที่ร้านอาจปิดบัญชีไปแล้ว —
              กดตัดใหม่เมื่อพร้อม
            </p>
          </div>
        )}

        {unposted > 0 && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            ยังมี {unposted} วันที่ยอดขายเข้ามาแล้วแต่ยังไม่ได้ตัดสต๊อก —
            ต้นทุนของวันเหล่านั้นยังไม่ถูกนับ กำไรขั้นต้นแบบสูตรอาหารจึงยังดูดีเกินจริง
          </p>
        )}

        {branchId === undefined ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีสาขาในระบบ</p>
        ) : (
          <ConsumptionDayTable days={days} branchId={branchId} />
        )}

        <p className="text-xs text-muted-foreground">
          ของแปรรูปยังไม่มีสต๊อกของตัวเอง — การขายจะระเบิดทะลุไปถึงวัตถุดิบดิบเสมอ
          และการนับของแปรรูปจะเจอ “ของเกิน” ทุกครั้ง จนกว่าจะมีระบบบันทึกการผลิต
        </p>
      </main>
    </div>
  );
}

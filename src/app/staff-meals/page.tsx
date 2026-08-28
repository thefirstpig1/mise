// Sprint 5 Part 26 L5 — /staff-meals: record what staff ate, and see what has been.
//
// Server Component. A route of its own rather than a corner of /waste, because a
// staff meal is deliberately NOT waste (CONTEXT.md, and WasteReason refuses
// STAFF_MEAL by name): it is a sale that collected no money, and putting it on
// the waste screen would put it back in the food-waste figure that ADR 0017 Q4
// spent a Part cleaning up.
//
// Filters live in the URL (`?branch=&member=&voided=&from=&to=`) so the view is
// linkable and `revalidatePath("/staff-meals")` from the L4 write path refreshes
// whatever the user is actually looking at.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature
// type-checks under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix).

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { prisma } from "@/lib/db";
import { getBranchesLogic } from "@/server/branch";
import { getProductsLogic } from "@/server/product";
import { getMenusLogic } from "@/server/menu";
import {
  getStaffMealQuotaLogic,
  getStaffMealsLogic,
  getStaffMembersLogic,
  getZeroPriceSalesWarningLogic,
} from "@/server/staff-meal-read";
import { STAFF_MEAL_PRICE_SOURCE_LABELS_TH } from "@/lib/validations/staff-meal";
import { createStaffMealAction, voidStaffMealAction } from "./actions";
import {
  toStaffMealQuotaView,
  toStaffMealRowView,
} from "./_components/staff-meal-view";
import StaffMealEntryForm from "./_components/StaffMealEntryForm";
import VoidStaffMealButton from "./_components/VoidStaffMealButton";

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

/**
 * The list defaults to THIS MONTH, not to all of history — the same call /waste
 * made. A staff meal log grows every single day, and the month is the period a
 * shop actually reviews.
 */
function currentMonthBangkok(): { from: string; to: string } {
  const today = computeBangkokToday();
  const first = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  );
  return {
    from: first.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

export default async function StaffMealsPage({
  searchParams,
}: {
  searchParams: Promise<{
    branch?: string;
    member?: string;
    voided?: string;
    from?: string;
    to?: string;
    day?: string;
  }>;
}) {
  const { tenantId } = await requireTenant();
  const sp = await searchParams;

  const todayIso = computeBangkokToday().toISOString().slice(0, 10);
  const month = currentMonthBangkok();
  const from = sp.from || month.from;
  const to = sp.to || month.to;

  const [branches, members, menus, products, tenant] = await Promise.all([
    getBranchesLogic(tenantId),
    // The PICKER wants people who still work here. The history below asks for
    // everybody, because dropping someone who left would move last month's
    // figure by pressing a button today (rule S7).
    getStaffMembersLogic(tenantId, { includeInactive: false }),
    getMenusLogic(tenantId, {
      stubsOnly: false,
      // A retired dish is not on offer, so it is not something staff can order
      // today. Backdating one is the rare case, and the search box on /menus is
      // where that conversation belongs.
      includeRetired: false,
    }),
    getProductsLogic(tenantId),
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { staffMealMaxMenuPrice: true, staffMealDailyQuota: true },
    }),
  ]);

  const defaultBranchId = sp.branch || branches[0]?.id || "";
  // The warning is about the day the FORM is set to, which defaults to today.
  const warningDay = sp.day || todayIso;

  const [history, warning] = await Promise.all([
    getStaffMealsLogic(tenantId, {
      branchId: sp.branch || undefined,
      staffMemberId: sp.member || undefined,
      from: new Date(`${from}T00:00:00Z`),
      to: new Date(`${to}T00:00:00Z`),
      includeVoided: sp.voided === "true",
    }),
    defaultBranchId
      ? getZeroPriceSalesWarningLogic(tenantId, {
          branchId: defaultBranchId,
          businessDate: new Date(`${warningDay}T00:00:00Z`),
        })
      : Promise.resolve({ totalLines: 0, tags: [] }),
  ]);

  // Today's quota standing for the person being filtered on, when there is one.
  const quota = sp.member
    ? toStaffMealQuotaView(
        await getStaffMealQuotaLogic(tenantId, {
          staffMemberId: sp.member,
          businessDate: new Date(`${todayIso}T00:00:00Z`),
        })
      )
    : null;

  const rows = history.rows.map((r) =>
    toStaffMealRowView(r, tenant.staffMealMaxMenuPrice)
  );

  return (
    <div className="space-y-6">
      <StaffMealEntryForm
        action={createStaffMealAction}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        menus={menus.map((m) => ({ id: m.id, name: m.name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          units: p.productUnits.map((u) => ({
            id: u.id,
            unitName: u.unitName,
            isBase: u.isBase,
          })),
        }))}
        todayBangkok={todayIso}
        defaultBranchId={defaultBranchId}
        maxMenuPrice={
          tenant.staffMealMaxMenuPrice === null
            ? null
            : tenant.staffMealMaxMenuPrice.toString()
        }
        zeroPriceTags={warning.tags.map((t) => ({
          discountReason: t.discountReason,
          lines: t.lines,
        }))}
      />

      {/* --- filters --- */}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-muted-foreground" htmlFor="f-branch">
            สาขา
          </label>
          <select id="f-branch" name="branch" defaultValue={sp.branch ?? ""} className={inputClass}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground" htmlFor="f-member">
            พนักงาน
          </label>
          <select id="f-member" name="member" defaultValue={sp.member ?? ""} className={inputClass}>
            <option value="">ทุกคน</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground" htmlFor="f-from">
            ตั้งแต่
          </label>
          <input id="f-from" name="from" type="date" defaultValue={from} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground" htmlFor="f-to">
            ถึง
          </label>
          <input id="f-to" name="to" type="date" defaultValue={to} className={inputClass} />
        </div>
        <label className="flex items-center gap-2 py-2 text-sm">
          <input type="checkbox" name="voided" value="true" defaultChecked={sp.voided === "true"} />
          แสดงรายการที่ยกเลิกแล้ว
        </label>
        <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
          กรอง
        </button>
        <a href="/staff-meals/people" className="py-2 text-sm underline">
          จัดการรายชื่อพนักงาน
        </a>
      </form>

      {/* --- the quota standing, when one person is in view --- */}
      {quota && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <p className="font-medium">
            โควตาวันนี้ของ {quota.staffMemberName}
          </p>
          {quota.quota === null ? (
            <p className="mt-1 text-muted-foreground">
              ร้านยังไม่ได้ตั้งโควตา — ใช้ไปวันนี้ ฿{quota.used}
            </p>
          ) : (
            <p className={`mt-1 ${quota.over ? "text-amber-700" : "text-muted-foreground"}`}>
              ใช้ไป ฿{quota.used} จาก ฿{quota.quota}
              {quota.quotaSource === "PERSON" ? " (โควตาเฉพาะคนนี้)" : " (โควตาของร้าน)"}
              {quota.over && " — เกินโควตา"}
            </p>
          )}
          {quota.unpricedCount > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              มีอีก {quota.unpricedCount} มื้อที่ยังไม่มีราคา ตัวเลขข้างบนจึงเป็น
              <strong>อย่างน้อย</strong> ไม่ใช่ยอดเต็ม
            </p>
          )}
        </div>
      )}

      {/* --- the list --- */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">รายการมื้อพนักงาน</h2>
          <p className="text-sm text-muted-foreground">
            รวมมูลค่าตามราคาขาย ฿{history.totalValue.toString()}
            {history.unpricedCount > 0 && (
              <> · อีก {history.unpricedCount} มื้อยังไม่มีราคา</>
            )}
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          ตัวเลขนี้คือ<strong>มูลค่าตามราคาขาย</strong> ใช้ดูว่าให้สวัสดิการไปเท่าไหร่ —
          ไม่ใช่ต้นทุน สต๊อกถูกตัดตามราคาวัตถุดิบจริงเสมอ
        </p>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            ยังไม่มีรายการในช่วงที่เลือก
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`rounded-xl border p-3 ${
                  r.voidedAt ? "border-dashed border-border opacity-60" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {r.menuName ?? "ทำกินเองจากของในร้าน"}
                    {r.servings !== "1" && ` × ${r.servings}`}
                  </p>
                  <p className="text-sm">
                    {r.value === null ? (
                      <span className="text-muted-foreground">ยังไม่มีราคา</span>
                    ) : (
                      <>฿{r.value}</>
                    )}
                  </p>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {r.businessDateLabel} · {r.branchName} ·{" "}
                  {r.staffMemberName ?? "กินกันหลายคน"}
                  {r.staffMemberRetired && (
                    <span className="ml-1 rounded bg-muted px-1">ลาออกแล้ว</span>
                  )}
                  {" · "}
                  ตัดวัตถุดิบ {r.itemCount} รายการ
                  {r.priceSource !== "NONE" && (
                    <> · {STAFF_MEAL_PRICE_SOURCE_LABELS_TH[r.priceSource]}</>
                  )}
                  {r.recordedByName && <> · บันทึกโดย {r.recordedByName}</>}
                </p>

                {r.overCeiling && (
                  <p className="mt-1 text-xs text-amber-700">
                    ราคาจานนี้เกินเพดานที่ร้านตั้งไว้ (เทียบกับเพดานที่ใช้อยู่ตอนนี้)
                  </p>
                )}

                {r.notes && <p className="mt-1 text-xs">{r.notes}</p>}

                {r.voidedAt ? (
                  <p className="mt-1 text-xs text-red-700">
                    ยกเลิกเมื่อ {r.voidedAtLabel}
                    {r.voidReason && ` — ${r.voidReason}`}
                  </p>
                ) : (
                  <VoidStaffMealButton
                    action={voidStaffMealAction}
                    staffMealId={r.id}
                    label={r.menuName ?? "มื้อนี้"}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {history.truncated && (
          <p className="text-xs text-muted-foreground">
            แสดงเฉพาะรายการล่าสุด — ลองแคบช่วงวันที่ลง
          </p>
        )}
      </section>
    </div>
  );
}

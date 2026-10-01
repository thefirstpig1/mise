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
import { withTenantContext } from "@/lib/db";
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
import {
  approveStaffMealAction,
  createStaffMealAction,
  getTicketBoardAction,
  rejectStaffMealAction,
  requestStaffMealAction,
  voidStaffMealAction,
} from "./actions";
import TicketBoard from "./_components/TicketBoard";
import {
  toStaffMealQuotaView,
  toStaffMealRowView,
} from "./_components/staff-meal-view";
import StaffMealEntryForm from "./_components/StaffMealEntryForm";
import VoidStaffMealButton from "./_components/VoidStaffMealButton";


import EmptyState from "@/components/ui/EmptyState";
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
  const { tenantId, reach, can } = await requireTenant("staffmeal:write");

  // Recording a meal and reading back how much ONE NAMED PERSON has eaten
  // are different questions, and only the first is kitchen work. The page
  // gate is `staffmeal:write`; the quota standing below is `staff:view`,
  // which is the whole reason that capability exists (ADR 0029 Q7 — the
  // roster picker on the form is part of recording, not of surveillance).
  const seesPeople = can("staff:view");
  const isApprover = can("staffmeal:approve");
  const canBackdate = can("settings:write");
  const sp = await searchParams;

  const todayIso = computeBangkokToday().toISOString().slice(0, 10);
  const month = currentMonthBangkok();
  const from = sp.from || month.from;
  const to = sp.to || month.to;

  // ONE wave of reads (2026-10-01, Kong: pages that were reviewed must not be
  // slow). This page used to read in three waves — lists, then history and the
  // warning, then the ticket board — and only the warning ever needed anything
  // from an earlier wave (which branch the form opens on), so it alone waits
  // for the branch list.
  const branchesP = getBranchesLogic(tenantId, reach);
  // The warning is about the day the FORM is set to, which defaults to today.
  const warningDay = sp.day || todayIso;
  const warningP = branchesP.then((bs) => {
    const branchId = sp.branch || bs[0]?.id || "";
    return branchId
      ? getZeroPriceSalesWarningLogic(tenantId, {
          branchId,
          businessDate: new Date(`${warningDay}T00:00:00Z`),
        })
      : { totalLines: 0, tags: [] };
  });

  const [branches, members, menus, products, tenant, history, warning, quotaRaw, board] = await Promise.all([
    branchesP,
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
    // Inside the tenant context like every tenant read: since Part 30 RLS is
    // enforced, and a bare `prisma` read here raised 22P02 on every visit.
    withTenantContext(tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { staffMealMaxMenuPrice: true, staffMealDailyQuota: true, staffMealStockSource: true },
      })
    ),
    getStaffMealsLogic(tenantId, {
      branchId: sp.branch || undefined,
      staffMemberId: sp.member || undefined,
      from: new Date(`${from}T00:00:00Z`),
      to: new Date(`${to}T00:00:00Z`),
      includeVoided: sp.voided === "true",
    }),
    warningP,
    // Today's quota standing for the person being filtered on, when there is one.
    // Not fetched at all without `staff:view` — this is the per-person aggregate,
    // the one read in this Part that is about a human rather than about stock.
    sp.member && seesPeople
      ? getStaffMealQuotaLogic(tenantId, {
          staffMemberId: sp.member,
          businessDate: new Date(`${todayIso}T00:00:00Z`),
        })
      : Promise.resolve(null),
    getTicketBoardAction(),
  ]);

  const defaultBranchId = sp.branch || branches[0]?.id || "";
  const quota = quotaRaw === null ? null : toStaffMealQuotaView(quotaRaw);

  const rows = history.rows.map((r) =>
    toStaffMealRowView(r, tenant.staffMealMaxMenuPrice)
  );

  const menuOptions = menus.map((m) => ({
    id: m.id,
    name: m.name,
    sku: m.posMenuId ?? "",
    imageUrl: null,
    section: m.menuCategory?.name ?? null,
    group: null,
    baseUnitName: null,
  }));

  return (
    <div className="space-y-6">
      <TicketBoard
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        defaultBranchId={defaultBranchId}
        menus={menuOptions}
        todayIso={todayIso}
        canBackdate={canBackdate}
        initial={board}
        request={requestStaffMealAction}
        approve={approveStaffMealAction}
        reject={rejectStaffMealAction}
        refresh={getTicketBoardAction}
      />

      <h2 className="pt-2 text-base font-semibold">
        {isApprover ? "บันทึกหม้อใหญ่ หรือบันทึกแทนพาร์ทไทม์" : "บันทึกหม้อใหญ่ (ทำกินเองจากของในร้าน)"}
      </h2>
      <StaffMealEntryForm
        action={createStaffMealAction}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        // On behalf only of people WITHOUT an account (ADR 0035 Q2).
        members={members.filter((m) => !m.hasAccount).map((m) => ({ id: m.id, name: m.name }))}
        menus={menuOptions}
        isApprover={isApprover}
        canBackdate={canBackdate}
        products={products.filter((p) => p.isActive).map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          imageUrl: p.imageUrl,
          section: p.category?.accountingSection ?? null,
          group: p.category?.groupName ?? null,
          baseUnitName: p.productUnits.find((u) => u.isBase)?.unitName ?? null,
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
        // Under POS the POS deducts by design; the double-deduction warning is moot.
        zeroPriceTags={(tenant.staffMealStockSource === "POS" ? [] : warning.tags).map((t) => ({
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
          <select id="f-branch" name="branch" defaultValue={sp.branch ?? ""} className="input">
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
          <select id="f-member" name="member" defaultValue={sp.member ?? ""} className="input">
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
          <input id="f-from" name="from" type="date" defaultValue={from} className="input" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground" htmlFor="f-to">
            ถึง
          </label>
          <input id="f-to" name="to" type="date" defaultValue={to} className="input" />
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
      {sp.member && !seesPeople && (
        // Said out loud rather than left blank: someone who filtered to a person
        // and got nothing would read it as "this person has eaten nothing"
        // (rule A8).
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">
          ไม่มีสิทธิ์ดูโควตารายคน
        </div>
      )}
      {quota && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <p className="font-medium">
            โควตาวันนี้ของ {quota.staffMemberName}
          </p>
          {quota.quota === null ? (
            <p className="mt-1 text-muted-foreground">
              ร้านยังไม่ได้ตั้งโควตา — ใช้ไปวันนี้ ฿{quota.used}
            </p>
          ) : (
            <p className={`mt-1 ${quota.over ? "text-warn" : "text-muted-foreground"}`}>
              ใช้ไป ฿{quota.used} จาก ฿{quota.quota}
              {quota.quotaSource === "PERSON" ? " (โควตาเฉพาะคนนี้)" : " (โควตาของร้าน)"}
              {quota.over && " — เกินโควตา"}
            </p>
          )}
          {quota.unpricedCount > 0 && (
            <p className="mt-1 text-xs text-warn">
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
          <EmptyState art="none">
            ยังไม่มีรายการในช่วงที่เลือก
          </EmptyState>
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
                  {r.ticketNo && <> · {r.ticketNo}</>}
                  {r.onBehalf ? (
                    <> · บันทึกแทนโดย {r.recordedByAccount}</>
                  ) : (
                    r.menuName && r.approvedByName && <> · อนุมัติโดย {r.approvedByName}</>
                  )}
                  {!r.onBehalf && !r.menuName && r.recordedByAccount && <> · บันทึกโดย {r.recordedByAccount}</>}
                  {r.recordedByName && <> ({r.recordedByName})</>}
                </p>

                {r.overCeiling && (
                  <p className="mt-1 text-xs text-warn">
                    ราคาจานนี้เกินเพดานที่ร้านตั้งไว้ (เทียบกับเพดานที่ใช้อยู่ตอนนี้)
                  </p>
                )}

                {r.notes && <p className="mt-1 text-xs">{r.notes}</p>}

                {r.voidedAt ? (
                  <p className="mt-1 text-xs text-bad">
                    ยกเลิกเมื่อ {r.voidedAtLabel}
                    {r.voidReason && ` — ${r.voidReason}`}
                  </p>
                ) : isApprover ? (
                  <VoidStaffMealButton
                    action={voidStaffMealAction}
                    staffMealId={r.id}
                    label={r.menuName ?? "มื้อนี้"}
                  />
                ) : null}
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

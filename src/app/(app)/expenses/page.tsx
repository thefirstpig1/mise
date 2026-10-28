// Sprint 3 Part 16 L5a — the list of bills, and what is still due.
//
// Server Component. Filters live in the URL so the view is linkable and the
// action layer's revalidatePath("/expenses") refreshes what the user is looking
// at — the rule /stock, /cost and /stock-counts already follow.
//
// `searchParams` is a PROMISE in Next 15: the plain-object signature type-checks
// under `pnpm tsc` and fails `pnpm build` (the Part 10 L5a discovery).

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getSuppliersLogic } from "@/server/supplier";
import { getDueRecurringLogic, getExpensesLogic } from "@/server/expense";
import {
  getExpensesQuerySchema,
  EXPENSE_PAYMENT_STATUS_LABELS_TH,
  EXPENSE_PAYMENT_STATUS_VALUES,
  EXPENSE_SOURCE_LABELS_TH,
  EXPENSE_SOURCE_VALUES,
} from "@/lib/validations/expense";
import {
  expenseTitle,
  toDueRecurringView,
  toExpenseListRowView,
} from "./_components/expense-view";
import { monthLabelTh } from "@/lib/expense-labels";
import SupplierFilter from "./_components/SupplierFilter";
import { formatMoney } from "@/app/(app)/cost/_components/cost-view";
import PaymentBadge from "./_components/PaymentBadge";

import EmptyState from "@/components/ui/EmptyState";
import ActionLink from "@/components/ui/ActionLink";
import { getSpendBreakdownLogic } from "@/server/pnl";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { FilterForm } from "@/components/ui/FilterLink";
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { dateStyle: "medium" });


export default async function ExpenseListPage({
  searchParams,
}: {
  searchParams: Promise<{
    branch?: string;
    supplier?: string;
    source?: string;
    status?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { tenantId, reach} = await requireTenant("expense:view");
  const sp = await searchParams;

  // A malformed filter falls back to the unfiltered list rather than erroring:
  // a query string is navigation, not a form being filled in (Part 10 L5c).
  const parsed = getExpensesQuerySchema.safeParse({
    branchId: sp.branch,
    supplierId: sp.supplier,
    source: sp.source,
    paymentStatus: sp.status,
    from: sp.from,
    to: sp.to,
  });
  const query = parsed.success ? parsed.data : {};

  // The breakdown needs a period even when the list is unfiltered: default to
  // this month, the question an owner opening the page is asking.
  const today = computeBangkokToday();
  const breakdownFrom = query.from ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const breakdownTo = query.to ?? today;

  const [branches, suppliers, rows, due, spend] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getExpensesLogic(tenantId, query, reach).then((list) => list.map(toExpenseListRowView)),
    getDueRecurringLogic(tenantId, { branchId: query.branchId }, reach).then((list) =>
      list.map(toDueRecurringView)
    ),
    getSpendBreakdownLogic(tenantId, { from: breakdownFrom, to: breakdownTo, branchId: query.branchId }, reach),
  ]);
  const spendTotal = Number(spend.total.toString());
  // One money style inside the breakdown, the same as the bars beside it.
  const bahtWhole = (n: number) =>
    new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
  const periodLabel = `${breakdownFrom.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" })} – ${breakdownTo.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;

  const dueCount = due.reduce((n, d) => n + d.duePeriods.length, 0);
  const supplierItems = suppliers.map((s) => ({
    id: s.id,
    name: s.nameShort ?? s.nameFull,
    sku: "",
    imageUrl: null,
    section: "ผู้ขาย",
    group: null,
    baseUnitName: null,
    detail: s.nameShort && s.nameShort !== s.nameFull ? s.nameFull : null,
  }));

  const unpaidTotal = rows
    .filter((r) => r.paymentStatus === "UNPAID")
    .reduce((sum, r) => sum + Number(r.netPaymentAmount), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">ค่าใช้จ่าย</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ทุกบาทที่ออกจากร้าน — ทั้งค่าของและค่าใช้จ่ายอื่น รวมอยู่ที่เดียว
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/expenses/recurring"
            className="btn-secondary"
          >
            รายการประจำ
          </a>
          <a
            href="/expenses/new"
            className="btn"
          >
            บันทึกค่าใช้จ่าย
          </a>
        </div>
      </div>

      {/*
        "ถึงกำหนด" — computed, never generated (ADR 0016 Q5). Nothing runs in the
        background in this stack, so a reminder means visible when someone opens
        the page; saying so is better than implying a notification that will
        never arrive.
      */}
      {due.length > 0 && (
        <section className="rounded-lg border border-warn-border bg-warn-bg p-4">
          <h3 className="text-sm font-bold text-warn">
            ถึงกำหนดบันทึก ({dueCount} งวด)
          </h3>
          <p className="mt-1 text-xs text-warn">
            รายการประจำที่ยังไม่ได้บันทึกในเดือนนั้น — ระบบไม่บันทึกให้เอง
            เพราะยอดจริงแต่ละเดือนไม่เท่ากัน
          </p>
          <ul className="mt-3 space-y-2">
            {due.map((d) => (
              <li key={d.template.id} className="text-sm text-warn">
                <span className="font-medium">{d.template.description}</span>
                <span className="ml-2 text-xs">
                  {d.template.branchName} · ทุกวันที่ {d.template.dayOfMonth} ·
                  ตั้งต้น {formatMoney(d.template.defaultAmount)} ฿
                </span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {d.duePeriods.map((period) => (
                    <a
                      key={period}
                      href={`/expenses/new?recurring=${d.template.id}&period=${period}`}
                      className="rounded-lg border border-warn-border bg-white px-2 py-1 text-xs font-medium hover:bg-warn-bg"
                    >
                      บันทึกงวด {monthLabelTh(period)}
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* B4 (Kong 2026-10-24): the breakdown by category lives on วิเคราะห์รายจ่าย,
          which drills further; this page records and finds bills. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
        {/* Never ฿0 for "nothing recorded yet" (mise-ui-review §3): say so, and
            point at the recurring months that are the usual reason. */}
        <p className="text-sm">
          รายจ่าย {periodLabel}:{" "}
          {spendTotal === 0 ? (
            <b className="text-muted-foreground">ยังไม่มีบิลในช่วงนี้</b>
          ) : (
            <>
              <b className="tabular-nums">{bahtWhole(spendTotal)}</b>
              <span className="text-muted-foreground"> · ตามวันที่บิล ไม่รวม VAT</span>
            </>
          )}
          {dueCount > 0 && (
            <span className="text-muted-foreground"> · รายการประจำรอบันทึก {dueCount} งวด</span>
          )}
        </p>
        <ActionLink href="/expenses/analysis">ดูแยกหมวดและผู้ขาย ›</ActionLink>
      </div>

      <FilterForm className="flex flex-wrap items-end gap-3">
        {branches.length > 1 && (
          <div>
            <label htmlFor="branch" className="label">
              สาขา
            </label>
            <select
              id="branch"
              name="branch"
              defaultValue={query.branchId ?? ""}
              className="input mt-1"
            >
              <option value="">ทุกสาขา</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="w-72 max-w-full">
          <label htmlFor="supplier" className="label">
            ผู้ขาย
          </label>
          <SupplierFilter items={supplierItems} value={query.supplierId ?? ""} />
        </div>
        <div>
          <label htmlFor="source" className="label">
            ที่มา
          </label>
          <select
            id="source"
            name="source"
            defaultValue={query.source ?? ""}
            className="input mt-1"
          >
            <option value="">ทั้งหมด</option>
            {EXPENSE_SOURCE_VALUES.map((s) => (
              <option key={s} value={s}>
                {EXPENSE_SOURCE_LABELS_TH[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="label">
            การจ่ายเงิน
          </label>
          <select
            id="status"
            name="status"
            defaultValue={query.paymentStatus ?? ""}
            className="input mt-1"
          >
            <option value="">ทั้งหมด</option>
            {EXPENSE_PAYMENT_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {EXPENSE_PAYMENT_STATUS_LABELS_TH[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="from" className="label">
            ตั้งแต่
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={sp.from ?? ""}
            className="input mt-1"
          />
        </div>
        <div>
          <label htmlFor="to" className="label">
            ถึง
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={sp.to ?? ""}
            className="input mt-1"
          />
        </div>
        <button
          type="submit"
          className="btn-secondary"
        >
          กรอง
        </button>
      </FilterForm>

      {rows.length === 0 ? (
        <EmptyState art="start">
          ยังไม่มีรายการค่าใช้จ่าย — กด &ldquo;บันทึกค่าใช้จ่าย&rdquo;
          เพื่อบันทึกบิลแรก (บิลค่าของจะถูกสร้างให้เองเมื่อยืนยันใบรับของ)
        </EmptyState>
      ) : (
        <>
          {unpaidTotal > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
              ยังไม่จ่าย{" "}
              <span className="font-medium tabular-nums">
                {formatMoney(String(unpaidTotal))} ฿
              </span>{" "}
              <span className="text-xs text-muted-foreground">
                (ยอดสุทธิหลังหักภาษี ณ ที่จ่าย ตามที่กรองอยู่)
              </span>
            </div>
          )}

          <div className="data-table">
            <table className="w-full min-w-[46rem]">
              <thead>
                <tr>
                  <th>วันที่บิล</th>
                  <th>รายละเอียด</th>
                  <th>สาขา</th>
                  <th>ที่มา</th>
                  <th className="text-right">ยอดรวม</th>
                  <th className="text-right">จ่ายจริง</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="group relative transition-colors hover:bg-muted/50">
                    <td className="text-sm text-muted-foreground">
                      {dateLabel(r.billDate)}
                    </td>
                    <td>
                      <a
                        href={`/expenses/${r.id}`}
                        className="whitespace-nowrap font-semibold text-foreground after:absolute after:inset-0 after:content-['']"
                      >
                        {expenseTitle(r)}
                      </a>
                      <div className="text-xs text-muted-foreground">
                        {r.itemCount} รายการ
                        {r.billNo && ` · ${r.billNo}`}
                        {r.period && ` · งวด ${monthLabelTh(r.period)}`}
                      </div>
                    </td>
                    <td className="text-sm">{r.branchName}</td>
                    <td className="text-xs text-muted-foreground">
                      {EXPENSE_SOURCE_LABELS_TH[r.source]}
                    </td>
                    <td className="text-right text-sm tabular-nums">
                      {formatMoney(r.totalAmount)}
                    </td>
                    <td className="text-right text-sm tabular-nums">
                      {formatMoney(r.netPaymentAmount)}
                    </td>
                    <td>
                      <PaymentBadge status={r.paymentStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

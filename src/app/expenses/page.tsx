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
  toDueRecurringView,
  toExpenseListRowView,
} from "./_components/expense-view";
import { formatMoney } from "@/app/cost/_components/cost-view";
import PaymentBadge from "./_components/PaymentBadge";

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

  const [branches, suppliers, rows, due] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getExpensesLogic(tenantId, query).then((list) => list.map(toExpenseListRowView)),
    getDueRecurringLogic(tenantId, { branchId: query.branchId }).then((list) =>
      list.map(toDueRecurringView)
    ),
  ]);

  const unpaidTotal = rows
    .filter((r) => r.paymentStatus === "UNPAID")
    .reduce((sum, r) => sum + Number(r.netPaymentAmount), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">ค่าใช้จ่าย</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ทุกบาทที่ออกจากร้าน — ทั้งค่าของและค่าใช้จ่ายอื่น รวมอยู่ที่เดียว
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/expenses/recurring"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
          >
            รายการประจำ
          </a>
          <a
            href="/expenses/new"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
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
            ถึงกำหนดบันทึก ({due.reduce((n, d) => n + d.duePeriods.length, 0)} งวด)
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
                      บันทึกงวด {period}
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3">
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
        <div>
          <label htmlFor="supplier" className="label">
            ผู้ขาย
          </label>
          <select
            id="supplier"
            name="supplier"
            defaultValue={query.supplierId ?? ""}
            className="input mt-1"
          >
            <option value="">ทั้งหมด</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameShort ?? s.nameFull}
              </option>
            ))}
          </select>
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
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          กรอง
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
          ยังไม่มีรายการค่าใช้จ่าย — กด &ldquo;บันทึกค่าใช้จ่าย&rdquo;
          เพื่อบันทึกบิลแรก (บิลค่าของจะถูกสร้างให้เองเมื่อยืนยันใบรับของ)
        </div>
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

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[46rem]">
              <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">วันที่บิล</th>
                  <th className="px-3 py-2 font-medium">รายละเอียด</th>
                  <th className="px-3 py-2 font-medium">สาขา</th>
                  <th className="px-3 py-2 font-medium">ที่มา</th>
                  <th className="px-3 py-2 text-right font-medium">ยอดรวม</th>
                  <th className="px-3 py-2 text-right font-medium">จ่ายจริง</th>
                  <th className="px-3 py-2 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 text-sm text-muted-foreground">
                      {dateLabel(r.billDate)}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`/expenses/${r.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.supplierName ?? r.billNo ?? "ค่าใช้จ่าย"}
                      </a>
                      <div className="text-xs text-muted-foreground">
                        {r.itemCount} รายการ
                        {r.billNo && ` · ${r.billNo}`}
                        {r.period && ` · งวด ${r.period}`}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm">{r.branchName}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {EXPENSE_SOURCE_LABELS_TH[r.source]}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">
                      {formatMoney(r.totalAmount)}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">
                      {formatMoney(r.netPaymentAmount)}
                    </td>
                    <td className="px-3 py-2">
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

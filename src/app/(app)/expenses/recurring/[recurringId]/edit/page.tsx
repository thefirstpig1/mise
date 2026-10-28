// Sprint 3 Part 16 L5c — editing a recurring template.
//
// Months already confirmed are NOT revisited (ADR 0016 Q5): the expenses they
// produced are real bills someone approved, and a template is a starting point
// rather than a source of truth about the past. Narrowing the window only
// changes what is still due.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getSuppliersLogic } from "@/server/supplier";
import { getCategoriesLogic } from "@/server/category";
import {
  addPeriods,
  currentPeriod,
  getRecurringExpenseByIdLogic,
  getRecurringHistoryLogic,
  getSupplierLastCategoriesLogic,
} from "@/server/expense";
import { formatMoney } from "@/app/(app)/cost/_components/cost-view";
import {
  toExpenseSupplierOption,
  toRecurringExpenseView,
} from "../../../_components/expense-view";
import Crumbs from "../../../_components/Crumbs";
import RecurringHistory from "../../../_components/RecurringHistory";
import RecurringExpenseForm from "../../../_components/RecurringExpenseForm";
import {
  deleteRecurringExpenseAction,
  updateRecurringExpenseAction,
} from "../../../actions";
import RetireRecurringButton from "../../../_components/RetireRecurringButton";

export default async function EditRecurringExpensePage({
  params,
}: {
  params: Promise<{ recurringId: string }>;
}) {
  const { tenantId, reach, membership, assertBranch } = await requireTenant("expense:write");
  const { recurringId } = await params;

  // The six months the history shows: up to this month (or the template's
  // last), never before it started. Known before any read, so it runs alongside.
  const now = currentPeriod();
  const [row, branches, suppliers, categories, lastCategories] = await Promise.all([
    getRecurringExpenseByIdLogic(tenantId, recurringId),
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getCategoriesLogic(tenantId),
    getSupplierLastCategoriesLogic(tenantId),
  ]);
  if (!row) notFound();
  // Rule A5: reachable by URL, so the document's branch is checked here too.
  assertBranch(row.branchId);
  const template = toRecurringExpenseView(row);
  const vatDefault = membership.tenant.defaultVatRatePercent.toString();

  const last = template.endPeriod && template.endPeriod < now ? template.endPeriod : now;
  const periods = Array.from({ length: 6 }, (_, i) => addPeriods(last, i - 5)).filter(
    (p) => p >= template.startPeriod
  );
  const history = await getRecurringHistoryLogic(tenantId, template.id, periods);
  const billOf = new Map(history.map((h) => [h.period, h]));
  const months = periods.map((p) => {
    const h = billOf.get(p);
    return {
      period: p,
      bill: h ? { id: h.expenseId, total: Number(h.totalAmount), paid: h.paymentStatus === "PAID" } : null,
    };
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Crumbs
          trail={[
            { href: "/expenses", label: "ค่าใช้จ่าย" },
            { href: "/expenses/recurring", label: "รายการประจำ" },
          ]}
          here={template.description}
        />
        <h2 className="mt-1 text-2xl font-semibold">{template.description}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {template.branchName} · ทุกวันที่ {template.dayOfMonth} · ยอดตั้งต้น ฿
          {formatMoney(template.defaultAmount)}
          {!template.isActive && " · ปิดใช้งานแล้ว"}
        </p>
      </div>

      {periods.length > 0 && (
        <RecurringHistory
          months={months}
          defaultAmount={Number(template.defaultAmount)}
          recurringId={template.id}
          canRecord={template.isActive}
        />
      )}

      <div>
        <h3 className="text-lg font-semibold">ตั้งค่ารายการนี้</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          บิลที่บันทึกไปแล้วจะไม่เปลี่ยนตาม — การแก้ที่นี่มีผลกับงวดที่ยังไม่ได้บันทึก
        </p>
      </div>

      <RecurringExpenseForm
        action={updateRecurringExpenseAction}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        suppliers={suppliers.map((s) => toExpenseSupplierOption(s, lastCategories, vatDefault))}
        categories={categories.map((c) => ({
          id: c.id,
          account: c.account,
          accountingSection: c.accountingSection,
          groupName: c.groupName,
        }))}
        currentPeriod={currentPeriod()}
        existing={template}
      />

      <div className="border-t border-border pt-4">
        <RetireRecurringButton
          action={deleteRecurringExpenseAction}
          recurringId={template.id}
          description={template.description}
        />
      </div>
    </div>
  );
}

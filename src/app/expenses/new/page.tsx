// Sprint 3 Part 16 L5b — recording a bill by hand.
//
// Also the page a "ถึงกำหนด" link lands on: `?recurring=<id>&period=<YYYY-MM>`
// prefills the form from the template and carries the pair that makes confirming
// idempotent (ADR 0016 Q5). The template supplies a STARTING amount, never the
// amount — an electricity bill differs every month, which is the whole reason
// confirmation exists.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getSuppliersLogic } from "@/server/supplier";
import { getCategoriesLogic } from "@/server/category";
import { getRecurringExpenseByIdLogic } from "@/server/expense";
import { PERIOD_REGEX } from "@/lib/validations/expense";
import { createExpenseAction } from "../actions";
import ExpenseForm from "../_components/ExpenseForm";

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ recurring?: string; period?: string }>;
}) {
  const { tenantId, reach} = await requireTenant("expense:write");
  const { recurring, period } = await searchParams;

  const [branches, suppliers, categories] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getCategoriesLogic(tenantId),
  ]);

  let prefill = undefined;
  if (recurring && period && PERIOD_REGEX.test(period)) {
    const template = await getRecurringExpenseByIdLogic(tenantId, recurring);
    // A link to a template that has since been retired is a dead link, not an
    // empty form that would silently record an unattached bill.
    if (!template) notFound();
    prefill = {
      recurringExpenseId: template.id,
      period,
      description: template.description,
      branchId: template.branchId,
      supplierId: template.supplierId,
      categoryId: template.categoryId,
      defaultAmount: template.defaultAmount.toString(),
      isPriceVatInclusive: template.isPriceVatInclusive,
      vatRatePercent: template.vatRatePercent?.toString() ?? null,
      subjectToWht: template.subjectToWht,
      whtRatePercent: template.whtRatePercent?.toString() ?? null,
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <a
          href="/expenses"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับรายการค่าใช้จ่าย
        </a>
        <h2 className="mt-1 text-xl font-bold">
          {prefill ? `บันทึก${prefill.description} งวด ${prefill.period}` : "บันทึกค่าใช้จ่าย"}
        </h2>
        {prefill && (
          <p className="mt-1 text-sm text-muted-foreground">
            ยอดตั้งต้นมาจากรายการประจำ — แก้ให้ตรงกับบิลจริงได้เลย
          </p>
        )}
      </div>

      {categories.length === 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          ยังไม่มีหมวดบัญชีในระบบ — ต้องมีอย่างน้อย 1 หมวดก่อนบันทึกค่าใช้จ่าย{" "}
          <a href="/categories" className="font-medium underline">
            ไปตั้งค่าหมวดบัญชี
          </a>
        </div>
      ) : (
        <ExpenseForm
          action={createExpenseAction}
          branches={branches.map((b) => ({ id: b.id, name: b.name }))}
          suppliers={suppliers.map((s) => ({
            id: s.id,
            label: s.nameShort ?? s.nameFull,
          }))}
          categories={categories.map((c) => ({
            id: c.id,
            account: c.account,
            accountingSection: c.accountingSection,
            groupName: c.groupName,
          }))}
          todayBangkok={computeBangkokToday().toISOString().slice(0, 10)}
          prefill={prefill}
        />
      )}
    </div>
  );
}

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
import { getRecurringExpenseByIdLogic, getSupplierLastCategoriesLogic } from "@/server/expense";
import { monthLabelTh } from "@/lib/expense-labels";
import { toExpenseSupplierOption } from "../_components/expense-view";
import Crumbs from "../_components/Crumbs";
import { PERIOD_REGEX } from "@/lib/validations/expense";
import { createExpenseAction } from "../actions";
import ExpenseForm from "../_components/ExpenseForm";

import EmptyState from "@/components/ui/EmptyState";
export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ recurring?: string; period?: string }>;
}) {
  const { tenantId, reach, membership } = await requireTenant("expense:write");
  const { recurring, period } = await searchParams;

  const [branches, suppliers, categories, lastCategories] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getCategoriesLogic(tenantId),
    getSupplierLastCategoriesLogic(tenantId),
  ]);
  const vatDefault = membership.tenant.defaultVatRatePercent.toString();

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
        <Crumbs
          trail={[
            { href: "/expenses", label: "ค่าใช้จ่าย" },
            ...(prefill ? [{ href: "/expenses/recurring", label: "รายการประจำ" }] : []),
          ]}
          here={prefill ? `บันทึกงวด ${monthLabelTh(prefill.period)}` : "บันทึกค่าใช้จ่าย"}
        />
        <h2 className="mt-1 text-2xl font-semibold">
          {prefill ? `บันทึก${prefill.description} งวด ${monthLabelTh(prefill.period)}` : "บันทึกค่าใช้จ่าย"}
        </h2>
        {prefill && (
          <p className="mt-1 text-sm text-muted-foreground">
            ยอดตั้งต้นมาจากรายการประจำ — แก้ให้ตรงกับบิลจริงได้เลย
          </p>
        )}
      </div>

      {categories.length === 0 ? (
        <EmptyState art="setup">
          ยังไม่มีหมวดบัญชีในระบบ — ต้องมีอย่างน้อย 1 หมวดก่อนบันทึกค่าใช้จ่าย{" "}
          <a href="/categories" className="font-medium underline">
            ไปตั้งค่าหมวดบัญชี
          </a>
        </EmptyState>
      ) : (
        <ExpenseForm
          action={createExpenseAction}
          branches={branches.map((b) => ({ id: b.id, name: b.name }))}
          suppliers={suppliers.map((s) => toExpenseSupplierOption(s, lastCategories, vatDefault))}
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

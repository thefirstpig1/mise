// Sprint 3 Part 16 L5b — editing a bill.
//
// The same form as /expenses/new, in edit mode. A bill created by a goods
// receipt renders the fields the receipt owns as read-only (ADR 0016 Q3.4); the
// server refuses them too, so this is about not inviting the typing, not about
// being the guard.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getSuppliersLogic } from "@/server/supplier";
import { getCategoriesLogic } from "@/server/category";
import { getExpenseByIdLogic, getSupplierLastCategoriesLogic } from "@/server/expense";
import { expenseTitle, toExpenseDetailView, toExpenseSupplierOption } from "../../_components/expense-view";
import Crumbs from "../../_components/Crumbs";
import ExpenseForm from "../../_components/ExpenseForm";
import { updateExpenseAction } from "../../actions";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, reach, membership, assertBranch } = await requireTenant("expense:write");
  const { id } = await params;

  const [row, branches, suppliers, categories, lastCategories] = await Promise.all([
    getExpenseByIdLogic(tenantId, id),
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getCategoriesLogic(tenantId),
    getSupplierLastCategoriesLogic(tenantId),
  ]);
  const vatDefault = membership.tenant.defaultVatRatePercent.toString();
  if (!row) notFound();
  // Rule A5: reachable by URL, so the document's branch is checked here too.
  assertBranch(row.branchId);
  const expense = toExpenseDetailView(row);

  return (
    <div className="space-y-6">
      <div>
        <Crumbs
          trail={[
            { href: "/expenses", label: "ค่าใช้จ่าย" },
            { href: `/expenses/${expense.id}`, label: expenseTitle(expense) },
          ]}
          here="แก้ไข"
        />
        <h2 className="mt-1 text-2xl font-semibold">แก้ไขค่าใช้จ่าย</h2>
      </div>

      <ExpenseForm
        action={updateExpenseAction}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        suppliers={suppliers.map((s) => toExpenseSupplierOption(s, lastCategories, vatDefault))}
        categories={categories.map((c) => ({
          id: c.id,
          account: c.account,
          accountingSection: c.accountingSection,
          groupName: c.groupName,
        }))}
        todayBangkok={computeBangkokToday().toISOString().slice(0, 10)}
        existing={expense}
      />
    </div>
  );
}

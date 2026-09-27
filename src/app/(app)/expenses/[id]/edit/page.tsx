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
import { getExpenseByIdLogic } from "@/server/expense";
import { toExpenseDetailView } from "../../_components/expense-view";
import ExpenseForm from "../../_components/ExpenseForm";
import { updateExpenseAction } from "../../actions";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, reach} = await requireTenant("expense:write");
  const { id } = await params;

  const [row, branches, suppliers, categories] = await Promise.all([
    getExpenseByIdLogic(tenantId, id),
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getCategoriesLogic(tenantId),
  ]);
  if (!row) notFound();
  const expense = toExpenseDetailView(row);

  return (
    <div className="space-y-6">
      <div>
        <a
          href={`/expenses/${expense.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปที่บิล
        </a>
        <h2 className="mt-1 text-xl font-bold">แก้ไขค่าใช้จ่าย</h2>
      </div>

      <ExpenseForm
        action={updateExpenseAction}
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
        existing={expense}
      />
    </div>
  );
}

// Sprint 3 Part 16 L5c — a new recurring template.

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getSuppliersLogic } from "@/server/supplier";
import { getCategoriesLogic } from "@/server/category";
import { currentPeriod } from "@/server/expense";
import { createRecurringExpenseAction } from "../../actions";
import RecurringExpenseForm from "../../_components/RecurringExpenseForm";

export default async function NewRecurringExpensePage() {
  const { tenantId } = await requireTenant("expense:write");

  const [branches, suppliers, categories] = await Promise.all([
    getBranchesLogic(tenantId),
    getSuppliersLogic(tenantId),
    getCategoriesLogic(tenantId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <a
          href="/expenses/recurring"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับรายการประจำ
        </a>
        <h2 className="mt-1 text-xl font-bold">เพิ่มรายการประจำ</h2>
      </div>

      <RecurringExpenseForm
        action={createRecurringExpenseAction}
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
        currentPeriod={currentPeriod()}
      />
    </div>
  );
}

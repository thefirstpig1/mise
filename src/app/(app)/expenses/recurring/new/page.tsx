// Sprint 3 Part 16 L5c — a new recurring template.

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getSuppliersLogic } from "@/server/supplier";
import { getCategoriesLogic } from "@/server/category";
import { currentPeriod, getSupplierLastCategoriesLogic } from "@/server/expense";
import { toExpenseSupplierOption } from "../../_components/expense-view";
import Crumbs from "../../_components/Crumbs";
import { createRecurringExpenseAction } from "../../actions";
import RecurringExpenseForm from "../../_components/RecurringExpenseForm";

export default async function NewRecurringExpensePage() {
  const { tenantId, reach, membership } = await requireTenant("expense:write");

  const [branches, suppliers, categories, lastCategories] = await Promise.all([
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getCategoriesLogic(tenantId),
    getSupplierLastCategoriesLogic(tenantId),
  ]);
  const vatDefault = membership.tenant.defaultVatRatePercent.toString();

  return (
    <div className="space-y-6">
      <div>
        <Crumbs
          trail={[
            { href: "/expenses", label: "ค่าใช้จ่าย" },
            { href: "/expenses/recurring", label: "รายการประจำ" },
          ]}
          here="เพิ่มรายการประจำ"
        />
        <h2 className="mt-1 text-xl font-bold">เพิ่มรายการประจำ</h2>
      </div>

      <RecurringExpenseForm
        action={createRecurringExpenseAction}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        suppliers={suppliers.map((s) => toExpenseSupplierOption(s, lastCategories, vatDefault))}
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

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
import { currentPeriod, getRecurringExpenseByIdLogic } from "@/server/expense";
import { toRecurringExpenseView } from "../../../_components/expense-view";
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
  const { tenantId, reach} = await requireTenant("expense:write");
  const { recurringId } = await params;

  const [row, branches, suppliers, categories] = await Promise.all([
    getRecurringExpenseByIdLogic(tenantId, recurringId),
    getBranchesLogic(tenantId, reach),
    getSuppliersLogic(tenantId),
    getCategoriesLogic(tenantId),
  ]);
  if (!row) notFound();
  const template = toRecurringExpenseView(row);

  return (
    <div className="space-y-6">
      <div>
        <a
          href="/expenses/recurring"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับรายการประจำ
        </a>
        <h2 className="mt-1 text-xl font-bold">แก้ไข{template.description}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          บิลที่บันทึกไปแล้วจะไม่เปลี่ยนตาม — การแก้ที่นี่มีผลกับงวดที่ยังไม่ได้บันทึก
        </p>
      </div>

      <RecurringExpenseForm
        action={updateRecurringExpenseAction}
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
        existing={template}
      />

      <div className="border-t border-border pt-4">
        <RetireRecurringButton
          action={deleteRecurringExpenseAction}
          recurringId={template.id}
        />
      </div>
    </div>
  );
}

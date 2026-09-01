// Sprint 3 Part 16 L5c — the recurring templates.
//
// A template is a note about what repeats, not a scheduler. Nothing here writes
// an expense; the "ถึงกำหนด" panel on /expenses computes which months are still
// owed and a human confirms each one (ADR 0016 Q5).

import { requireTenant } from "@/lib/require-tenant";
import {
  currentPeriod,
  getDueRecurringLogic,
  getRecurringExpensesLogic,
} from "@/server/expense";
import { formatMoney } from "@/app/cost/_components/cost-view";
import { toRecurringExpenseView } from "../_components/expense-view";

export default async function RecurringExpensePage() {
  const { tenantId } = await requireTenant("expense:view");

  const [templates, due] = await Promise.all([
    getRecurringExpensesLogic(tenantId).then((rows) => rows.map(toRecurringExpenseView)),
    getDueRecurringLogic(tenantId),
  ]);
  const dueCount = new Map(due.map((d) => [d.template.id, d.duePeriods.length]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a
            href="/expenses"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← กลับรายการค่าใช้จ่าย
          </a>
          <h2 className="mt-1 text-xl font-bold">รายการประจำ</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ค่าใช้จ่ายที่มาทุกเดือน — ระบบจะเตือนว่าเดือนไหนยังไม่ได้บันทึก
            แต่ไม่บันทึกให้เอง เพราะยอดจริงแต่ละเดือนไม่เท่ากัน
          </p>
        </div>
        <a
          href="/expenses/recurring/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          เพิ่มรายการประจำ
        </a>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
          ยังไม่มีรายการประจำ — เพิ่มค่าเช่า ค่าไฟ หรือค่าทำบัญชี
          แล้วระบบจะเตือนทุกเดือน
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[42rem]">
            <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">รายการ</th>
                <th className="px-3 py-2 font-medium">สาขา</th>
                <th className="px-3 py-2 font-medium">หมวดบัญชี</th>
                <th className="px-3 py-2 text-right font-medium">ยอดตั้งต้น</th>
                <th className="px-3 py-2 font-medium">ครบกำหนด</th>
                <th className="px-3 py-2 font-medium">ช่วงที่ใช้</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {templates.map((t) => (
                <tr key={t.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <a
                      href={`/expenses/recurring/${t.id}/edit`}
                      className="font-medium text-primary hover:underline"
                    >
                      {t.description}
                    </a>
                    {(dueCount.get(t.id) ?? 0) > 0 && (
                      <div className="text-xs text-warn">
                        ค้าง {dueCount.get(t.id)} งวด
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm">{t.branchName}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {t.categoryLabel}
                  </td>
                  <td className="px-3 py-2 text-right text-sm tabular-nums">
                    {formatMoney(t.defaultAmount)}
                  </td>
                  <td className="px-3 py-2 text-sm">ทุกวันที่ {t.dayOfMonth}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {t.startPeriod} – {t.endPeriod ?? "ไม่มีกำหนด"}
                  </td>
                  <td className="px-3 py-2">
                    {t.isActive ? (
                      <span className="text-xs text-emerald-700">เปิดใช้งาน</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">ปิดแล้ว</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        งวดปัจจุบัน {currentPeriod()} · รายการที่ค้างจะขึ้นเตือนในหน้าค่าใช้จ่าย
        ย้อนหลังได้ไม่เกิน 12 เดือน
      </p>
    </div>
  );
}

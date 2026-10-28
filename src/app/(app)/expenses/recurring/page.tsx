// Sprint 3 Part 16 L5c — the recurring templates.
//
// A template is a note about what repeats, not a scheduler. Nothing here writes
// an expense; the "ถึงกำหนด" panel on /expenses computes which months are still
// owed and a human confirms each one (ADR 0016 Q5).
//
// Expense review 2026-10-27: each row carries its own "บันทึกงวด …" buttons
// (no trip back to /expenses), the status column that said เปิดใช้งาน on every
// row is gone, and a switched-off template is a dimmed row at the end.

import { requireTenant } from "@/lib/require-tenant";
import {
  currentPeriod,
  getDueRecurringLogic,
  getRecurringExpensesLogic,
} from "@/server/expense";
import { formatMoney } from "@/app/(app)/cost/_components/cost-view";
import { toRecurringExpenseView } from "../_components/expense-view";
import { monthLabelTh } from "@/lib/expense-labels";
import Crumbs from "../_components/Crumbs";

import EmptyState from "@/components/ui/EmptyState";
export default async function RecurringExpensePage() {
  const { tenantId, capabilities, reach } = await requireTenant("expense:view");
  const canWrite = capabilities.has("expense:write");

  const [templates, due] = await Promise.all([
    getRecurringExpensesLogic(tenantId).then((rows) => rows.map(toRecurringExpenseView)),
    getDueRecurringLogic(tenantId, {}, reach),
  ]);
  const dueOf = new Map(due.map((d) => [d.template.id, d.duePeriods]));
  /** Buttons shown per row, oldest first (the order someone works through them); the rest are counted. */
  const SHOWN = 3;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Crumbs trail={[{ href: "/expenses", label: "ค่าใช้จ่าย" }]} here="รายการประจำ" />
          <h2 className="mt-1 text-2xl font-semibold">รายการประจำ</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ค่าใช้จ่ายที่มาทุกเดือน — ระบบจะเตือนว่าเดือนไหนยังไม่ได้บันทึก
            แต่ไม่บันทึกให้เอง เพราะยอดจริงแต่ละเดือนไม่เท่ากัน
          </p>
        </div>
        {canWrite && (
          <a href="/expenses/recurring/new" className="btn">
            เพิ่มรายการประจำ
          </a>
        )}
      </div>

      {templates.length === 0 ? (
        <EmptyState art="start">
          ยังไม่มีรายการประจำ — เพิ่มค่าเช่า ค่าไฟ หรือค่าทำบัญชี
          แล้วระบบจะเตือนทุกเดือน
        </EmptyState>
      ) : (
        <div className="data-table">
          <table className="w-full min-w-[46rem]">
            <thead>
              <tr>
                <th>รายการ</th>
                <th>หมวดบัญชี</th>
                <th className="text-right">ยอดตั้งต้น</th>
                <th>ครบกำหนด</th>
                <th className="text-right">ยังไม่ได้บันทึก</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const periods = t.isActive ? (dueOf.get(t.id) ?? []) : [];
                return (
                  <tr
                    key={t.id}
                    className={`group relative transition-colors hover:bg-muted/50 ${t.isActive ? "" : "opacity-60"}`}
                  >
                    <td>
                      <a
                        href={`/expenses/recurring/${t.id}/edit`}
                        className="whitespace-nowrap font-semibold text-foreground after:absolute after:inset-0 after:content-['']"
                      >
                        {t.description}
                      </a>
                      <div className="text-xs text-muted-foreground">
                        {t.isActive
                          ? `${t.branchName} · ตั้งแต่ ${monthLabelTh(t.startPeriod)}${t.endPeriod ? ` ถึง ${monthLabelTh(t.endPeriod)}` : ""}`
                          : `ปิดใช้งานแล้ว · ${t.branchName}`}
                      </div>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {t.categoryLabel}
                    </td>
                    <td className="text-right text-sm tabular-nums">
                      {formatMoney(t.defaultAmount)}
                    </td>
                    <td className="text-sm">ทุกวันที่ {t.dayOfMonth}</td>
                    <td className="text-right">
                      {!t.isActive ? (
                        <span className="text-xs text-muted-foreground">ไม่เตือนแล้ว</span>
                      ) : periods.length === 0 ? (
                        <span className="text-xs text-muted-foreground">ครบแล้ว</span>
                      ) : canWrite ? (
                        <div className="relative z-10 inline-flex flex-wrap justify-end gap-1.5">
                          {periods.slice(0, SHOWN).map((p, i) => (
                            <a
                              key={p}
                              href={`/expenses/new?recurring=${t.id}&period=${p}`}
                              className="whitespace-nowrap rounded-full border border-warn-border bg-warn-bg px-3 py-1 text-xs font-semibold text-warn hover:brightness-95"
                            >
                              {periods.length === 1 || i === 0 ? "บันทึกงวด " : ""}
                              {monthLabelTh(p)}
                            </a>
                          ))}
                          {periods.length > SHOWN && (
                            <span className="self-center text-xs text-muted-foreground">
                              และอีก {periods.length - SHOWN} งวด
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-warn">ค้าง {periods.length} งวด</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        งวดปัจจุบัน {monthLabelTh(currentPeriod())} · งวดที่ยังไม่ได้บันทึกจะขึ้นเตือนในหน้าค่าใช้จ่ายด้วย
        ย้อนหลังได้ไม่เกิน 12 เดือน
      </p>
    </div>
  );
}

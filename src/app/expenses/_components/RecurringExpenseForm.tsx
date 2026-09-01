"use client";

// Sprint 3 Part 16 L5c — the recurring template form.
//
// A template records what recurs. It **generates nothing** (ADR 0016 Q5): the
// months it owes are computed, and a human confirms each one, because an
// electricity bill differs every month and a pre-written row would be a half-real
// bill every later report has to know about and filter out.
//
// The due day stops at 28 and the field says why — a template due on the 30th
// would skip February, and a template that silently skips a month is worse than
// one that lands early.

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RecurringExpenseActionState } from "../actions";
import type { CategoryOption } from "./ExpenseForm";
import type { RecurringExpenseView } from "./expense-view";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "block text-sm font-medium";

export default function RecurringExpenseForm({
  action,
  branches,
  suppliers,
  categories,
  currentPeriod,
  existing,
}: {
  action: (
    prev: RecurringExpenseActionState,
    fd: FormData
  ) => Promise<RecurringExpenseActionState>;
  branches: { id: string; name: string }[];
  suppliers: { id: string; label: string }[];
  categories: CategoryOption[];
  currentPeriod: string;
  existing?: RecurringExpenseView;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as RecurringExpenseActionState
  );
  const [subjectToWht, setSubjectToWht] = useState(existing?.subjectToWht ?? false);

  useEffect(() => {
    if (state.ok) router.push("/expenses/recurring");
  }, [state, router]);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const err = (field: string) => fieldErrors?.[field];

  return (
    <form action={formAction} className="space-y-5">
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {formError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {formError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="description" className={labelClass}>
            รายการ <span className="text-bad">*</span>
          </label>
          <input
            id="description"
            name="description"
            placeholder="ค่าเช่าร้าน / ค่าไฟฟ้า / ค่าทำบัญชี"
            defaultValue={existing?.description ?? ""}
            className={`${inputClass} mt-1`}
            required
          />
          {err("description") && (
            <p className="mt-1 text-xs text-bad">{err("description")}</p>
          )}
        </div>

        <div>
          <label htmlFor="branch_id" className={labelClass}>
            สาขา <span className="text-bad">*</span>
          </label>
          <select
            id="branch_id"
            name="branch_id"
            defaultValue={existing?.branchId ?? branches[0]?.id ?? ""}
            className={`${inputClass} mt-1`}
            required
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {err("branchId") && (
            <p className="mt-1 text-xs text-bad">{err("branchId")}</p>
          )}
        </div>

        <div>
          <label htmlFor="supplier_id" className={labelClass}>
            ผู้ขาย
          </label>
          <select
            id="supplier_id"
            name="supplier_id"
            defaultValue={existing?.supplierId ?? ""}
            className={`${inputClass} mt-1`}
          >
            <option value="">ไม่ระบุ</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="category_id" className={labelClass}>
            หมวดบัญชี <span className="text-bad">*</span>
          </label>
          <select
            id="category_id"
            name="category_id"
            defaultValue={existing?.categoryId ?? categories[0]?.id ?? ""}
            className={`${inputClass} mt-1`}
            required
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.account} · {c.accountingSection} · {c.groupName}
              </option>
            ))}
          </select>
          {err("categoryId") && (
            <p className="mt-1 text-xs text-bad">{err("categoryId")}</p>
          )}
        </div>

        <div>
          <label htmlFor="default_amount" className={labelClass}>
            ยอดตั้งต้น <span className="text-bad">*</span>
          </label>
          <input
            id="default_amount"
            name="default_amount"
            inputMode="decimal"
            defaultValue={existing?.defaultAmount ?? ""}
            className={`${inputClass} mt-1 text-right tabular-nums`}
            required
          />
          <p className="mt-1 text-xs text-muted-foreground">
            เป็นแค่ยอดตั้งต้น — ตอนบันทึกจริงแก้ได้ทุกเดือน
          </p>
          {err("defaultAmount") && (
            <p className="mt-1 text-xs text-bad">{err("defaultAmount")}</p>
          )}
        </div>

        <div>
          <label htmlFor="day_of_month" className={labelClass}>
            ครบกำหนดวันที่ <span className="text-bad">*</span>
          </label>
          <input
            id="day_of_month"
            name="day_of_month"
            type="number"
            min={1}
            max={28}
            defaultValue={existing?.dayOfMonth ?? 5}
            className={`${inputClass} mt-1`}
            required
          />
          <p className="mt-1 text-xs text-muted-foreground">
            ได้ถึงวันที่ 28 เท่านั้น — วันที่ 29-31 จะข้ามเดือนกุมภาพันธ์
          </p>
          {err("dayOfMonth") && (
            <p className="mt-1 text-xs text-bad">{err("dayOfMonth")}</p>
          )}
        </div>

        <div>
          <label htmlFor="start_period" className={labelClass}>
            เริ่มงวด (YYYY-MM) <span className="text-bad">*</span>
          </label>
          <input
            id="start_period"
            name="start_period"
            placeholder={currentPeriod}
            defaultValue={existing?.startPeriod ?? currentPeriod}
            className={`${inputClass} mt-1`}
            required
          />
          {err("startPeriod") && (
            <p className="mt-1 text-xs text-bad">{err("startPeriod")}</p>
          )}
        </div>

        <div>
          <label htmlFor="end_period" className={labelClass}>
            ถึงงวด (เว้นว่าง = ไม่มีกำหนดจบ)
          </label>
          <input
            id="end_period"
            name="end_period"
            placeholder="YYYY-MM"
            defaultValue={existing?.endPeriod ?? ""}
            className={`${inputClass} mt-1`}
          />
          {err("endPeriod") && (
            <p className="mt-1 text-xs text-bad">{err("endPeriod")}</p>
          )}
        </div>

        <div>
          <label htmlFor="vat_rate_percent" className={labelClass}>
            อัตรา VAT (%)
          </label>
          <input
            id="vat_rate_percent"
            name="vat_rate_percent"
            inputMode="decimal"
            placeholder="เว้นว่าง = ไม่มี VAT"
            defaultValue={existing?.vatRatePercent ?? ""}
            className={`${inputClass} mt-1`}
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_price_vat_inclusive"
              defaultChecked={existing?.isPriceVatInclusive ?? true}
            />
            ยอดที่กรอกรวม VAT แล้ว
          </label>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="subject_to_wht"
              checked={subjectToWht}
              onChange={(e) => setSubjectToWht(e.target.checked)}
            />
            หักภาษี ณ ที่จ่าย
          </label>
          {subjectToWht ? (
            <>
              <input
                name="wht_rate_percent"
                inputMode="decimal"
                placeholder="อัตรา % (เช่น 5 สำหรับค่าเช่า)"
                defaultValue={existing?.whtRatePercent ?? ""}
                className={`${inputClass} mt-2`}
              />
              {err("whtRatePercent") && (
                <p className="mt-1 text-xs text-bad">{err("whtRatePercent")}</p>
              )}
            </>
          ) : (
            <input type="hidden" name="wht_rate_percent" value="" />
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={existing?.isActive ?? true}
        />
        เปิดใช้งาน (ปิดแล้วจะไม่ขึ้นในรายการถึงกำหนด)
      </label>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก…" : existing ? "บันทึกการแก้ไข" : "เพิ่มรายการประจำ"}
        </button>
        <a
          href="/expenses/recurring"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}

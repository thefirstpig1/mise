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
//
// Expense review 2026-10-27: months come from a month grid, not typed YYYY-MM;
// supplier and category are searchable pickers; VAT and withholding are the
// same chips as the bill form, and choosing a supplier fills its tax in.

import { useActionState, useEffect, useMemo, useState } from "react";
import { MoneyInput } from "@/components/ui/NumberField";
import QtyStepper from "@/components/ui/QtyStepper";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import { useRouter } from "next/navigation";
import { ACCOUNT_TH } from "@/lib/expense-labels";
import type { RecurringExpenseActionState } from "../actions";
import type { CategoryOption } from "./ExpenseForm";
import type { ExpenseSupplierOption, RecurringExpenseView } from "./expense-view";
import MonthPicker from "./MonthPicker";
import { Chips, VatChips, WhtChips } from "./TaxChips";


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
  suppliers: ExpenseSupplierOption[];
  categories: CategoryOption[];
  currentPeriod: string;
  existing?: RecurringExpenseView;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as RecurringExpenseActionState
  );
  const [branchId, setBranchId] = useState(
    existing?.branchId ?? (branches.length === 1 ? branches[0].id : "")
  );
  const [supplierId, setSupplierId] = useState(existing?.supplierId ?? "");
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [vatRate, setVatRate] = useState(existing?.vatRatePercent ?? "");
  const [inclusive, setInclusive] = useState(existing?.isPriceVatInclusive ?? true);
  const [whtRate, setWhtRate] = useState(
    existing?.subjectToWht ? (existing.whtRatePercent ?? "") : ""
  );
  const [missing, setMissing] = useState<string | null>(null);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const supplierItems: PickerProduct[] = useMemo(
    () =>
      suppliers.map((s) => ({
        id: s.id, name: s.label, sku: "", imageUrl: null, section: "ผู้ขาย",
        group: null, baseUnitName: null, detail: s.fullName,
      })),
    [suppliers]
  );
  const categoryItems: PickerProduct[] = useMemo(
    () =>
      categories.map((c) => ({
        id: c.id, name: c.groupName, sku: "", imageUrl: null,
        section: ACCOUNT_TH[c.account] ?? c.account, group: null,
        baseUnitName: null, detail: c.accountingSection,
      })),
    [categories]
  );
  const chooseSupplier = (id: string) => {
    setSupplierId(id);
    const s = id ? supplierById.get(id) : undefined;
    if (!s) return;
    setVatRate(s.vatRatePercent ?? "");
    setInclusive(s.vatRatePercent ? s.pricesIncludeVat : true);
    setWhtRate(s.subjectToWht ? (s.whtRatePercent ?? "") : "");
    if (!categoryId && s.lastCategoryId) setCategoryId(s.lastCategoryId);
  };
  const fallbackYear = Number(currentPeriod.slice(0, 4));

  useEffect(() => {
    if (state.ok) router.push("/expenses/recurring");
  }, [state, router]);

  const formError = missing ?? (state.ok === false ? state.formError : undefined);
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const err = (field: string) => fieldErrors?.[field];

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const gap = !branchId ? "กรุณาเลือกสาขา" : !categoryId ? "กรุณาเลือกหมวดบัญชี" : null;
        setMissing(gap);
        if (gap) {
          e.preventDefault();
          // The message sits at the top; the button is at the bottom.
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }}
      className="space-y-5"
    >
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {formError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {formError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="description" className="label">
            รายการ <span className="text-bad">*</span>
          </label>
          <input
            id="description"
            name="description"
            placeholder="ค่าเช่าร้าน / ค่าไฟฟ้า / ค่าทำบัญชี"
            defaultValue={existing?.description ?? ""}
            className={"input w-full mt-1"}
            required
          />
          {err("description") && (
            <p className="mt-1 text-xs text-bad">{err("description")}</p>
          )}
        </div>

        <div>
          <span className="label">
            สาขา <span className="text-bad">*</span>
          </span>
          {branches.length === 1 ? (
            <p className="mt-1 flex h-10 items-center text-sm">{branches[0].name}</p>
          ) : (
            <Chips
              label="สาขา"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              value={branchId}
              onChange={setBranchId}
            />
          )}
          <input type="hidden" name="branch_id" value={branchId} />
          {err("branchId") && (
            <p className="mt-1 text-xs text-bad">{err("branchId")}</p>
          )}
        </div>

        <div>
          <label htmlFor="supplier_pick" className="label">
            ผู้ขาย
          </label>
          <ProductPicker
            products={supplierItems}
            value={supplierId}
            onChange={chooseSupplier}
            name="supplier_id"
            inputId="supplier_pick"
            thumbs={false}
            placeholder="ไม่ระบุผู้ขาย — พิมพ์ชื่อเพื่อค้นหา"
          />
        </div>

        <div>
          <label htmlFor="category_pick" className="label">
            หมวดบัญชี <span className="text-bad">*</span>
          </label>
          <ProductPicker
            products={categoryItems}
            value={categoryId}
            onChange={setCategoryId}
            name="category_id"
            inputId="category_pick"
            thumbs={false}
            placeholder="เลือกหมวดบัญชี — พิมพ์ค้นหา เช่น ไฟ เช่า"
            invalid={!categoryId && (!!missing || !!err("categoryId"))}
          />
          {err("categoryId") && (
            <p className="mt-1 text-xs text-bad">{err("categoryId")}</p>
          )}
        </div>

        <div>
          <label htmlFor="default_amount" className="label">
            ยอดตั้งต้น <span className="text-bad">*</span>
          </label>
          <MoneyInput
            id="default_amount"
            name="default_amount"
            defaultValue={existing?.defaultAmount ?? ""}
            boxClassName="mt-1 w-40"
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
          <label htmlFor="day_of_month" className="label">
            ครบกำหนดวันที่ <span className="text-bad">*</span>
          </label>
          <QtyStepper
            defaultValue={String(existing?.dayOfMonth ?? 5)}
            min={1}
            label="ครบกำหนดวันที่"
            className="mt-1"
            inputProps={{ id: "day_of_month", name: "day_of_month", max: 28, required: true }}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            ได้ถึงวันที่ 28 เท่านั้น — วันที่ 29-31 จะข้ามเดือนกุมภาพันธ์
          </p>
          {err("dayOfMonth") && (
            <p className="mt-1 text-xs text-bad">{err("dayOfMonth")}</p>
          )}
        </div>

        <div>
          <label htmlFor="start_period" className="label">
            เริ่มงวด <span className="text-bad">*</span>
          </label>
          <MonthPicker
            id="start_period"
            name="start_period"
            defaultValue={existing?.startPeriod ?? currentPeriod}
            fallbackYear={fallbackYear}
          />
          {err("startPeriod") && (
            <p className="mt-1 text-xs text-bad">{err("startPeriod")}</p>
          )}
        </div>

        <div>
          <label htmlFor="end_period" className="label">
            ถึงงวด
          </label>
          <MonthPicker
            id="end_period"
            name="end_period"
            defaultValue={existing?.endPeriod ?? ""}
            fallbackYear={fallbackYear}
            emptyLabel="ไม่มีกำหนดจบ"
          />
          {err("endPeriod") && (
            <p className="mt-1 text-xs text-bad">{err("endPeriod")}</p>
          )}
        </div>

        <div>
          <span className="label">VAT</span>
          <VatChips
            rate={vatRate}
            inclusive={inclusive}
            onChange={(r, inc) => {
              setVatRate(r);
              setInclusive(inc);
            }}
          />
          {err("vatRatePercent") && (
            <p className="mt-1 text-xs text-bad">{err("vatRatePercent")}</p>
          )}
        </div>

        <div>
          <span className="label">หักภาษี ณ ที่จ่าย</span>
          <WhtChips rate={whtRate} onChange={setWhtRate} />
          <p className="mt-1 text-xs text-muted-foreground">ค่าเช่ามักหัก 5% ค่าบริการ 3%</p>
          {err("whtRatePercent") && (
            <p className="mt-1 text-xs text-bad">{err("whtRatePercent")}</p>
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
          className="btn"
        >
          {isPending ? "กำลังบันทึก…" : existing ? "บันทึกการแก้ไข" : "เพิ่มรายการประจำ"}
        </button>
        <a
          href="/expenses/recurring"
          className="btn-secondary"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}

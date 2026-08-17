"use client";

// Sprint 3 Part 16 L5b — the bill form, shared by create and edit.
//
// Three things it is careful about:
//
//   * **The running total is a PREVIEW, not the answer.** Every stored figure is
//     recomputed server-side in `Prisma.Decimal` (ADR 0016 Q3). This arithmetic
//     exists so a user can see what 7% does to their bill before saving; if the
//     two ever disagree the server's is the one that counts, and the label says
//     so rather than implying a guarantee it cannot make.
//   * **VAT direction is a choice, shown as one.** A Thai shop's bill usually
//     quotes the total (inclusive); a tax invoice shows both. Which way the maths
//     ran is not recoverable from the results (Decision #36), so it is a visible
//     switch and not a hidden default.
//   * **A bill created by a goods receipt renders its own fields read-only.** The
//     server refuses them anyway (Q3.4) — this is so nobody types into a box that
//     was never going to be saved.

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseActionState } from "../actions";
import type { ExpenseDetailView } from "./expense-view";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-muted/50 disabled:text-muted-foreground";
const labelClass = "block text-sm font-medium";

export type CategoryOption = {
  id: string;
  account: string;
  accountingSection: string;
  groupName: string;
};

type LineDraft = {
  key: string;
  categoryId: string;
  description: string;
  qty: string;
  unitPrice: string;
  lineTotal: string;
};

const blankLine = (categoryId: string): LineDraft => ({
  key: Math.random().toString(36).slice(2),
  categoryId,
  description: "",
  qty: "",
  unitPrice: "",
  lineTotal: "",
});

const money = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ExpenseForm({
  action,
  branches,
  suppliers,
  categories,
  todayBangkok,
  existing,
  prefill,
}: {
  action: (
    prev: ExpenseActionState,
    fd: FormData
  ) => Promise<ExpenseActionState>;
  branches: { id: string; name: string }[];
  suppliers: { id: string; label: string }[];
  categories: CategoryOption[];
  todayBangkok: string;
  /** Present when editing. */
  existing?: ExpenseDetailView;
  /** Present when confirming a recurring template (ADR 0016 Q5). */
  prefill?: {
    recurringExpenseId: string;
    period: string;
    description: string;
    branchId: string;
    supplierId: string | null;
    categoryId: string;
    defaultAmount: string;
    isPriceVatInclusive: boolean;
    vatRatePercent: string | null;
    subjectToWht: boolean;
    whtRatePercent: string | null;
  };
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as ExpenseActionState
  );

  const locked = existing?.source === "FROM_GOODS_RECEIPT";
  const firstCategory = categories[0]?.id ?? "";

  const [branchId, setBranchId] = useState(
    existing?.branchId ?? prefill?.branchId ?? branches[0]?.id ?? ""
  );
  const [vatRate, setVatRate] = useState(
    existing?.vatRatePercent ?? prefill?.vatRatePercent ?? ""
  );
  const [inclusive, setInclusive] = useState(
    existing?.isPriceVatInclusive ?? prefill?.isPriceVatInclusive ?? true
  );
  const [subjectToWht, setSubjectToWht] = useState(
    existing?.subjectToWht ?? prefill?.subjectToWht ?? false
  );
  const [whtRate, setWhtRate] = useState(
    existing?.whtRatePercent ?? prefill?.whtRatePercent ?? ""
  );
  const [paymentStatus, setPaymentStatus] = useState(
    existing?.paymentStatus ?? "UNPAID"
  );
  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (existing) {
      // A stored line is ALWAYS net of VAT, but the form asks for what the user
      // types — and on a VAT-inclusive bill that is the gross figure printed on
      // the paper. Showing the net one here would make the server back the tax
      // out a second time, and the bill would shrink by 7% on every edit.
      const storedRate = Number(existing.vatRatePercent ?? 0);
      const grossUp =
        existing.isPriceVatInclusive && storedRate > 0
          ? (net: string) => ((Number(net) || 0) * (1 + storedRate / 100)).toFixed(2)
          : (net: string) => net;

      return existing.items.map((item) => ({
        key: item.id,
        categoryId: item.categoryId,
        description: item.description,
        qty: item.qty ?? "",
        unitPrice: item.unitPrice ?? "",
        lineTotal: grossUp(item.totalPrice),
      }));
    }
    if (prefill) {
      return [
        {
          ...blankLine(prefill.categoryId),
          description: prefill.description,
          lineTotal: prefill.defaultAmount,
        },
      ];
    }
    return [blankLine(firstCategory)];
  });

  useEffect(() => {
    if (state.ok) router.push(`/expenses/${state.expenseId}`);
  }, [state, router]);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const err = (field: string) => fieldErrors?.[field];

  // --- the preview (see the header note: display only) ---
  const typedTotal = lines.reduce((sum, l) => sum + (Number(l.lineTotal) || 0), 0);
  const rate = Number(vatRate) || 0;
  const subtotal = rate > 0 && inclusive ? typedTotal / (1 + rate / 100) : typedTotal;
  const vat = rate > 0 ? (inclusive ? typedTotal - subtotal : (subtotal * rate) / 100) : 0;
  const total = subtotal + vat;
  const wht = subjectToWht ? (subtotal * (Number(whtRate) || 0)) / 100 : 0;

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form action={formAction} className="space-y-6">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      {prefill && (
        <>
          <input
            type="hidden"
            name="recurring_expense_id"
            value={prefill.recurringExpenseId}
          />
          <input type="hidden" name="period" value={prefill.period} />
        </>
      )}
      {existing?.recurringExpenseId && (
        <>
          <input
            type="hidden"
            name="recurring_expense_id"
            value={existing.recurringExpenseId}
          />
          <input type="hidden" name="period" value={existing.period ?? ""} />
        </>
      )}

      {formError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      {locked && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
          บิลนี้สร้างจากใบรับของ{" "}
          {existing?.sourceGrNumber && (
            <a
              href={`/goods-receipts/${existing.sourceGrId}`}
              className="font-medium underline"
            >
              {existing.sourceGrNumber}
            </a>
          )}{" "}
          — ยอดเงิน สาขา ผู้ขาย และรายการ แก้ที่นี่ไม่ได้
          ให้แก้ที่ใบรับของ ส่วนเลขใบกำกับภาษี ภาษีหัก ณ ที่จ่าย และการจ่ายเงิน แก้ได้
        </div>
      )}

      {/* ---------------- header ---------------- */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="branch_id" className={labelClass}>
            สาขา <span className="text-red-600">*</span>
          </label>
          <select
            id="branch_id"
            name="branch_id"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={`${inputClass} mt-1`}
            disabled={locked}
            required
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {/* A disabled control posts nothing, so the value is carried by hand. */}
          {locked && <input type="hidden" name="branch_id" value={branchId} />}
          {err("branchId") && (
            <p className="mt-1 text-xs text-red-600">{err("branchId")}</p>
          )}
        </div>

        <div>
          <label htmlFor="supplier_id" className={labelClass}>
            ผู้ขาย
          </label>
          <select
            id="supplier_id"
            name="supplier_id"
            defaultValue={existing?.supplierId ?? prefill?.supplierId ?? ""}
            className={`${inputClass} mt-1`}
            disabled={locked}
          >
            <option value="">ไม่ระบุ (เช่น ค่าไฟ ค่าเช่า)</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {locked && (
            <input
              type="hidden"
              name="supplier_id"
              value={existing?.supplierId ?? ""}
            />
          )}
          {err("supplierId") && (
            <p className="mt-1 text-xs text-red-600">{err("supplierId")}</p>
          )}
        </div>

        <div>
          <label htmlFor="bill_date" className={labelClass}>
            วันที่บิล <span className="text-red-600">*</span>
          </label>
          <input
            id="bill_date"
            name="bill_date"
            type="date"
            defaultValue={existing?.billDate ?? todayBangkok}
            className={`${inputClass} mt-1`}
            disabled={locked}
            required
          />
          {locked && (
            <input type="hidden" name="bill_date" value={existing!.billDate} />
          )}
          {err("billDate") && (
            <p className="mt-1 text-xs text-red-600">{err("billDate")}</p>
          )}
        </div>

        <div>
          <label htmlFor="bill_no" className={labelClass}>
            เลขที่บิล / ใบส่งของ
          </label>
          <input
            id="bill_no"
            name="bill_no"
            defaultValue={existing?.billNo ?? ""}
            className={`${inputClass} mt-1`}
            disabled={locked}
          />
          {locked && (
            <input type="hidden" name="bill_no" value={existing?.billNo ?? ""} />
          )}
          {err("billNo") && (
            <p className="mt-1 text-xs text-red-600">{err("billNo")}</p>
          )}
        </div>

        <div>
          <label htmlFor="vat_invoice_no" className={labelClass}>
            เลขที่ใบกำกับภาษี
          </label>
          <input
            id="vat_invoice_no"
            name="vat_invoice_no"
            defaultValue={existing?.vatInvoiceNo ?? ""}
            className={`${inputClass} mt-1`}
          />
        </div>

        <div>
          <label htmlFor="payment_method" className={labelClass}>
            วิธีชำระเงิน
          </label>
          <input
            id="payment_method"
            name="payment_method"
            placeholder="เงินสด / โอน / บัตร"
            defaultValue={existing?.paymentMethod ?? ""}
            className={`${inputClass} mt-1`}
          />
        </div>
      </section>

      {/* ---------------- lines ---------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">รายการในบิล</h3>
          {!locked && (
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, blankLine(firstCategory)])}
              className="rounded-lg border border-border px-3 py-1 text-xs font-medium"
            >
              + เพิ่มรายการ
            </button>
          )}
        </div>

        {err("items") && <p className="text-xs text-red-600">{err("items")}</p>}
        {err("categoryId") && (
          <p className="text-xs text-red-600">{err("categoryId")}</p>
        )}

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div
              key={line.key}
              className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-12"
            >
              <div className="sm:col-span-4">
                <label className={`${labelClass} text-xs`}>หมวดบัญชี</label>
                <select
                  name="item_category_id"
                  value={line.categoryId}
                  onChange={(e) => updateLine(line.key, { categoryId: e.target.value })}
                  className={`${inputClass} mt-1`}
                  disabled={locked}
                  required
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.account} · {c.accountingSection} · {c.groupName}
                    </option>
                  ))}
                </select>
                {locked && (
                  <input type="hidden" name="item_category_id" value={line.categoryId} />
                )}
              </div>

              <div className="sm:col-span-4">
                <label className={`${labelClass} text-xs`}>รายละเอียด</label>
                <input
                  name="item_description"
                  value={line.description}
                  onChange={(e) => updateLine(line.key, { description: e.target.value })}
                  className={`${inputClass} mt-1`}
                  disabled={locked}
                  required
                />
                {locked && (
                  <input type="hidden" name="item_description" value={line.description} />
                )}
              </div>

              <div className="sm:col-span-1">
                <label className={`${labelClass} text-xs`}>จำนวน</label>
                <input
                  name="item_qty"
                  inputMode="decimal"
                  value={line.qty}
                  onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                  className={`${inputClass} mt-1`}
                  disabled={locked}
                />
                {locked && <input type="hidden" name="item_qty" value={line.qty} />}
              </div>

              <div className="sm:col-span-1">
                <label className={`${labelClass} text-xs`}>ราคา/หน่วย</label>
                <input
                  name="item_unit_price"
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                  className={`${inputClass} mt-1`}
                  disabled={locked}
                />
                {locked && (
                  <input type="hidden" name="item_unit_price" value={line.unitPrice} />
                )}
              </div>

              <div className="sm:col-span-2">
                <label className={`${labelClass} text-xs`}>
                  จำนวนเงิน <span className="text-red-600">*</span>
                </label>
                <input
                  name="item_line_total"
                  inputMode="decimal"
                  value={line.lineTotal}
                  onChange={(e) => updateLine(line.key, { lineTotal: e.target.value })}
                  className={`${inputClass} mt-1 text-right tabular-nums`}
                  disabled={locked}
                  required
                />
                {locked && (
                  <input type="hidden" name="item_line_total" value={line.lineTotal} />
                )}
              </div>

              {/* These two are only ever set by the goods-receipt hook, but they
                  must be posted for every row so the parallel arrays stay aligned
                  by index. */}
              <input type="hidden" name="item_department_id" value="" />
              <input
                type="hidden"
                name="item_product_id"
                value={existing?.items[index]?.productId ?? ""}
              />
              <input
                type="hidden"
                name="item_product_unit_id"
                value={existing?.items[index]?.productUnitId ?? ""}
              />

              {!locked && lines.length > 1 && (
                <div className="sm:col-span-12">
                  <button
                    type="button"
                    onClick={() =>
                      setLines((prev) => prev.filter((l) => l.key !== line.key))
                    }
                    className="text-xs text-red-600 hover:underline"
                  >
                    ลบรายการนี้
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- tax ---------------- */}
      <section className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
        <div>
          <label htmlFor="vat_rate_percent" className={labelClass}>
            อัตรา VAT (%)
          </label>
          <input
            id="vat_rate_percent"
            name="vat_rate_percent"
            inputMode="decimal"
            placeholder="เว้นว่าง = บิลนี้ไม่มี VAT"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
            className={`${inputClass} mt-1`}
            disabled={locked}
          />
          {locked && (
            <input type="hidden" name="vat_rate_percent" value={vatRate} />
          )}
          {err("vatRatePercent") && (
            <p className="mt-1 text-xs text-red-600">{err("vatRatePercent")}</p>
          )}
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_price_vat_inclusive"
              checked={inclusive}
              onChange={(e) => setInclusive(e.target.checked)}
              disabled={locked}
            />
            ราคาที่กรอกรวม VAT แล้ว
          </label>
          {locked && inclusive && (
            <input type="hidden" name="is_price_vat_inclusive" value="on" />
          )}
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
          {subjectToWht && (
            <div className="mt-2 space-y-2">
              <input
                name="wht_rate_percent"
                inputMode="decimal"
                placeholder="อัตรา % (เช่น 3)"
                value={whtRate}
                onChange={(e) => setWhtRate(e.target.value)}
                className={inputClass}
              />
              {err("whtRatePercent") && (
                <p className="text-xs text-red-600">{err("whtRatePercent")}</p>
              )}
              <input
                name="wht_certificate_no"
                placeholder="เลขที่หนังสือรับรอง 50 ทวิ"
                defaultValue={existing?.whtCertificateNo ?? ""}
                className={inputClass}
              />
              <p className="text-xs text-muted-foreground">
                คิดจากยอด<strong>ก่อน VAT</strong> — 10,000 + VAT 7% หัก 3% = 300 บาท
                (ไม่ใช่ 321)
              </p>
            </div>
          )}
          {!subjectToWht && <input type="hidden" name="wht_rate_percent" value="" />}
        </div>
      </section>

      {/* ---------------- payment + preview ---------------- */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="payment_status" className={labelClass}>
            สถานะการจ่ายเงิน
          </label>
          <select
            id="payment_status"
            name="payment_status"
            value={paymentStatus}
            onChange={(e) =>
              setPaymentStatus(e.target.value as "UNPAID" | "PAID")
            }
            className={`${inputClass} mt-1`}
          >
            <option value="UNPAID">ยังไม่จ่าย</option>
            <option value="PAID">จ่ายแล้ว</option>
          </select>
          {paymentStatus === "PAID" && (
            <div className="mt-2">
              <label htmlFor="paid_at" className={`${labelClass} text-xs`}>
                วันที่จ่าย (เว้นว่าง = วันนี้)
              </label>
              <input
                id="paid_at"
                name="paid_at"
                type="date"
                defaultValue={existing?.paidAt?.slice(0, 10) ?? ""}
                className={`${inputClass} mt-1`}
              />
            </div>
          )}
          {err("paidAt") && (
            <p className="mt-1 text-xs text-red-600">{err("paidAt")}</p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">ยอดก่อน VAT</span>
            <span className="tabular-nums">{money(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT</span>
            <span className="tabular-nums">{money(vat)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>ยอดรวม</span>
            <span className="tabular-nums">{money(total)}</span>
          </div>
          {subjectToWht && (
            <>
              <div className="flex justify-between text-muted-foreground">
                <span>หัก ณ ที่จ่าย</span>
                <span className="tabular-nums">−{money(wht)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>จ่ายจริง</span>
                <span className="tabular-nums">{money(total - wht)}</span>
              </div>
            </>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            ตัวเลขนี้เป็นการคำนวณให้ดูก่อนบันทึก — ยอดที่บันทึกจริงคำนวณที่เซิร์ฟเวอร์
          </p>
        </div>
      </section>

      <div>
        <label htmlFor="notes" className={labelClass}>
          หมายเหตุ
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={existing?.notes ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก…" : existing ? "บันทึกการแก้ไข" : "บันทึกค่าใช้จ่าย"}
        </button>
        <a
          href={existing ? `/expenses/${existing.id}` : "/expenses"}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}

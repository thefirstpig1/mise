"use client";

// Sprint 3 Part 16 L5b — the bill form, shared by create and edit.
// Reworked in the expense review (Kong 2026-10-27, mockup Qzmu2bZFH9YABpu7pP6SR9).
//
// Things it is careful about:
//
//   * **The running total is a PREVIEW, not the answer.** Every stored figure is
//     recomputed server-side in `Prisma.Decimal` (ADR 0016 Q3). This arithmetic
//     exists so a user can see what 7% does to their bill before saving; the
//     label says the system works it out again, rather than implying a guarantee.
//   * **The supplier comes first and fills in what it knows** — its VAT and
//     withholding (the same rule as the purchase order, ADR 0036 Q7) and the
//     category on its last hand-entered bill. Only a CHANGE the person makes
//     fills anything: opening a saved bill never rewrites it.
//   * **No category is guessed.** The old form defaulted every line to the
//     first category in the list, so a bill saved without looking landed in
//     "ภาชนะใช้ครั้งเดียว". A line now starts empty unless the supplier says.
//   * **A bill created by a goods receipt renders its own fields read-only.** The
//     server refuses them anyway (Q3.4) — this is so nobody types into a box that
//     was never going to be saved.

import { useActionState, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import { MeasureInput, MoneyInput } from "@/components/ui/NumberField";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import { useRouter } from "next/navigation";
import { ACCOUNT_TH, categoryLabelTh } from "@/lib/expense-labels";
import type { ExpenseActionState } from "../actions";
import type { ExpenseDetailView, ExpenseSupplierOption } from "./expense-view";
import { Chips, MethodChips, VatChips, WhtChips } from "./TaxChips";

export type CategoryOption = {
  id: string;
  account: string;
  accountingSection: string;
  groupName: string;
};

type LineDraft = {
  key: string;
  categoryId: string;
  /** Filled in from the supplier's last bill, not chosen — says so on screen. */
  categoryAuto: boolean;
  description: string;
  qty: string;
  unitPrice: string;
  lineTotal: string;
};

const blankLine = (categoryId = "", categoryAuto = false): LineDraft => ({
  key: Math.random().toString(36).slice(2),
  categoryId,
  categoryAuto,
  description: "",
  qty: "",
  unitPrice: "",
  lineTotal: "",
});

const money = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** qty × price, or null while either is missing. */
const product = (qty: string, price: string) => {
  const q = Number(qty);
  const p = Number(price);
  return qty.trim() !== "" && price.trim() !== "" && Number.isFinite(q) && Number.isFinite(p)
    ? (q * p).toFixed(2)
    : null;
};

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
  suppliers: ExpenseSupplierOption[];
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

  const [supplierId, setSupplierId] = useState(
    existing?.supplierId ?? prefill?.supplierId ?? ""
  );
  const [branchId, setBranchId] = useState(
    existing?.branchId ?? prefill?.branchId ?? (branches.length === 1 ? branches[0].id : "")
  );
  const [vatRate, setVatRate] = useState(
    existing?.vatRatePercent ?? prefill?.vatRatePercent ?? ""
  );
  const [inclusive, setInclusive] = useState(
    existing?.isPriceVatInclusive ?? prefill?.isPriceVatInclusive ?? true
  );
  const initialWht = existing
    ? existing.subjectToWht ? (existing.whtRatePercent ?? "") : ""
    : prefill?.subjectToWht ? (prefill.whtRatePercent ?? "") : "";
  const [whtRate, setWhtRate] = useState(initialWht);
  /** Which of VAT / withholding the supplier filled in (cleared on a manual change). */
  const [taxAuto, setTaxAuto] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(
    existing?.paymentStatus ?? "UNPAID"
  );
  const [paymentMethod, setPaymentMethod] = useState(existing?.paymentMethod ?? "");
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
        categoryAuto: false,
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
    return [blankLine()];
  });

  useEffect(() => {
    if (state.ok) router.push(`/expenses/${state.expenseId}` as Route);
  }, [state, router]);

  // Said before the server is asked: an empty branch or category would come
  // back as "ไม่ถูกต้อง", which reads as if the person chose something wrong.
  const [missing, setMissing] = useState<string | null>(null);
  const formError = missing ?? (state.ok === false ? state.formError : undefined);
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const err = (field: string) => fieldErrors?.[field];

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const supplier = supplierId ? supplierById.get(supplierId) : undefined;

  const supplierItems: PickerProduct[] = useMemo(
    () =>
      suppliers.map((s) => ({
        id: s.id,
        name: s.label,
        sku: "",
        imageUrl: null,
        section: "ผู้ขาย",
        group: null,
        baseUnitName: null,
        detail: s.fullName,
      })),
    [suppliers]
  );
  const categoryItems: PickerProduct[] = useMemo(
    () =>
      categories.map((c) => ({
        id: c.id,
        name: c.groupName,
        sku: "",
        imageUrl: null,
        section: ACCOUNT_TH[c.account] ?? c.account,
        group: null,
        baseUnitName: null,
        detail: c.accountingSection,
      })),
    [categories]
  );
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  /** A person chose a supplier: fill in what it knows, and only that. */
  const chooseSupplier = (id: string) => {
    setSupplierId(id);
    const s = id ? supplierById.get(id) : undefined;
    if (s) {
      setVatRate(s.vatRatePercent ?? "");
      setInclusive(s.vatRatePercent ? s.pricesIncludeVat : true);
      setWhtRate(s.subjectToWht ? (s.whtRatePercent ?? "") : "");
      setTaxAuto(true);
    } else if (taxAuto) {
      // The previous supplier's tax was never the person's answer — take it back.
      setVatRate("");
      setInclusive(true);
      setWhtRate("");
      setTaxAuto(false);
    }
    // Lines still empty, or still holding the previous supplier's guess, follow.
    const last = s?.lastCategoryId ?? null;
    setLines((prev) =>
      prev.map((l) =>
        l.categoryId === "" || l.categoryAuto
          ? { ...l, categoryId: last ?? "", categoryAuto: last !== null }
          : l
      )
    );
  };

  // --- the preview (see the header note: display only) ---
  const typedTotal = lines.reduce((sum, l) => sum + (Number(l.lineTotal) || 0), 0);
  const rate = Number(vatRate) || 0;
  const subtotal = rate > 0 && inclusive ? typedTotal / (1 + rate / 100) : typedTotal;
  const vat = rate > 0 ? (inclusive ? typedTotal - subtotal : (subtotal * rate) / 100) : 0;
  const total = subtotal + vat;
  const wht = whtRate ? (subtotal * (Number(whtRate) || 0)) / 100 : 0;

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  /** Typing a quantity or a price works the amount out; the amount stays editable (a discount). */
  const updateQtyPrice = (l: LineDraft, patch: { qty?: string; unitPrice?: string }) => {
    const next = { ...l, ...patch };
    const auto = product(next.qty, next.unitPrice);
    updateLine(l.key, auto === null ? patch : { ...patch, lineTotal: auto });
  };

  const autoTag = (
    <span className="ml-2 inline-flex items-center rounded-full border border-good-border bg-good-bg px-2 py-0.5 text-xs font-semibold text-good">
      ✓ ตามค่าของผู้ขาย
    </span>
  );

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const gap = !branchId
          ? "กรุณาเลือกสาขา"
          : lines.some((l) => !l.categoryId)
            ? "กรุณาเลือกหมวดบัญชีให้ทุกรายการ"
            : null;
        setMissing(gap);
        if (gap) {
          e.preventDefault();
          // The message sits at the top; the button is at the bottom.
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }}
      className="space-y-6"
    >
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

      {!existing && !prefill && (
        <p className="rounded-lg border border-border bg-surface-sunk px-4 py-3 text-sm text-muted-foreground">
          ซื้อวัตถุดิบเข้าสต๊อก เช่น หมู ผัก ข้าวสาร? กรุณาบันทึกที่{" "}
          <a href="/goods-receipts/new" className="font-medium text-primary underline">
            หน้ารับของ (ซื้อสดได้ ไม่ต้องมีใบสั่งซื้อ)
          </a>{" "}
          แทน ของจะเข้าสต๊อกและต้นทุนจะถูกต้อง ระบบจะสร้างบิลค่าใช้จ่ายให้เอง
        </p>
      )}

      {formError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {formError}
        </div>
      )}

      {locked && (
        <div className="rounded-lg border border-border-strong bg-muted p-3 text-sm text-foreground">
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
      <section className="grid gap-5 sm:grid-cols-2">
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
            placeholder="ไม่ระบุผู้ขาย (เช่น ค่าไฟ ค่าเช่า) — พิมพ์ชื่อเพื่อค้นหา"
            disabledText={locked ? (supplier?.label ?? existing?.supplierName ?? "ไม่ระบุผู้ขาย") : undefined}
          />
          {!locked && !existing && (
            <p className="mt-1 text-xs text-muted-foreground">
              เลือกผู้ขายก่อน ระบบจะเติม VAT หัก ณ ที่จ่าย และหมวดที่ผู้ขายรายนี้ใช้ครั้งล่าสุดให้ แก้ได้ทุกช่อง
            </p>
          )}
          {err("supplierId") && (
            <p className="mt-1 text-xs text-bad">{err("supplierId")}</p>
          )}
        </div>

        <div>
          <span className="label">
            สาขา <span className="text-bad">*</span>
          </span>
          {branches.length === 1 || locked ? (
            <p className="mt-1 flex h-10 items-center text-sm">
              {branches.find((b) => b.id === branchId)?.name ?? existing?.branchName ?? "—"}
            </p>
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
          <label htmlFor="bill_date" className="label">
            วันที่บิล <span className="text-bad">*</span>
          </label>
          <input
            id="bill_date"
            name="bill_date"
            type="date"
            defaultValue={existing?.billDate ?? todayBangkok}
            className={"input w-full disabled:bg-muted/50 disabled:text-muted-foreground mt-1"}
            disabled={locked}
            required
          />
          {locked && (
            <input type="hidden" name="bill_date" value={existing!.billDate} />
          )}
          {err("billDate") && (
            <p className="mt-1 text-xs text-bad">{err("billDate")}</p>
          )}
        </div>

        <div>
          <label htmlFor="bill_no" className="label">
            เลขที่บิล / ใบส่งของ
          </label>
          <input
            id="bill_no"
            name="bill_no"
            placeholder="ถ้ามี"
            defaultValue={existing?.billNo ?? ""}
            className={"input w-full disabled:bg-muted/50 disabled:text-muted-foreground mt-1"}
            disabled={locked}
          />
          {locked && (
            <input type="hidden" name="bill_no" value={existing?.billNo ?? ""} />
          )}
          {err("billNo") && (
            <p className="mt-1 text-xs text-bad">{err("billNo")}</p>
          )}
        </div>
      </section>

      {/* ---------------- lines ---------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">รายการในบิล</h3>
          {!locked && (
            <button
              type="button"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  blankLine(supplier?.lastCategoryId ?? "", !!supplier?.lastCategoryId),
                ])
              }
              className="rounded-full border border-border-strong px-3 py-1 text-xs font-medium hover:border-primary-line"
            >
              + เพิ่มรายการ
            </button>
          )}
        </div>

        {err("items") && <p className="text-xs text-bad">{err("items")}</p>}
        {err("categoryId") && (
          <p className="text-xs text-bad">{err("categoryId")}</p>
        )}

        <div className="space-y-3">
          {lines.map((line, index) => {
            const cat = categoryById.get(line.categoryId);
            return (
              <div
                key={line.key}
                className="grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-12"
              >
                <div className="sm:col-span-5">
                  <span className="label text-xs">
                    หมวดบัญชี <span className="text-bad">*</span>
                    {line.categoryAuto && (
                      <span className="ml-2 font-normal text-good">✓ ใช้ครั้งล่าสุดกับผู้ขายนี้</span>
                    )}
                  </span>
                  <div className={line.categoryId === "" ? "[&_input]:border-warn-border" : ""}>
                    <ProductPicker
                      products={categoryItems}
                      value={line.categoryId}
                      onChange={(id) => updateLine(line.key, { categoryId: id, categoryAuto: false })}
                      name="item_category_id"
                      thumbs={false}
                      placeholder="เลือกหมวดบัญชี — พิมพ์ค้นหา เช่น ไฟ เช่า ทำความสะอาด"
                      invalid={line.categoryId === "" && (!!missing || !!err("categoryId"))}
                      disabledText={locked ? (cat ? categoryLabelTh(cat) : "—") : undefined}
                    />
                  </div>
                </div>

                <div className="sm:col-span-7">
                  <label className={"label text-xs"}>
                    รายละเอียด <span className="text-bad">*</span>
                  </label>
                  <input
                    name="item_description"
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    className={"input w-full disabled:bg-muted/50 disabled:text-muted-foreground mt-1"}
                    disabled={locked}
                    required
                  />
                  {locked && (
                    <input type="hidden" name="item_description" value={line.description} />
                  )}
                </div>

                <div className="sm:col-span-3">
                  <label className={"label text-xs"}>จำนวน</label>
                  <MeasureInput
                    name="item_qty"
                    unit=""
                    value={line.qty}
                    onChange={(e) => updateQtyPrice(line, { qty: e.target.value })}
                    boxClassName="mt-1 w-full"
                    disabled={locked}
                  />
                  {locked && <input type="hidden" name="item_qty" value={line.qty} />}
                </div>

                <div className="sm:col-span-4">
                  <label className={"label text-xs"}>ราคา/หน่วย</label>
                  <MoneyInput
                    name="item_unit_price"
                    value={line.unitPrice}
                    onChange={(e) => updateQtyPrice(line, { unitPrice: e.target.value })}
                    boxClassName="mt-1 w-full"
                    disabled={locked}
                  />
                  {locked && (
                    <input type="hidden" name="item_unit_price" value={line.unitPrice} />
                  )}
                </div>

                <div className="sm:col-span-5">
                  <label className={"label text-xs"}>
                    จำนวนเงิน <span className="text-bad">*</span>
                  </label>
                  <MoneyInput
                    name="item_line_total"
                    value={line.lineTotal}
                    onChange={(e) => updateLine(line.key, { lineTotal: e.target.value })}
                    boxClassName="mt-1 w-full"
                    disabled={locked}
                    required
                  />
                  {locked && (
                    <input type="hidden" name="item_line_total" value={line.lineTotal} />
                  )}
                  {!locked && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      จำนวน × ราคา คิดให้เอง พิมพ์ทับได้ถ้าบิลมีส่วนลด
                    </p>
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
                      className="text-xs text-bad hover:underline"
                    >
                      ลบรายการนี้
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------- tax ---------------- */}
      <section className="grid gap-5 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2">
        <div>
          <span className="label">
            VAT
            {taxAuto && supplier && autoTag}
          </span>
          <VatChips
            rate={vatRate}
            inclusive={inclusive}
            disabled={locked}
            onChange={(r, inc) => {
              setVatRate(r);
              setInclusive(inc);
              setTaxAuto(false);
            }}
          />
          {err("vatRatePercent") && (
            <p className="mt-1 text-xs text-bad">{err("vatRatePercent")}</p>
          )}
          <div className="mt-3">
            <label htmlFor="vat_invoice_no" className="label text-xs">
              เลขที่ใบกำกับภาษี
            </label>
            <input
              id="vat_invoice_no"
              name="vat_invoice_no"
              placeholder="ถ้ามี"
              defaultValue={existing?.vatInvoiceNo ?? ""}
              className="input mt-1 w-full"
            />
          </div>
        </div>

        <div>
          <span className="label">หักภาษี ณ ที่จ่าย</span>
          <WhtChips
            rate={whtRate}
            onChange={(r) => {
              setWhtRate(r);
              setTaxAuto(false);
            }}
          />
          {err("whtRatePercent") && (
            <p className="mt-1 text-xs text-bad">{err("whtRatePercent")}</p>
          )}
          {whtRate && (
            <div className="mt-3 space-y-2">
              <label htmlFor="wht_certificate_no" className="label text-xs">
                เลขที่หนังสือรับรอง 50 ทวิ
              </label>
              <input
                id="wht_certificate_no"
                name="wht_certificate_no"
                placeholder="ถ้าออกให้แล้ว"
                defaultValue={existing?.whtCertificateNo ?? ""}
                className="input w-full"
              />
              <p className="text-xs text-muted-foreground">
                คิดจากยอด<strong>ก่อน VAT</strong> — 10,000 + VAT 7% หัก 3% = 300 บาท
                (ไม่ใช่ 321)
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ---------------- payment + preview ---------------- */}
      <section className="grid items-start gap-5 sm:grid-cols-2">
        <div className="space-y-4">
          <div>
            <span className="label">การจ่ายเงิน</span>
            <Chips
              label="การจ่ายเงิน"
              options={[
                { value: "UNPAID", label: "ยังไม่จ่าย" },
                { value: "PAID", label: "จ่ายแล้ว" },
              ]}
              value={paymentStatus}
              onChange={(v) => setPaymentStatus(v as "UNPAID" | "PAID")}
            />
            <input type="hidden" name="payment_status" value={paymentStatus} />
          </div>
          {paymentStatus === "PAID" ? (
            <>
              <div>
                <span className="label text-xs">จ่ายด้วย</span>
                <MethodChips value={paymentMethod} onChange={setPaymentMethod} />
              </div>
              <div>
                <label htmlFor="paid_at" className={"label text-xs"}>
                  วันที่จ่าย (เว้นว่าง = วันนี้)
                </label>
                <input
                  id="paid_at"
                  name="paid_at"
                  type="date"
                  defaultValue={existing?.paidAt?.slice(0, 10) ?? ""}
                  className={"input w-full mt-1"}
                />
              </div>
            </>
          ) : (
            // Keep a method typed before switching back to ยังไม่จ่าย.
            <input type="hidden" name="payment_method" value={paymentMethod} />
          )}
          {err("paidAt") && (
            <p className="mt-1 text-xs text-bad">{err("paidAt")}</p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface-sunk p-4 text-sm">
          <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground">ยอดก่อน VAT</span>
            <span className="tabular-nums">{money(subtotal)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground">VAT</span>
            <span className="tabular-nums">{rate > 0 ? money(vat) : "ไม่มี"}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-wash pt-2 font-semibold">
            <span>ยอดรวม</span>
            <span className="tabular-nums text-base">฿{money(total)}</span>
          </div>
          {whtRate && (
            <>
              <div className="flex justify-between py-0.5 text-muted-foreground">
                <span>หัก ณ ที่จ่าย {Number(whtRate)}%</span>
                <span className="tabular-nums">−{money(wht)}</span>
              </div>
              <div className="flex justify-between py-0.5 font-semibold">
                <span>จ่ายจริง</span>
                <span className="tabular-nums">฿{money(total - wht)}</span>
              </div>
            </>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            ยอดนี้ใช้ดูก่อนบันทึก ระบบจะคำนวณให้อีกครั้งตอนบันทึก
          </p>
        </div>
      </section>

      <div>
        <label htmlFor="notes" className="label">
          หมายเหตุ
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={existing?.notes ?? ""}
          className={"input w-full mt-1"}
        />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="btn"
        >
          {isPending ? "กำลังบันทึก…" : existing ? "บันทึกการแก้ไข" : "บันทึกค่าใช้จ่าย"}
        </button>
        <a
          href={existing ? `/expenses/${existing.id}` : "/expenses"}
          className="btn-secondary"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}

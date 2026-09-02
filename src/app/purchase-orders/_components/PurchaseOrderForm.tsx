"use client";

// Sprint 2 Part 11 L5b — the order form (shared by create and edit).
//
// Driven by React 19 useActionState. Input `name=` attributes are snake_case to
// match rawFromFormData in ../actions.ts; fieldErrors keys are the schema's
// camelCase names. Lines submit as PARALLEL ARRAYS (`line_product_id` repeated
// per row) which the action zips by index — FormData has no nested structure.
//
// Four things this form owns that the layers below deliberately do not:
//
//  1. **Price autofill.** Choosing a product asks the server for today's price
//     from this supplier at this branch (L3a's resolver). Found: the price, the
//     order unit and the provenance id are filled in, and the user can still
//     overwrite the number. Not found: the row stays blank and says so — that is
//     the hand-typed path (Q5), not an error.
//  2. **The totals preview.** Computed in JS `Number` and DISPLAY ONLY; the
//     authoritative subtotal/VAT/total come back from the server, which computes
//     them in Decimal and rounds VAT once on the subtotal.
//  3. **VAT prefill from the supplier.** A supplier that is not VAT-registered
//     blanks the rate, which is what "this order carries no VAT" looks like (Q6).
//     The user can always override — some suppliers register mid-year.
//  4. **The "sent orders are final" warning**, shown before the first save, not
//     after. The lock is the whole point of Q4 and finding out afterwards is the
//     worst time to learn it.

import { useActionState, useEffect, useMemo, useState } from "react";
import type { PurchaseOrderActionState } from "../actions";
import type { ResolvedPriceView } from "./purchase-order-view";

export type POUnitOption = {
  id: string;
  unitName: string;
  /** STRING (Pitfall #20) — used for display only in this component. */
  toBaseRatio: string;
  isBase: boolean;
};

export type POProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUnitName: string | null;
  units: POUnitOption[];
};

export type POSupplierOption = {
  id: string;
  nameFull: string;
  isVatRegistered: boolean;
  /** STRING or null (Pitfall #20). */
  defaultVatRatePercent: string | null;
};

export type POBranchOption = { id: string; name: string };

/** One editable row. `key` is client-only identity so React can track reorders. */
type LineRow = {
  key: string;
  productId: string;
  orderUnitId: string;
  qty: string;
  unitPrice: string;
  mappingId: string;
  notes: string;
  /** null = not looked up yet; "none" = looked up and there is no price. */
  priceScope: "branch" | "tenant" | "none" | null;
  minOrderQty: string | null;
};

export type PurchaseOrderFormInitial = {
  id: string;
  branchId: string;
  supplierId: string;
  expectedDeliveryDate: string;
  vatRatePercent: string;
  notes: string;
  lines: {
    productId: string;
    orderUnitId: string;
    qtyOrdered: string;
    unitPrice: string;
    supplierProductMappingId: string | null;
    notes: string | null;
  }[];
};

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "block text-sm font-medium";
const errorClass = "mt-1 text-xs text-bad";

let rowSeq = 0;
const newRow = (): LineRow => ({
  key: `r${rowSeq++}`,
  productId: "",
  orderUnitId: "",
  qty: "",
  unitPrice: "",
  mappingId: "",
  notes: "",
  priceScope: null,
  minOrderQty: null,
});

const n = (s: string) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

/** Display-only money formatting for the preview. */
const fmt = (v: number) =>
  v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PurchaseOrderForm({
  action,
  products,
  suppliers,
  branches,
  tenantDefaultVatRate,
  initial,
  resolvePrice,
}: {
  action: (
    prev: PurchaseOrderActionState,
    fd: FormData
  ) => Promise<PurchaseOrderActionState>;
  products: POProductOption[];
  suppliers: POSupplierOption[];
  branches: POBranchOption[];
  tenantDefaultVatRate: string;
  /** Present = edit mode; the order id travels in a hidden field. */
  initial?: PurchaseOrderFormInitial;
  /** Resolve today's price — the bound L4 action. */
  resolvePrice?: (query: {
    productId: string;
    supplierId: string;
    branchId: string;
  }) => Promise<
    { ok: true; data: ResolvedPriceView | null } | { ok: false; formError: string }
  >;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as PurchaseOrderActionState
  );

  const [branchId, setBranchId] = useState(
    initial?.branchId ?? branches[0]?.id ?? ""
  );
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [vatRate, setVatRate] = useState(initial?.vatRatePercent ?? "");
  const [rows, setRows] = useState<LineRow[]>(() =>
    initial?.lines.length
      ? initial.lines.map((l) => ({
          ...newRow(),
          productId: l.productId,
          orderUnitId: l.orderUnitId,
          qty: l.qtyOrdered,
          unitPrice: l.unitPrice,
          mappingId: l.supplierProductMappingId ?? "",
          notes: l.notes ?? "",
        }))
      : [newRow()]
  );

  const isEdit = Boolean(initial);
  const supplier = suppliers.find((s) => s.id === supplierId);

  // VAT follows the supplier — but only on a CHANGE the user made, never on
  // mount, or reopening a saved draft would silently rewrite its rate.
  const [vatTouchedFor, setVatTouchedFor] = useState(initial?.supplierId ?? "");
  useEffect(() => {
    if (!supplierId || supplierId === vatTouchedFor) return;
    setVatTouchedFor(supplierId);
    if (!supplier) return;
    setVatRate(
      supplier.isVatRegistered
        ? (supplier.defaultVatRatePercent ?? tenantDefaultVatRate)
        : ""
    );
  }, [supplierId, supplier, vatTouchedFor, tenantDefaultVatRate]);

  const patch = (key: string, next: Partial<LineRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /** Ask the server for today's price and fill the row in (Q5 handles "none"). */
  const autofill = async (key: string, productId: string) => {
    if (!resolvePrice || !productId || !supplierId || !branchId) return;
    const res = await resolvePrice({ productId, supplierId, branchId });
    if (!res.ok) return;
    if (!res.data) {
      patch(key, { priceScope: "none", mappingId: "", minOrderQty: null });
      return;
    }
    patch(key, {
      unitPrice: res.data.unitPrice,
      mappingId: res.data.mappingId,
      priceScope: res.data.scope,
      minOrderQty: res.data.minOrderQty,
      // Only adopt the mapping's unit if it is still a unit of this product.
      ...(res.data.orderUnitId &&
      products
        .find((p) => p.id === productId)
        ?.units.some((u) => u.id === res.data!.orderUnitId)
        ? { orderUnitId: res.data.orderUnitId }
        : {}),
    });
  };

  const onProductChange = (row: LineRow, productId: string) => {
    const product = products.find((p) => p.id === productId);
    const base = product?.units.find((u) => u.isBase) ?? product?.units[0];
    patch(row.key, {
      productId,
      orderUnitId: base?.id ?? "",
      mappingId: "",
      priceScope: null,
      minOrderQty: null,
    });
    void autofill(row.key, productId);
  };

  // Display-only preview; the server owns the authoritative numbers.
  const preview = useMemo(() => {
    const subtotal = rows.reduce((s, r) => s + n(r.qty) * n(r.unitPrice), 0);
    const vat = vatRate.trim() === "" ? 0 : (subtotal * n(vatRate)) / 100;
    return { subtotal, vat, total: subtotal + vat };
  }, [rows, vatRate]);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const err = (key: string) => fieldErrors?.[key];

  return (
    <form action={formAction} className="space-y-6">
      {isEdit && <input type="hidden" name="id" value={initial!.id} />}

      {state.ok && (
        <div className="rounded-lg border border-good-border bg-good-bg p-4 text-sm text-good">
          บันทึกแล้ว — เลขที่ <strong>{state.poNumber}</strong>{" "}
          <a href={`/purchase-orders/${state.id}`} className="ml-2 underline">
            เปิดใบสั่งซื้อ
          </a>
        </div>
      )}

      {formError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-4 text-sm text-bad">
          {formError}
        </div>
      )}

      {!isEdit && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          บันทึกเป็น “ร่าง” ก่อน — แก้ได้จนกว่าจะกดส่ง เมื่อส่งแล้วจะแก้ไม่ได้
          เพราะผู้ขายถือสำเนาใบเดียวกันอยู่
        </div>
      )}

      {/* --- who + where --- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="supplier_id" className={labelClass}>
            ผู้ขาย <span className="text-bad">*</span>
          </label>
          <select
            id="supplier_id"
            name="supplier_id"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={`${inputClass} mt-1`}
            required
            disabled={isEdit}
          >
            <option value="">— เลือกผู้ขาย —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameFull}
              </option>
            ))}
          </select>
          {isEdit && (
            <p className="mt-1 text-xs text-muted-foreground">
              เปลี่ยนผู้ขายไม่ได้ — ราคาทุกบรรทัดผูกกับผู้ขายรายนี้ ถ้าต้องเปลี่ยนให้สร้างใบใหม่
            </p>
          )}
          {err("supplierId") && <p className={errorClass}>{err("supplierId")}</p>}
        </div>

        <div>
          <label htmlFor="branch_id" className={labelClass}>
            สาขา <span className="text-bad">*</span>
          </label>
          <select
            id="branch_id"
            name="branch_id"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={`${inputClass} mt-1`}
            required
            disabled={isEdit}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {err("branchId") && <p className={errorClass}>{err("branchId")}</p>}
        </div>
      </div>

      {/* --- lines --- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">รายการสั่งซื้อ</h3>
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, newRow()])}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted/40"
          >
            + เพิ่มรายการ
          </button>
        </div>
        {err("lines") && <p className={errorClass}>{err("lines")}</p>}

        <div className="space-y-3">
          {rows.map((row, i) => {
            const product = products.find((p) => p.id === row.productId);
            const lineTotal = n(row.qty) * n(row.unitPrice);
            const belowMin =
              row.minOrderQty !== null &&
              row.qty.trim() !== "" &&
              n(row.qty) < n(row.minOrderQty);

            return (
              <div
                key={row.key}
                className="rounded-lg border border-border p-3 sm:p-4"
              >
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <label className={labelClass}>วัตถุดิบ</label>
                    <select
                      name="line_product_id"
                      value={row.productId}
                      onChange={(e) => onProductChange(row, e.target.value)}
                      className={`${inputClass} mt-1`}
                    >
                      <option value="">— เลือกวัตถุดิบ —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className={labelClass}>จำนวน</label>
                    <input
                      name="line_qty"
                      type="number"
                      step="0.001"
                      min="0"
                      value={row.qty}
                      onChange={(e) => patch(row.key, { qty: e.target.value })}
                      className={`${inputClass} mt-1`}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className={labelClass}>หน่วย</label>
                    <select
                      name="line_order_unit_id"
                      value={row.orderUnitId}
                      onChange={(e) =>
                        patch(row.key, { orderUnitId: e.target.value })
                      }
                      className={`${inputClass} mt-1`}
                      disabled={!product}
                    >
                      {!product && <option value="">—</option>}
                      {product?.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.unitName}
                          {u.isBase ? " (หน่วยหลัก)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label className={labelClass}>ราคา/หน่วย</label>
                    <input
                      name="line_unit_price"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={row.unitPrice}
                      onChange={(e) =>
                        patch(row.key, { unitPrice: e.target.value })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </div>
                </div>

                <input type="hidden" name="line_mapping_id" value={row.mappingId} />
                <input type="hidden" name="line_notes" value={row.notes} />

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.priceScope === "branch" && (
                      <span className="rounded-full border border-border-strong bg-muted px-2 py-0.5 text-muted-foreground">
                        ราคาเฉพาะสาขานี้
                      </span>
                    )}
                    {row.priceScope === "tenant" && (
                      <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-muted-foreground">
                        ราคากลางจากรายการราคา
                      </span>
                    )}
                    {row.priceScope === "none" && (
                      <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-warn">
                        ไม่มีราคาในระบบ — กรอกเอง
                      </span>
                    )}
                    {belowMin && (
                      <span className="text-warn">
                        ผู้ขายกำหนดขั้นต่ำ {row.minOrderQty}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-muted-foreground">
                      รวม {fmt(lineTotal)} บาท
                    </span>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setRows((rs) => rs.filter((r) => r.key !== row.key))
                        }
                        className="text-bad hover:underline"
                      >
                        ลบรายการที่ {i + 1}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* --- terms --- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="expected_delivery_date" className={labelClass}>
            กำหนดรับของ
          </label>
          <input
            id="expected_delivery_date"
            name="expected_delivery_date"
            type="date"
            defaultValue={initial?.expectedDeliveryDate ?? ""}
            className={`${inputClass} mt-1`}
          />
          {err("expectedDeliveryDate") && (
            <p className={errorClass}>{err("expectedDeliveryDate")}</p>
          )}
        </div>

        <div>
          <label htmlFor="vat_rate_percent" className={labelClass}>
            VAT (%)
          </label>
          <input
            id="vat_rate_percent"
            name="vat_rate_percent"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
            className={`${inputClass} mt-1`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            เว้นว่าง = ใบนี้ไม่มี VAT
          </p>
          {err("vatRatePercent") && (
            <p className={errorClass}>{err("vatRatePercent")}</p>
          )}
        </div>
      </div>

      {/* --- preview: what the supplier will invoice --- */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">ยอดก่อน VAT</span>
          <span className="tabular-nums">{fmt(preview.subtotal)}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-muted-foreground">
            VAT {vatRate.trim() === "" ? "(ไม่มี)" : `${vatRate}%`}
          </span>
          <span className="tabular-nums">{fmt(preview.vat)}</span>
        </div>
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-medium">
          <span>ยอดรวม</span>
          <span className="tabular-nums">{fmt(preview.total)} บาท</span>
        </div>
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          หมายเหตุถึงผู้ขาย
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          className={`${inputClass} mt-1`}
        />
        {err("notes") && <p className={errorClass}>{err("notes")}</p>}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก…" : isEdit ? "บันทึกการแก้ไข" : "บันทึกร่าง"}
        </button>
        <a
          href="/purchase-orders"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}

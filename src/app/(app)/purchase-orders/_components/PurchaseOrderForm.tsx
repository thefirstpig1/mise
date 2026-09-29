"use client";

import { orStale } from "@/lib/stale-tab";

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

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { PurchaseOrderActionState } from "../actions";
import type { ResolvedPriceView } from "./purchase-order-view";
import ProductPicker from "@/components/ui/ProductPicker";

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
  imageUrl: string | null;
  section: string | null;
  group: string | null;
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
  /** ADR 0036 R1 — the kitchen line this row was cut from, kept through edits. */
  requestLineId: string;
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
    purchaseRequestLineId: string | null;
    notes: string | null;
  }[];
};

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
  requestLineId: "",
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
  supplierCarries,
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
  /** Which products the chosen supplier carries at the chosen branch. */
  supplierCarries?: (query: {
    supplierId: string;
    branchId: string;
  }) => Promise<{ ok: true; productIds: string[] } | { ok: false; formError: string }>;
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
          requestLineId: l.purchaseRequestLineId ?? "",
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

  // --- what this supplier carries (Kong 2026-09-29: "กดซัพมั่วแล้วสั่งของที่ซัพไม่มี") ---
  // The picker lists only these by default; anything else is one deliberate
  // press away (a first order from a new supplier has no history yet — ADR
  // 0012 Q5 keeps that possible), and such a row says so in plain words.
  const [carried, setCarried] = useState<{ key: string; ids: Set<string> } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const carriedKey = `${supplierId}|${branchId}`;
  useEffect(() => {
    setShowAll(false);
    if (!supplierCarries || !supplierId || !branchId) return;
    let live = true;
    void orStale(supplierCarries({ supplierId, branchId })).then((r) => {
      if (live && r.ok) setCarried({ key: carriedKey, ids: new Set(r.productIds) });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carriedKey]);
  const carriedIds = carried?.key === carriedKey ? carried.ids : null;
  const noCatalog = carriedIds !== null && carriedIds.size === 0;
  const pickable = useMemo(
    () => (carriedIds && !showAll && !noCatalog ? products.filter((p) => carriedIds.has(p.id)) : products),
    [products, carriedIds, showAll, noCatalog]
  );
  const notCarried = (productId: string) => carriedIds !== null && productId !== "" && !carriedIds.has(productId);

  // --- a new row comes into view, centred, with its search box ready ---
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const pickerRefs = useRef(new Map<string, HTMLInputElement | null>());
  useEffect(() => {
    if (!focusKey) return;
    const el = document.querySelector(`[data-row="${focusKey}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // After the scroll starts, so the browser does not jump to the input instead.
    const t = window.setTimeout(() => pickerRefs.current.get(focusKey)?.focus({ preventScroll: true }), 250);
    return () => window.clearTimeout(t);
  }, [focusKey]);
  const addRow = () => {
    const r = newRow();
    setRows((rs) => [...rs, r]);
    setFocusKey(r.key);
  };

  const patch = (key: string, next: Partial<LineRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /** Ask the server for today's price and fill the row in (Q5 handles "none"). */
  const autofill = async (key: string, productId: string) => {
    if (!resolvePrice || !productId || !supplierId || !branchId) return;
    const res = await orStale(resolvePrice({ productId, supplierId, branchId }));
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

  // Another supplier means other prices: every line already chosen is priced
  // again from the NEW supplier, rather than keeping the old one's figures.
  const [pricedFor, setPricedFor] = useState(`${initial?.supplierId ?? ""}|${initial?.branchId ?? ""}`);
  useEffect(() => {
    if (!supplierId || carriedKey === pricedFor) return;
    setPricedFor(carriedKey);
    for (const r of rows) {
      if (!r.productId) continue;
      patch(r.key, { unitPrice: "", mappingId: "", priceScope: null, minOrderQty: null });
      void autofill(r.key, r.productId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carriedKey]);

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
          <label htmlFor="supplier_id" className="label">
            ผู้ขาย <span className="text-bad">*</span>
          </label>
          <select
            id="supplier_id"
            name="supplier_id"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={"input w-full mt-1"}
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
          {!isEdit && supplierId && (
            <p className="mt-1 text-xs text-muted-foreground">
              หรือ{" "}
              <a href={`/suppliers/${supplierId}/order`} className="text-primary underline">
                เลือกจากแคตตาล็อกของผู้ขายรายนี้
              </a>{" "}
              — เห็นเฉพาะของที่ผู้ขายมี พร้อมราคาล่าสุด
            </p>
          )}
          {isEdit && (
            <p className="mt-1 text-xs text-muted-foreground">
              เปลี่ยนผู้ขายไม่ได้ — ราคาทุกบรรทัดผูกกับผู้ขายรายนี้ ถ้าต้องเปลี่ยนให้สร้างใบใหม่
            </p>
          )}
          {err("supplierId") && <p className={errorClass}>{err("supplierId")}</p>}
        </div>

        <div>
          <label htmlFor="branch_id" className="label">
            สาขา <span className="text-bad">*</span>
          </label>
          {branches.length === 1 ? (
            // One branch in reach: nothing to choose, so no control to misread.
            <>
              <input type="hidden" name="branch_id" value={branchId} />
              <p id="branch_id" className="input mt-1 w-full bg-muted/50">
                {branches[0].name}
              </p>
            </>
          ) : (
            <select
              id="branch_id"
              name="branch_id"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={"input w-full mt-1"}
              required
              disabled={isEdit}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          {err("branchId") && <p className={errorClass}>{err("branchId")}</p>}
        </div>
      </div>

      {/* --- lines --- */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">รายการสั่งซื้อ</h3>
          {carriedIds && !noCatalog && (
            <p className="text-xs text-muted-foreground">
              {showAll ? (
                <>
                  แสดงวัตถุดิบทั้งหมด ·{" "}
                  <button type="button" onClick={() => setShowAll(false)} className="text-primary underline">
                    กลับไปแสดงเฉพาะของที่ผู้ขายรายนี้มี ({carriedIds.size} รายการ)
                  </button>
                </>
              ) : (
                <>แสดงเฉพาะของที่ผู้ขายรายนี้มี {carriedIds.size} รายการ (จากรายการราคาและการส่งของที่ผ่านมา)</>
              )}
            </p>
          )}
          {noCatalog && (
            <p className="text-xs text-warn">
              ผู้ขายรายนี้ยังไม่มีรายการราคาและยังไม่เคยส่งของ จึงแสดงวัตถุดิบทั้งหมด — ตรวจให้แน่ใจว่าผู้ขายมีของที่สั่ง
            </p>
          )}
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
                data-row={row.key}
                className="rounded-lg border border-border p-3 sm:p-4"
              >
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <label className="label">วัตถุดิบ</label>
                    <ProductPicker
                      name="line_product_id"
                      // A chosen product stays shown even if it is outside the narrowed list.
                      products={row.productId && !pickable.some((p) => p.id === row.productId) ? products : pickable}
                      value={row.productId}
                      onChange={(id) => onProductChange(row, id)}
                      disabledText={!supplierId ? "เลือกผู้ขายก่อน แล้วจึงเลือกวัตถุดิบ" : undefined}
                      onInputRef={(el) => {
                        pickerRefs.current.set(row.key, el);
                      }}
                      footer={
                        carriedIds && !noCatalog && !showAll
                          ? {
                              label: "ไม่เจอที่ต้องการ? แสดงวัตถุดิบที่ผู้ขายรายนี้ยังไม่เคยมี",
                              onClick: () => setShowAll(true),
                            }
                          : undefined
                      }
                    />
                    {notCarried(row.productId) && (
                      <p className="mt-1 text-xs text-warn">
                        ผู้ขายรายนี้ยังไม่เคยมีสินค้านี้ในรายการราคาหรือการส่งของ — ตรวจกับผู้ขายก่อนส่งใบ
                      </p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label">จำนวน</label>
                    <input
                      name="line_qty"
                      type="number"
                      step="0.001"
                      min="0"
                      value={row.qty}
                      onChange={(e) => patch(row.key, { qty: e.target.value })}
                      className={"input w-full mt-1"}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label">หน่วย</label>
                    <select
                      name="line_order_unit_id"
                      value={row.orderUnitId}
                      onChange={(e) =>
                        patch(row.key, { orderUnitId: e.target.value })
                      }
                      className={"input w-full mt-1"}
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
                    <label className="label">ราคา/หน่วย</label>
                    <input
                      name="line_unit_price"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={row.unitPrice}
                      onChange={(e) =>
                        patch(row.key, { unitPrice: e.target.value })
                      }
                      className={"input w-full mt-1"}
                    />
                  </div>
                </div>

                <input type="hidden" name="line_mapping_id" value={row.mappingId} />
                <input type="hidden" name="line_notes" value={row.notes} />
                <input type="hidden" name="line_request_line_id" value={row.requestLineId} />

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
        {/* At the END of the list (Kong 2026-09-29): ten lines should not mean
            scrolling back to the top ten times. The new row scrolls to centre. */}
        <button
          type="button"
          onClick={addRow}
          disabled={!supplierId}
          className="w-full rounded-lg border border-dashed border-border-strong py-3 text-sm font-medium text-primary hover:bg-muted/40 disabled:cursor-not-allowed disabled:text-muted-foreground"
        >
          + เพิ่มรายการ
        </button>
      </div>

      {/* --- terms --- */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* No delivery date here (ADR 0036 Q8): a date nobody has agreed with the
            supplier is a guess the kitchen would plan around. The supplier's
            promise is recorded on the order after it is sent. */}
        <p className="self-end text-xs text-muted-foreground">
          วันส่งของใส่ได้หลังส่งใบ เมื่อผู้ขายยืนยันแล้ว (ที่หน้าใบสั่งซื้อ)
        </p>

        <div>
          <label htmlFor="vat_rate_percent" className="label">
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
            className={"input w-full mt-1"}
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
        <label htmlFor="notes" className="label">
          หมายเหตุถึงผู้ขาย
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          className={"input w-full mt-1"}
        />
        {err("notes") && <p className={errorClass}>{err("notes")}</p>}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="btn"
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

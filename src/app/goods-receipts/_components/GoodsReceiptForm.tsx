"use client";

// Sprint 2 Part 13 L5b — the receive form (shared by create and edit).
//
// Driven by React 19 useActionState. Input `name=` attributes are snake_case to
// match rawFromFormData in ../actions.ts; fieldErrors keys are the schema's
// camelCase names. Lines submit as PARALLEL ARRAYS which the action zips by
// index — FormData has no nested structure (the Part 8.5 fanout).
//
// Five things this form owns that the layers below deliberately do not:
//
//  1. **Two modes in one form.** "รับตามใบสั่งซื้อ" picks an order and prefills
//     every line with what is still outstanding, at the order's own price and
//     unit; "ซื้อสด" builds lines from scratch (ADR 0013 Q1). Branch and supplier
//     are LOCKED in PO mode — they are the order's, not a choice.
//  2. **The over-receipt warning**, shown the moment the number exceeds what is
//     outstanding, with the note field revealed and required. The server enforces
//     it (OverReceiptNoteRequiredError); this is so the user finds out while
//     typing rather than on submit.
//  3. **The base-unit preview.** `qty × ratio` in JS `Number`, DISPLAY ONLY — the
//     authoritative conversion happens in Decimal on the server, using the PO
//     line's frozen ratio.
//  4. **The submit key.** One uuid per mounted form, in a hidden field, which the
//     server uses AS the document id. This is what makes a double POST one
//     receipt instead of two (ADR 0013 Consequence 4) — regenerate it per render
//     and the guarantee is gone.
//  5. **The "confirming is what moves stock" warning**, shown before the first
//     save. A draft is safe; the button after it is not.

import { useActionState, useEffect, useId, useMemo, useState } from "react";
import type { GoodsReceiptActionState } from "../actions";
import type { ReceivablePurchaseOrderView } from "./goods-receipt-view";

export type GrUnitOption = {
  id: string;
  unitName: string;
  /** STRING (Pitfall #20) — display/preview only in this component. */
  toBaseRatio: string;
  isBase: boolean;
};

export type GrProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUnitName: string | null;
  units: GrUnitOption[];
};

export type GrSupplierOption = {
  id: string;
  nameFull: string;
  /** The supplier's usual VAT rate — where a standalone receipt starts (Part 16). */
  defaultVatRatePercent: string | null;
};
export type GrBranchOption = { id: string; name: string };

export type GrPurchaseOrderOption = {
  id: string;
  poNumber: string;
  status: string;
  branchId: string;
  supplierId: string;
  supplierName: string;
  branchName: string;
  expectedDeliveryLabel: string;
};

/** One editable row. `key` is client-only identity so React can track reorders. */
type LineRow = {
  key: string;
  purchaseOrderItemId: string;
  productId: string;
  receivedUnitId: string;
  qty: string;
  unitPrice: string;
  notes: string;
  /** Present on a PO-based row: what the order still owes, and in what unit. */
  outstanding: string | null;
  orderedUnitName: string | null;
  orderedUnitPrice: string | null;
  /** FROZEN ratio from the PO line; null on a standalone row (use the unit's). */
  frozenRatio: string | null;
};

export type GoodsReceiptFormInitial = {
  id: string;
  branchId: string;
  supplierId: string;
  purchaseOrderId: string | null;
  invoiceNo: string;
  /** Blank = this delivery carried no VAT (Part 16). */
  vatRatePercent: string;
  /** `datetime-local` value, already shifted to Bangkok by the serializer. */
  receivedAtLocal: string;
  notes: string;
  lines: {
    purchaseOrderItemId: string | null;
    productId: string;
    receivedUnitId: string;
    receivedUnitName: string;
    toBaseRatio: string;
    qtyReceivedActual: string;
    unitPriceActual: string;
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
  purchaseOrderItemId: "",
  productId: "",
  receivedUnitId: "",
  qty: "",
  unitPrice: "",
  notes: "",
  outstanding: null,
  orderedUnitName: null,
  orderedUnitPrice: null,
  frozenRatio: null,
});

const n = (s: string) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

const fmt = (v: number) =>
  v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Trim trailing zeros so "4.000" reads as "4". */
const trimQty = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

export default function GoodsReceiptForm({
  action,
  products,
  suppliers,
  branches,
  purchaseOrders,
  loadPurchaseOrder,
  nowLocal,
  minLocal,
  maxLocal,
  initial,
  initialPurchaseOrder,
}: {
  action: (
    prev: GoodsReceiptActionState,
    fd: FormData
  ) => Promise<GoodsReceiptActionState>;
  products: GrProductOption[];
  suppliers: GrSupplierOption[];
  branches: GrBranchOption[];
  purchaseOrders: GrPurchaseOrderOption[];
  /** The bound L4 action that fetches an order's outstanding lines. */
  loadPurchaseOrder: (id: string) => Promise<
    | { ok: true; data: ReceivablePurchaseOrderView | null }
    | { ok: false; formError: string }
  >;
  /** All three computed on the SERVER in Bangkok — a device in another timezone
   *  would otherwise be offered a time the server rejects (Decision #60). */
  nowLocal: string;
  minLocal: string;
  maxLocal: string;
  /** Present = edit mode; the receipt id travels in a hidden field. */
  initial?: GoodsReceiptFormInitial;
  /** Prefilled order when the page was opened as /new?po=<id>. */
  initialPurchaseOrder?: ReceivablePurchaseOrderView | null;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as GoodsReceiptActionState
  );

  const isEdit = Boolean(initial);
  // One key per MOUNTED form — never regenerated on re-render, or the double-POST
  // guarantee it exists for disappears. In edit mode the receipt already has an
  // id, so the key is that id and the create path is unreachable anyway.
  const submitKeyFallback = useId();
  const [submitKey] = useState(
    () =>
      initial?.id ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : submitKeyFallback)
  );

  const [poId, setPoId] = useState(
    initial?.purchaseOrderId ?? initialPurchaseOrder?.id ?? ""
  );
  const [po, setPo] = useState<ReceivablePurchaseOrderView | null>(
    initialPurchaseOrder ?? null
  );
  const [poError, setPoError] = useState<string | null>(null);
  const [loadingPo, setLoadingPo] = useState(false);

  const [branchId, setBranchId] = useState(
    initial?.branchId ?? initialPurchaseOrder?.branchId ?? branches[0]?.id ?? ""
  );
  const [supplierId, setSupplierId] = useState(
    initial?.supplierId ?? initialPurchaseOrder?.supplierId ?? ""
  );

  /**
   * VAT on this delivery (Part 16, ADR 0016 Q2).
   *
   * Inherited but EDITABLE: the order's rate, or the supplier's usual one, is a
   * starting point — the tax invoice that came with the delivery is the
   * authority, exactly as `unit_price_actual` is for price. Blank means this
   * delivery carried no VAT, one meaning, as on a PO.
   *
   * `vatTouched` is what stops a later prefill from overwriting a rate the user
   * has already corrected by hand.
   */
  const [vatRate, setVatRate] = useState(
    initial?.vatRatePercent ??
      initialPurchaseOrder?.vatRatePercent ??
      suppliers.find((s) => s.id === (initial?.supplierId ?? initialPurchaseOrder?.supplierId))
        ?.defaultVatRatePercent ??
      ""
  );
  const [vatTouched, setVatTouched] = useState(false);

  const linesFromPo = (v: ReceivablePurchaseOrderView): LineRow[] =>
    v.lines.map((l) => ({
      key: `p${l.purchaseOrderItemId}`,
      purchaseOrderItemId: l.purchaseOrderItemId,
      productId: l.productId,
      receivedUnitId: l.orderUnitId,
      qty: trimQty(l.qtyOutstanding),
      unitPrice: l.unitPrice,
      notes: "",
      outstanding: l.qtyOutstanding,
      orderedUnitName: l.orderUnitName,
      orderedUnitPrice: l.unitPrice,
      frozenRatio: l.toBaseRatio,
    }));

  const [rows, setRows] = useState<LineRow[]>(() => {
    if (initial) {
      return initial.lines.map((l, i) => ({
        key: `i${i}`,
        purchaseOrderItemId: l.purchaseOrderItemId ?? "",
        productId: l.productId,
        receivedUnitId: l.receivedUnitId,
        qty: trimQty(l.qtyReceivedActual),
        unitPrice: l.unitPriceActual,
        notes: l.notes ?? "",
        outstanding: null,
        orderedUnitName: l.receivedUnitName,
        orderedUnitPrice: null,
        frozenRatio: l.toBaseRatio,
      }));
    }
    if (initialPurchaseOrder?.receivable) return linesFromPo(initialPurchaseOrder);
    return [newRow()];
  });

  /** Pull an order's outstanding lines when the user picks one. */
  useEffect(() => {
    if (isEdit) return;
    if (!poId) {
      setPo(null);
      setPoError(null);
      return;
    }
    if (po?.id === poId) return;

    let cancelled = false;
    setLoadingPo(true);
    loadPurchaseOrder(poId)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok || !r.data) {
          setPo(null);
          setPoError(r.ok ? "ไม่พบใบสั่งซื้อนี้" : r.formError);
          return;
        }
        setPo(r.data);
        setPoError(
          r.data.receivable
            ? null
            : "ใบสั่งซื้อนี้ยังรับของไม่ได้ (ต้องส่งให้ผู้ขายก่อน และต้องไม่ถูกยกเลิก)"
        );
        setBranchId(r.data.branchId);
        setSupplierId(r.data.supplierId);
        // The order's rate, unless the receiver has already typed one.
        if (!vatTouched) setVatRate(r.data.vatRatePercent ?? "");
        if (r.data.receivable) setRows(linesFromPo(r.data));
      })
      .finally(() => {
        if (!cancelled) setLoadingPo(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId, isEdit]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const setRow = (key: string, patch: Partial<LineRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Display-only base-unit preview; the server converts in Decimal. */
  const baseQtyOf = (r: LineRow): { qty: number; unitName: string | null } => {
    const product = productById.get(r.productId);
    const ratio =
      r.frozenRatio ??
      product?.units.find((u) => u.id === r.receivedUnitId)?.toBaseRatio ??
      "1";
    return { qty: n(r.qty) * n(ratio), unitName: product?.baseUnitName ?? null };
  };

  const isOver = (r: LineRow) =>
    r.outstanding !== null && n(r.qty) > n(r.outstanding);

  const total = rows.reduce((s, r) => s + n(r.qty) * n(r.unitPrice), 0);
  const anyOver = rows.some(isOver);
  const fieldErrors = state.ok ? undefined : state.fieldErrors;
  const poMode = Boolean(poId);

  return (
    <form action={formAction} className="space-y-6">
      {isEdit && <input type="hidden" name="id" value={initial!.id} />}
      <input type="hidden" name="submit_key" value={submitKey} />
      <input type="hidden" name="purchase_order_id" value={poId} />
      <input type="hidden" name="branch_id" value={branchId} />
      <input type="hidden" name="supplier_id" value={supplierId} />

      {!state.ok && state.formError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {state.formError}
        </div>
      )}
      {state.ok && (
        <div className="rounded-lg border border-good-border bg-good-bg p-3 text-sm text-good">
          บันทึกฉบับร่าง {state.grNumber} แล้ว —{" "}
          <a href={`/goods-receipts/${state.id}`} className="font-medium underline">
            เปิดเพื่อยืนยันรับของ
          </a>
        </div>
      )}

      {/* ---------------- source ---------------- */}
      <section className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">ที่มาของสินค้า</h3>

        {isEdit ? (
          <p className="text-sm text-muted-foreground">
            {initial!.purchaseOrderId
              ? "รับตามใบสั่งซื้อ — เปลี่ยนใบสั่งซื้อไม่ได้ ถ้าผิดให้ทิ้งฉบับร่างแล้วสร้างใหม่"
              : "ซื้อสด (ไม่มีใบสั่งซื้อ)"}
          </p>
        ) : (
          <div>
            <label className={labelClass} htmlFor="po-picker">
              ใบสั่งซื้อ
            </label>
            <select
              id="po-picker"
              className={`${inputClass} mt-1`}
              value={poId}
              onChange={(e) => {
                setPoId(e.target.value);
                if (!e.target.value) {
                  setPo(null);
                  setPoError(null);
                  setRows([newRow()]);
                }
              }}
            >
              <option value="">— ซื้อสด (ไม่มีใบสั่งซื้อ) —</option>
              {purchaseOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.poNumber} · {o.supplierName} · {o.branchName}
                </option>
              ))}
            </select>
            {loadingPo && (
              <p className="mt-1 text-xs text-muted-foreground">กำลังดึงรายการที่ค้างรับ…</p>
            )}
            {poError && <p className={errorClass}>{poError}</p>}
            {fieldErrors?.purchaseOrderId && (
              <p className={errorClass}>{fieldErrors.purchaseOrderId}</p>
            )}
            {purchaseOrders.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                ยังไม่มีใบสั่งซื้อที่ส่งแล้ว — รับของแบบซื้อสดได้เลย
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="branch">
              สาขา
            </label>
            <select
              id="branch"
              className={`${inputClass} mt-1 disabled:bg-muted/50`}
              value={branchId}
              disabled={poMode || isEdit}
              onChange={(e) => setBranchId(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {fieldErrors?.branchId && <p className={errorClass}>{fieldErrors.branchId}</p>}
          </div>

          <div>
            <label className={labelClass} htmlFor="supplier">
              ผู้ขาย
            </label>
            <select
              id="supplier"
              className={`${inputClass} mt-1 disabled:bg-muted/50`}
              value={supplierId}
              disabled={poMode || isEdit}
              onChange={(e) => {
                setSupplierId(e.target.value);
                if (!vatTouched && !poId) {
                  setVatRate(
                    suppliers.find((s) => s.id === e.target.value)
                      ?.defaultVatRatePercent ?? ""
                  );
                }
              }}
            >
              <option value="">— เลือกผู้ขาย —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameFull}
                </option>
              ))}
            </select>
            {fieldErrors?.supplierId && (
              <p className={errorClass}>{fieldErrors.supplierId}</p>
            )}
          </div>
        </div>

        {(poMode || isEdit) && (
          <p className="text-xs text-muted-foreground">
            สาขาและผู้ขายมาจากใบสั่งซื้อ จึงแก้ที่นี่ไม่ได้
          </p>
        )}
      </section>

      {/* ---------------- header ---------------- */}
      <section className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="received_at">
            วันเวลาที่รับของ
          </label>
          <input
            id="received_at"
            name="received_at"
            type="datetime-local"
            defaultValue={initial?.receivedAtLocal ?? nowLocal}
            min={minLocal}
            max={maxLocal}
            className={`${inputClass} mt-1`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            เวลาไทย — ย้อนหลังได้ไม่เกิน 90 วัน
          </p>
          {fieldErrors?.receivedAt && (
            <p className={errorClass}>{fieldErrors.receivedAt}</p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="invoice_no">
            เลขที่ใบส่งของ / ใบกำกับภาษี
          </label>
          <input
            id="invoice_no"
            name="invoice_no"
            defaultValue={initial?.invoiceNo ?? ""}
            className={`${inputClass} mt-1`}
            placeholder="ไม่บังคับ"
          />
          {fieldErrors?.invoiceNo && (
            <p className={errorClass}>{fieldErrors.invoiceNo}</p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="vat_rate_percent">
            อัตรา VAT (%)
          </label>
          <input
            id="vat_rate_percent"
            name="vat_rate_percent"
            inputMode="decimal"
            value={vatRate}
            onChange={(e) => {
              setVatRate(e.target.value);
              setVatTouched(true);
            }}
            className={`${inputClass} mt-1`}
            placeholder="เว้นว่าง = ใบนี้ไม่มี VAT"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            ดึงมาจากใบสั่งซื้อหรือค่าตั้งต้นของผู้ขาย — แก้ให้ตรงกับใบกำกับภาษีที่มากับของได้
            {" · "}ถ้าร้านไม่ได้จด VAT ระบบจะรวม VAT เป็นต้นทุนของ
          </p>
          {fieldErrors?.vatRatePercent && (
            <p className={errorClass}>{fieldErrors.vatRatePercent}</p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="notes">
            หมายเหตุ
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={initial?.notes ?? ""}
            className={`${inputClass} mt-1`}
          />
        </div>
      </section>

      {/* ---------------- lines ---------------- */}
      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">รายการที่รับ</h3>
          {!poMode && (
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, newRow()])}
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
            >
              + เพิ่มรายการ
            </button>
          )}
        </div>

        {fieldErrors?.lines && <p className={errorClass}>{fieldErrors.lines}</p>}

        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">ยังไม่มีรายการ</p>
        )}

        <div className="space-y-3">
          {rows.map((r) => {
            const product = productById.get(r.productId);
            const over = isOver(r);
            const base = baseQtyOf(r);
            return (
              <div
                key={r.key}
                className={`space-y-2 rounded-lg border p-3 ${
                  over ? "border-warn-border bg-warn-bg/50" : "border-border"
                }`}
              >
                <input type="hidden" name="line_po_item_id" value={r.purchaseOrderItemId} />
                <input type="hidden" name="line_product_id" value={r.productId} />
                <input
                  type="hidden"
                  name="line_received_unit_id"
                  value={r.receivedUnitId}
                />

                <div className="grid gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <label className="text-xs text-muted-foreground">วัตถุดิบ</label>
                    {r.purchaseOrderItemId ? (
                      <div className="mt-1 text-sm font-medium">
                        {product?.name ?? "—"}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {product?.sku}
                        </span>
                      </div>
                    ) : (
                      <select
                        className={`${inputClass} mt-1`}
                        value={r.productId}
                        onChange={(e) => {
                          const p = productById.get(e.target.value);
                          setRow(r.key, {
                            productId: e.target.value,
                            // Default to the base unit — the unit stock is counted in.
                            receivedUnitId: p?.units[0]?.id ?? "",
                          });
                        }}
                      >
                        <option value="">— เลือกวัตถุดิบ —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs text-muted-foreground">หน่วย</label>
                    {r.purchaseOrderItemId ? (
                      <div className="mt-1 text-sm">{r.orderedUnitName}</div>
                    ) : (
                      <select
                        className={`${inputClass} mt-1`}
                        value={r.receivedUnitId}
                        onChange={(e) => setRow(r.key, { receivedUnitId: e.target.value })}
                        disabled={!product}
                      >
                        {(product?.units ?? []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.unitName}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs text-muted-foreground">จำนวนที่รับ</label>
                    <input
                      name="line_qty"
                      type="number"
                      step="0.001"
                      min="0"
                      value={r.qty}
                      onChange={(e) => setRow(r.key, { qty: e.target.value })}
                      className={`${inputClass} mt-1 text-right`}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs text-muted-foreground">ราคา/หน่วย</label>
                    <input
                      name="line_unit_price"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={r.unitPrice}
                      onChange={(e) => setRow(r.key, { unitPrice: e.target.value })}
                      className={`${inputClass} mt-1 text-right`}
                    />
                  </div>

                  <div className="flex items-end sm:col-span-1">
                    {!poMode && (
                      <button
                        type="button"
                        onClick={() =>
                          setRows((rs) => rs.filter((x) => x.key !== r.key))
                        }
                        className="w-full rounded-lg border border-border px-2 py-2 text-xs text-muted-foreground"
                      >
                        ลบ
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {r.outstanding !== null && (
                    <span>ค้างรับ {trimQty(r.outstanding)} {r.orderedUnitName}</span>
                  )}
                  {r.orderedUnitPrice !== null &&
                    n(r.unitPrice) !== n(r.orderedUnitPrice) && (
                      <span className="text-warn">
                        ราคาต่างจากใบสั่งซื้อ ({r.orderedUnitPrice})
                      </span>
                    )}
                  {base.unitName && n(r.qty) > 0 && (
                    <span>
                      = {base.qty.toLocaleString("th-TH")} {base.unitName} เข้าคลัง
                    </span>
                  )}
                  <span>รวม {fmt(n(r.qty) * n(r.unitPrice))} ฿</span>
                </div>

                {/* The note is only required when over-receiving, so it only
                    appears then — an always-on field would be ignored. */}
                {over ? (
                  <div>
                    <label className="text-xs font-medium text-warn">
                      รับเกินที่ค้างอยู่ — ระบุเหตุผล (จำเป็น)
                    </label>
                    <input
                      name="line_notes"
                      value={r.notes}
                      onChange={(e) => setRow(r.key, { notes: e.target.value })}
                      className={`${inputClass} mt-1`}
                      placeholder="เช่น ซัพส่งเกินมา 2 กระสอบ / แถมให้"
                    />
                  </div>
                ) : (
                  <input type="hidden" name="line_notes" value={r.notes} />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">รวมทั้งใบ&nbsp;</span>
          <span className="font-semibold tabular-nums">{fmt(total)} ฿</span>
        </div>
      </section>

      {anyOver && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          มีรายการที่รับเกินจำนวนที่สั่ง — ระบบจะบันทึกเข้าคลังตามจริงและติดธง
          &quot;ต้องตรวจสอบ&quot; ไว้ให้ผู้จัดการดู
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        บันทึกตอนนี้จะได้เป็น <strong>ฉบับร่าง</strong> — สต๊อกยังไม่ขยับ
        จนกว่าจะกด &quot;ยืนยันรับของ&quot; ในหน้าถัดไป และเมื่อยืนยันแล้วจะแก้ไม่ได้
        (ต้องยกเลิกใบรับแล้วออกใหม่)
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก…" : isEdit ? "บันทึกฉบับร่าง" : "บันทึกฉบับร่าง"}
        </button>
        <a
          href="/goods-receipts"
          className="rounded-lg border border-border px-4 py-2 text-sm"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}

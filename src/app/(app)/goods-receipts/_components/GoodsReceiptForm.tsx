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
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import QtyStepper from "@/components/ui/QtyStepper";
import SelectChip from "@/components/ui/SelectChip";
import Marquee from "@/components/ui/Marquee";
import { MeasureInput, MoneyInput } from "@/components/ui/NumberField";
import NewPackSize, { NEW_PACK_SIZE, containerGuess, packInUse, useAddedUnits } from "@/components/ui/NewPackSize";

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
  imageUrl: string | null;
  section: string | null;
  group: string | null;
  baseUnitName: string | null;
  units: GrUnitOption[];
};

export type GrSupplierOption = {
  id: string;
  nameFull: string;
  /** The supplier's usual VAT rate — where a standalone receipt starts (Part 16). */
  defaultVatRatePercent: string | null;
  /** ADR 0036 Q7 — its bills show prices with VAT inside. */
  pricesIncludeVat: boolean;
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
  /** Kong 2026-10-24: which department this line goes to; "" = server default. */
  departmentId: string;
};

export type GoodsReceiptFormInitial = {
  id: string;
  branchId: string;
  supplierId: string;
  purchaseOrderId: string | null;
  invoiceNo: string;
  /** Blank = this delivery carried no VAT (Part 16). */
  vatRatePercent: string;
  /** Rule PR3 — the prices were typed as the bill shows them, VAT included. */
  pricesIncludeVat: boolean;
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
    /** The line's department when it went to exactly one; null otherwise. */
    departmentId?: string | null;
  }[];
};

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
  departmentId: "",
});

const n = (s: string) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

const fmt = (v: number) =>
  v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One column template for the header and every line (Kong 2026-10-22) — the purchase order's. */
const LINE_GRID = "sm:grid-cols-[minmax(0,1fr)_8rem_12.5rem_8.5rem_6.5rem_1.75rem]";
const LINE_GRID_MOBILE = "grid-cols-[8rem_minmax(0,1fr)_auto] [grid-template-areas:'p_p_x'_'q_u_u'_'pr_t_t']";

/** Trim trailing zeros so "4.000" reads as "4". */
const trimQty = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

export default function GoodsReceiptForm({
  action,
  products: productsIn,
  suppliers,
  branches,
  purchaseOrders,
  loadPurchaseOrder,
  nowLocal,
  minLocal,
  maxLocal,
  initial,
  initialPurchaseOrder,
  departments = [],
  departmentDefaults = {},
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
  /** Active departments; the per-line picker shows only when there are two or more. */
  departments?: { id: string; name: string; isDefault?: boolean }[];
  departmentDefaults?: Record<string, string>;
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
  // "+ ขนาดใหม่…" (Kong 2026-10-21): a size that arrived for the first time is
  // added here, at the door, and is selectable at once.
  const [products, addUnit] = useAddedUnits(productsIn);
  const [sizeFor, setSizeFor] = useState<{ rowKey: string; productId: string } | null>(null);
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
  // Rule PR3 — are the prices typed as the bill shows them, VAT included?
  const [inclusive, setInclusive] = useState(
    initial?.pricesIncludeVat ??
      initialPurchaseOrder?.pricesIncludeVat ??
      suppliers.find((s) => s.id === (initial?.supplierId ?? initialPurchaseOrder?.supplierId))?.pricesIncludeVat ??
      false
  );

  const linesFromPo = (v: ReceivablePurchaseOrderView): LineRow[] =>
    v.lines.map((l) => ({
      key: `p${l.purchaseOrderItemId}`,
      purchaseOrderItemId: l.purchaseOrderItemId,
      productId: l.productId,
      receivedUnitId: l.orderUnitId,
      qty: trimQty(l.qtyOutstanding),
      // The order's price in its own terms — as quoted when it was VAT-inclusive.
      unitPrice: l.unitPriceQuoted ?? l.unitPrice,
      notes: "",
      outstanding: l.qtyOutstanding,
      orderedUnitName: l.orderUnitName,
      orderedUnitPrice: l.unitPrice,
      frozenRatio: l.toBaseRatio,
      departmentId: departmentDefaults[l.productId] ?? "",
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
        departmentId: l.departmentId ?? "",
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
        setInclusive(r.data.pricesIncludeVat);
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

  const pickerProducts: PickerProduct[] = products;

  // An order is picked like a product: grouped by branch, searchable by number
  // or supplier (the PO number rides in `sku`, so typing "PO-0012" finds it).
  const poOptions = useMemo<PickerProduct[]>(
    () =>
      purchaseOrders.map((o) => ({
        id: o.id,
        name: o.supplierName,
        sku: o.poNumber,
        imageUrl: null,
        section: o.branchName,
        group: null,
        baseUnitName: null,
        detail:
          o.expectedDeliveryLabel && o.expectedDeliveryLabel !== "—"
            ? `กำหนดส่ง ${o.expectedDeliveryLabel}`
            : "ยังไม่ระบุวันส่ง",
      })),
    [purchaseOrders]
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
            <label className="label" htmlFor="po-picker">
              ใบสั่งซื้อ
            </label>
            <ProductPicker
              inputId="po-picker"
              products={poOptions}
              value={poId}
              placeholder="พิมพ์เลขใบสั่งซื้อหรือชื่อผู้ขาย — หรือกดเพื่อดูทั้งหมด"
              onChange={(id) => {
                setPoId(id);
                if (!id) {
                  setPo(null);
                  setPoError(null);
                  setRows([newRow()]);
                }
              }}
            />
            {!poId && purchaseOrders.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                ไม่เลือก = ซื้อสด (ไม่มีใบสั่งซื้อ)
              </p>
            )}
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
            <label className="label" htmlFor="branch">
              สาขา
            </label>
            {branches.length === 1 ? (
              // One branch in reach: nothing to choose, so no control to misread.
              <p id="branch" className="input mt-1 w-full bg-muted/50">
                {branches.find((b) => b.id === branchId)?.name ??
                  purchaseOrders.find((o) => o.id === poId)?.branchName ??
                  branches[0].name}
              </p>
            ) : (
              <select
                id="branch"
                className={"input w-full mt-1 disabled:bg-muted/50"}
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
            )}
            {fieldErrors?.branchId && <p className={errorClass}>{fieldErrors.branchId}</p>}
          </div>

          <div>
            <label className="label" htmlFor="supplier">
              ผู้ขาย
            </label>
            <select
              id="supplier"
              className={"input w-full mt-1 disabled:bg-muted/50"}
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
                if (!poId) setInclusive(suppliers.find((s) => s.id === e.target.value)?.pricesIncludeVat ?? false);
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
          <label className="label" htmlFor="received_at">
            วันเวลาที่รับของ
          </label>
          <input
            id="received_at"
            name="received_at"
            type="datetime-local"
            defaultValue={initial?.receivedAtLocal ?? nowLocal}
            min={minLocal}
            max={maxLocal}
            className={"input w-full mt-1"}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            เวลาไทย — ย้อนหลังได้ไม่เกิน 90 วัน
          </p>
          {fieldErrors?.receivedAt && (
            <p className={errorClass}>{fieldErrors.receivedAt}</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="invoice_no">
            เลขที่ใบส่งของ / ใบกำกับภาษี
          </label>
          <input
            id="invoice_no"
            name="invoice_no"
            defaultValue={initial?.invoiceNo ?? ""}
            className={"input w-full mt-1"}
            placeholder="ไม่บังคับ"
          />
          {fieldErrors?.invoiceNo && (
            <p className={errorClass}>{fieldErrors.invoiceNo}</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="vat_rate_percent">
            อัตรา VAT <span className="font-normal text-muted-subtle">(เว้นว่าง = ใบนี้ไม่มี VAT)</span>
          </label>
          <MeasureInput
            id="vat_rate_percent"
            name="vat_rate_percent"
            unit="%"
            min="0"
            max="100"
            placeholder="ไม่มี"
            value={vatRate}
            onChange={(e) => {
              setVatRate(e.target.value);
              setVatTouched(true);
            }}
            boxClassName="mt-1 w-28"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            ดึงมาจากใบสั่งซื้อหรือค่าตั้งต้นของผู้ขาย — แก้ให้ตรงกับใบกำกับภาษีที่มากับของได้
            {" · "}ถ้าร้านไม่ได้จด VAT ระบบจะรวม VAT เป็นต้นทุนของ
          </p>
          {vatRate.trim() !== "" && Number(vatRate) > 0 && (
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="prices_include_vat"
                checked={inclusive}
                onChange={(e) => setInclusive(e.target.checked)}
                className="mt-1"
              />
              <span>
                ราคาในบิลรวม VAT แล้ว
                <span className="block text-xs text-muted-foreground">
                  กรอกราคาตามที่เห็นบนบิลได้เลย ระบบแยก VAT ออกจากยอดรวมเอง
                </span>
              </span>
            </label>
          )}
          {fieldErrors?.vatRatePercent && (
            <p className={errorClass}>{fieldErrors.vatRatePercent}</p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="notes">
            หมายเหตุ
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={initial?.notes ?? ""}
            className={"input w-full mt-1"}
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
              className="btn-secondary btn-sm"
            >
              + เพิ่มรายการ
            </button>
          )}
        </div>

        {fieldErrors?.lines && <p className={errorClass}>{fieldErrors.lines}</p>}

        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">ยังไม่มีรายการ</p>
        )}

        {/* Kong 2026-10-22 (mockup https://claude.ai/artifact/BPFBfCpLAWvqFq5SpYcKTd):
            the same one-row line as the purchase order, every column a fixed
            width shared with the header. "รับจริง" turns yellow when less than
            what is still owed arrived. */}
        <div className="rounded-2xl border border-border bg-surface px-3 sm:px-4">
          <div className={`hidden gap-3 pb-1 pt-3 text-xs text-muted-subtle sm:grid ${LINE_GRID}`}>
            <span>วัตถุดิบ</span>
            <span className="text-center">รับจริง</span>
            <span>หน่วย</span>
            <span className="text-right">
              ราคา/หน่วย {inclusive && vatRate.trim() !== "" && Number(vatRate) > 0 ? "(รวม VAT)" : "(ไม่รวม VAT)"}
            </span>
            <span className="text-right">รวม</span>
            <span />
          </div>
          {rows.map((r) => {
            const product = productById.get(r.productId);
            const over = isOver(r);
            const base = baseQtyOf(r);
            const short = r.outstanding !== null && r.qty.trim() !== "" && n(r.qty) < n(r.outstanding);
            // The unit's name today (Kong 2026-10-21 renamed กก. → kg); the PO keeps what it printed.
            const unitName = product?.units.find((u) => u.id === r.receivedUnitId)?.unitName ?? r.orderedUnitName;
            return (
              <div key={r.key} className={`-mx-3 border-b border-border px-3 py-3 last:border-b-0 sm:-mx-4 sm:px-4 ${over ? "bg-warn-bg/50" : ""}`}>
                <input type="hidden" name="line_po_item_id" value={r.purchaseOrderItemId} />
                <input type="hidden" name="line_product_id" value={r.productId} />
                <input type="hidden" name="line_received_unit_id" value={r.receivedUnitId} />
                {departments.length === 0 && <input type="hidden" name="line_department_id" value="" />}

                <div className={`grid items-center gap-x-3 gap-y-2 ${LINE_GRID_MOBILE} sm:[grid-template-areas:'p_q_u_pr_t_x'] ${LINE_GRID}`}>
                  <div className="min-w-0 [grid-area:p]">
                    {r.purchaseOrderItemId ? (
                      <div className="min-w-0">
                        <Marquee className="text-sm font-medium">{product?.name ?? "—"}</Marquee>
                        <span className="text-xs text-muted-subtle">
                          {product?.sku}
                          {r.outstanding !== null && ` · ค้างรับ ${trimQty(r.outstanding)} ${unitName}`}
                        </span>
                      </div>
                    ) : (
                      <ProductPicker
                        products={pickerProducts}
                        value={r.productId}
                        onChange={(id) => {
                          const p = productById.get(id);
                          setRow(r.key, {
                            productId: id,
                            // Default to the base unit — the unit stock is counted in.
                            receivedUnitId: p?.units[0]?.id ?? "",
                            departmentId: departmentDefaults[id] ?? "",
                          });
                        }}
                      />
                    )}
                  </div>

                  <div className="flex flex-col items-center [grid-area:q]">
                    <QtyStepper
                      value={r.qty}
                      onChange={(qty) => setRow(r.key, { qty })}
                      label={`จำนวนที่รับ ${product?.name ?? ""}`}
                      tone={short || over ? "warn" : "default"}
                      inputProps={{ name: "line_qty" }}
                    />
                    <span className="mt-1 min-h-[1rem] text-xs text-muted-subtle">
                      {base.unitName && n(r.qty) > 0 && base.unitName !== unitName ? `= ${base.qty.toLocaleString("th-TH")} ${base.unitName}` : ""}
                    </span>
                  </div>

                  <div className="min-w-0 [grid-area:u]">
                    {r.purchaseOrderItemId ? (
                      <Marquee className="text-sm">{unitName}</Marquee>
                    ) : (
                      <SelectChip
                        value={r.receivedUnitId}
                        onChange={(v) =>
                          v === NEW_PACK_SIZE
                            ? setSizeFor({ rowKey: r.key, productId: r.productId })
                            : setRow(r.key, { receivedUnitId: v })
                        }
                        placeholder="หน่วย"
                        options={[
                          ...(product?.units.map((u) => ({ value: u.id, label: u.unitName })) ?? []),
                          ...(product ? [{ value: NEW_PACK_SIZE, label: "+ ขนาดใหม่…" }] : []),
                        ]}
                        selectProps={{ disabled: !product, "aria-label": "หน่วย" }}
                      />
                    )}
                  </div>

                  <div className="flex flex-col items-end [grid-area:pr]">
                    <MoneyInput
                      name="line_unit_price"
                      value={r.unitPrice}
                      onChange={(e) => setRow(r.key, { unitPrice: e.target.value })}
                      aria-label="ราคาต่อหน่วย"
                      tone={r.orderedUnitPrice !== null && n(r.unitPrice) !== n(r.orderedUnitPrice) ? "warn" : "default"}
                      boxClassName="w-full"
                    />
                    <span className="mt-1 min-h-[1rem] text-xs text-muted-subtle">
                      {base.unitName && n(r.qty) > 0 && base.qty > 0 && n(r.unitPrice) > 0 && base.unitName !== unitName
                        ? `฿${fmt((n(r.qty) * n(r.unitPrice)) / base.qty)}/${base.unitName}`
                        : ""}
                    </span>
                  </div>

                  <div className="flex h-9 items-center justify-end font-display tabular-nums [grid-area:t]">฿{fmt(n(r.qty) * n(r.unitPrice))}</div>

                  <div className="flex h-9 items-center justify-end [grid-area:x]">
                    {!poMode && (
                      <button
                        type="button"
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        aria-label="ลบรายการ"
                        title="ลบรายการ"
                        className="grid h-7 w-7 place-items-center rounded-lg text-muted-subtle hover:bg-bad-bg hover:text-bad"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {departments.length > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>แผนก</span>
                    <SelectChip
                      size="sm"
                      value={r.departmentId || (departments.find((d) => d.isDefault)?.id ?? "")}
                      onChange={(v) => setRow(r.key, { departmentId: v })}
                      options={departments.map((d) => ({ value: d.id, label: d.name }))}
                      className="w-48"
                      selectProps={{ name: "line_department_id", "aria-label": `แผนกของ ${product?.name ?? "รายการนี้"}` }}
                    />
                  </div>
                )}

                {(short || (r.orderedUnitPrice !== null && n(r.unitPrice) !== n(r.orderedUnitPrice))) && (
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-warn">
                    {short && (
                      <span>
                        รับไม่ครบ ขาด {trimQty(String(Math.round((n(r.outstanding!) - n(r.qty)) * 1000) / 1000))} {unitName}
                      </span>
                    )}
                    {r.orderedUnitPrice !== null && n(r.unitPrice) !== n(r.orderedUnitPrice) && (
                      <span>ราคาต่างจากใบสั่งซื้อ (฿{r.orderedUnitPrice})</span>
                    )}
                  </div>
                )}

                {/* The note is only required when over-receiving, so it only
                    appears then — an always-on field would be ignored. */}
                {over ? (
                  <div className="mt-2">
                    <label className="text-xs font-medium text-warn">
                      รับเกินที่ค้างอยู่ — ระบุเหตุผล (จำเป็น)
                    </label>
                    <input
                      name="line_notes"
                      value={r.notes}
                      onChange={(e) => setRow(r.key, { notes: e.target.value })}
                      className={"input w-full mt-1"}
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
          <span className="text-muted-foreground">
            รวมทั้งใบ{inclusive && vatRate.trim() !== "" && Number(vatRate) > 0 ? " (รวม VAT)" : " (ก่อน VAT)"}&nbsp;
          </span>
          <span className="font-semibold tabular-nums">฿{fmt(total)}</span>
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
          className="btn"
        >
          {isPending ? "กำลังบันทึก…" : isEdit ? "บันทึกฉบับร่าง" : "บันทึกฉบับร่าง"}
        </button>
        <a
          href="/goods-receipts"
          className="btn-secondary"
        >
          ยกเลิก
        </a>
      </div>
      {sizeFor &&
        (() => {
          const p = productById.get(sizeFor.productId);
          const r = rows.find((x) => x.key === sizeFor.rowKey);
          if (!p || !r) return null;
          return (
            <NewPackSize
              productId={p.id}
              productName={p.name}
              baseUnitName={p.units.find((u) => u.isBase)?.unitName ?? p.baseUnitName ?? ""}
              guessBox={containerGuess(p.units, r.receivedUnitId)}
              guessUnit={packInUse(p.units, r.receivedUnitId)}
              onClose={() => setSizeFor(null)}
              onDone={(u) => {
                addUnit(p.id, u);
                setRow(r.key, { receivedUnitId: u.id });
                setSizeFor(null);
              }}
            />
          );
        })()}
    </form>
  );
}

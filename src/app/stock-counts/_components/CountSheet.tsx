"use client";

// Sprint 3 Part 15 L5b/L5c — the count sheet.
//
// Three things this component owns that the layers below deliberately do not:
//
//  1. **Blind counting.** When `showExpected` is off, the expected and variance
//     columns are not rendered at all — not hidden with CSS, not greyed out. The
//     server still stores the expected figure either way (Q3/Q7), so the switch
//     costs nothing and reveals nothing.
//  2. **Successive entry.** A stock take is dozens of lines. Saving a line keeps
//     the sheet open, clears the entry boxes and returns focus to the product
//     picker — the same shape /stock/adjust uses for the same reason.
//  3. **The partial-count warning.** Closing reports how many stocked products
//     are not on the sheet. It never blocks: a partial count is the normal case
//     (Q7), and only the person closing knows whether "42 uncounted" means "I
//     counted the freezer" or "I forgot half the store".

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { StockCountActionState } from "../actions";
import StatusBadge from "./StatusBadge";
import { formatMoney, formatQty } from "./stock-count-view";
import type { StockCountDetailView } from "./stock-count-view";

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  units: { id: string; unitName: string; isBase: boolean }[];
};

type EntryRow = { unitId: string; qty: string };

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "block text-sm font-medium";

export default function CountSheet({
  detail,
  products,
  costByProduct,
  uncountedStocked,
  saveLine,
  removeLine,
  close,
  voidCount,
}: {
  detail: StockCountDetailView;
  products: ProductOption[];
  /** Cost per base unit, as a string, for valuing a variance (Q4 — computed, not stored). */
  costByProduct: Record<string, string>;
  uncountedStocked: number;
  saveLine: (
    prev: StockCountActionState,
    fd: FormData
  ) => Promise<StockCountActionState>;
  removeLine: (countId: string, itemId: string) => Promise<StockCountActionState>;
  close: (prev: StockCountActionState, fd: FormData) => Promise<StockCountActionState>;
  voidCount: (
    prev: StockCountActionState,
    fd: FormData
  ) => Promise<StockCountActionState>;
}) {
  const isDraft = detail.status === "DRAFT";

  const [saveState, saveAction, saving] = useActionState(
    saveLine,
    { ok: false } as StockCountActionState
  );
  const [closeState, closeAction, closing] = useActionState(
    close,
    { ok: false } as StockCountActionState
  );
  const [voidState, voidAction, voiding] = useActionState(
    voidCount,
    { ok: false } as StockCountActionState
  );

  const [productId, setProductId] = useState("");
  const [entries, setEntries] = useState<EntryRow[]>([{ unitId: "", qty: "" }]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const productRef = useRef<HTMLSelectElement>(null);

  const product = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId]
  );

  // Picking a product resets the boxes to its base unit — what stock is counted in.
  useEffect(() => {
    const base = product?.units.find((u) => u.isBase) ?? product?.units[0];
    setEntries([{ unitId: base?.id ?? "", qty: "" }]);
  }, [product]);

  // Successive entry: a saved line clears the boxes and hands the sheet back.
  useEffect(() => {
    if (!saveState.ok) return;
    setProductId("");
    setEntries([{ unitId: "", qty: "" }]);
    productRef.current?.focus();
  }, [saveState]);

  const alreadyCounted = new Set(
    detail.items.filter((i) => !i.isReversal).map((i) => i.productId)
  );

  const varianceValue = (variance: string, pid: string) => {
    const cost = Number(costByProduct[pid] ?? "0");
    const v = Number(variance);
    return Number.isFinite(cost) && Number.isFinite(v) ? v * cost : 0;
  };

  const totalVarianceValue = detail.items
    .filter((i) => !i.isReversal)
    .reduce((sum, i) => sum + varianceValue(i.variance, i.productId), 0);

  const saveErrors = saveState.ok === false ? saveState.fieldErrors : undefined;
  const saveFormError = saveState.ok === false ? saveState.formError : undefined;
  const closeError = closeState.ok === false ? closeState.formError : undefined;
  const voidError = voidState.ok === false ? voidState.formError : undefined;

  return (
    <div className="space-y-6">
      {/* --- header --- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a
            href="/stock-counts"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← กลับไปรายการใบนับ
          </a>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold">
            {detail.scNumber}
            <StatusBadge status={detail.status} />
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.branchName} · นับวันที่ {detail.countDateLabel}
            {detail.startedBy && ` · เปิดโดย ${detail.startedBy}`}
          </p>
        </div>
      </div>

      {detail.status === "VOIDED" && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          ใบนับนี้ถูกยกเลิกเมื่อ {detail.voidedAtLabel}
          {detail.voidedBy && ` โดย ${detail.voidedBy}`} — เหตุผล: {detail.voidReason}
          <span className="mt-1 block text-xs text-muted-foreground">
            รายการเดิมยังอยู่ครบ ระบบเพิ่มรายการกลับรายการเข้าไปเพื่อคืนสต๊อก
          </span>
        </div>
      )}

      {detail.status === "CLOSED" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          ปิดใบแล้วเมื่อ {detail.closedAtLabel}
          {detail.closedBy && ` โดย ${detail.closedBy}`} — ส่วนต่างถูกบันทึกเข้าคลังเรียบร้อย
        </div>
      )}

      {/* --- money summary (computed, never stored — Q4) --- */}
      {detail.countedLineCount > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">นับแล้ว</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {detail.countedLineCount}{" "}
              <span className="text-sm font-normal">รายการ</span>
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">ขาด / เกิน (จำนวน)</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              <span className="text-red-700">−{formatQty(detail.totalShortQty)}</span>
              {" / "}
              <span className="text-emerald-700">+{formatQty(detail.totalOverQty)}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              คนละหน่วยกัน — ดูเป็นรายรายการด้านล่าง
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">มูลค่าส่วนต่าง (ประมาณ)</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${totalVarianceValue < 0 ? "text-red-700" : ""}`}
            >
              {formatMoney(String(totalVarianceValue))}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              คิดจากต้นทุนล่าสุด · ตัวเลขจริงดูที่หน้าต้นทุน
            </p>
          </div>
        </div>
      )}

      {/* --- add / edit a line --- */}
      {isDraft && (
        <form action={saveAction} className="rounded-lg border border-border p-4">
          <input type="hidden" name="stock_count_id" value={detail.id} />
          <h3 className="text-sm font-medium">บันทึกจำนวนที่นับได้</h3>

          {saveFormError && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {saveFormError}
            </div>
          )}

          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="product_id" className={labelClass}>
                วัตถุดิบ <span className="text-red-600">*</span>
              </label>
              <select
                ref={productRef}
                id="product_id"
                name="product_id"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className={`${inputClass} mt-1`}
                required
              >
                <option value="">— เลือกวัตถุดิบ —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku}){alreadyCounted.has(p.id) ? " — นับแล้ว" : ""}
                  </option>
                ))}
              </select>
              {productId && alreadyCounted.has(productId) && (
                <p className="mt-1 text-xs text-amber-700">
                  นับรายการนี้ไปแล้ว — บันทึกอีกครั้งจะเป็นการแก้ตัวเลขเดิม
                </p>
              )}
              {saveErrors?.productId && (
                <p className="mt-1 text-xs text-red-600">{saveErrors.productId}</p>
              )}
            </div>

            {product && (
              <div>
                <span className={labelClass}>
                  จำนวนที่นับได้ <span className="text-red-600">*</span>
                </span>
                <p className="mb-1 text-xs text-muted-foreground">
                  นับได้หลายหน่วยรวมกันได้ เช่น 2 กระสอบ + 3 kg
                </p>
                <div className="space-y-2">
                  {entries.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        name="entry_qty"
                        type="number"
                        step="0.001"
                        min="0"
                        value={row.qty}
                        onChange={(e) =>
                          setEntries((rows) =>
                            rows.map((r, j) =>
                              j === i ? { ...r, qty: e.target.value } : r
                            )
                          )
                        }
                        className={`${inputClass} flex-1`}
                        placeholder="0"
                      />
                      <select
                        name="entry_unit_id"
                        value={row.unitId}
                        onChange={(e) =>
                          setEntries((rows) =>
                            rows.map((r, j) =>
                              j === i ? { ...r, unitId: e.target.value } : r
                            )
                          )
                        }
                        className={`${inputClass} w-40`}
                      >
                        {product.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.unitName}
                            {u.isBase ? " (หน่วยหลัก)" : ""}
                          </option>
                        ))}
                      </select>
                      {entries.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setEntries((rows) => rows.filter((_, j) => j !== i))
                          }
                          className="text-xs text-muted-foreground hover:text-red-700"
                        >
                          ลบ
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setEntries((rows) => [...rows, { unitId: "", qty: "" }])}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  + เพิ่มหน่วย
                </button>
                {saveErrors?.entries && (
                  <p className="mt-1 text-xs text-red-600">{saveErrors.entries}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  ถ้าไปดูแล้วไม่มีของเลย ให้ใส่ 0 — ระบบจะตัดสต๊อกให้เหลือศูนย์
                  ส่วนของที่ไม่ได้นับ ไม่ต้องใส่บรรทัด
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="counted_by_name" className={labelClass}>
                  ผู้นับ
                </label>
                <input
                  id="counted_by_name"
                  name="counted_by_name"
                  type="text"
                  maxLength={100}
                  className={`${inputClass} mt-1`}
                  placeholder="ชื่อคนที่เดินนับ (ถ้าไม่ใช่คุณ)"
                />
              </div>
              <div>
                <label htmlFor="line_notes" className={labelClass}>
                  หมายเหตุ
                </label>
                <input
                  id="line_notes"
                  name="notes"
                  type="text"
                  maxLength={500}
                  className={`${inputClass} mt-1`}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving || !productId}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "กำลังบันทึก…" : "บันทึกรายการ"}
            </button>
          </div>
        </form>
      )}

      {/* --- the lines --- */}
      <div>
        <h3 className="mb-2 text-sm font-medium">รายการที่นับแล้ว</h3>
        {detail.items.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
            ยังไม่ได้นับอะไรเลย
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem]">
              <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">วัตถุดิบ</th>
                  <th className="px-3 py-2 text-right font-medium">นับได้</th>
                  {detail.showExpected && (
                    <>
                      <th className="px-3 py-2 text-right font-medium">ระบบว่ามี</th>
                      <th className="px-3 py-2 text-right font-medium">ส่วนต่าง</th>
                      <th className="px-3 py-2 text-right font-medium">มูลค่า</th>
                    </>
                  )}
                  <th className="px-3 py-2 font-medium">ผู้นับ</th>
                  {isDraft && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detail.items.map((item) => (
                  <tr
                    key={item.id}
                    className={item.isReversal ? "bg-muted/30 text-muted-foreground" : ""}
                  >
                    <td className="px-3 py-2 text-sm">
                      {item.productName}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {item.productSku}
                      </span>
                      {item.isReversal && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                          กลับรายการ
                        </span>
                      )}
                      {item.entries.length > 0 && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {item.entries
                            .map((e) => `${formatQty(e.qtyInUnit)} ${e.unitName}`)
                            .join(" + ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">
                      {formatQty(item.qtyCounted)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {item.baseUnitName}
                      </span>
                    </td>
                    {detail.showExpected && (
                      <>
                        <td className="px-3 py-2 text-right text-sm tabular-nums text-muted-foreground">
                          {formatQty(item.qtyExpected)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right text-sm tabular-nums ${item.varianceIsShort ? "font-medium text-red-700" : item.varianceIsZero ? "text-muted-foreground" : "font-medium text-emerald-700"}`}
                        >
                          {item.varianceIsZero
                            ? "ตรง"
                            : `${item.varianceIsShort ? "" : "+"}${formatQty(item.variance)}`}
                        </td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">
                          {item.varianceIsZero
                            ? "—"
                            : formatMoney(
                                String(varianceValue(item.variance, item.productId))
                              )}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.countedByName ?? item.countedByUser ?? "—"}
                      <span className="mt-0.5 block">{item.countedAtLabel}</span>
                    </td>
                    {isDraft && (
                      <td className="px-3 py-2 text-right">
                        <form
                          action={async () => {
                            await removeLine(detail.id, item.id);
                          }}
                        >
                          <button
                            type="submit"
                            className="text-xs text-muted-foreground hover:text-red-700"
                          >
                            เอาออก
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- close --- */}
      {isDraft && (
        <form action={closeAction} className="rounded-lg border border-border p-4">
          <input type="hidden" name="id" value={detail.id} />
          <h3 className="text-sm font-medium">ปิดใบนับ</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            ปิดแล้วระบบจะบันทึกส่วนต่างเข้าคลังทันที และแก้ใบนี้ไม่ได้อีก
          </p>

          {uncountedStocked > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              ยังมีวัตถุดิบอีก <strong>{uncountedStocked}</strong> รายการที่มีของอยู่แต่ไม่ได้นับรอบนี้
              — ของพวกนี้จะไม่ถูกแตะต้อง ปิดใบได้ตามปกติถ้าตั้งใจนับแค่บางส่วน
            </div>
          )}

          {closeError && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {closeError}
            </div>
          )}

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmClose}
              onChange={(e) => setConfirmClose(e.target.checked)}
            />
            ตรวจตัวเลขแล้ว ยืนยันปิดใบนับ
          </label>

          <button
            type="submit"
            disabled={closing || !confirmClose || detail.items.length === 0}
            className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {closing ? "กำลังปิด…" : "ปิดใบนับและบันทึกส่วนต่าง"}
          </button>
        </form>
      )}

      {/* --- void --- */}
      {detail.status === "CLOSED" && (
        <div className="rounded-lg border border-border p-4">
          {!voidOpen ? (
            <button
              type="button"
              onClick={() => setVoidOpen(true)}
              className="text-sm text-red-700 hover:underline"
            >
              ยกเลิกใบนับนี้
            </button>
          ) : (
            <form action={voidAction} className="space-y-3">
              <input type="hidden" name="id" value={detail.id} />
              <h3 className="text-sm font-medium">ยกเลิกใบนับ</h3>
              <p className="text-sm text-muted-foreground">
                ระบบจะเพิ่มรายการกลับรายการเพื่อคืนสต๊อกให้เหมือนก่อนปิดใบ
                รายการเดิมจะยังอยู่ครบ
              </p>
              {voidError && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                  {voidError}
                </div>
              )}
              <div>
                <label htmlFor="void_reason" className={labelClass}>
                  เหตุผล <span className="text-red-600">*</span>
                </label>
                <input
                  id="void_reason"
                  name="void_reason"
                  type="text"
                  maxLength={500}
                  required
                  className={`${inputClass} mt-1`}
                  placeholder="เช่น นับซ้ำช่องเดิม / ลืมว่ายกของไปสาขาอื่น"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={voiding}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {voiding ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}
                </button>
                <button
                  type="button"
                  onClick={() => setVoidOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm"
                >
                  ไม่ยกเลิก
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

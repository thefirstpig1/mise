"use client";

// Sprint 3 Part 17 L5a — the waste entry form (ADR 0017 Q2/Q7).
//
// The design constraint that decides everything here: **recording waste has to
// fit in the thirty seconds between the bin and the next order, on a phone, or
// nobody will do it.** So:
//
//  1. There is no draft and no confirm step. One submit posts to the ledger.
//  2. The form stays open after a success and keeps product/branch/date, because
//     the kitchen throws away three things in a row, not one. Only qty, the
//     reason's free text and notes clear.
//  3. `submit_key` is minted HERE and becomes waste_log.id (Part 13.5). Because
//     of (2) it must ROTATE after each success — a key held across a batch would
//     make the second tray read as a replay of the first and silently write
//     nothing, which is the worst possible failure for a loss record.
//  4. The negative-balance warning is shown but never blocks. A shop that never
//     recorded the delivery still threw the food away (ADR 0011 Q9); refusing the
//     write would only lose the fact. Unlike the adjust form there is not even a
//     confirm checkbox — waste is not a correction the user might have got
//     backwards, it is an event they watched happen.
//
// `todayBangkok` comes from the server: the zod backdate window is checked
// against BANGKOK today, so a device in another timezone would otherwise be
// offered a date the server rejects (Decision #60).

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { WasteActionState } from "@/app/waste/actions";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";
import {
  WASTE_REASON_LABELS_TH,
  WASTE_REASON_VALUES,
} from "@/lib/validations/waste";

export type WasteProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUnitName: string | null;
  units: { id: string; unitName: string; isBase: boolean }[];
};

export type WasteBranchOption = { id: string; name: string };

const errorClass = "mt-1 text-xs text-bad";

/** A fresh `submit_key` — the id the server will give the `waste_log` row. */
function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function WasteEntryForm({
  action,
  products,
  branches,
  todayBangkok,
  defaultBranchId,
}: {
  action: (prev: WasteActionState, fd: FormData) => Promise<WasteActionState>;
  products: WasteProductOption[];
  branches: WasteBranchOption[];
  todayBangkok: string;
  defaultBranchId: string;
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as WasteActionState);

  const [submitKey, setSubmitKey] = useState(newSubmitKey);
  const [productId, setProductId] = useState("");
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [unitId, setUnitId] = useState("");
  const [qty, setQty] = useState("");

  const qtyRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const product = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId]
  );

  // Picking a product resets the unit to its base — the unit stock is kept in.
  useEffect(() => {
    const base = product?.units.find((u) => u.isBase) ?? product?.units[0];
    setUnitId(base?.id ?? "");
  }, [product]);

  // Successive entry (see (2)/(3) above): keep what stays the same across a
  // batch, clear what does not, rotate the key, put the cursor back on quantity.
  useEffect(() => {
    if (!state.ok) return;
    setQty("");
    if (notesRef.current) notesRef.current.value = "";
    setSubmitKey(newSubmitKey());
    qtyRef.current?.focus();
  }, [state]);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const err = (key: string) => fieldErrors?.[key];

  const minBackdate = (() => {
    const d = new Date(`${todayBangkok}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - MAX_BACKDATE_DAYS);
    return d.toISOString().slice(0, 10);
  })();

  const baseUnitLabel = product?.baseUnitName ?? "";

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="submit_key" value={submitKey} />

      {state.ok && (
        <div className="rounded-lg border border-good-border bg-good-bg p-4 text-sm text-good">
          บันทึกแล้ว — ยอดคงเหลือใหม่{" "}
          <strong>
            {state.postBalance} {baseUnitLabel}
          </strong>
          {state.negative && (
            <span className="ml-2 font-medium text-bad">
              (ติดลบ — อาจยังไม่ได้บันทึกใบรับของ)
            </span>
          )}
        </div>
      )}

      {formError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-4 text-sm text-bad">
          {formError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="product_id" className="label">
            วัตถุดิบ <span className="text-bad">*</span>
          </label>
          <select
            id="product_id"
            name="product_id"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className={"input w-full mt-1"}
            required
          >
            <option value="">— เลือกวัตถุดิบ —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
          {err("productId") && <p className={errorClass}>{err("productId")}</p>}
        </div>

        <div>
          <label htmlFor="input_qty" className="label">
            จำนวนที่ทิ้ง <span className="text-bad">*</span>
          </label>
          <input
            ref={qtyRef}
            id="input_qty"
            name="input_qty"
            type="number"
            step="0.001"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={"input w-full mt-1"}
            required
          />
          {err("inputQty") && <p className={errorClass}>{err("inputQty")}</p>}
        </div>

        <div>
          <label htmlFor="input_unit_id" className="label">
            หน่วย <span className="text-bad">*</span>
          </label>
          <select
            id="input_unit_id"
            name="input_unit_id"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className={"input w-full mt-1"}
            required
            disabled={!product}
          >
            {(product?.units ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitName}
              </option>
            ))}
          </select>
          {err("inputUnitId") && <p className={errorClass}>{err("inputUnitId")}</p>}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="reason" className="label">
            สาเหตุ <span className="text-bad">*</span>
          </label>
          <select
            id="reason"
            name="reason"
            defaultValue="SPOILED"
            className={"input w-full mt-1"}
            required
          >
            {WASTE_REASON_VALUES.map((r) => (
              <option key={r} value={r}>
                {WASTE_REASON_LABELS_TH[r]}
              </option>
            ))}
          </select>
          {err("reason") && <p className={errorClass}>{err("reason")}</p>}
          {/* The yield boundary, said where someone might otherwise get it wrong
              (Q3). Trim and cooking loss belong to the product's yield %, not
              here — burying them in waste would make both numbers useless. */}
          <p className="mt-1 text-xs text-muted-foreground">
            ของที่หายไปตอนตัดแต่งหรือทำสุก ไม่ใช่ของเสีย — อยู่ใน % yield ของวัตถุดิบ
            และอาหารพนักงานก็ไม่ใช่ของเสียเช่นกัน
          </p>
        </div>

        <div>
          <label htmlFor="branch_id" className="label">
            สาขา <span className="text-bad">*</span>
          </label>
          <select
            id="branch_id"
            name="branch_id"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={"input w-full mt-1"}
            required
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {err("branchId") && <p className={errorClass}>{err("branchId")}</p>}
        </div>

        <div>
          <label htmlFor="occurred_at" className="label">
            วันที่ <span className="text-bad">*</span>
          </label>
          <input
            id="occurred_at"
            name="occurred_at"
            type="date"
            defaultValue={todayBangkok}
            min={minBackdate}
            max={todayBangkok}
            className={"input w-full mt-1"}
            required
          />
          {err("occurredAt") && <p className={errorClass}>{err("occurredAt")}</p>}
        </div>

        <div>
          <label htmlFor="wasted_by_name" className="label">
            ใครทิ้ง
          </label>
          <input
            id="wasted_by_name"
            name="wasted_by_name"
            type="text"
            maxLength={100}
            placeholder="เช่น เชฟหนึ่ง (ไม่ใส่ก็ได้)"
            className={"input w-full mt-1"}
          />
          {/* ADR 0015 Q2's rule: the owner holds the only login and the staff do
              the work, so the account alone would record "the owner threw
              everything away" — tidy and false. */}
          {err("wastedByName") && <p className={errorClass}>{err("wastedByName")}</p>}
        </div>

        <div>
          <label htmlFor="notes" className="label">
            หมายเหตุ
          </label>
          <textarea
            ref={notesRef}
            id="notes"
            name="notes"
            rows={1}
            maxLength={500}
            className={"input w-full mt-1"}
          />
          {err("notes") && <p className={errorClass}>{err("notes")}</p>}
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? "กำลังบันทึก…" : "บันทึกของเสีย"}
      </button>
      <p className="text-xs text-muted-foreground">
        บันทึกแล้วตัดสต๊อกทันที — ถ้าคีย์ผิด ให้กดยกเลิกที่รายการนั้น ระบบจะคืนของเข้าสต๊อกให้
        โดยรายการเดิมยังอยู่ให้เห็น
      </p>
    </form>
  );
}

"use client";

// Sprint 2 Part 10 L5a — the manual stock-adjustment form (the only Part 10
// producer of ledger rows). Driven by React 19 useActionState against
// createStockAdjustmentAction. Input `name=` attributes are snake_case to match
// rawFromFormData in src/app/stock/actions.ts; fieldErrors keys are the
// schema's camelCase names.
//
// Three things this form owns that the layers below deliberately do not:
//
//  1. The Q9 negative-balance gate. The server NEVER blocks a negative balance —
//     stock going below zero is real information (a missed receive, a bad count)
//     and hiding it would be worse than showing it. So the refusal to write is
//     purely a UI speed bump: a red banner + an explicit confirm checkbox. The
//     user can always proceed.
//  2. The live post-balance preview, so the consequence is visible BEFORE the
//     write, not after. Preview math runs in JS `Number` — display only; the
//     authoritative post-balance always comes back from the server as a string
//     (see stock-view.ts on why Decimals never round-trip through Number).
//  3. Successive entry. Counting stock is a batch job — a user adjusts ten
//     items in a row — so a successful write keeps the product/branch/date and
//     clears only qty + notes, instead of navigating away.
//  4. (Part 13.5) The `submit_key` lifecycle. The key is minted HERE and becomes
//     stock_adjustment.id, which is what makes a double POST resolve to one
//     movement instead of doubling the stock. Because of (3) this form is the one
//     place the key must ROTATE — a key held across a batch would make item #2
//     read as a replay of item #1 and silently write nothing.
//
// `todayBangkok` / `minBackdate` are passed in from the server page rather than
// computed here: the zod backdate window is checked against BANGKOK today, and a
// device in another timezone would otherwise offer a date the server rejects.

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { StockAdjustmentActionState } from "@/app/stock/actions";
import {
  ADJUSTMENT_REASON_FORM_VALUES,
  ADJUSTMENT_REASON_LABELS_TH,
  ADJUSTMENT_TYPE_LABELS_TH,
  ADJUSTMENT_TYPE_VALUES,
  MAX_BACKDATE_DAYS,
  type AdjustmentType,
} from "@/lib/validations/stock-movement";
import type { StockBalanceView } from "./stock-view";

/** One selectable unit of a product. `toBaseRatio` is a STRING (Pitfall #20). */
export type ProductUnitOption = {
  id: string;
  unitName: string;
  toBaseRatio: string;
  isBase: boolean;
};

export type StockProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUnitName: string | null;
  units: ProductUnitOption[];
};

export type StockBranchOption = { id: string; name: string };

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "block text-sm font-medium";
const errorClass = "mt-1 text-xs text-bad";

/** Trim a preview number to the ledger's 3 decimal places, without trailing zeros. */
const fmt = (n: number): string =>
  Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "—";

/**
 * A fresh `submit_key` — the id the server will give the `stock_adjustment` row.
 *
 * The fallback is a real v4 uuid rather than something like `useId()` because the
 * schema validates the shape: a non-uuid key would fail with "คีย์การบันทึกไม่ถูกต้อง",
 * which the user cannot act on. `crypto.randomUUID` needs a secure context, so the
 * branch is unreachable on https and localhost — it exists for the case where it
 * isn't, not to be clever.
 */
function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function StockAdjustForm({
  action,
  products,
  branches,
  todayBangkok,
  fetchBalance,
  fetchCost,
}: {
  action: (
    prev: StockAdjustmentActionState,
    fd: FormData
  ) => Promise<StockAdjustmentActionState>;
  products: StockProductOption[];
  branches: StockBranchOption[];
  todayBangkok: string;
  /** getStockBalanceAction, bound by the page (a "use server" fn crossing over). */
  fetchBalance: (query: {
    productId: string;
    branchId: string;
  }) => Promise<{ ok: true; data: StockBalanceView } | { ok: false; formError: string }>;
  /**
   * Part 14 — resolves the cost the server WOULD apply to a gain, so the user can
   * judge it without opening the cost field at all (ADR 0014 UX guardrail 1).
   */
  fetchCost: (query: {
    productId: string;
    branchId: string;
  }) => Promise<
    | { ok: true; data: { costPerBaseUnit: string; costSourceLabel: string } }
    | { ok: false; formError: string }
  >;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as StockAdjustmentActionState
  );

  // One key per submission — NOT per render, or the row id would change between
  // the POST and its retry and the dedupe would have nothing to match on.
  const [submitKey, setSubmitKey] = useState(newSubmitKey);

  const [productId, setProductId] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [type, setType] = useState<AdjustmentType>("ADJUST_GAIN");
  const [qty, setQty] = useState("");
  const [unitId, setUnitId] = useState("");
  const [confirmedNegative, setConfirmedNegative] = useState(false);

  const qtyRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Part 14: the optional cost, COLLAPSED by default. This form exists for batch
  // entry — ten items in a row, qty and Enter — so an extra always-visible field
  // would cost every user something to spare the rare one who knows the price.
  const [costOpen, setCostOpen] = useState(false);
  const [costUnitId, setCostUnitId] = useState("");
  const costRef = useRef<HTMLInputElement>(null);
  const costNoteRef = useRef<HTMLInputElement>(null);
  const [defaultCost, setDefaultCost] = useState<{
    costPerBaseUnit: string;
    costSourceLabel: string;
  } | null>(null);

  const product = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId]
  );

  // --- current balance for the chosen (product, branch) ---
  const [balance, setBalance] = useState<StockBalanceView | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    if (!productId || !branchId) {
      setBalance(null);
      return;
    }
    let stale = false;
    setBalanceLoading(true);
    fetchBalance({ productId, branchId })
      .then((res) => {
        // Guard against an out-of-order response for a previous selection.
        if (stale) return;
        setBalance(res.ok ? res.data : null);
      })
      .finally(() => {
        if (!stale) setBalanceLoading(false);
      });
    return () => {
      stale = true;
    };
    // `state` is a dependency so the balance refreshes after a successful write.
  }, [productId, branchId, fetchBalance, state]);

  // Picking a product resets the unit to its base — the natural unit to count in.
  useEffect(() => {
    const base = product?.units.find((u) => u.isBase) ?? product?.units[0];
    setUnitId(base?.id ?? "");
    setCostUnitId(base?.id ?? "");
  }, [product]);

  // What the server would use if the user says nothing (Q5's fallback chain),
  // shown as plain text so the decision "is that right?" needs no clicks.
  useEffect(() => {
    if (!productId || !branchId) {
      setDefaultCost(null);
      return;
    }
    let stale = false;
    fetchCost({ productId, branchId }).then((res) => {
      if (stale) return;
      setDefaultCost(res.ok ? res.data : null);
    });
    return () => {
      stale = true;
    };
  }, [productId, branchId, fetchCost, state]);

  // --- preview (display only; the server returns the authoritative value) ---
  const unit = product?.units.find((u) => u.id === unitId);
  const qtyNum = Number(qty);
  const hasQty = qty.trim() !== "" && Number.isFinite(qtyNum) && qtyNum > 0;
  const deltaBase =
    hasQty && unit
      ? (type === "ADJUST_LOSS" ? -1 : 1) * qtyNum * Number(unit.toBaseRatio)
      : 0;
  const currentBase = balance ? Number(balance.balance) : 0;
  const previewBase = currentBase + deltaBase;
  const willGoNegative = hasQty && balance !== null && previewBase < 0;

  // A new selection invalidates a confirmation given for the previous preview.
  useEffect(() => {
    setConfirmedNegative(false);
  }, [productId, branchId, type, qty, unitId]);

  // Successive entry: keep product/branch/date, clear qty + notes, refocus qty.
  // The key rotates HERE, in the same effect: the previous key is now spent (it
  // identifies the row that was just written), so the next item in the batch needs
  // its own — otherwise the server would recognise it as a replay and write nothing.
  useEffect(() => {
    if (!state.ok) return;
    setQty("");
    if (notesRef.current) notesRef.current.value = "";
    if (costRef.current) costRef.current.value = "";
    if (costNoteRef.current) costNoteRef.current.value = "";
    setCostOpen(false);
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
  const blockedByNegative = willGoNegative && !confirmedNegative;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="submit_key" value={submitKey} />

      {state.ok && (
        <div className="rounded-lg border border-good-border bg-good-bg p-4 text-sm text-good">
          บันทึกแล้ว — ยอดคงเหลือใหม่{" "}
          <strong>
            {state.postBalance} {baseUnitLabel}
          </strong>
          {state.negative && (
            <span className="ml-2 font-medium text-bad">
              (ติดลบ — ต้องตรวจสอบ)
            </span>
          )}
        </div>
      )}

      {formError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-4 text-sm text-bad">
          {formError}
        </div>
      )}

      {/* --- what + where --- */}
      <div>
        <label htmlFor="product_id" className={labelClass}>
          วัตถุดิบ <span className="text-bad">*</span>
        </label>
        <select
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
              {p.name} ({p.sku})
            </option>
          ))}
        </select>
        {err("productId") && <p className={errorClass}>{err("productId")}</p>}
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
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {err("branchId") && <p className={errorClass}>{err("branchId")}</p>}
      </div>

      {/* --- current balance, so the user adjusts against a known number --- */}
      {productId && branchId && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {balanceLoading ? (
            <span className="text-muted-foreground">กำลังโหลดยอดคงเหลือ…</span>
          ) : balance ? (
            <>
              <span className="text-muted-foreground">ยอดคงเหลือปัจจุบัน: </span>
              <strong className={balance.negative ? "text-bad" : ""}>
                {balance.balance} {baseUnitLabel}
              </strong>
              {balance.movementCount === 0 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  (ยังไม่เคยมีการเคลื่อนไหว)
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">ไม่พบยอดคงเหลือ</span>
          )}
        </div>
      )}

      {/* --- direction --- */}
      <fieldset>
        <legend className={labelClass}>
          ประเภทการปรับ <span className="text-bad">*</span>
        </legend>
        <div className="mt-2 flex gap-4">
          {ADJUSTMENT_TYPE_VALUES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="type"
                value={t}
                checked={type === t}
                onChange={() => setType(t)}
              />
              {ADJUSTMENT_TYPE_LABELS_TH[t]}
            </label>
          ))}
        </div>
        {err("type") && <p className={errorClass}>{err("type")}</p>}
      </fieldset>

      {/* --- how much, in which unit --- */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="input_qty" className={labelClass}>
            จำนวน <span className="text-bad">*</span>
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
            className={`${inputClass} mt-1`}
            required
          />
          {err("inputQty") && <p className={errorClass}>{err("inputQty")}</p>}
        </div>

        <div>
          <label htmlFor="input_unit_id" className={labelClass}>
            หน่วย <span className="text-bad">*</span>
          </label>
          <select
            id="input_unit_id"
            name="input_unit_id"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className={`${inputClass} mt-1`}
            required
            disabled={!product}
          >
            {!product && <option value="">— เลือกวัตถุดิบก่อน —</option>}
            {product?.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitName}
                {u.isBase ? " (หน่วยหลัก)" : ""}
              </option>
            ))}
          </select>
          {err("inputUnitId") && <p className={errorClass}>{err("inputUnitId")}</p>}
        </div>
      </div>

      {/* --- preview: the consequence, before the write --- */}
      {hasQty && balance && unit && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            willGoNegative
              ? "border-bad-border bg-bad-bg text-bad"
              : "border-border bg-muted/30"
          }`}
        >
          <div>
            ยอดหลังปรับ:{" "}
            <strong>
              {fmt(previewBase)} {baseUnitLabel}
            </strong>
            <span className="ml-2 text-xs text-muted-foreground">
              ({fmt(currentBase)} {deltaBase < 0 ? "−" : "+"}{" "}
              {fmt(Math.abs(deltaBase))})
            </span>
          </div>
          {!unit.isBase && (
            <div className="mt-1 text-xs text-muted-foreground">
              {qty} {unit.unitName} = {fmt(Math.abs(deltaBase))} {baseUnitLabel}
            </div>
          )}
          {willGoNegative && (
            <label className="mt-3 flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                checked={confirmedNegative}
                onChange={(e) => setConfirmedNegative(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                ยอดจะติดลบ — โปรดตรวจสอบว่าลืมบันทึกรับของหรือนับผิดหรือไม่
                ยืนยันว่าต้องการบันทึกตามนี้
              </span>
            </label>
          )}
        </div>
      )}

      {/* --- why --- */}
      <div>
        <label htmlFor="reason" className={labelClass}>
          เหตุผล <span className="text-bad">*</span>
        </label>
        <select
          id="reason"
          name="reason"
          defaultValue="RECOUNT"
          className={`${inputClass} mt-1`}
          required
        >
          {/* Part 17 Q4: SPOILAGE and DAMAGE are gone from this list. An
              adjustment is a CORRECTION; throwing food away is an event, and it
              has its own document now. */}
          {ADJUSTMENT_REASON_FORM_VALUES.map((r) => (
            <option key={r} value={r}>
              {ADJUSTMENT_REASON_LABELS_TH[r]}
            </option>
          ))}
        </select>
        {err("reason") && <p className={errorClass}>{err("reason")}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          ทิ้งของเสียให้บันทึกที่หน้า{" "}
          <a href="/waste" className="text-primary hover:underline">
            ของเสีย
          </a>{" "}
          — จะได้แยกออกจากของที่หายโดยไม่รู้สาเหตุในรายงานต้นทุน
        </p>
      </div>

      {/* --- when (business time; backdatable within the Q5 window) --- */}
      <div>
        <label htmlFor="occurred_at" className={labelClass}>
          วันที่ <span className="text-bad">*</span>
        </label>
        <input
          id="occurred_at"
          name="occurred_at"
          type="date"
          defaultValue={todayBangkok}
          min={minBackdate}
          max={todayBangkok}
          className={`${inputClass} mt-1`}
          required
        />
        <p className="mt-1 text-xs text-muted-foreground">
          ย้อนหลังได้ไม่เกิน {MAX_BACKDATE_DAYS} วัน
        </p>
        {err("occurredAt") && <p className={errorClass}>{err("occurredAt")}</p>}
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          หมายเหตุ
        </label>
        <textarea
          ref={notesRef}
          id="notes"
          name="notes"
          rows={2}
          className={`${inputClass} mt-1`}
        />
        {err("notes") && <p className={errorClass}>{err("notes")}</p>}
      </div>

      {/* Part 14 (ADR 0014 Q6) — only on a GAIN: a LOSS removes stock that already
          has a cost from the layer it is drawn from, and zod refuses a cost there
          rather than ignoring it. */}
      {type === "ADJUST_GAIN" && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          {defaultCost && (
            <p className="text-xs text-muted-foreground">
              ระบบจะใช้ต้นทุน{" "}
              <strong className="tabular-nums">
                {defaultCost.costPerBaseUnit} ฿ / {baseUnitLabel}
              </strong>{" "}
              ({defaultCost.costSourceLabel})
            </p>
          )}

          {!costOpen ? (
            <button
              type="button"
              onClick={() => setCostOpen(true)}
              className="mt-1 text-xs text-primary hover:underline"
            >
              ระบุต้นทุนเอง
            </button>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1">
                  <label htmlFor="cost_unit_cost" className={labelClass}>
                    ต้นทุน (บาท)
                  </label>
                  <input
                    ref={costRef}
                    id="cost_unit_cost"
                    name="cost_unit_cost"
                    type="number"
                    step="0.0001"
                    min="0"
                    className={`${inputClass} mt-1`}
                    placeholder="เช่น 4500"
                  />
                </div>
                <div className="min-w-[7rem]">
                  <label htmlFor="cost_unit_id" className={labelClass}>
                    ต่อหน่วย
                  </label>
                  <select
                    id="cost_unit_id"
                    name="cost_unit_id"
                    value={costUnitId}
                    onChange={(e) => setCostUnitId(e.target.value)}
                    className={`${inputClass} mt-1`}
                  >
                    {(product?.units ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitName}
                        {u.isBase ? " (หน่วยหลัก)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="cost_note" className={labelClass}>
                  ที่มา / หมายเหตุ
                </label>
                <input
                  ref={costNoteRef}
                  id="cost_note"
                  name="cost_note"
                  type="text"
                  maxLength={500}
                  className={`${inputClass} mt-1`}
                  placeholder="เช่น ของจากใบส่งของที่ลืมคีย์"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                เว้นว่างไว้ก็ได้ — ระบบจะใช้ราคาซื้อครั้งล่าสุด และแก้ทีหลังได้ที่หน้าต้นทุน
              </p>
            </div>
          )}
          {err("costDeclaration") && (
            <p className={errorClass}>{err("costDeclaration")}</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || blockedByNegative}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก…" : "บันทึกการปรับสต๊อก"}
        </button>
        {blockedByNegative && (
          <span className="text-xs text-bad">
            ติ๊กยืนยันด้านบนก่อนจึงจะบันทึกได้
          </span>
        )}
      </div>
    </form>
  );
}

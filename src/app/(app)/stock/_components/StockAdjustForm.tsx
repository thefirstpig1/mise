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
import QtyStepper from "@/components/ui/QtyStepper";
import SelectChip from "@/components/ui/SelectChip";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import { MoneyInput } from "@/components/ui/NumberField";
import type { StockAdjustmentActionState } from "@/app/(app)/stock/actions";
import {
  ADJUSTMENT_REASON_FORM_VALUES,
  ADJUSTMENT_REASON_LABELS_TH,
  ADJUSTMENT_TYPE_LABELS_TH,
  ADJUSTMENT_TYPE_VALUES,
  MAX_BACKDATE_DAYS,
  type AdjustmentType,
} from "@/lib/validations/stock-movement";
import type { StockBalanceView } from "./stock-view";
import { readApi } from "@/lib/read-api";
import { useKeepForm } from "@/lib/keep-form";

/** One selectable unit of a product. `toBaseRatio` is a STRING (Pitfall #20). */
export type ProductUnitOption = {
  id: string;
  unitName: string;
  toBaseRatio: string;
  isBase: boolean;
};

/** Searched with ProductPicker (Kong 2026-10-22: never a <select> of every product). */
export type StockProductOption = PickerProduct & {
  units: ProductUnitOption[];
};

export type StockBranchOption = { id: string; name: string };

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

// GET reads (mise-ui-review §5c) — these were Server Actions the page handed down.
type BalanceRead = { ok: true; data: StockBalanceView } | { ok: false; formError: string };
type CostRead = { ok: true; data: { costPerBaseUnit: string; costSourceLabel: string } } | { ok: false; formError: string };
const fetchBalance = (q: { productId: string; branchId: string }): Promise<BalanceRead> =>
  readApi<{ ok: true; data: StockBalanceView }>("/api/stock", "balance", q);
const fetchCostRead = (q: { productId: string; branchId: string }): Promise<CostRead> =>
  readApi<{ ok: true; data: { costPerBaseUnit: string; costSourceLabel: string } }>("/api/cost", "productCost", q);

export default function StockAdjustForm({
  action,
  products,
  branches,
  todayBangkok,
  canSeeCost,
  initialBranchId,
}: {
  action: (
    prev: StockAdjustmentActionState,
    fd: FormData
  ) => Promise<StockAdjustmentActionState>;
  products: StockProductOption[];
  branches: StockBranchOption[];
  todayBangkok: string;
  /**
   * Part 14 — the form shows the cost the server WOULD apply to a gain, so the
   * user can judge it without opening the cost field at all (ADR 0014 UX
   * guardrail 1). Only for a reader with cost:view: the read requires it, and
   * asking anyway sent a cook to /denied mid-form (ADR 0038 audit).
   */
  canSeeCost: boolean;
  /** `?branch=` — the branch the person came from (the งานสต๊อก hub). */
  initialBranchId?: string;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as StockAdjustmentActionState
  );
  const formActionKeep = useKeepForm(formAction, state);

  // One key per submission — NOT per render, or the row id would change between
  // the POST and its retry and the dedupe would have nothing to match on.
  const [submitKey, setSubmitKey] = useState(newSubmitKey);

  const [productId, setProductId] = useState("");
  const [branchId, setBranchId] = useState(
    branches.find((b) => b.id === initialBranchId)?.id ?? branches[0]?.id ?? ""
  );
  // Kong 2026-10-25 (stock mockup XYYyUgNP18V4HL3vUwrUf1): no direction is
  // pre-chosen — "ปรับเพิ่ม" by default added stock to anyone who pressed save
  // without looking. And the usual case is "this is what is really there", so
  // that is the first mode: type what you see, the system works out the change.
  const [mode, setMode] = useState<"counted" | "delta">("counted");
  const [counted, setCounted] = useState("");
  const [type, setType] = useState<AdjustmentType | null>(null);
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
  const fetchCost = canSeeCost ? fetchCostRead : null;
  useEffect(() => {
    if (!fetchCost || !productId || !branchId) {
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
  const currentBase = balance ? Number(balance.balance) : 0;
  const baseUnit = product?.units.find((u) => u.isBase) ?? null;
  const countedNum = Number(counted);
  const hasCounted = counted.trim() !== "" && Number.isFinite(countedNum) && countedNum >= 0 && balance !== null;
  const countedDelta = hasCounted ? Math.round((countedNum - currentBase) * 1000) / 1000 : 0;
  const deltaBase =
    mode === "counted"
      ? countedDelta
      : hasQty && unit && type
        ? (type === "ADJUST_LOSS" ? -1 : 1) * qtyNum * Number(unit.toBaseRatio)
        : 0;
  const previewBase = currentBase + deltaBase;
  const willGoNegative = (mode === "counted" ? hasCounted : hasQty) && balance !== null && previewBase < 0;

  // A new selection invalidates a confirmation given for the previous preview.
  useEffect(() => {
    setConfirmedNegative(false);
  }, [productId, branchId, type, qty, unitId, mode, counted]);

  // Successive entry: keep product/branch/date, clear qty + notes, refocus qty.
  // The key rotates HERE, in the same effect: the previous key is now spent (it
  // identifies the row that was just written), so the next item in the batch needs
  // its own — otherwise the server would recognise it as a replay and write nothing.
  useEffect(() => {
    if (!state.ok) return;
    setQty("");
    setCounted("");
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
    <form {...formActionKeep} className="space-y-6">
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
        <label htmlFor="product_id" className="label">
          วัตถุดิบ <span className="text-bad">*</span>
        </label>
        <ProductPicker
          products={products}
          value={productId}
          onChange={(id) => {
            setProductId(id);
            // Picked: the next thing to type is how much.
            if (id) window.setTimeout(() => qtyRef.current?.focus(), 0);
          }}
          name="product_id"
          inputId="product_id"
          invalid={!!err("productId")}
        />
        {err("productId") && <p className={errorClass}>{err("productId")}</p>}
      </div>

      <div>
        <label htmlFor="branch_id" className="label">
          สาขา <span className="text-bad">*</span>
        </label>
        {/* One branch in reach is a fact, not a choice. */}
        {branches.length === 1 ? (
          <>
            <input type="hidden" id="branch_id" name="branch_id" value={branchId} />
            <p className="mt-1 text-sm">{branches[0].name}</p>
          </>
        ) : (
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
        )}
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

      {/* --- how: what is really there, or by how much --- */}
      <fieldset>
        <legend className="label">ปรับยังไง</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(
            [
              ["counted", "ตั้งเป็นยอดที่มีจริง", "พิมพ์ว่าเหลือเท่าไหร่ ระบบคิดส่วนต่างให้"],
              ["delta", "เพิ่ม / ลด เท่านี้", "รู้จำนวนที่เปลี่ยน"],
            ] as const
          ).map(([m, title, hint]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-xl border-2 p-3 text-left text-sm ${mode === m ? "border-primary bg-primary/5" : "border-border-strong"}`}
            >
              <b>{title}</b>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {mode === "counted" ? (
        <div>
          <label htmlFor="counted_qty" className="label">
            มีจริงตอนนี้ <span className="text-bad">*</span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <QtyStepper inputRef={qtyRef} value={counted} onChange={setCounted} label="มีจริงตอนนี้" inputProps={{ id: "counted_qty" }} />
            <span className="text-sm text-muted-foreground">{baseUnitLabel || "หน่วยหลัก"}</span>
          </div>
          {/* What the server receives is the CHANGE — the same three fields the
              delta mode posts, worked out here from what was typed. */}
          <input type="hidden" name="type" value={countedDelta < 0 ? "ADJUST_LOSS" : "ADJUST_GAIN"} />
          <input type="hidden" name="input_qty" value={hasCounted && countedDelta !== 0 ? String(Math.abs(countedDelta)) : ""} />
          <input type="hidden" name="input_unit_id" value={baseUnit?.id ?? ""} />
          {hasCounted && (
            <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${countedDelta === 0 ? "bg-good-bg text-good" : "bg-bad-bg text-bad"}`}>
              ระบบ {fmt(currentBase)} → จริง {fmt(countedNum)} {baseUnitLabel} ·{" "}
              <b>{countedDelta === 0 ? "ตรงกับระบบแล้ว ไม่ต้องปรับ" : `${countedDelta < 0 ? "ปรับลด" : "ปรับเพิ่ม"} ${fmt(Math.abs(countedDelta))} ${baseUnitLabel}`}</b>
              {countedDelta !== 0 && defaultCost && (
                <span> · ≈ ฿{Math.round(Math.abs(countedDelta) * Number(defaultCost.costPerBaseUnit)).toLocaleString("th-TH")}</span>
              )}
            </p>
          )}
          {err("inputQty") && <p className={errorClass}>{err("inputQty")}</p>}
        </div>
      ) : (
        <>
          <fieldset>
            <legend className="label">
              ประเภทการปรับ <span className="text-bad">*</span>
            </legend>
            <div className="mt-2 flex gap-4">
              {ADJUSTMENT_TYPE_VALUES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} required />
                  {ADJUSTMENT_TYPE_LABELS_TH[t]}
                </label>
              ))}
            </div>
            {err("type") && <p className={errorClass}>{err("type")}</p>}
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="input_qty" className="label">
                จำนวน <span className="text-bad">*</span>
              </label>
              <QtyStepper
                inputRef={qtyRef}
                value={qty}
                onChange={setQty}
                label="จำนวน"
                className="mt-1"
                inputProps={{ id: "input_qty", name: "input_qty", required: true }}
              />
              {err("inputQty") && <p className={errorClass}>{err("inputQty")}</p>}
            </div>

            <div>
              <label htmlFor="input_unit_id" className="label">
                หน่วย <span className="text-bad">*</span>
              </label>
              <SelectChip
                value={unitId}
                onChange={setUnitId}
                placeholder={product ? "หน่วย" : "เลือกวัตถุดิบก่อน"}
                options={(product?.units ?? []).map((u) => ({ value: u.id, label: u.isBase ? `${u.unitName} (หน่วยหลัก)` : u.unitName }))}
                className="mt-1 w-56"
                selectProps={{ id: "input_unit_id", name: "input_unit_id", required: true, disabled: !product }}
              />
              {err("inputUnitId") && <p className={errorClass}>{err("inputUnitId")}</p>}
            </div>
          </div>
        </>
      )}

      {/* --- preview: the consequence, before the write --- */}
      {mode === "delta" && hasQty && balance && unit && type && (
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
          {unit && !unit.isBase && (
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
        <label htmlFor="reason" className="label">
          เหตุผล <span className="text-bad">*</span>
        </label>
        <select
          id="reason"
          name="reason"
          defaultValue=""
          className={"input w-full mt-1"}
          required
        >
          <option value="" disabled>
            เลือกสาเหตุ
          </option>
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
          — จะได้แยกออกจากของที่หายโดยไม่รู้สาเหตุในรายงานต้นทุน · นับทั้งร้านใหม่? ใช้หน้า{" "}
          <a href="/stock-counts/new" className="text-primary hover:underline">
            นับสต๊อก
          </a>{" "}
          — ได้เอกสารและรายการขาด/เกินครบ
        </p>
      </div>

      {/* --- when (business time; backdatable within the Q5 window) --- */}
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
        <p className="mt-1 text-xs text-muted-foreground">
          ย้อนหลังได้ไม่เกิน {MAX_BACKDATE_DAYS} วัน
        </p>
        {err("occurredAt") && <p className={errorClass}>{err("occurredAt")}</p>}
      </div>

      <div>
        <label htmlFor="notes" className="label">
          หมายเหตุ
        </label>
        <textarea
          ref={notesRef}
          id="notes"
          name="notes"
          rows={2}
          className={"input w-full mt-1"}
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
                ฿{defaultCost.costPerBaseUnit} / {baseUnitLabel}
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
                <div>
                  <label htmlFor="cost_unit_cost" className="label">
                    ต้นทุน
                  </label>
                  <MoneyInput
                    ref={costRef}
                    id="cost_unit_cost"
                    name="cost_unit_cost"
                    placeholder="4500"
                    boxClassName="mt-1 w-36"
                  />
                </div>
                <div className="min-w-[7rem]">
                  <label htmlFor="cost_unit_id" className="label">
                    ต่อหน่วย
                  </label>
                  <SelectChip
                    value={costUnitId}
                    onChange={setCostUnitId}
                    placeholder="หน่วย"
                    options={(product?.units ?? []).map((u) => ({ value: u.id, label: u.isBase ? `${u.unitName} (หน่วยหลัก)` : u.unitName }))}
                    className="mt-1 w-48"
                    selectProps={{ id: "cost_unit_id", name: "cost_unit_id" }}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="cost_note" className="label">
                  ที่มา / หมายเหตุ
                </label>
                <input
                  ref={costNoteRef}
                  id="cost_note"
                  name="cost_note"
                  type="text"
                  maxLength={500}
                  className={"input w-full mt-1"}
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
          disabled={isPending || blockedByNegative || (mode === "counted" && (!hasCounted || countedDelta === 0))}
          className="btn"
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

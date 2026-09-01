"use client";

// Sprint 3 Part 18 L5a — the dispatch form (ADR 0018 Q1/Q3).
//
// The constraint that shapes this screen is that **pressing ส่งของ moves real
// stock at two branches at once, immediately.** There is no draft to correct in
// (Q1), and the person filling it in is usually standing next to the truck. So:
//
//  1. `submit_key` is minted HERE and becomes stock_transfer.id (Part 13.5). It
//     ROTATES after each success, because the same person sends a second truck
//     the same afternoon and a held key would make that second load read as a
//     replay — silently writing nothing while the goods drive away.
//  2. The destination picker EXCLUDES the origin. The DB and zod both refuse a
//     same-branch transfer; not offering it is better than explaining it.
//  3. The driver's name and the "คนขับนับแล้ว" box sit together, because the
//     confirmation is meaningless without somebody's name against it — which is
//     what the CHECK constraint says too.
//  4. The form states, in words, what pressing the button does to the ledger.
//     Every other write in this system affects the screen its author is looking
//     at; this one changes another branch's stock.

import { useActionState, useMemo, useState } from "react";
import type { DispatchTransferActionState } from "@/app/transfers/actions";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";

export type TransferProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUnitName: string | null;
  units: { id: string; unitName: string; isBase: boolean }[];
};

export type TransferBranchOption = { id: string; name: string; code: string };

type LineDraft = { key: number; productId: string; qty: string; unitId: string };

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "block text-sm font-medium";

/** A fresh `submit_key` — the id the server will give the `stock_transfer` row. */
function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let nextKey = 1;
const blankLine = (): LineDraft => ({
  key: nextKey++,
  productId: "",
  qty: "",
  unitId: "",
});

export default function TransferDispatchForm({
  action,
  products,
  branches,
  nowBangkok,
}: {
  action: (
    prev: DispatchTransferActionState,
    fd: FormData
  ) => Promise<DispatchTransferActionState>;
  products: TransferProductOption[];
  branches: TransferBranchOption[];
  /** `datetime-local` value for "now" in Bangkok — the zod window is checked
   *  against BANGKOK today, so a device in another timezone would otherwise be
   *  offered an instant the server rejects (Decision #60). */
  nowBangkok: string;
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as DispatchTransferActionState);

  const [submitKey, setSubmitKey] = useState(newSubmitKey);
  const [fromBranchId, setFromBranchId] = useState(branches[0]?.id ?? "");
  const [toBranchId, setToBranchId] = useState(branches[1]?.id ?? "");
  const [driverConfirmed, setDriverConfirmed] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);

  // Rotate the key once a dispatch succeeds, so the next truck is its own
  // document rather than a replay of this one.
  const succeeded = state.ok === true;
  const [lastOk, setLastOk] = useState<string | null>(null);
  if (succeeded && state.transferId !== lastOk) {
    setLastOk(state.transferId);
    setSubmitKey(newSubmitKey());
    setLines([blankLine()]);
  }

  const fieldErrors = state.ok === false ? (state.fieldErrors ?? {}) : {};
  const formError = state.ok === false ? state.formError : undefined;

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const destinations = branches.filter((b) => b.id !== fromBranchId);

  const setLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="submit_key" value={submitKey} />

      {succeeded && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          บันทึกใบโอน <strong>{state.tfNumber}</strong> แล้ว — ของออกจากสาขาต้นทางและเข้าสาขาปลายทางเรียบร้อย{" "}
          <a href={`/transfers/${state.transferId}`} className="underline">
            เปิดใบโอน
          </a>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          สาขาต้นทาง
          <select
            name="from_branch_id"
            value={fromBranchId}
            onChange={(e) => {
              setFromBranchId(e.target.value);
              // Never leave the two equal: the DB refuses it and the user would
              // only find out after pressing send.
              if (e.target.value === toBranchId) {
                setToBranchId(
                  branches.find((b) => b.id !== e.target.value)?.id ?? ""
                );
              }
            }}
            className={`mt-1 ${inputClass}`}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {fieldErrors.fromBranchId && (
            <p className="mt-1 text-xs text-bad">{fieldErrors.fromBranchId}</p>
          )}
        </label>

        <label className={labelClass}>
          สาขาปลายทาง
          <select
            name="to_branch_id"
            value={toBranchId}
            onChange={(e) => setToBranchId(e.target.value)}
            className={`mt-1 ${inputClass}`}
          >
            {destinations.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {fieldErrors.toBranchId && (
            <p className="mt-1 text-xs text-bad">{fieldErrors.toBranchId}</p>
          )}
        </label>

        <label className={labelClass}>
          วันเวลาที่ส่ง
          <input
            type="datetime-local"
            name="dispatched_at"
            defaultValue={nowBangkok}
            required
            className={`mt-1 ${inputClass}`}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            ย้อนหลังได้ไม่เกิน {MAX_BACKDATE_DAYS} วัน
          </span>
          {fieldErrors.dispatchedAt && (
            <p className="mt-1 text-xs text-bad">{fieldErrors.dispatchedAt}</p>
          )}
        </label>

        <label className={labelClass}>
          ผู้ส่งของ (ถ้าไม่ใช่บัญชีนี้)
          <input
            name="dispatched_by_name"
            type="text"
            maxLength={100}
            className={`mt-1 ${inputClass}`}
            placeholder="ชื่อคนที่ยกของขึ้นรถ"
          />
        </label>
      </div>

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">คนขับรถ</legend>
        <p className="mb-3 text-xs text-muted-foreground">
          ให้คนขับนับของต่อหน้าก่อนรับไป แล้วกรอกชื่อเขาไว้ — เวลาปลายทางนับได้ไม่ครบ
          จะได้รู้ว่าหายก่อนขึ้นรถหรือหายระหว่างทาง
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            ชื่อคนขับ
            <input
              name="driver_name"
              type="text"
              maxLength={100}
              className={`mt-1 ${inputClass}`}
            />
            {fieldErrors.driverName && (
              <p className="mt-1 text-xs text-bad">{fieldErrors.driverName}</p>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm sm:mt-7">
            <input
              type="checkbox"
              name="driver_confirmed"
              value="on"
              checked={driverConfirmed}
              onChange={(e) => setDriverConfirmed(e.target.checked)}
            />
            คนขับนับของและรับไปแล้ว
          </label>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">รายการที่โอน</legend>
        {fieldErrors.lines && (
          <p className="mb-2 text-xs text-bad">{fieldErrors.lines}</p>
        )}
        {fieldErrors.qtySent && (
          <p className="mb-2 text-xs text-bad">{fieldErrors.qtySent}</p>
        )}

        <div className="space-y-3">
          {lines.map((l) => {
            const product = productById.get(l.productId);
            return (
              <div key={l.key} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <select
                  name="line_product_id"
                  value={l.productId}
                  onChange={(e) => {
                    const p = productById.get(e.target.value);
                    setLine(l.key, {
                      productId: e.target.value,
                      // Default to the base unit, which is the unit stock is
                      // kept in and the one a storeman thinks in.
                      unitId: p?.units.find((u) => u.isBase)?.id ?? "",
                    });
                  }}
                  required
                  className={inputClass}
                >
                  <option value="">เลือกวัตถุดิบ</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <input
                  name="line_qty_sent"
                  type="number"
                  step="0.001"
                  min="0"
                  value={l.qty}
                  onChange={(e) => setLine(l.key, { qty: e.target.value })}
                  required
                  placeholder="จำนวน"
                  className={inputClass}
                />

                <select
                  name="line_unit_id"
                  value={l.unitId}
                  onChange={(e) => setLine(l.key, { unitId: e.target.value })}
                  required
                  className={inputClass}
                >
                  {(product?.units ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.unitName}
                    </option>
                  ))}
                </select>

                {/* Every line needs its notes field present, or the parallel
                    arrays the action reads would fall out of step. */}
                <input type="hidden" name="line_notes" value="" />

                <button
                  type="button"
                  onClick={() =>
                    setLines((ls) =>
                      ls.length === 1 ? ls : ls.filter((x) => x.key !== l.key)
                    )
                  }
                  disabled={lines.length === 1}
                  className="rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-muted/40 disabled:opacity-40"
                >
                  ลบ
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, blankLine()])}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          + เพิ่มรายการ
        </button>
      </fieldset>

      <label className={labelClass}>
        หมายเหตุ
        <input name="notes" type="text" maxLength={500} className={`mt-1 ${inputClass}`} />
      </label>

      {formError && (
        <p className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {formError}
        </p>
      )}

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        กดส่งแล้วของจะถูกตัดออกจากสาขาต้นทางและเข้าสาขาปลายทาง<strong>ทันที</strong> —
        การกดรับที่ปลายทางเป็นการยืนยันว่ามีคนนับของแล้ว ไม่ใช่ตัวที่ทำให้ของเข้า
      </div>

      <button
        type="submit"
        disabled={isPending || branches.length < 2}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? "กำลังบันทึก…" : "ส่งของ"}
      </button>
    </form>
  );
}

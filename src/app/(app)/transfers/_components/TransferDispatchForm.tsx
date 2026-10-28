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
import QtyStepper from "@/components/ui/QtyStepper";
import SelectChip from "@/components/ui/SelectChip";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import type { DispatchTransferActionState } from "@/app/(app)/transfers/actions";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";

/** Searched with ProductPicker (Kong 2026-10-22: never a <select> of every product). */
export type TransferProductOption = PickerProduct & {
  units: { id: string; unitName: string; isBase: boolean }[];
};

export type TransferBranchOption = { id: string; name: string; code: string };

type LineDraft = { key: number; productId: string; qty: string; unitId: string };


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
        <div className="rounded-lg border border-good-border bg-good-bg p-4 text-sm text-good">
          บันทึกใบโอน <strong>{state.tfNumber}</strong> แล้ว — ของออกจากสาขาต้นทางและเข้าสาขาปลายทางเรียบร้อย{" "}
          <a href={`/transfers/${state.transferId}`} className="underline">
            เปิดใบโอน
          </a>
        </div>
      )}

      <div className="card grid gap-4 sm:grid-cols-2">
        <label className="label">
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
            className="input mt-1 w-full"
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

        <label className="label">
          สาขาปลายทาง
          {/* One possible destination is a fact, not a choice. */}
          {destinations.length === 1 ? (
            <>
              <input type="hidden" name="to_branch_id" value={destinations[0].id} />
              <span className="mt-1 flex h-10 items-center text-base font-normal text-foreground">{destinations[0].name}</span>
            </>
          ) : (
            <select
              name="to_branch_id"
              value={toBranchId}
              onChange={(e) => setToBranchId(e.target.value)}
              className="input mt-1 w-full"
            >
              {destinations.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          {fieldErrors.toBranchId && (
            <p className="mt-1 text-xs text-bad">{fieldErrors.toBranchId}</p>
          )}
        </label>

        <label className="label">
          วันเวลาที่ส่ง
          <input
            type="datetime-local"
            name="dispatched_at"
            defaultValue={nowBangkok}
            required
            className="input mt-1 w-full"
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            ย้อนหลังได้ไม่เกิน {MAX_BACKDATE_DAYS} วัน
          </span>
          {fieldErrors.dispatchedAt && (
            <p className="mt-1 text-xs text-bad">{fieldErrors.dispatchedAt}</p>
          )}
        </label>

        <label className="label">
          ผู้ส่งของ (ถ้าไม่ใช่บัญชีนี้)
          <input
            name="dispatched_by_name"
            type="text"
            maxLength={100}
            className="input mt-1 w-full"
            placeholder="ชื่อคนที่ยกของขึ้นรถ"
          />
        </label>
      </div>

      <section className="card space-y-3">
        <h3 className="font-semibold">คนขับรถ</h3>
        <p className="text-xs text-muted-foreground">
          ให้คนขับนับของต่อหน้าก่อนรับไป แล้วกรอกชื่อเขาไว้ — เวลาปลายทางนับได้ไม่ครบ
          จะได้รู้ว่าหายก่อนขึ้นรถหรือหายระหว่างทาง
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="label">
            ชื่อคนขับ
            <input
              name="driver_name"
              type="text"
              maxLength={100}
              className="input mt-1 w-full"
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
      </section>

      <section className="card">
        <h3 className="mb-3 font-semibold">รายการที่โอน</h3>
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
              // Phone: the product on its own row, then stepper · unit · × on one.
              <div key={l.key} className="grid grid-cols-[9rem_minmax(0,1fr)_1.75rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_11rem_1.75rem]">
                <div className="col-span-3 min-w-0 sm:col-span-1">
                  <ProductPicker
                    name="line_product_id"
                    products={products}
                    value={l.productId}
                    onChange={(id) => {
                      const p = productById.get(id);
                      setLine(l.key, {
                        productId: id,
                        // Default to the base unit, which is the unit stock is
                        // kept in and the one a storeman thinks in.
                        unitId: p?.units.find((u) => u.isBase)?.id ?? "",
                      });
                    }}
                  />
                </div>

                <QtyStepper
                  value={l.qty}
                  onChange={(qty) => setLine(l.key, { qty })}
                  label={`จำนวนที่ส่ง ${product?.name ?? ""}`}
                  inputProps={{ name: "line_qty_sent", required: true, placeholder: "0" }}
                />

                <SelectChip
                  value={l.unitId}
                  onChange={(unitId) => setLine(l.key, { unitId })}
                  placeholder="หน่วย"
                  options={(product?.units ?? []).map((u) => ({ value: u.id, label: u.unitName }))}
                  selectProps={{ name: "line_unit_id", required: true, "aria-label": `หน่วย ${product?.name ?? ""}` }}
                />

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
                  aria-label="ลบรายการ"
                  title="ลบรายการ"
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted-subtle hover:bg-bad-bg hover:text-bad disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, blankLine()])}
          className="btn-secondary btn-sm mt-3"
        >
          + เพิ่มรายการ
        </button>
      </section>

      <label className="label">
        หมายเหตุ
        <input name="notes" type="text" maxLength={500} className="input mt-1 w-full" />
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
        className="btn w-full"
      >
        {isPending ? "กำลังบันทึก…" : "ส่งของ"}
      </button>
    </form>
  );
}

"use client";

// Sprint 3 Part 18 L5a — the receive form (ADR 0018 Q2).
// Kong 2026-10-27: the receiver counts in whatever is in front of them — packs,
// bottles, or both ("1 แพ็ค + 11 ขวด") — not only in the unit it was sent in.
// The server adds the entries up in the base unit, exactly (option A).
//
// What this screen must not let anyone believe: that pressing รับของ is what
// brings the goods in. It is not — both ledger legs posted at dispatch (Q1).
// What it posts is the SHORTFALL, and the wording says exactly that.
//
// Two deliberate choices:
//
//  1. **Every quantity box starts EMPTY, not prefilled with what was sent.**
//     A prefilled form is a form people submit without counting, and the one
//     number this screen exists to collect is the count. "ครบตามที่ส่ง" is
//     one deliberate tap for the crate that really is complete.
//  2. **The gap is shown live, per line, as the user types** — in the base
//     unit, because a mix of packs and bottles has no other common measure.

import { useActionState, useState } from "react";
import QtyStepper from "@/components/ui/QtyStepper";
import { orStale } from "@/lib/stale-tab";
import type { TransferActionState } from "@/app/(app)/transfers/actions";
import type { TransferLineView } from "./transfer-view";

type Entry = { unitId: string; qty: string };

const trim = (n: number) => String(Math.round(n * 1000) / 1000);

export default function ReceiveTransferForm({
  action,
  transferId,
  lines,
}: {
  action: (
    prev: TransferActionState,
    fd: FormData
  ) => Promise<TransferActionState>;
  transferId: string;
  lines: TransferLineView[];
}) {
  const [state, formAction, isPending] = useActionState(
    (prev: TransferActionState, fd: FormData) => orStale(action(prev, fd)),
    { ok: false } as TransferActionState
  );
  // Each line starts with one empty box in the unit it was sent in.
  const [entries, setEntries] = useState<Record<string, Entry[]>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, [{ unitId: l.inputUnitId, qty: "" }]]))
  );

  const fieldErrors = state.ok === false ? (state.fieldErrors ?? {}) : {};
  const formError = state.ok === false ? state.formError : undefined;

  const ratioOf = (l: TransferLineView, unitId: string) =>
    Number(l.product.units.find((u) => u.id === unitId)?.toBaseRatio ?? 0);
  const setLine = (id: string, next: Entry[]) => setEntries((e) => ({ ...e, [id]: next }));

  let missingTotal = 0;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={transferId} />

      <p className="text-sm text-muted-foreground">
        นับของที่ได้จริง เลือกหน่วยตามที่นับ (ชิ้น แพ็ค ลัง) ผสมกันได้ — ของเข้ายอดสาขานี้ตั้งแต่ต้นทางกดส่งแล้ว
        การกดรับจะบันทึกเฉพาะ<strong>ส่วนที่ขาด</strong>เป็นของหายระหว่างขนส่ง
      </p>

      <div className="space-y-3">
        {lines.map((l) => {
          const list = entries[l.id] ?? [];
          const typed = list.some((e) => e.qty.trim() !== "");
          const gotBase = list.reduce((n, e) => n + (Number(e.qty) || 0) * ratioOf(l, e.unitId), 0);
          const sentBase = Number(l.qtySentBase);
          const missing = typed ? Math.round((sentBase - gotBase) * 1000) / 1000 : null;
          if (missing !== null && missing > 0) missingTotal += 1;
          const base = l.product.baseUnitName ?? "";
          const unused = l.product.units.find((u) => !list.some((e) => e.unitId === u.id));
          return (
            <div key={l.id} className="space-y-2 rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{l.product.name}</p>
                <p className="text-sm text-muted-foreground">
                  ส่งมา {l.qtySent} {l.inputUnitName}
                  {l.inputUnitName !== base && base && ` (${trim(sentBase)} ${base})`}
                </p>
              </div>

              {list.map((e, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input type="hidden" name="entry_item_id" value={l.id} />
                  <input type="hidden" name="entry_unit_id" value={e.unitId} />
                  <QtyStepper
                    value={e.qty}
                    onChange={(qty) => setLine(l.id, list.map((x, j) => (j === i ? { ...x, qty } : x)))}
                    label={`นับได้จริง ${l.product.name}`}
                    tone={missing !== null && missing > 0 ? "warn" : "default"}
                    className="shrink-0"
                    inputClassName="h-11 w-14 text-base font-semibold placeholder:text-xs placeholder:font-normal"
                    inputProps={{ name: "entry_qty", placeholder: "จำนวน" }}
                  />
                  <select
                    value={e.unitId}
                    aria-label={`หน่วยที่นับ ${l.product.name}`}
                    onChange={(ev) => setLine(l.id, list.map((x, j) => (j === i ? { ...x, unitId: ev.target.value } : x)))}
                    className="input h-11 min-w-0 flex-1 px-2 text-sm sm:max-w-[14rem]"
                  >
                    {l.product.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitName}
                      </option>
                    ))}
                  </select>
                  {list.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLine(l.id, list.filter((_, j) => j !== i))}
                      aria-label="ลบหน่วยนี้"
                      className="px-2 text-xs text-muted-foreground hover:text-bad"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2">
                {unused ? (
                  <button
                    type="button"
                    onClick={() => setLine(l.id, [...list, { unitId: unused.id, qty: "" }])}
                    className="text-xs text-primary underline"
                  >
                    + อีกหน่วย (เช่น 1 แพ็ค + 3 ชิ้น)
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => setLine(l.id, [{ unitId: l.inputUnitId, qty: l.qtySent }])}
                  className="rounded-full border border-primary-line bg-surface px-3 py-1 text-xs text-primary hover:bg-primary-soft"
                >
                  ครบตามที่ส่ง
                </button>
              </div>

              {missing !== null && (
                <p
                  className={`text-sm font-medium ${
                    missing > 0 ? "text-bad" : missing < 0 ? "text-warn" : "text-good"
                  }`}
                >
                  รวม {trim(gotBase)} {base}
                  {missing > 0
                    ? ` · หาย ${trim(missing)} ${base} — จะถูกบันทึกเป็นของหายระหว่างขนส่งของสาขานี้`
                    : missing < 0
                      ? " · มากกว่าที่ส่งมา — มีฝั่งใดฝั่งหนึ่งนับผิด ต้องคุยกันก่อน ไม่ใช่บันทึกเพิ่ม"
                      : " · ครบตามที่ส่งมา"}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {fieldErrors.qtyReceived && <p className="text-xs text-bad">{fieldErrors.qtyReceived}</p>}
      {fieldErrors.lines && <p className="text-xs text-bad">{fieldErrors.lines}</p>}

      <label className="label">
        คนที่นับของ (ถ้าไม่ใช่คุณ)
        <input
          name="received_by_name"
          type="text"
          maxLength={100}
          className="input mt-1 w-full"
          placeholder="เว้นว่าง = คุณ (บัญชีที่เข้าอยู่)"
        />
      </label>

      <label className="label">
        หมายเหตุ
        <input name="notes" type="text" maxLength={500} className="input mt-1 w-full" placeholder="เช่น กระป๋องบุบ 1" />
      </label>

      {formError && (
        <p className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">{formError}</p>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface/95 px-4 pb-3 pt-2.5 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button type="submit" disabled={isPending} className="btn h-12 w-full text-base">
          {isPending ? "กำลังบันทึก…" : `ยืนยันรับของ${missingTotal > 0 ? ` · หาย ${missingTotal} รายการ` : ""}`}
        </button>
      </div>
    </form>
  );
}

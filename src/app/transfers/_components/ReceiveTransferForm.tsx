"use client";

// Sprint 3 Part 18 L5a — the receive form (ADR 0018 Q2).
//
// What this screen must not let anyone believe: that pressing รับของ is what
// brings the goods in. It is not — both ledger legs posted at dispatch (Q1).
// What it posts is the SHORTFALL, and the wording says exactly that.
//
// Two deliberate choices:
//
//  1. **Every quantity box starts EMPTY, not prefilled with what was sent.**
//     A prefilled form is a form people submit without counting, and the one
//     number this screen exists to collect is the count. It also means a blank
//     box is a mistake the server can catch (L2's `ต้องระบุจำนวนที่รับ`) rather
//     than a silent zero — which would write the whole line off as lost, with a
//     driver's name attached to it.
//  2. **The gap is shown live, per line, as the user types.** "ส่ง 10 รับ 8 →
//     หาย 2" while they are standing at the crate is worth more than a correct
//     figure discovered next month by counting.

import { useActionState, useState } from "react";
import type { TransferActionState } from "@/app/transfers/actions";
import type { TransferLineView } from "./transfer-view";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

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
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as TransferActionState);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const fieldErrors = state.ok === false ? (state.fieldErrors ?? {}) : {};
  const formError = state.ok === false ? state.formError : undefined;

  const missingOf = (l: TransferLineView): number | null => {
    const raw = counts[l.id];
    if (raw === undefined || raw.trim() === "") return null;
    const got = Number(raw);
    if (Number.isNaN(got)) return null;
    return Number(l.qtySent) - got;
  };

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={transferId} />

      <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        นับของจริงที่ได้รับแล้วกรอกลงไป — ของเข้ายอดสาขานี้ตั้งแต่ต้นทางกดส่งแล้ว
        การกดรับจะบันทึกเฉพาะ<strong>ส่วนที่ขาด</strong>เป็นของหายระหว่างขนส่ง
      </p>

      <div className="space-y-3">
        {lines.map((l) => {
          const missing = missingOf(l);
          return (
            <div key={l.id} className="rounded-lg border border-border p-3">
              <input type="hidden" name="line_item_id" value={l.id} />
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="text-sm">
                  <p className="font-medium">{l.product.name}</p>
                  <p className="text-muted-foreground">
                    ส่งมา {l.qtySent} {l.inputUnitName}
                  </p>
                </div>
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">
                    นับได้จริง ({l.inputUnitName})
                  </span>
                  <input
                    name="line_qty_received"
                    type="number"
                    step="0.001"
                    min="0"
                    max={l.qtySent}
                    required
                    value={counts[l.id] ?? ""}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [l.id]: e.target.value }))
                    }
                    className={inputClass}
                  />
                </label>
              </div>

              {missing !== null && missing > 0 && (
                <p className="mt-2 text-xs text-red-700">
                  หาย {missing} {l.inputUnitName} — จะถูกบันทึกเป็นของหายระหว่างขนส่งของสาขานี้
                </p>
              )}
              {missing !== null && missing < 0 && (
                <p className="mt-2 text-xs text-red-700">
                  รับได้ไม่เกินจำนวนที่ส่ง — ถ้านับได้มากกว่านี้จริง แปลว่ามีฝั่งใดฝั่งหนึ่งนับผิด
                  ต้องคุยกันก่อน ไม่ใช่บันทึกเพิ่ม
                </p>
              )}
              {missing === 0 && (
                <p className="mt-2 text-xs text-emerald-700">ครบตามที่ส่งมา</p>
              )}
            </div>
          );
        })}
      </div>

      {fieldErrors.qtyReceived && (
        <p className="text-xs text-red-600">{fieldErrors.qtyReceived}</p>
      )}
      {fieldErrors.lines && (
        <p className="text-xs text-red-600">{fieldErrors.lines}</p>
      )}

      <label className="block text-sm font-medium">
        ผู้รับ (ถ้าไม่ใช่บัญชีนี้)
        <input
          name="received_by_name"
          type="text"
          maxLength={100}
          className={`mt-1 ${inputClass}`}
          placeholder="ชื่อคนที่นับของ"
        />
      </label>

      <label className="block text-sm font-medium">
        หมายเหตุ
        <input name="notes" type="text" maxLength={500} className={`mt-1 ${inputClass}`} />
      </label>

      {formError && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? "กำลังบันทึก…" : "ยืนยันรับของ"}
      </button>
    </form>
  );
}

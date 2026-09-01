"use client";

// Sprint 2 Part 14 L5b — declaring (or correcting) the cost of found stock.
//
// Entry point two of two for ADR 0014 Q6. Entry point one is the optional field
// on the adjust form; this is the one that has to still be there in November,
// when someone finally digs the delivery note out of a drawer.
//
// The cost is typed in the unit the user THINKS in — "กระสอบละ 4,500", not
// "180.0000 ฿/kg". Converting is the computer's job, and asking the user to do it
// would both slow them down and lose the number they actually meant.

import { useActionState, useEffect, useState } from "react";
import { declareCostAction, type CostActionState } from "../actions";
import type { CostDeclarationView } from "./cost-view";

export type DeclareUnitOption = {
  id: string;
  unitName: string;
  isBase: boolean;
};

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

export default function DeclareCostForm({
  movementId,
  units,
  history,
  currentLabel,
  onDone,
}: {
  movementId: string;
  units: DeclareUnitOption[];
  history: CostDeclarationView[];
  /** What the system is using right now, so the user can judge before typing. */
  currentLabel: string;
  onDone?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    declareCostAction,
    { ok: false } as CostActionState
  );

  const [unitId, setUnitId] = useState(
    () => units.find((u) => u.isBase)?.id ?? units[0]?.id ?? ""
  );

  useEffect(() => {
    if (state.ok) onDone?.();
  }, [state, onDone]);

  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const formError = state.ok === false ? state.formError : undefined;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="movement_id" value={movementId} />

        <p className="text-xs text-muted-foreground">
          ตอนนี้ระบบใช้ <strong>{currentLabel}</strong>
        </p>

        {formError && (
          <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
            {formError}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[9rem] flex-1">
            <label htmlFor={`unit_cost-${movementId}`} className="block text-sm font-medium">
              ต้นทุน (บาท) <span className="text-bad">*</span>
            </label>
            <input
              id={`unit_cost-${movementId}`}
              name="unit_cost"
              type="number"
              step="0.0001"
              min="0"
              required
              className={`${inputClass} mt-1`}
              placeholder="เช่น 4500"
            />
            {fieldErrors?.unitCost && (
              <p className="mt-1 text-xs text-bad">{fieldErrors.unitCost}</p>
            )}
          </div>

          <div className="min-w-[8rem]">
            <label htmlFor={`unit_id-${movementId}`} className="block text-sm font-medium">
              ต่อหน่วย <span className="text-bad">*</span>
            </label>
            <select
              id={`unit_id-${movementId}`}
              name="unit_id"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className={`${inputClass} mt-1`}
              required
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitName}
                  {u.isBase ? " (หน่วยหลัก)" : ""}
                </option>
              ))}
            </select>
            {fieldErrors?.unitId && (
              <p className="mt-1 text-xs text-bad">{fieldErrors.unitId}</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor={`note-${movementId}`} className="block text-sm font-medium">
            ที่มา / หมายเหตุ
          </label>
          <input
            id={`note-${movementId}`}
            name="note"
            type="text"
            maxLength={500}
            className={`${inputClass} mt-1`}
            placeholder="เช่น ของจากใบส่งของ 15 ส.ค. ที่ลืมคีย์"
          />
          {fieldErrors?.note && (
            <p className="mt-1 text-xs text-bad">{fieldErrors.note}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก…" : "บันทึกต้นทุน"}
        </button>
      </form>

      {history.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            ประวัติการระบุต้นทุน
          </p>
          <ul className="mt-2 space-y-1.5">
            {history.map((h) => (
              <li
                key={h.id}
                className={`text-xs ${h.superseded ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}
              >
                <span className="font-medium tabular-nums">
                  {h.inputUnitCost} ฿ / {h.inputUnitName}
                </span>
                {" · "}
                {h.declaredByName}
                {" · "}
                {h.declaredAtLabel}
                {h.note && <span className="ml-1">— {h.note}</span>}
              </li>
            ))}
          </ul>
          {/* Nothing is deleted: a corrected number has to be defensible to
              whoever asks, which is the whole reason the table appends. */}
        </div>
      )}
    </div>
  );
}

"use client";

// Sprint 5 Part 21 L5d — swap an ingredient across many recipes at once (Q14).
//
// Three rules from ADR 0021 are visible in the markup, and none of them is
// cosmetic:
//
//  1. **Q15's empty box.** Where the quantity cannot honestly carry over, the
//     plan sends `carryQty: null` and this form renders an EMPTY box — not a
//     zero, not the old number. พริกกะเหรี่ยง → พริกชี้ฟ้า is the same kind of
//     thing in the same unit, so 20 g stays 20 g; พริกกะเหรี่ยง →
//     พริกกะเหรี่ยงผัดน้ำมัน is not, because the fried product has absorbed oil
//     and lost water. A wrong default is a value somebody clicks past, and every
//     plate is wrong from that day with nothing on screen looking wrong.
//  2. **Central and branch recipes are two groups, never one list** (Q8). Branch
//     rows start UNTICKED: a bulk edit that quietly includes สาขาอโศก's own
//     recipe undoes a decision that branch made.
//  3. **An unticked row posts NOTHING.** Its three inputs are `disabled`, so the
//     browser leaves them out entirely — the action reads recipe id, quantity and
//     unit as parallel arrays, and a row that posted a quantity without its id
//     would shift every row below it.
//
// `submit_key` rotates after a success, so the afternoon's second swap is its own
// write rather than a replay of the first.

import { useActionState, useState } from "react";
import type { SubstitutionActionState } from "@/app/recipes/actions";
import type { SubstitutionPlanRowView } from "@/app/recipes/_components/recipe-view";

export type ReplacementUnit = { id: string; unitName: string; isBase: boolean };

const inputClass =
  "rounded-lg border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none";

function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type RowState = { checked: boolean; qty: string; unitId: string };

export default function SubstitutionForm({
  action,
  fromProductId,
  fromLabel,
  toLabel,
  toProductId,
  toComponentMenuId,
  units,
  central,
  branch,
  todayBangkok,
}: {
  action: (
    prev: SubstitutionActionState,
    fd: FormData
  ) => Promise<SubstitutionActionState>;
  fromProductId: string;
  fromLabel: string;
  toLabel: string;
  /** Exactly one of these two is set — the schema refuses both and neither. */
  toProductId: string | null;
  toComponentMenuId: string | null;
  /** The REPLACEMENT's units. Empty when the replacement is a menu. */
  units: ReplacementUnit[];
  central: SubstitutionPlanRowView[];
  branch: SubstitutionPlanRowView[];
  todayBangkok: string;
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as SubstitutionActionState);

  const [submitKey, setSubmitKey] = useState(newSubmitKey);
  const [backdating, setBackdating] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(todayBangkok);

  const init = (rows: SubstitutionPlanRowView[], checked: boolean) =>
    Object.fromEntries(
      rows.map((r) => [
        r.recipeId,
        {
          checked,
          // Q15: null means the person has to type it. Never prefill a guess.
          qty: r.carryQty ?? "",
          unitId: r.carryUnitId ?? "",
        } satisfies RowState,
      ])
    );

  const [rows, setRows] = useState<Record<string, RowState>>(() => ({
    ...init(central, true),
    // Q8: a branch decided for itself. Including it is chosen, never a default.
    ...init(branch, false),
  }));

  const [handled, setHandled] = useState(false);
  const succeeded = state.ok === true;
  if (succeeded && !handled) {
    setHandled(true);
    setSubmitKey(newSubmitKey());
  }
  if (!succeeded && handled) setHandled(false);

  const needsAck = state.ok ? undefined : state.needsAcknowledgement;
  const formError = state.ok ? undefined : state.formError;
  const fieldErrors = state.ok ? undefined : state.fieldErrors;

  const patch = (id: string, p: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  const checkedCount = Object.values(rows).filter((r) => r.checked).length;
  const branchChecked = branch.filter((r) => rows[r.recipeId]?.checked).length;

  const group = (
    title: string,
    hint: string,
    list: SubstitutionPlanRowView[],
    offset: number
  ) =>
    list.length === 0 ? null : (
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="space-y-2">
          {list.map((r, i) => {
            const s = rows[r.recipeId];
            const rowError =
              fieldErrors?.[`targets.${offset + i}.qty`] ??
              fieldErrors?.[`targets.${offset + i}.productUnitId`];
            return (
              <div
                key={r.recipeId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3"
              >
                <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={s.checked}
                    onChange={(e) => patch(r.recipeId, { checked: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span>
                    {r.label}
                    {r.branchNames.length > 0 ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.branchNames.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </label>

                <span className="text-xs text-muted-foreground">
                  เดิม {r.qty} {r.unitName ?? "จาน"} →
                </span>

                <input
                  type="hidden"
                  name="target_recipe_id"
                  value={r.recipeId}
                  disabled={!s.checked}
                />
                <input
                  name="target_qty"
                  value={s.qty}
                  onChange={(e) => patch(r.recipeId, { qty: e.target.value })}
                  disabled={!s.checked}
                  inputMode="decimal"
                  placeholder={r.carryQty === null ? "ต้องกรอกใหม่" : "จำนวน"}
                  aria-label={`จำนวนใหม่สำหรับ ${r.label}`}
                  className={`${inputClass} w-28 ${
                    r.carryQty === null && s.checked && s.qty === ""
                      ? "border-warn-border bg-warn-bg"
                      : ""
                  }`}
                />

                {toProductId !== null ? (
                  <select
                    name="target_product_unit_id"
                    value={s.unitId}
                    onChange={(e) => patch(r.recipeId, { unitId: e.target.value })}
                    disabled={!s.checked}
                    aria-label={`หน่วยสำหรับ ${r.label}`}
                    className={`${inputClass} w-28`}
                  >
                    <option value="">— หน่วย —</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="hidden"
                    name="target_product_unit_id"
                    value=""
                    disabled={!s.checked}
                  />
                )}

                {rowError ? (
                  <p className="w-full text-xs text-bad">{rowError}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="submit_key" value={submitKey} />
      <input type="hidden" name="from_product_id" value={fromProductId} />
      <input type="hidden" name="to_product_id" value={toProductId ?? ""} />
      <input
        type="hidden"
        name="to_component_menu_id"
        value={toComponentMenuId ?? ""}
      />

      <div className="rounded-xl border border-border bg-surface p-4 text-sm">
        เปลี่ยน <strong>{fromLabel}</strong> เป็น <strong>{toLabel}</strong> ใน
        สูตรที่ติ๊กไว้ · เลือกแล้ว {checkedCount} สูตร
      </div>

      {central.length === 0 && branch.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
          ไม่มีสูตรไหนใช้ {fromLabel} อยู่
        </div>
      ) : null}

      {group(
        "สูตรกลาง",
        "สูตรที่ทุกสาขาใช้ร่วมกัน",
        central,
        0
      )}

      {group(
        "สูตรเฉพาะของสาขา",
        "สาขาเหล่านี้เคยตัดสินใจแยกสูตรของตัวเองไว้ — ติ๊กเท่าที่ต้องการเปลี่ยนจริง ๆ",
        branch,
        central.length
      )}

      {/* A quantity that cannot carry over is the one thing on this screen that
          can be wrong without looking wrong. Say so before the submit, not after. */}
      {[...central, ...branch].some(
        (r) => r.carryQty === null && rows[r.recipeId]?.checked
      ) ? (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">
          บางบรรทัดต้องกรอกจำนวนใหม่เอง — ของใหม่ไม่ใช่ของชนิดเดียวกันหรือคนละหน่วย
          จำนวนเดิมจึงใช้แทนกันไม่ได้
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={backdating}
            onChange={(e) => setBackdating(e.target.checked)}
            className="h-4 w-4"
          />
          เปลี่ยนมาตั้งแต่วันก่อนหน้า
        </label>
        {backdating ? (
          <input
            type="date"
            name="effective_from"
            value={effectiveFrom}
            max={todayBangkok}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className={`${inputClass} mt-2`}
          />
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            ไม่ติ๊ก = มีผลตั้งแต่วันนี้เป็นต้นไป
          </p>
        )}
      </div>

      {formError ? (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {formError}
        </div>
      ) : null}

      {needsAck ? (
        <div className="space-y-2 rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">
          <p className="font-medium">
            การเปลี่ยนนี้จะไปแก้สูตรที่สาขาเหล่านี้แยกไว้เอง:
          </p>
          <ul className="list-inside list-disc">
            {needsAck.branchNames.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="acknowledge_branch_recipes"
              className="h-4 w-4"
            />
            เข้าใจแล้ว แก้สูตรของสาขาเหล่านี้ด้วย
          </label>
        </div>
      ) : null}

      {succeeded && state.ok ? (
        <p className="text-sm text-emerald-700">
          แก้แล้ว {state.changedCount} สูตร
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending || checkedCount === 0}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending
          ? "กำลังแก้…"
          : `เปลี่ยนใน ${checkedCount} สูตร${branchChecked > 0 ? ` (รวมสูตรสาขา ${branchChecked})` : ""}`}
      </button>
    </form>
  );
}

"use client";

// Sprint 3 Part 17 L5b — set the par for this product, per branch (ADR 0017 Q5).
//
// This section exists on the PRODUCT page because of Consequence 4: the below-par
// list is only as good as the pars being filled in, and nothing fills them in
// automatically. A feature nobody can reach from where they already work goes
// unused, and a par list with three pars in it is worse than none — it looks
// complete while covering nothing.
//
// One row per branch, because a par is per (product, branch): a branch that is
// out of pork is out of pork whatever the business holds elsewhere (ADR 0014
// Q9b). For the single-branch shop that is the common case, this is one row.
//
// Each row is its own <form> with its own action state — a shared one would make
// an error on ทองหล่อ appear under อารีย์.

import { useActionState } from "react";
import type { ParLevelActionState } from "@/app/stock/par-level-actions";

export type ParUnitOption = { id: string; unitName: string; isBase: boolean };

export type ParBranchRow = {
  branchId: string;
  branchName: string;
  /** null = this branch has no par (which is not a state, it is an absence). */
  parLevelId: string | null;
  /** As entered, so the box re-opens in the unit the user chose. */
  inputQty: string | null;
  inputUnitId: string | null;
};

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

function BranchParForm({
  productId,
  row,
  units,
  setAction,
  deleteAction,
}: {
  productId: string;
  row: ParBranchRow;
  units: ParUnitOption[];
  setAction: (
    prev: ParLevelActionState,
    fd: FormData
  ) => Promise<ParLevelActionState>;
  deleteAction: (
    prev: ParLevelActionState,
    fd: FormData
  ) => Promise<ParLevelActionState>;
}) {
  const [setState, setFormAction, setPending] = useActionState(setAction, {
    ok: false,
  } as ParLevelActionState);
  const [delState, delFormAction, delPending] = useActionState(deleteAction, {
    ok: false,
  } as ParLevelActionState);

  const errors = [setState, delState]
    .map((s) => (s.ok === false ? (s.formError ?? Object.values(s.fieldErrors ?? {})[0]) : undefined))
    .filter(Boolean);

  const defaultUnitId =
    row.inputUnitId ?? units.find((u) => u.isBase)?.id ?? units[0]?.id ?? "";

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <span className="min-w-24 text-sm font-medium">{row.branchName}</span>

        <form action={setFormAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="product_id" value={productId} />
          <input type="hidden" name="branch_id" value={row.branchId} />
          <input
            name="input_qty"
            type="number"
            step="0.001"
            min="0"
            defaultValue={row.inputQty ?? ""}
            placeholder="ขั้นต่ำ"
            className={`${inputClass} w-28`}
            required
          />
          <select
            name="input_unit_id"
            defaultValue={defaultUnitId}
            className={inputClass}
            required
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={setPending}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {setPending ? "กำลังบันทึก…" : row.parLevelId ? "แก้ไข" : "ตั้งค่า"}
          </button>
        </form>

        {row.parLevelId && (
          <form action={delFormAction}>
            <input type="hidden" name="id" value={row.parLevelId} />
            <button
              type="submit"
              disabled={delPending}
              className="rounded-lg px-2 py-2 text-xs text-muted-foreground hover:text-bad disabled:opacity-50"
            >
              {delPending ? "กำลังลบ…" : "ไม่ตั้งขั้นต่ำ"}
            </button>
          </form>
        )}
      </div>

      {errors.map((e, i) => (
        <p key={i} className="mt-1 text-xs text-bad">
          {e}
        </p>
      ))}
      {(setState.ok || delState.ok) && errors.length === 0 && (
        <p className="mt-1 text-xs text-good">บันทึกแล้ว</p>
      )}
    </div>
  );
}

export default function ParLevelSection({
  productId,
  rows,
  units,
  setAction,
  deleteAction,
}: {
  productId: string;
  rows: ParBranchRow[];
  units: ParUnitOption[];
  setAction: (
    prev: ParLevelActionState,
    fd: FormData
  ) => Promise<ParLevelActionState>;
  deleteAction: (
    prev: ParLevelActionState,
    fd: FormData
  ) => Promise<ParLevelActionState>;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">ขั้นต่ำที่ควรมี (par)</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          ตั้งไว้เท่าไหร่ ถ้าของเหลือน้อยกว่านี้จะขึ้นเตือนในหน้าสต๊อก — ระบบไม่สั่งซื้อให้เอง
          ตั้งได้ในหน่วยที่ถนัด ระบบแปลงเป็นหน่วยหลักให้
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          ยังไม่มีสาขาในระบบ
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <BranchParForm
              key={row.branchId}
              productId={productId}
              row={row}
              units={units}
              setAction={setAction}
              deleteAction={deleteAction}
            />
          ))}
        </div>
      )}
    </section>
  );
}

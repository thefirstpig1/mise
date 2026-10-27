"use client";

// Part 35 L1 — add a branch, rename one.
// Review 2026-10-28 (mockup 6A5E893FefkuYmW3Z5vzbn): the add form no longer
// sits open under the list taking half the screen, and a row opens on a press
// anywhere on it (not a small "แก้ไข") — both open the same popup.

import { useActionState, useEffect, useState } from "react";
import {
  createBranchAction,
  updateBranchAction,
  type SettingsActionState,
} from "@/app/(app)/settings/branches/actions";
import SettingsModal from "@/app/(app)/settings/_components/SettingsModal";

export type BranchRowView = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  /** "05:00" */
  salesDayCutoff: string;
};

/**
 * The sales-day cut-off, with what it does said where it is set (rule P24 ★):
 * a cook closing at 02:00 must never see that night split across two days.
 */
export function CutoffField({ id, defaultValue, error }: { id: string; defaultValue: string; error?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label mb-1">เวลาตัดวันขาย</label>
      <input id={id} name="sales_day_cutoff" type="time" min="00:00" max="12:00" defaultValue={defaultValue} required className="input w-36 tabular-nums" />
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : null}
      <p className="mt-1 text-xs text-muted-foreground">
        บิลก่อนเวลานี้นับเป็นยอดของวันก่อน · ร้านเปิดถึงตีสอง ตั้ง 05:00 แล้วบิลตีหนึ่งจะอยู่ในยอดเมื่อวาน
      </p>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer font-semibold text-primary">อ่านเพิ่ม</summary>
        <p className="mt-1 text-muted-foreground">
          ใช้กับไฟล์ POS ที่มีเวลาขายแต่ไม่บอกวันขาย (ไฟล์ที่บอกวันมาแล้วใช้วันตามไฟล์) · แก้แล้วมีผลกับการนำเข้าครั้งถัดไป ถ้าจะแก้วันเก่าให้นำเข้าวันนั้นใหม่
        </p>
      </details>
    </div>
  );
}

const IDLE: SettingsActionState = { ok: false };

function FieldError({ state, name }: { state: SettingsActionState; name: string }) {
  if (state.ok || !state.fieldErrors?.[name]) return null;
  return <p className="mt-1 text-xs text-bad">{state.fieldErrors[name]}</p>;
}

/** Add (row = null) or edit one branch. Closes itself once the save went through. */
function BranchDialog({ row, onClose }: { row: BranchRowView | null; onClose: () => void }) {
  const [state, action, pending] = useActionState(row ? updateBranchAction : createBranchAction, IDLE);
  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);
  const title = row ? `แก้${row.name}` : "เพิ่มสาขา";

  return (
    <SettingsModal title={title} onClose={onClose}>
      <form action={action} className="space-y-4">
        {row && <input type="hidden" name="id" value={row.id} />}
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="branch-name" className="label mb-1">ชื่อสาขา</label>
            <input id="branch-name" name="name" defaultValue={row?.name ?? ""} required placeholder="เช่น สาขาลาดพร้าว" className="input w-full" autoFocus />
            <FieldError state={state} name="name" />
          </div>
          <div>
            <label htmlFor="branch-code" className="label mb-1">รหัสสาขา</label>
            {row ? (
              <input id="branch-code" value={row.code} disabled className="input w-full bg-muted font-mono text-muted-foreground" />
            ) : (
              <input id="branch-code" name="code" required maxLength={10} placeholder="เช่น LPR" className="input w-full uppercase" />
            )}
            <FieldError state={state} name="code" />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">รหัสอยู่หน้าเลขเอกสารทุกใบ เช่น {row?.code ?? "LPR"}-PO-0001 จึงเปลี่ยนภายหลังไม่ได้</p>
        <div>
          <label htmlFor="branch-address" className="label mb-1">
            ที่อยู่ <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
          </label>
          <input id="branch-address" name="address" defaultValue={row?.address ?? ""} className="input w-full" />
          <FieldError state={state} name="address" />
        </div>
        <CutoffField id="branch-cutoff" defaultValue={row?.salesDayCutoff ?? "05:00"} error={!state.ok ? state.fieldErrors?.salesDayCutoffMinutes : undefined} />
        {!state.ok && state.formError && <p className="text-sm text-bad">{state.formError}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="h-11 rounded-xl border border-border-strong px-4 text-sm font-semibold text-primary hover:bg-muted">
            ยกเลิก
          </button>
          <button type="submit" className="btn h-11 px-5" disabled={pending}>
            {pending ? "กำลังบันทึก…" : row ? "บันทึก" : "เพิ่มสาขา"}
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}

export function AddBranchButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn h-11 px-5" onClick={() => setOpen(true)}>
        + เพิ่มสาขา
      </button>
      {open && <BranchDialog row={null} onClose={() => setOpen(false)} />}
    </>
  );
}

export function BranchList({ rows }: { rows: BranchRowView[] }) {
  const [open, setOpen] = useState<BranchRowView | null>(null);
  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(r)} className="block w-full px-5 py-4 text-left transition-colors hover:bg-muted/50">
              <span className="font-semibold">{r.name}</span>
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{r.code}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                ตัดวันขาย <span className="tabular-nums">{r.salesDayCutoff}</span> น. · {r.address ?? "ยังไม่ใส่ที่อยู่"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <BranchDialog key={open.id} row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

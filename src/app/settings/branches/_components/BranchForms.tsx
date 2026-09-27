"use client";

// Part 35 L1 — add a branch, rename one. Built like settings/members: one add
// form on top, one row per branch that opens into its edit form.

import { useActionState, useState } from "react";
import {
  createBranchAction,
  updateBranchAction,
  type SettingsActionState,
} from "@/app/settings/branches/actions";

export type BranchRowView = {
  id: string;
  name: string;
  code: string;
  address: string | null;
};

const IDLE: SettingsActionState = { ok: false };

function FieldError({ state, name }: { state: SettingsActionState; name: string }) {
  if (state.ok || !state.fieldErrors?.[name]) return null;
  return <p className="mt-1 text-xs text-bad">{state.fieldErrors[name]}</p>;
}

function Feedback({ state }: { state: SettingsActionState }) {
  if (state.ok) return <p className="text-sm text-good">{state.message}</p>;
  if (state.formError) return <p className="text-sm text-bad">{state.formError}</p>;
  return null;
}

export function AddBranchForm() {
  const [state, action, pending] = useActionState(createBranchAction, IDLE);
  return (
    <form action={action} className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-4 font-semibold">เพิ่มสาขา</h2>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor="new-name" className="label mb-1">ชื่อสาขา</label>
          <input id="new-name" name="name" required placeholder="เช่น สาขาลาดพร้าว" className="input w-full" />
          <FieldError state={state} name="name" />
        </div>
        <div>
          <label htmlFor="new-code" className="label mb-1">รหัสสาขา</label>
          <input
            id="new-code"
            name="code"
            required
            maxLength={10}
            placeholder="เช่น LPR"
            className="input w-full uppercase"
          />
          <FieldError state={state} name="code" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="new-address" className="label mb-1">
            ที่อยู่ <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
          </label>
          <input id="new-address" name="address" className="input w-full" />
          <FieldError state={state} name="address" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        รหัสสาขาจะอยู่หน้าเลขเอกสารทุกใบ เช่น LPR-PO-0001 และเปลี่ยนภายหลังไม่ได้
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "กำลังบันทึก…" : "เพิ่มสาขา"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

function EditBranch({ row, onDone }: { row: BranchRowView; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateBranchAction, IDLE);
  return (
    <form action={action} className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={row.id} />
      <div>
        <label className="label mb-1" htmlFor={`name-${row.id}`}>ชื่อสาขา</label>
        <input id={`name-${row.id}`} name="name" defaultValue={row.name} required className="input w-full" />
        <FieldError state={state} name="name" />
      </div>
      <div>
        <label className="label mb-1" htmlFor={`address-${row.id}`}>ที่อยู่</label>
        <input id={`address-${row.id}`} name="address" defaultValue={row.address ?? ""} className="input w-full" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-muted-foreground hover:text-foreground">
          ปิด
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function BranchList({ rows }: { rows: BranchRowView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
      {rows.map((r) => (
        <li key={r.id} className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">
                {r.name}{" "}
                <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {r.code}
                </span>
              </p>
              {r.address ? <p className="truncate text-sm text-muted-foreground">{r.address}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => setOpen(open === r.id ? null : r.id)}
              className="shrink-0 text-sm text-primary hover:underline"
            >
              {open === r.id ? "ปิด" : "แก้ไข"}
            </button>
          </div>
          {open === r.id ? <EditBranch row={r} onDone={() => setOpen(null)} /> : null}
        </li>
      ))}
    </ul>
  );
}

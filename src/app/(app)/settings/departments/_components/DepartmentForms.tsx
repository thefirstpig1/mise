"use client";

// Part 35 L1 — add, rename, close and reopen departments.

import { useActionState, useState } from "react";
import {
  createDepartmentAction,
  setDepartmentActiveAction,
  updateDepartmentAction,
} from "@/app/(app)/settings/departments/actions";
import type { SettingsActionState } from "@/app/(app)/settings/branches/actions";

export type DepartmentRowView = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  isDefault: boolean;
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

export function AddDepartmentForm() {
  const [state, action, pending] = useActionState(createDepartmentAction, IDLE);
  return (
    <form action={action} className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-4 font-semibold">เพิ่มแผนก</h2>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor="new-name" className="label mb-1">ชื่อแผนก</label>
          <input id="new-name" name="name" required placeholder="เช่น ครัว, บาร์, เบเกอรี่" className="input w-full" />
          <FieldError state={state} name="name" />
        </div>
        <div>
          <label htmlFor="new-code" className="label mb-1">รหัสแผนก</label>
          <input id="new-code" name="code" required maxLength={10} placeholder="เช่น KIT" className="input w-full uppercase" />
          <FieldError state={state} name="code" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="new-desc" className="label mb-1">
            คำอธิบาย <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
          </label>
          <input id="new-desc" name="description" className="input w-full" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "กำลังบันทึก…" : "เพิ่มแผนก"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

function ActiveToggle({ row }: { row: DepartmentRowView }) {
  const [state, action, pending] = useActionState(setDepartmentActiveAction, IDLE);
  if (row.isDefault) return null;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="isActive" value={row.isActive ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {row.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
      </button>
      {!state.ok && state.formError ? <span className="text-xs text-bad">{state.formError}</span> : null}
    </form>
  );
}

function EditDepartment({ row, onDone }: { row: DepartmentRowView; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateDepartmentAction, IDLE);
  return (
    <form action={action} className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={row.id} />
      <div>
        <label className="label mb-1" htmlFor={`name-${row.id}`}>ชื่อแผนก</label>
        <input id={`name-${row.id}`} name="name" defaultValue={row.name} required className="input w-full" />
        <FieldError state={state} name="name" />
      </div>
      <div>
        <label className="label mb-1" htmlFor={`desc-${row.id}`}>คำอธิบาย</label>
        <input id={`desc-${row.id}`} name="description" defaultValue={row.description ?? ""} className="input w-full" />
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

export function DepartmentList({ rows }: { rows: DepartmentRowView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
      {rows.map((r) => (
        <li key={r.id} className={`p-4 ${r.isActive ? "" : "opacity-60"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">
                {r.name}{" "}
                <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {r.code}
                </span>
                {r.isDefault ? (
                  <span className="ml-2 text-xs text-muted-foreground">แผนกตั้งต้น</span>
                ) : null}
                {!r.isActive ? <span className="ml-2 text-xs text-muted-foreground">ปิดใช้งานอยู่</span> : null}
              </p>
              {r.description ? <p className="truncate text-sm text-muted-foreground">{r.description}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <ActiveToggle row={r} />
              <button
                type="button"
                onClick={() => setOpen(open === r.id ? null : r.id)}
                className="text-sm text-primary hover:underline"
              >
                {open === r.id ? "ปิด" : "แก้ไข"}
              </button>
            </div>
          </div>
          {open === r.id ? <EditDepartment row={r} onDone={() => setOpen(null)} /> : null}
        </li>
      ))}
    </ul>
  );
}

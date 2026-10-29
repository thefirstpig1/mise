"use client";

// Part 35 L1 — add, rename, close and reopen departments.
// Review 2026-10-28 (mockup 6A5E893FefkuYmW3Z5vzbn): "ปิดใช้งาน" sat right
// beside "แก้ไข" and closed a department on one press with no question. It now
// lives inside the department's popup and says what closing does before it
// does it; the row opens on a press anywhere; the add form became a button.

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createDepartmentAction,
  setDepartmentActiveAction,
  updateDepartmentAction,
} from "@/app/(app)/settings/departments/actions";
import type { SettingsActionState } from "@/app/(app)/settings/branches/actions";
import SettingsModal from "@/app/(app)/settings/_components/SettingsModal";
import { orStale } from "@/lib/stale-tab";
import { useKeepForm } from "@/lib/keep-form";

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

/** Closing or reopening, from inside the popup. Closing asks first; reopening does not need to. */
function ActiveControl({ row, onDone }: { row: DepartmentRowView; onDone: () => void }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (row.isDefault) return <p className="text-xs text-muted-foreground">แผนกตั้งต้นปิดใช้งานไม่ได้</p>;

  const set = (active: boolean) =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", row.id);
      fd.set("isActive", active ? "true" : "false");
      const r = await orStale(setDepartmentActiveAction(IDLE, fd));
      if (r.ok) {
        router.refresh();
        onDone();
      } else setError(r.formError ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    });

  if (!row.isActive) {
    return (
      <button type="button" disabled={pending} onClick={() => set(true)} className="py-2 text-sm font-semibold text-primary hover:underline">
        {pending ? "กำลังเปิด…" : "เปิดใช้งานแผนกนี้อีกครั้ง"}
      </button>
    );
  }
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="py-2 text-sm font-semibold text-bad hover:underline">
        ปิดใช้งานแผนกนี้
      </button>
    );
  }
  return (
    <div role="alert" className="w-full rounded-xl border border-bad-border bg-bad-bg p-3.5">
      <p className="font-semibold text-bad">ปิดใช้งานแผนก{row.name}?</p>
      <p className="mt-1 text-sm text-foreground/80">
        ขอซื้อหรือรับของใหม่เลือก{row.name}ไม่ได้ · ต้นทุนและยอดขายเก่าของ{row.name}ยังอยู่ในรายงาน · เปิดใหม่ได้ทุกเมื่อ
      </p>
      {error && <p className="mt-1 text-sm text-bad">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" autoFocus onClick={() => setAsking(false)} className="btn-secondary">
          ไม่ปิด
        </button>
        <button type="button" disabled={pending} onClick={() => set(false)} className="h-10 rounded-xl bg-bad px-4 text-sm font-semibold text-bad-foreground disabled:opacity-60">
          {pending ? "กำลังปิด…" : "ปิดใช้งาน"}
        </button>
      </div>
    </div>
  );
}

function DepartmentDialog({ row, onClose }: { row: DepartmentRowView | null; onClose: () => void }) {
  const [state, action, pending] = useActionState(row ? updateDepartmentAction : createDepartmentAction, IDLE);
  const actionKeep = useKeepForm(action, state);
  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);

  return (
    <SettingsModal title={row ? `แก้แผนก${row.name}` : "เพิ่มแผนก"} sub={row && !row.isActive ? "แผนกนี้ปิดใช้งานอยู่" : undefined} onClose={onClose}>
      <form {...actionKeep} className="space-y-4">
        {row && <input type="hidden" name="id" value={row.id} />}
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="dept-name" className="label mb-1">ชื่อแผนก</label>
            <input id="dept-name" name="name" defaultValue={row?.name ?? ""} required placeholder="เช่น ครัว บาร์ เบเกอรี่" className="input w-full" autoFocus />
            <FieldError state={state} name="name" />
          </div>
          <div>
            <label htmlFor="dept-code" className="label mb-1">รหัสแผนก</label>
            {row ? (
              <input id="dept-code" value={row.code} disabled className="input w-full bg-muted font-mono text-muted-foreground" />
            ) : (
              <input id="dept-code" name="code" required maxLength={10} placeholder="เช่น KIT" className="input w-full uppercase" />
            )}
            <FieldError state={state} name="code" />
          </div>
        </div>
        <div>
          <label htmlFor="dept-desc" className="label mb-1">
            คำอธิบาย <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
          </label>
          <input id="dept-desc" name="description" defaultValue={row?.description ?? ""} placeholder="เช่น เครื่องดื่มและของหวาน" className="input w-full" />
        </div>
        {!state.ok && state.formError && <p className="text-sm text-bad">{state.formError}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">
            ยกเลิก
          </button>
          <button type="submit" className="btn h-11 px-5" disabled={pending}>
            {pending ? "กำลังบันทึก…" : row ? "บันทึก" : "เพิ่มแผนก"}
          </button>
        </div>
      </form>
      {row && (
        <div className="mt-3 border-t border-border pt-3">
          <ActiveControl row={row} onDone={onClose} />
        </div>
      )}
    </SettingsModal>
  );
}

export function AddDepartmentButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn h-11 px-5" onClick={() => setOpen(true)}>
        + เพิ่มแผนก
      </button>
      {open && <DepartmentDialog row={null} onClose={() => setOpen(false)} />}
    </>
  );
}

export function DepartmentList({ rows }: { rows: DepartmentRowView[] }) {
  const [open, setOpen] = useState<DepartmentRowView | null>(null);
  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(r)} className={`block w-full px-5 py-4 text-left transition-colors hover:bg-muted/50 ${r.isActive ? "" : "opacity-60"}`}>
              <span className="font-semibold">{r.name}</span>
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{r.code}</span>
              {r.isDefault && <span className="ml-2 whitespace-nowrap rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary">แผนกตั้งต้น</span>}
              {!r.isActive && <span className="ml-2 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">ปิดใช้งานอยู่</span>}
              {(r.description || r.isDefault) && (
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {r.isDefault ? "รายการที่ไม่ได้ระบุแผนกลงที่นี่" : r.description}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {open && <DepartmentDialog key={open.id} row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

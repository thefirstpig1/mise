"use client";

// Sprint 5 Part 26 L5 — the roster (ADR 0028 Q3/Q4).
//
// A name, a branch, and an optional per-person quota. Nothing else, and the
// fields that are ABSENT are as much the design as the three that are here: no
// ID number, no wage, no phone, no start date. Mise is not an HR system, and
// every one of those is a duty to protect under PDPA bought for a question
// nobody in this Part is asking.
//
// There is no delete. Someone who has left is switched off — they still appear
// in every past month, labelled, because dropping them would move last month's
// figure by pressing a button today (rule S7, ADR 0027's L1 one table across).

import { useActionState, useEffect, useRef } from "react";
import type { StaffMemberActionState } from "@/app/staff-meals/actions";


export type BranchOption = { id: string; name: string };

export function CreateStaffMemberForm({
  action,
  branches,
  defaultBranchId,
  tenantQuota,
}: {
  action: (
    prev: StaffMemberActionState,
    fd: FormData
  ) => Promise<StaffMemberActionState>;
  branches: BranchOption[];
  defaultBranchId: string;
  /** The shop-wide default, so the blank field can say what blank MEANS. */
  tenantQuota: string | null;
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as StaffMemberActionState);
  const nameRef = useRef<HTMLInputElement>(null);

  // Several people get added in a row on the day a shop sets this up.
  useEffect(() => {
    if (!state.ok) return;
    if (nameRef.current) {
      nameRef.current.value = "";
      nameRef.current.focus();
    }
  }, [state]);

  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="new-name">
            ชื่อเรียก
          </label>
          <input
            id="new-name"
            ref={nameRef}
            name="name"
            type="text"
            maxLength={100}
            required
            placeholder="เช่น สมชาย"
            className="input w-full"
          />
          {fieldErrors?.name && (
            <p className="mt-1 text-xs text-bad">{fieldErrors.name}</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="new-branch">
            สาขาประจำ
          </label>
          <select
            id="new-branch"
            name="branch_id"
            defaultValue={defaultBranchId}
            className="input w-full"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="new-quota">
            โควตา/วัน (บาท)
          </label>
          <input
            id="new-quota"
            name="daily_quota_amount"
            type="number"
            step="0.01"
            min="0"
            placeholder={tenantQuota ?? "ไม่มีโควตา"}
            className="input w-full"
          />
          {fieldErrors?.dailyQuotaAmount && (
            <p className="mt-1 text-xs text-bad">
              {fieldErrors.dailyQuotaAmount}
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        เว้นว่าง = ใช้โควตาของร้าน
        {tenantQuota ? ` (฿${tenantQuota}/วัน)` : " ซึ่งตอนนี้ยังไม่ได้ตั้งไว้"} —
        ไม่ได้แปลว่าไม่มีโควตา
      </p>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? "กำลังเพิ่ม…" : "เพิ่มพนักงาน"}
      </button>
    </form>
  );
}

export function EditStaffMemberRow({
  action,
  member,
  branches,
}: {
  action: (
    prev: StaffMemberActionState,
    fd: FormData
  ) => Promise<StaffMemberActionState>;
  member: {
    id: string;
    name: string;
    branchId: string;
    dailyQuotaAmount: string | null;
    isActive: boolean;
  };
  branches: BranchOption[];
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as StaffMemberActionState);
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;

  return (
    <form
      action={formAction}
      className={`grid gap-2 rounded-xl border p-3 sm:grid-cols-[2fr_1.5fr_1fr_auto_auto] sm:items-center ${
        member.isActive ? "border-border" : "border-dashed border-border opacity-70"
      }`}
    >
      <input type="hidden" name="id" value={member.id} />
      <div>
        <input
          name="name"
          type="text"
          maxLength={100}
          defaultValue={member.name}
          className="input w-full"
          aria-label="ชื่อ"
        />
        {fieldErrors?.name && (
          <p className="mt-1 text-xs text-bad">{fieldErrors.name}</p>
        )}
      </div>
      <select
        name="branch_id"
        defaultValue={member.branchId}
        className="input w-full"
        aria-label="สาขา"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <input
        name="daily_quota_amount"
        type="number"
        step="0.01"
        min="0"
        defaultValue={member.dailyQuotaAmount ?? ""}
        placeholder="ตามร้าน"
        className="input w-full"
        aria-label="โควตาต่อวัน"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_active"
          value="true"
          defaultChecked={member.isActive}
        />
        ยังทำงานอยู่
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
      >
        {isPending ? "…" : "บันทึก"}
      </button>
    </form>
  );
}

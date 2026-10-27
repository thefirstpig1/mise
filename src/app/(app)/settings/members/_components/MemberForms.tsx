"use client";

// Sprint 6 Part 29 L5 — inviting and managing people (ADR 0029).
//
// The people first, one row each that opens on a press; inviting is a button
// that opens a popup (review 2026-10-28 — the invite form used to push the list
// off the screen). Deliberately plain: this screen is used a handful of times
// in a shop's life, so it is built to be UNDERSTOOD rather than to be fast.
//
// THE ROLE CARDS OFFER EVERY ROLE, INCLUDING `owner`, EVEN TO A MANAGER WHO
// CANNOT GRANT IT. That is the choice this file most wants explained. Filtering
// it would teach nobody anything: the manager would simply never learn the role
// exists, and would ask the owner for "the thing that lets me see everything"
// without a name for it. Picking it gets a sentence naming exactly why it was
// refused (rule 4), which is information. Hiding is for doors that lead nowhere
// at all (rule A7) — not for a choice with an explanation behind it.
//
// The remove/restore button IS hidden on an owner's row when the reader is not
// an owner, because there is no version of that press which could succeed.

import { useActionState, useEffect, useState } from "react";
import SettingsModal from "@/app/(app)/settings/_components/SettingsModal";
import {
  inviteMemberAction,
  setMemberActiveAction,
  updateMemberAction,
  type MemberActionState,
} from "@/app/(app)/settings/members/actions";

type BranchOption = { id: string; name: string };
type RoleOption = { value: string; label: string; hint: string };

export type MemberRowView = {
  membershipId: string;
  email: string;
  name: string | null;
  role: string;
  roleLabel: string;
  isActive: boolean;
  neverSignedIn: boolean;
  allBranches: boolean;
  branchNames: string[];
  changedLine: string | null;
  editable: boolean;
  isSelf: boolean;
};

const IDLE: MemberActionState = { ok: false };

function ReachFields({
  branches,
  canGrantAllBranches,
  defaultAllBranches,
  defaultBranchIds,
}: {
  branches: BranchOption[];
  canGrantAllBranches: boolean;
  defaultAllBranches: boolean;
  defaultBranchIds: string[];
}) {
  const [all, setAll] = useState(defaultAllBranches);

  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-xs text-muted-foreground">สาขาที่เข้าถึงได้</legend>

      {canGrantAllBranches && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="all_branches"
            className="h-4 w-4 accent-primary"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          ทุกสาขา รวมสาขาที่เปิดใหม่ในอนาคต
        </label>
      )}

      {/* The list stays visible under the tick, because unticking must not lose
          what was chosen — and because "ทุกสาขา" is easier to trust when you can
          see what it currently covers. */}
      <div className={`mt-2 space-y-1 ${all ? "opacity-40" : ""}`}>
        {branches.map((b) => (
          <label key={b.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="branch_id"
              className="h-4 w-4 accent-primary"
              value={b.id}
              defaultChecked={defaultBranchIds.includes(b.id)}
              disabled={all}
            />
            {b.name}
          </label>
        ))}
        {branches.length === 0 && (
          <p className="text-xs text-muted-foreground">
            คุณเข้าถึงสาขาใดอยู่ จึงยังมอบสิทธิ์สาขาให้ใครไม่ได้
          </p>
        )}
      </div>
    </fieldset>
  );
}

/**
 * Every role as a card, so they can be compared side by side — a dropdown
 * showed one description at a time (review 2026-10-28). Real radios: the form
 * posts `role` exactly as the <select> did.
 */
function RoleCards({ roleOptions, defaultValue, idPrefix }: { roleOptions: RoleOption[]; defaultValue: string; idPrefix: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 label">บทบาท</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {roleOptions.map((r) => (
          <label
            key={r.value}
            htmlFor={`${idPrefix}-${r.value}`}
            className="flex cursor-pointer flex-col gap-0.5 rounded-xl border border-border px-3 py-2.5 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:ring-1 has-[:checked]:ring-primary"
          >
            <span className="flex items-center gap-2">
              <input id={`${idPrefix}-${r.value}`} type="radio" name="role" value={r.value} defaultChecked={r.value === defaultValue} className="h-4 w-4 shrink-0 accent-primary" />
              <span className="text-sm font-semibold">{r.label}</span>
            </span>
            {/* What the role can SEE, not just what it is called. */}
            <span className="text-xs leading-snug text-muted-foreground">{r.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const ghost = "h-11 rounded-xl border border-border-strong px-4 text-sm font-semibold text-primary hover:bg-muted";

function InviteDialog({
  branches,
  roleOptions,
  canGrantAllBranches,
  onClose,
}: {
  branches: BranchOption[];
  roleOptions: RoleOption[];
  canGrantAllBranches: boolean;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(inviteMemberAction, IDLE);
  const [round, setRound] = useState(0);

  return (
    <SettingsModal title="เชิญคนเข้าร้าน" sub="ไม่มีลิงก์คำเชิญให้ส่งต่อ · คนนั้นเข้าใช้ได้ทันทีเมื่อล็อกอินด้วยอีเมลนี้" onClose={onClose}>
      {state.ok ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-good-border bg-good-bg px-4 py-3 text-sm text-good">{state.message}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={ghost} onClick={() => setRound((n) => n + 1)}>
              เชิญคนต่อไป
            </button>
            <button type="button" className="btn h-11 px-5" onClick={onClose}>
              เสร็จ
            </button>
          </div>
        </div>
      ) : (
        <form key={round} action={action} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="invite-email" className="mb-1 label">อีเมล</label>
              <input id="invite-email" name="email" type="email" required autoFocus placeholder="name@example.com" className="input w-full" />
              {!state.ok && state.fieldErrors?.email && <p className="mt-1 text-xs text-bad">{state.fieldErrors.email}</p>}
            </div>
            <div>
              <label htmlFor="invite-name" className="mb-1 label">
                ชื่อ <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
              </label>
              <input id="invite-name" name="name" type="text" placeholder="ชื่อที่คนในร้านเรียก" className="input w-full" />
              {/* Said out loud, because an upsert that overwrote it would be a
                  silent surprise for the person who owns the account. */}
              <p className="mt-1 text-xs text-muted-foreground">ใช้เฉพาะกับอีเมลที่ยังไม่เคยเข้าใช้คิดครัว ไม่ทับชื่อที่เจ้าตัวตั้งไว้เอง</p>
            </div>
          </div>
          <RoleCards roleOptions={roleOptions} defaultValue="kitchen_staff" idPrefix="invite-role" />
          <ReachFields branches={branches} canGrantAllBranches={canGrantAllBranches} defaultAllBranches={false} defaultBranchIds={[]} />
          {!state.ok && state.formError && <p className="text-sm text-bad">{state.formError}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" className={ghost} onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" disabled={pending} className="btn h-11 px-5">
              {pending ? "กำลังเชิญ…" : "เชิญ"}
            </button>
          </div>
        </form>
      )}
    </SettingsModal>
  );
}

export function InviteButton(props: { branches: BranchOption[]; roleOptions: RoleOption[]; canGrantAllBranches: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn h-11 px-5" onClick={() => setOpen(true)}>
        + เชิญคนเข้าร้าน
      </button>
      {open && <InviteDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditDialog({
  row,
  branches,
  roleOptions,
  canGrantAllBranches,
  currentBranchIds,
  onClose,
}: {
  row: MemberRowView;
  branches: BranchOption[];
  roleOptions: RoleOption[];
  canGrantAllBranches: boolean;
  currentBranchIds: string[];
  onClose: () => void;
}) {
  const [editState, editAction, editPending] = useActionState(updateMemberAction, IDLE);
  const [activeState, activeAction, activePending] = useActionState(setMemberActiveAction, IDLE);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (editState.ok || activeState.ok) onClose();
  }, [editState, activeState, onClose]);

  return (
    <SettingsModal title={row.name ?? row.email} sub={[row.name ? row.email : null, row.changedLine].filter(Boolean).join(" · ") || undefined} onClose={onClose}>
      <form action={editAction} className="space-y-4">
        <input type="hidden" name="membership_id" value={row.membershipId} />
        <RoleCards roleOptions={roleOptions} defaultValue={row.role} idPrefix={`role-${row.membershipId}`} />
        <ReachFields branches={branches} canGrantAllBranches={canGrantAllBranches} defaultAllBranches={row.allBranches} defaultBranchIds={currentBranchIds} />
        {!editState.ok && editState.formError && <p className="text-sm text-bad">{editState.formError}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className={ghost} onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" disabled={editPending} className="btn h-11 px-5">
            {editPending ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </form>

      <form action={activeAction} className="mt-3 border-t border-border pt-3">
        <input type="hidden" name="membership_id" value={row.membershipId} />
        <input type="hidden" name="is_active" value={row.isActive ? "false" : "true"} />
        {!row.isActive ? (
          <button type="submit" disabled={activePending} className="py-2 text-sm font-semibold text-primary hover:underline">
            {activePending ? "กำลังเพิ่มกลับ…" : "เพิ่มกลับเข้าร้าน"}
          </button>
        ) : !asking ? (
          <button type="button" onClick={() => setAsking(true)} className="py-2 text-sm font-semibold text-bad hover:underline">
            นำออกจากร้าน
          </button>
        ) : (
          <div role="alert" className="rounded-xl border border-bad-border bg-bad-bg p-3.5">
            <p className="font-semibold text-bad">นำ{row.name ?? row.email}ออกจากร้าน?</p>
            <p className="mt-1 text-sm text-foreground/80">เข้าร้านนี้ไม่ได้อีกตั้งแต่ตอนนี้ · เอกสารที่เคยทำไว้ยังอยู่และยังขึ้นชื่อเดิม · เพิ่มกลับได้ทุกเมื่อ</p>
            <div className="mt-3 flex gap-2">
              <button type="button" autoFocus onClick={() => setAsking(false)} className="h-10 rounded-xl border border-border-strong bg-surface px-4 text-sm font-semibold text-primary hover:bg-muted">
                ไม่นำออก
              </button>
              <button type="submit" disabled={activePending} className="h-10 rounded-xl bg-bad px-4 text-sm font-semibold text-bad-foreground disabled:opacity-60">
                {activePending ? "กำลังนำออก…" : "นำออกจากร้าน"}
              </button>
            </div>
          </div>
        )}
        {!activeState.ok && activeState.formError && <p className="mt-2 text-sm text-bad">{activeState.formError}</p>}
      </form>
    </SettingsModal>
  );
}

function reachLine(row: MemberRowView) {
  return row.allBranches ? "ทุกสาขา" : row.branchNames.length > 0 ? row.branchNames.join(" · ") : "ยังไม่ได้กำหนดสาขา";
}

export default function MemberForms({
  rows,
  branches,
  roleOptions,
  canGrantAllBranches,
}: {
  rows: MemberRowView[];
  branches: BranchOption[];
  roleOptions: RoleOption[];
  canGrantAllBranches: boolean;
}) {
  const branchIdsByName = new Map(branches.map((b) => [b.name, b.id]));
  const [open, setOpen] = useState<MemberRowView | null>(null);

  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {rows.map((row) => {
          const body = (
            <>
              <span className="min-w-0">
                <span className="font-semibold">{row.name ?? row.email}</span>
                {row.isSelf && <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs">คุณ</span>}
                {!row.isActive && (
                  <span className="ml-2 whitespace-nowrap rounded-full border border-bad-border bg-bad-bg px-2 py-0.5 text-xs text-bad">ออกจากร้านแล้ว</span>
                )}
                {row.isActive && row.neverSignedIn && (
                  // No status column and no invitation table: "never signed in" IS
                  // the pending state, read off the account (ADR 0029 Q2).
                  <span className="ml-2 whitespace-nowrap rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-xs text-warn">ยังไม่เคยเข้าใช้งาน</span>
                )}
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {[row.name ? row.email : null, reachLine(row)].filter(Boolean).join(" · ")}
                </span>
                {!row.editable && (
                  // Rule 1 on the screen rather than only in a refusal.
                  <span className="mt-0.5 block text-xs text-muted-foreground">บัญชีเจ้าของร้าน แก้ไขได้โดยเจ้าของร้านเท่านั้น</span>
                )}
              </span>
              <span className="shrink-0 text-sm font-semibold">{row.roleLabel}</span>
            </>
          );
          return (
            <li key={row.membershipId} className={row.isActive ? "" : "opacity-70"}>
              {row.editable ? (
                <button type="button" onClick={() => setOpen(row)} className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/50">
                  {body}
                </button>
              ) : (
                <div className="flex items-start justify-between gap-3 px-5 py-4">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {open && (
        <EditDialog
          key={open.membershipId}
          row={open}
          branches={branches}
          roleOptions={roleOptions}
          canGrantAllBranches={canGrantAllBranches}
          currentBranchIds={open.branchNames.map((n) => branchIdsByName.get(n)).filter((id): id is string => id !== undefined)}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

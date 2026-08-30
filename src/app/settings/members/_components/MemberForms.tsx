"use client";

// Sprint 6 Part 29 L5 — inviting and managing people (ADR 0029).
//
// One invite form at the top, and one row per person that expands into an edit
// form. Deliberately plain: this screen is used a handful of times in a shop's
// life, so it is built to be UNDERSTOOD rather than to be fast.
//
// THE ROLE DROPDOWN OFFERS EVERY ROLE, INCLUDING `owner`, EVEN TO A MANAGER WHO
// CANNOT GRANT IT. That is the choice this file most wants explained. Filtering
// it would teach nobody anything: the manager would simply never learn the role
// exists, and would ask the owner for "the thing that lets me see everything"
// without a name for it. Picking it gets a sentence naming exactly why it was
// refused (rule 4), which is information. Hiding is for doors that lead nowhere
// at all (rule A7) — not for a choice with an explanation behind it.
//
// The remove/restore button IS hidden on an owner's row when the reader is not
// an owner, because there is no version of that press which could succeed.

import { useActionState, useState } from "react";
import {
  inviteMemberAction,
  setMemberActiveAction,
  updateMemberAction,
  type MemberActionState,
} from "@/app/settings/members/actions";

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

function Feedback({ state }: { state: MemberActionState }) {
  if (state.ok) {
    return (
      <p className="mt-2 text-sm text-emerald-700">{state.message}</p>
    );
  }
  if (state.formError) {
    return <p className="mt-2 text-sm text-red-700">{state.formError}</p>;
  }
  return null;
}

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

function RoleSelect({
  roleOptions,
  defaultValue,
  id,
}: {
  roleOptions: RoleOption[];
  defaultValue: string;
  id: string;
}) {
  const [role, setRole] = useState(defaultValue);
  const hint = roleOptions.find((r) => r.value === role)?.hint;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        บทบาท
      </label>
      <select
        id={id}
        name="role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      >
        {roleOptions.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {/* What the role can SEE, not just what it is called. A shop owner
          picking "ผู้จัดการ" from a list of job titles learns nothing about
          cost otherwise. */}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function InviteForm({
  branches,
  roleOptions,
  canGrantAllBranches,
}: {
  branches: BranchOption[];
  roleOptions: RoleOption[];
  canGrantAllBranches: boolean;
}) {
  const [state, action, pending] = useActionState(inviteMemberAction, IDLE);

  return (
    <form action={action} className="space-y-3 rounded-xl border border-border p-4">
      <h3 className="text-base font-semibold">เชิญคนเข้าร้าน</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="invite-email" className="mb-1 block text-sm font-medium">
            อีเมล
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          {!state.ok && state.fieldErrors?.email && (
            <p className="mt-1 text-xs text-red-700">{state.fieldErrors.email}</p>
          )}
        </div>
        <div>
          <label htmlFor="invite-name" className="mb-1 block text-sm font-medium">
            ชื่อ <span className="text-muted-foreground">(ไม่บังคับ)</span>
          </label>
          <input
            id="invite-name"
            name="name"
            type="text"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          {/* Said out loud, because an upsert that overwrote it would be a
              silent surprise for the person who owns the account. */}
          <p className="mt-1 text-xs text-muted-foreground">
            ใช้เฉพาะกับอีเมลที่ยังไม่เคยเข้าใช้ Mise — ไม่ทับชื่อที่เจ้าตัวตั้งไว้เอง
          </p>
        </div>
      </div>

      <RoleSelect roleOptions={roleOptions} defaultValue="kitchen_staff" id="invite-role" />

      <ReachFields
        branches={branches}
        canGrantAllBranches={canGrantAllBranches}
        defaultAllBranches={false}
        defaultBranchIds={[]}
      />

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {pending ? "กำลังเชิญ…" : "เชิญ"}
      </button>

      <Feedback state={state} />
    </form>
  );
}

function MemberRow({
  row,
  branches,
  roleOptions,
  canGrantAllBranches,
  branchIdsByName,
}: {
  row: MemberRowView;
  branches: BranchOption[];
  roleOptions: RoleOption[];
  canGrantAllBranches: boolean;
  branchIdsByName: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [editState, editAction, editPending] = useActionState(
    updateMemberAction,
    IDLE
  );
  const [activeState, activeAction, activePending] = useActionState(
    setMemberActiveAction,
    IDLE
  );

  const currentBranchIds = row.branchNames
    .map((n) => branchIdsByName.get(n))
    .filter((id): id is string => id !== undefined);

  return (
    <li className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium">{row.name ?? row.email}</span>
          {row.name && (
            <span className="ml-2 text-xs text-muted-foreground">{row.email}</span>
          )}
          {row.isSelf && (
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs">
              คุณ
            </span>
          )}
          {!row.isActive && (
            <span className="ml-2 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700">
              ออกจากร้านแล้ว
            </span>
          )}
          {row.isActive && row.neverSignedIn && (
            // No status column and no invitation table: "never signed in" IS
            // the pending state, read off the account (ADR 0029 Q2).
            <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              ยังไม่เคยเข้าใช้งาน
            </span>
          )}
        </div>
        <span className="text-sm text-muted-foreground">{row.roleLabel}</span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {row.allBranches
          ? "ทุกสาขา"
          : row.branchNames.length > 0
            ? row.branchNames.join(" · ")
            : "ยังไม่ได้กำหนดสาขา"}
      </p>

      {row.changedLine && (
        <p className="mt-1 text-xs text-muted-foreground">{row.changedLine}</p>
      )}

      {!row.editable ? (
        // Rule 1 on the screen rather than only in a refusal. There is no
        // version of these buttons that could succeed for this reader.
        <p className="mt-2 text-xs text-muted-foreground">
          บัญชีเจ้าของร้าน — แก้ไขได้โดยเจ้าของร้านเท่านั้น
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-sm text-primary hover:underline"
          >
            {open ? "ปิด" : "แก้ไขสิทธิ์"}
          </button>

          {open && (
            <form action={editAction} className="space-y-3 border-t border-border pt-3">
              <input type="hidden" name="membership_id" value={row.membershipId} />
              <RoleSelect
                roleOptions={roleOptions}
                defaultValue={row.role}
                id={`role-${row.membershipId}`}
              />
              <ReachFields
                branches={branches}
                canGrantAllBranches={canGrantAllBranches}
                defaultAllBranches={row.allBranches}
                defaultBranchIds={currentBranchIds}
              />
              <button
                type="submit"
                disabled={editPending}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                {editPending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
              <Feedback state={editState} />
            </form>
          )}

          <form action={activeAction}>
            <input type="hidden" name="membership_id" value={row.membershipId} />
            <input
              type="hidden"
              name="is_active"
              value={row.isActive ? "false" : "true"}
            />
            <button
              type="submit"
              disabled={activePending}
              className="text-sm text-muted-foreground underline disabled:opacity-50"
            >
              {row.isActive ? "นำออกจากร้าน" : "เพิ่มกลับเข้าร้าน"}
            </button>
            <Feedback state={activeState} />
          </form>
        </div>
      )}
    </li>
  );
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

  return (
    <div className="space-y-6">
      <InviteForm
        branches={branches}
        roleOptions={roleOptions}
        canGrantAllBranches={canGrantAllBranches}
      />

      <ul className="space-y-2">
        {rows.map((row) => (
          <MemberRow
            key={row.membershipId}
            row={row}
            branches={branches}
            roleOptions={roleOptions}
            canGrantAllBranches={canGrantAllBranches}
            branchIdsByName={branchIdsByName}
          />
        ))}
      </ul>
    </div>
  );
}

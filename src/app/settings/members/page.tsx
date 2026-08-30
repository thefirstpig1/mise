// ============================================================
// Mise — คนในร้าน (Sprint 6 Part 29 L5, ADR 0029)
// ============================================================
// The screen the whole of Sprint 6 exists to make safe. Three things happen
// here — invite, change, remove — and each of them can hand somebody the keys.
//
// WHAT THE PAGE DOES *NOT* DO IS THE INTERESTING PART. It offers every role
// including `owner`, and every branch this shop has, and lets the server refuse
// (rules 1, 2 and 4). Filtering the dropdown to what the actor may grant was
// considered and rejected: a manager who cannot see that `owner` exists learns
// nothing, and a person who picks it gets a sentence naming the reason. Hiding
// is for doors nobody can open at all (rule A7) — not for a choice that has an
// explanation attached.
//
// The one thing that IS hidden is the button on an owner's row when the reader
// is not an owner, because there is no version of that action they can perform.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getMembersLogic } from "@/server/membership-read";
import { ALL_ROLES, type Role } from "@/lib/permissions/service";
import { ROLE_HINTS_TH, ROLE_LABELS_TH } from "@/lib/validations/membership";
import MemberForms from "./_components/MemberForms";

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeZone: "Asia/Bangkok",
});

export default async function MembersPage() {
  const { tenantId, reach, role, membership } =
    await requireTenant("member:manage");

  const [members, branches] = await Promise.all([
    getMembersLogic(tenantId),
    // Rule A5 — you can only offer branches you reach, which is also rule 2
    // expressed as a form rather than as a refusal.
    getBranchesLogic(tenantId, reach),
  ]);

  const roleOptions = ALL_ROLES.map((r) => ({
    value: r,
    label: ROLE_LABELS_TH[r],
    hint: ROLE_HINTS_TH[r],
  }));

  const rows = members.map((m) => ({
    membershipId: m.membershipId,
    email: m.email,
    name: m.name,
    role: m.role,
    roleLabel: ROLE_LABELS_TH[m.role as Role] ?? m.role,
    isActive: m.isActive,
    neverSignedIn: m.neverSignedIn,
    allBranches: m.allBranches,
    branchNames: m.branchNames,
    changedLine:
      m.changedAt && m.changedByName
        ? `แก้ไขล่าสุดโดย ${m.changedByName} · ${BANGKOK_DATE.format(m.changedAt)}`
        : null,
    /** Rule 1, said on the screen instead of only in a refusal. */
    editable: m.role !== "owner" || role === "owner",
    isSelf: m.userId === membership.userId,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">คนในร้าน</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          เชิญคนเข้าร้านด้วยอีเมล — ไม่มีลิงก์คำเชิญให้ส่งต่อ
          คนที่ถูกเชิญเข้าใช้งานได้ทันทีเมื่อล็อกอินด้วยอีเมลนั้น
        </p>
      </div>

      <MemberForms
        rows={rows}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        roleOptions={roleOptions}
        canGrantAllBranches={reach.allBranches}
      />
    </div>
  );
}

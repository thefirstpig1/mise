// ============================================================
// Mise — สิทธิ์ของร้าน (ADR 0038, mockup ShGwn4G37nphkvnQrnf3WN)
// ============================================================
// Three tabs: the role table (owner edits, everyone with member:manage reads),
// each person's exceptions, and the log. Everything the screen decides — what
// is locked, what pairs with what, who may open what — is computed HERE from
// the same functions the gates use, so the board cannot drift from the rules.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import {
  ADJUSTABLE_CAPABILITY_GROUPS,
  ALL_ROLES,
  CAPABILITY_NEEDS,
  LOCKED_ROLES,
  capabilitiesOf,
  effectiveCapabilities,
  type Role,
} from "@/lib/permissions/service";
import { CAPABILITY_GROUP_LABELS_TH, CAPABILITY_LABELS_TH, capabilityLabelTh } from "@/lib/permissions/labels";
import { ROLE_LABELS_TH } from "@/lib/validations/membership";
import { getMembersLogic } from "@/server/membership-read";
import { getPermissionSettingsLogic } from "@/server/capability-settings";
import PermissionsBoard, { type BoardData } from "./_components/PermissionsBoard";

const WHEN = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const roleTh = (r: string) => ROLE_LABELS_TH[r as Role] ?? r;

export default async function PermissionsPage() {
  const { tenantId, role, membership, capabilities } = await requireTenant("member:manage");
  const [settings, members] = await Promise.all([getPermissionSettingsLogic(tenantId), getMembersLogic(tenantId)]);

  const adjustable = ADJUSTABLE_CAPABILITY_GROUPS.flatMap((g) => g.capabilities);
  const roleTable = Object.fromEntries(
    ALL_ROLES.map((r) => {
      const caps = effectiveCapabilities(r, settings.roleRows, []);
      return [r, adjustable.filter((c) => caps.has(c))];
    })
  );

  const data: BoardData = {
    isOwner: role === "owner",
    actorCapabilities: [...capabilities],
    roles: ALL_ROLES.map((r) => ({ id: r, label: roleTh(r), locked: LOCKED_ROLES.has(r) })),
    groups: ADJUSTABLE_CAPABILITY_GROUPS.map((g) => ({
      label: CAPABILITY_GROUP_LABELS_TH[g.key],
      capabilities: g.capabilities.map((c) => ({
        id: c,
        label: CAPABILITY_LABELS_TH[c]?.label ?? c,
        hint: CAPABILITY_LABELS_TH[c]?.hint ?? "",
        needs: CAPABILITY_NEEDS[c] ?? null,
      })),
    })),
    defaults: Object.fromEntries(ALL_ROLES.map((r) => [r, adjustable.filter((c) => capabilitiesOf(r).has(c))])),
    roleTable,
    locked: [
      {
        label: "เชิญคน แก้บทบาทและสาขาของคนในร้าน",
        why: "ถ้าปรับได้ ใครก็ให้สิทธิ์นี้กับอีเมลที่สองของตัวเองแล้วยกสิทธิ์กลับมาได้",
        roles: ALL_ROLES.filter((r) => capabilitiesOf(r).has("member:manage")),
      },
      {
        label: "ตั้งค่าร้าน (VAT วิธีคิดกำไร สาขา แผนก)",
        why: "เปลี่ยนความหมายของตัวเลขย้อนหลังทั้งหมด เป็นของเจ้าของกิจการ",
        roles: ALL_ROLES.filter((r) => capabilitiesOf(r).has("settings:write")),
      },
    ],
    members: members
      .filter((m) => m.isActive)
      .map((m) => {
        const own = settings.memberRows.filter((r) => r.tenantMembershipId === m.membershipId);
        const caps = effectiveCapabilities(m.role, settings.roleRows, own);
        return {
          id: m.membershipId,
          name: m.name ?? m.email,
          email: m.email,
          role: m.role,
          roleLabel: roleTh(m.role),
          branches: m.allBranches ? "ทุกสาขา" : m.branchNames.join(", ") || "ยังไม่มีสาขา",
          exceptions: Object.fromEntries(
            own.filter((o) => adjustable.includes(o.capability as never)).map((o) => [o.capability, o.granted])
          ),
          effective: adjustable.filter((c) => caps.has(c)),
          locked:
            m.role === "owner"
              ? "เจ้าของร้านมีทุกสิทธิ์เสมอ"
              : m.userId === membership.userId
                ? "แก้สิทธิ์ของตัวเองไม่ได้"
                : null,
        };
      }),
    log: settings.changes.map((c) => {
      const who = c.actor.name ?? c.actor.email;
      const verb = c.change === "grant" ? "เปิด" : c.change === "revoke" ? "ปิด" : "กลับเป็นค่าเริ่มต้น";
      const target = c.role
        ? `ของบทบาท ${roleTh(c.role)}`
        : `ให้ ${c.membership?.user.name ?? c.membership?.user.email ?? "—"} (${roleTh(c.membership?.role ?? "")})`;
      return {
        id: c.id,
        when: WHEN.format(c.createdAt),
        who,
        text:
          c.change === "reset" && !c.role
            ? `ให้ “${capabilityLabelTh(c.capability)}” ${target} กลับไปตามบทบาท`
            : `${verb} “${capabilityLabelTh(c.capability)}” ${target}`,
      };
    }),
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">สิทธิ์ของร้าน</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          คิดครัวตั้งค่าเริ่มต้นให้ทุกบทบาท ร้านปรับเฉพาะข้อที่ร้านตัวเองต่างไป แล้วยกเว้นให้รายคนได้ ·
          มีผลทันทีที่คนนั้นเปิดหน้าถัดไป
        </p>
      </div>
      <PermissionsBoard data={data} />
    </div>
  );
}

// Sprint 5 Part 26 L5 — /staff-meals/people: who eats.
//
// Server Component. The roster ADR 0028 Q3 bought so that "who went over their
// quota" is a countable question rather than a guess at three spellings of one
// name.
//
// This list ALWAYS includes people who have left, marked and greyed. That is
// not a convenience: the history screen counts their past meals in full, so a
// roster that hid them would leave rows pointing at a name nobody can find.

import { requireTenant } from "@/lib/require-tenant";
import { prisma } from "@/lib/db";
import { getBranchesLogic } from "@/server/branch";
import { getStaffMembersLogic } from "@/server/staff-meal-read";
import {
  createStaffMemberAction,
  updateStaffMemberAction,
} from "../actions";
import {
  CreateStaffMemberForm,
  EditStaffMemberRow,
} from "./_components/StaffMemberForm";

export default async function StaffPeoplePage() {
  const { tenantId } = await requireTenant();

  const [branches, members, tenant] = await Promise.all([
    getBranchesLogic(tenantId),
    getStaffMembersLogic(tenantId, { includeInactive: true }),
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { staffMealDailyQuota: true },
    }),
  ]);

  const branchOptions = branches.map((b) => ({ id: b.id, name: b.name }));
  const tenantQuota =
    tenant.staffMealDailyQuota === null
      ? null
      : tenant.staffMealDailyQuota.toString();

  const active = members.filter((m) => m.isActive);
  const inactive = members.filter((m) => !m.isActive);

  return (
    <div className="space-y-6">
      <a href="/staff-meals" className="text-sm underline">
        ← กลับไปหน้าบันทึกมื้อพนักงาน
      </a>

      <div>
        <h2 className="text-base font-semibold">เพิ่มพนักงาน</h2>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">
          เก็บแค่ชื่อเรียก สาขาประจำ และโควตา — ระบบนี้ไม่ใช่ระบบ HR
          จึงไม่เก็บเลขบัตร เงินเดือน หรือเบอร์โทร
        </p>
        <CreateStaffMemberForm
          action={createStaffMemberAction}
          branches={branchOptions}
          defaultBranchId={branches[0]?.id ?? ""}
          tenantQuota={tenantQuota}
        />
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">
          ยังทำงานอยู่ ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            ยังไม่มีรายชื่อ
          </p>
        ) : (
          active.map((m) => (
            <EditStaffMemberRow
              key={m.id}
              action={updateStaffMemberAction}
              branches={branchOptions}
              member={{
                id: m.id,
                name: m.name,
                branchId: m.branchId,
                dailyQuotaAmount:
                  m.dailyQuotaAmount === null
                    ? null
                    : m.dailyQuotaAmount.toString(),
                isActive: m.isActive,
              }}
            />
          ))
        )}
      </section>

      {inactive.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">
            ลาออกแล้ว ({inactive.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            ยังอยู่ในรายงานย้อนหลังเต็มจำนวน — การปิดสวิตช์เป็นคำบอกเรื่องอนาคต
            ไม่ได้ลบอดีต ติ๊กกลับได้ถ้ากลับมาทำงาน
          </p>
          {inactive.map((m) => (
            <EditStaffMemberRow
              key={m.id}
              action={updateStaffMemberAction}
              branches={branchOptions}
              member={{
                id: m.id,
                name: m.name,
                branchId: m.branchId,
                dailyQuotaAmount:
                  m.dailyQuotaAmount === null
                    ? null
                    : m.dailyQuotaAmount.toString(),
                isActive: m.isActive,
              }}
            />
          ))}
        </section>
      )}
    </div>
  );
}

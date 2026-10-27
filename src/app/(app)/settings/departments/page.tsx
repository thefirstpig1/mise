import Link from "next/link";
import { requireTenant } from "@/lib/require-tenant";
import { DEFAULT_DEPARTMENT_CODE, getDepartmentsForAdminLogic } from "@/server/department";
import { AddDepartmentButton, DepartmentList, type DepartmentRowView } from "./_components/DepartmentForms";

// Part 35 L1 — departments could be switched ON but never created, so a shop
// that turned them on got one department called "Main" and nothing else.
export default async function DepartmentsPage() {
  const { tenantId, membership } = await requireTenant("settings:write");
  const rows: DepartmentRowView[] = (await getDepartmentsForAdminLogic(tenantId)).map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    description: d.description,
    isActive: d.isActive,
    isDefault: d.code === DEFAULT_DEPARTMENT_CODE,
  }));
  // The default first: it is where everything without a department lands.
  rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">แผนก</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            แยกต้นทุนและยอดขายตามส่วนงาน · กดที่แผนกเพื่อแก้ไข · รายการที่ไม่ได้ระบุแผนกลงที่แผนกตั้งต้น
          </p>
        </div>
        <AddDepartmentButton />
      </header>
      {!membership.tenant.enableDepartments ? (
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
          ขณะนี้ร้านยังไม่ได้แยกตามแผนก สร้างแผนกไว้ก่อนได้ แล้วเปิดที่{" "}
          <Link href="/settings#addons" className="font-semibold text-primary hover:underline">
            ตั้งค่าร้าน › แผนกและส่วนเสริม
          </Link>
        </div>
      ) : null}
      <DepartmentList rows={rows} />
    </div>
  );
}

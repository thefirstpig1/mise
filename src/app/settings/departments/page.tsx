import { requireTenant } from "@/lib/require-tenant";
import { DEFAULT_DEPARTMENT_CODE, getDepartmentsForAdminLogic } from "@/server/department";
import { AddDepartmentForm, DepartmentList, type DepartmentRowView } from "./_components/DepartmentForms";

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">แผนก</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ใช้แยกต้นทุนและยอดขายตามส่วนงาน เช่น ครัว บาร์ เบเกอรี่ · รายการที่ไม่ได้ระบุแผนกจะลงที่แผนกตั้งต้น
        </p>
      </div>
      {!membership.tenant.enableDepartments ? (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
          ขณะนี้ร้านยังปิดการใช้งานแผนกอยู่ สร้างแผนกไว้ก่อนได้ แล้วเปิดใช้งานที่{" "}
          <a href="/settings" className="text-primary underline">ตั้งค่าร้าน</a>
        </div>
      ) : null}
      <DepartmentList rows={rows} />
      <AddDepartmentForm />
    </div>
  );
}

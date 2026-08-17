import { withTenantContext } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";
import { revalidatePath } from "next/cache";

export default async function SettingsPage() {
  const { membership } = await requireTenant();
  const { tenant } = membership;

  async function updateTenant(formData: FormData) {
    "use server";
    // Re-authenticate inside the action — server actions are independent
    // requests, so we don't rely on the render-time closure for scoping.
    const { tenantId } = await requireTenant();
    const enableDepts = formData.get("enable_departments") === "on";
    const isVat = formData.get("is_vat_registered") === "on";

    await withTenantContext(tenantId, (tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: {
          enableDepartments: enableDepts,
          isVatRegistered: isVat,
        },
      })
    );

    revalidatePath("/settings");
    revalidatePath("/dashboard");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-3">
          <a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            ← กลับ
          </a>
          <h1 className="mt-1 text-lg font-bold">ตั้งค่าร้าน</h1>
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-4 py-8">
        <h2 className="mb-6 text-2xl font-bold">{tenant.name}</h2>

        <form action={updateTenant} className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-6">
            <h3 className="mb-3 font-medium">ฟีเจอร์ที่ใช้งาน</h3>

            <div className="space-y-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name="enable_departments"
                  defaultChecked={tenant.enableDepartments}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium">เปิดใช้งานแผนก (Departments)</p>
                  <p className="text-sm text-muted-foreground">
                    สำหรับร้านที่มีหลายแผนกแยกกัน เช่น Bar, Kitchen, Bakery
                    <br />
                    <span className="text-xs">
                      ถ้าปิด ระบบจะใช้แผนก &quot;Main&quot; เป็น default ทุกรายการ
                    </span>
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name="is_vat_registered"
                  defaultChecked={tenant.isVatRegistered}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium">จดทะเบียน VAT</p>
                  <p className="text-sm text-muted-foreground">
                    เปิดเมื่อร้านจดทะเบียน VAT (รายได้เกิน ฿1.8M/ปี)
                    <br />
                    <span className="text-xs">
                      ร้านที่<strong>จด</strong> VAT ขอคืนภาษีซื้อได้ ต้นทุนสต๊อกจึงไม่รวม VAT ·
                      ร้านที่<strong>ไม่จด</strong> จ่าย VAT แล้วจบ ระบบจะรวม VAT
                      เป็นต้นทุนของ
                    </span>
                    <br />
                    <span className="text-xs">
                      ค่านี้ถูกบันทึกติดไปกับใบรับของแต่ละใบตอนกดยืนยัน —
                      เปลี่ยนตรงนี้จะมีผลกับใบรับของใบถัดไป
                      ไม่ย้อนไปตีมูลค่าของเก่าใหม่ (เพราะตอนนั้นร้านจ่าย VAT
                      ไปจริงและไม่มีใครคืนให้)
                    </span>
                  </p>
                </div>
              </label>
            </div>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-primary px-6 py-2 text-primary-foreground hover:opacity-90"
          >
            บันทึก
          </button>
        </form>
      </main>
    </div>
  );
}

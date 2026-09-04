import { withTenantContext } from "@/lib/db";
import {
  CANCELLED_SALE_POLICY_HINTS_TH,
  CANCELLED_SALE_POLICY_LABELS_TH,
  CANCELLED_SALE_POLICY_VALUES,
  RECOMMENDED_CANCELLED_SALE_POLICY,
} from "@/lib/validations/consumption";
import { requireTenant } from "@/lib/require-tenant";
import { revalidatePath } from "next/cache";

export default async function SettingsPage() {
  const { membership } = await requireTenant("settings:write");
  const { tenant } = membership;

  async function updateTenant(formData: FormData) {
    "use server";
    // Re-authenticate inside the action — server actions are independent
    // requests, so we don't rely on the render-time closure for scoping.
    const { tenantId } = await requireTenant("settings:write");
    const enableDepts = formData.get("enable_departments") === "on";
    const isVat = formData.get("is_vat_registered") === "on";
    // A radio, not a checkbox: both methods are legitimate and neither is the
    // absence of the other (ADR 0019 Q17). An unticked box would have to mean
    // one of them, and it should not.
    const gpMethod =
      formData.get("gross_profit_method") === "RECIPE_CONSUMPTION"
        ? "RECIPE_CONSUMPTION"
        : "PERIODIC_INVENTORY";

    // Part 22 (ADR 0022 Q3). Also a radio, and for the same reason: both
    // readings of a cancelled bill are legitimate and neither is the absence of
    // the other.
    const cancelPolicy =
      formData.get("cancelled_sale_policy") === "TREAT_AS_NOT_COOKED"
        ? "TREAT_AS_NOT_COOKED"
        : "TREAT_AS_COOKED";

    await withTenantContext(tenantId, (tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: {
          enableDepartments: enableDepts,
          isVatRegistered: isVat,
          grossProfitMethod: gpMethod,
          cancelledSalePolicy: cancelPolicy,
        },
      })
    );

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    revalidatePath("/cost");
    revalidatePath("/consumption");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
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
          <div className="rounded-lg border border-border bg-surface p-6">
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

          {/* ---------- what a cancelled bill does to stock (ADR 0022 Q3) ---------- */}
          {/*
            Rule N12: the ambiguity here comes from the NATURE of the shop, not
            from us not having thought it through, so it is the owner's to settle
            — and each option shows what choosing it DOES, with a worked example.
            A label alone would be two rules the shop has only been told the
            names of.
          */}
          <div className="rounded-lg border border-border bg-surface p-6">
            <h3 className="mb-1 font-medium">บิลที่ถูกยกเลิก ตัดสต๊อกไหม</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              ไฟล์จาก POS บอกแค่ว่า “บิลนี้ถูกยกเลิก” ไม่ได้บอกว่าครัวลงมือทำไปแล้วหรือยัง ·
              ทั้งสองแบบเกิดขึ้นจริงทั้งคู่ และร้านคุณรู้ดีกว่าระบบว่าแบบไหนเกิดบ่อยกว่า
            </p>

            <div className="space-y-4">
              {CANCELLED_SALE_POLICY_VALUES.map((value) => (
                <label key={value} className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="cancelled_sale_policy"
                    value={value}
                    defaultChecked={tenant.cancelledSalePolicy === value}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">
                      {CANCELLED_SALE_POLICY_LABELS_TH[value]}
                      {value === RECOMMENDED_CANCELLED_SALE_POLICY && (
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-normal text-primary">
                          แนะนำ
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="text-xs">
                        {CANCELLED_SALE_POLICY_HINTS_TH[value]}
                      </span>
                    </p>
                  </div>
                </label>
              ))}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              ที่แนะนำแบบ “ทำไปแล้ว” เพราะถ้าเดาผิด ความผิดพลาดจะโผล่ตอนนับสต๊อกเป็น
              <strong>ของเกิน</strong> ซึ่งมองเห็นและสืบกลับได้ · ส่วนอีกทางจะโผล่เป็น
              <strong>ของขาด</strong> ซึ่งหน้าตาเหมือนของหายหรือถูกขโมย
            </p>
          </div>

          {/* ---------- how gross profit is worked out (ADR 0019 Q17) ---------- */}
          <div className="rounded-lg border border-border bg-surface p-6">
            <h3 className="mb-1 font-medium">วิธีคิดกำไรขั้นต้น</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              กำไรขั้นต้น = รายได้ − <strong>ต้นทุนของที่ขายไป</strong> ซึ่งไม่เท่ากับของที่ซื้อเข้ามา
              · สองวิธีนี้ถูกต้องทั้งคู่ ต่างกันตรงว่าร้านคุณทำอะไรอยู่แล้วเป็นประจำ
            </p>

            <div className="space-y-4">
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="gross_profit_method"
                  value="PERIODIC_INVENTORY"
                  defaultChecked={tenant.grossProfitMethod === "PERIODIC_INVENTORY"}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium">จากการนับสต๊อก</p>
                  <p className="text-sm text-muted-foreground">
                    สต๊อกต้นงวด + ซื้อระหว่างงวด − สต๊อกปลายงวด
                    <br />
                    <span className="text-xs">
                      ใช้ได้ทันที <strong>ไม่ต้องมีสูตรอาหาร</strong> เหมาะกับร้านที่นับสต๊อกเป็นรอบอยู่แล้ว ·
                      ตัวเลขจะแม่นเท่าที่นับจริง ถ้าไม่เคยนับ ระบบจะบอกกำกับไว้ว่าตัวเลขนั้นมักดูดีเกินจริง
                    </span>
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="gross_profit_method"
                  value="RECIPE_CONSUMPTION"
                  defaultChecked={tenant.grossProfitMethod === "RECIPE_CONSUMPTION"}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium">จากสูตรอาหาร</p>
                  <p className="text-sm text-muted-foreground">
                    คิดจากวัตถุดิบที่สูตรบอกว่าเมนูที่ขายไปใช้จริง
                    <br />
                    <span className="text-xs">
                      แม่นที่สุดและไม่ต้องรอรอบนับ แต่ต้อง<strong>มีสูตรอาหาร</strong>และ
                      <strong>กดตัดสต๊อกของแต่ละวัน</strong>ก่อน · ช่องกำไรขั้นต้นจะบอกทุกครั้งว่า
                      ตัดไปแล้วกี่วันจากกี่วัน และครอบคลุมยอดขายกี่เปอร์เซ็นต์ ·
                      วันไหนยังไม่ได้ตัด จะยังไม่ถูกนับเป็นต้นทุน
                    </span>
                  </p>
                </div>
              </label>
            </div>
          </div>

          <button
            type="submit"
            className="btn"
          >
            บันทึก
          </button>
        </form>
      </main>
    </div>
  );
}

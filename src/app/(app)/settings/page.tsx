import { withTenantContext } from "@/lib/db";
import { MeasureInput, MoneyInput } from "@/components/ui/NumberField";
import {
  CANCELLED_SALE_POLICY_HINTS_TH,
  CANCELLED_SALE_POLICY_LABELS_TH,
  CANCELLED_SALE_POLICY_VALUES,
  RECOMMENDED_CANCELLED_SALE_POLICY,
} from "@/lib/validations/consumption";
import { requireTenant } from "@/lib/require-tenant";
import { getDailyCloseSettingsLogic } from "@/server/daily-close";
import DailyCloseSettings from "./_components/DailyCloseSettings";
import { revalidatePath } from "next/cache";

export default async function SettingsPage() {
  const { membership } = await requireTenant("settings:write");
  const { tenant } = membership;
  const dailyClose = await getDailyCloseSettingsLogic(membership.tenantId);

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

    // ADR 0035 Q4 — who deducts a menu staff meal. A radio for the same reason:
    // both are how real shops work.
    const staffMealStock = formData.get("staff_meal_stock_source") === "POS" ? "POS" : "SYSTEM";

    // Rule PAR-2 (Kong 2026-10-21): how many days ahead "ใกล้ขั้นต่ำ" warns.
    // A whole number 0–30; anything else keeps what the shop had.
    const rawWarn = Number(formData.get("par_warning_days"));
    const parWarningDays = Number.isInteger(rawWarn) && rawWarn >= 0 && rawWarn <= 30 ? rawWarn : undefined;

    // /cost targets (Kong 2026-10-23). A value out of range keeps what the shop
    // had — the same rule as par_warning_days — rather than clamping to a
    // target nobody typed.
    const numIn = (name: string, lo: number, hi: number, int = false) => {
      const v = Number(formData.get(name));
      return formData.get(name) !== null && Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v)) ? v : undefined;
    };
    const costTargets = {
      foodCostTargetPct: numIn("food_cost_target_pct", 5, 90),
      primeCostTargetPct: numIn("prime_cost_target_pct", 10, 99),
      countVarianceTargetPct: numIn("count_variance_target_pct", 0, 20),
      costCoverageMinPct: numIn("cost_coverage_min_pct", 50, 100, true),
      slowStockDays: numIn("slow_stock_days", 7, 365, true),
    };
    const targetData = Object.fromEntries(Object.entries(costTargets).filter(([, v]) => v !== undefined));

    await withTenantContext(tenantId, (tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: {
          enableDepartments: enableDepts,
          isVatRegistered: isVat,
          grossProfitMethod: gpMethod,
          cancelledSalePolicy: cancelPolicy,
          staffMealStockSource: staffMealStock,
          ...(parWarningDays === undefined ? {} : { parWarningDays }),
          ...targetData,
        },
      })
    );

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    revalidatePath("/cost");
    revalidatePath("/consumption");
    revalidatePath("/staff-meals");
    revalidatePath("/products");
  }

  return (
    <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold">{tenant.name}</h1>

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
                  <p className="font-medium">เปิดใช้งานแผนก</p>
                  <p className="text-sm text-muted-foreground">
                    สำหรับร้านที่แยกต้นทุนตามส่วนงาน เช่น ครัว บาร์ เบเกอรี่ ·{" "}
                    <a href="/settings/departments" className="text-primary underline">
                      จัดการแผนก
                    </a>
                    <br />
                    <span className="text-xs">
                      ถ้าปิด ทุกรายการจะลงที่แผนกตั้งต้น
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

          {/* ---------- who deducts a menu staff meal (ADR 0035 Q4) ---------- */}
          <div className="rounded-lg border border-border bg-surface p-6">
            <h3 className="mb-1 font-medium">มื้อพนักงาน (เมนูในร้าน) ใครตัดสต๊อก</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              พนักงานขอเบิกในระบบ หัวหน้ากดอนุมัติ · คำถามคือร้านคุณคีย์มื้อพนักงานเข้า POS ด้วยหรือเปล่า
              — ถ้าคีย์ แล้วระบบตัดอีกรอบ สต๊อกจะถูกตัดซ้ำสองครั้ง
            </p>
            <div className="space-y-4">
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="staff_meal_stock_source"
                  value="SYSTEM"
                  defaultChecked={tenant.staffMealStockSource === "SYSTEM"}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium">ระบบตัดสต๊อกให้ ตอนหัวหน้ากดอนุมัติ</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-xs">
                      สำหรับร้านที่<strong>ไม่ได้</strong>คีย์มื้อพนักงานเข้า POS · ระบบตัดวัตถุดิบตามสูตรของเมนูนั้น
                    </span>
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="staff_meal_stock_source"
                  value="POS"
                  defaultChecked={tenant.staffMealStockSource === "POS"}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium">POS ตัดแล้ว ระบบไม่ต้องตัด</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-xs">
                      สำหรับร้านที่คีย์มื้อพนักงานเข้า POS เป็นยอดขายราคา ฿0 อยู่แล้ว — สต๊อกถูกตัดตอนนำเข้ายอดขาย ·
                      ตั๋วในระบบใช้คุมโควตาและเป็นหลักฐานว่าใครเบิก ใครอนุมัติ
                    </span>
                  </p>
                </div>
              </label>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              ค่านี้ถูกบันทึกติดไปกับตั๋วแต่ละใบตอนกดอนุมัติ — เปลี่ยนตรงนี้มีผลกับตั๋วใบถัดไป ไม่ย้อนไปแก้ของเก่า ·
              แบบ “ทำกินเองจากของในร้าน” ระบบตัดเสมอ เพราะไม่มีใน POS
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
                      ตัดสต๊อกแล้ว (ระบบตัดให้ทุกครั้งที่นำเข้ายอดขาย) · ช่องกำไรขั้นต้นจะบอกทุกครั้งว่า
                      ตัดไปแล้วกี่วันจากกี่วัน และครอบคลุมยอดขายกี่เปอร์เซ็นต์ ·
                      วันไหนยังไม่ได้ตัด จะยังไม่ถูกนับเป็นต้นทุน
                    </span>
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface p-6">
            <h3 className="mb-1 font-medium">เตือนของใกล้หมด</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              ของที่ตั้งขั้นต่ำไว้ ระบบขึ้นตัวเลข<span className="font-medium text-bad">สีแดง</span>บนเมนู “สินค้า/วัตถุดิบ” เมื่อต่ำกว่าขั้นต่ำ และ
              <span className="font-medium text-warn">สีเหลือง</span>เมื่อใกล้ขั้นต่ำ
            </p>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              เตือนล่วงหน้า
              <MeasureInput
                name="par_warning_days"
                unit="วัน"
                min={0}
                max={30}
                step={1}
                inputMode="numeric"
                defaultValue={tenant.parWarningDays}
                aria-label="เตือนล่วงหน้ากี่วัน"
                boxClassName="w-28"
              />
              ก่อนถึงขั้นต่ำ
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              คิดจากปริมาณที่ใช้จริงต่อวัน (จากการตัดสต๊อกตามยอดขาย) · ของที่ยังไม่รู้อัตราการใช้ เตือนเมื่อเหลือไม่ถึง 20% เหนือขั้นต่ำ ·
              ผู้ขายส่งของช้า ตั้งให้มากกว่าจำนวนวันที่รอของ · ใส่ 0 = เตือนเฉพาะเมื่อต่ำกว่าขั้นต่ำแล้ว
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface p-6">
            <h3 className="mb-1 font-medium">เป้าต้นทุนของร้าน</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              หน้า “ต้นทุน” บอกว่าอยู่ในเป้าหรือเกินเป้าตามตัวเลขเหล่านี้ · ค่าเริ่มต้นมาจากเกณฑ์ร้านอาหารทั่วไป
            </p>
            <div className="grid gap-3 text-sm">
              {(
                [
                  ["food_cost_target_pct", "ต้นทุนอาหาร ไม่เกิน", "% ของยอดขาย", Number(tenant.foodCostTargetPct), 5, 90, 0.5],
                  ["prime_cost_target_pct", "Prime cost (ต้นทุนอาหาร + ค่าแรง) ไม่เกิน", "% ของยอดขาย", Number(tenant.primeCostTargetPct), 10, 99, 0.5],
                  ["count_variance_target_pct", "นับสต๊อกได้ไม่ตรงกับระบบ ไม่เกิน", "% ของยอดขาย", Number(tenant.countVarianceTargetPct), 0, 20, 0.1],
                  ["cost_coverage_min_pct", "เทียบกับเป้าเมื่อตัดสต๊อกแล้วอย่างน้อย", "% ของยอดขาย", tenant.costCoverageMinPct, 50, 100, 1],
                  ["slow_stock_days", "ของค้างนาน เมื่อล็อตเก่าสุดเก่ากว่า", "วัน", tenant.slowStockDays, 7, 365, 1],
                ] as const
              ).map(([name, label, unit, value, min, max, step]) => (
                <label key={name} className="flex flex-wrap items-center gap-2">
                  {label}
                  <MeasureInput name={name} unit={unit} min={min} max={max} step={step} inputMode="decimal" defaultValue={value} aria-label={label} boxClassName="w-40" />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              ตัดสต๊อกตามยอดขายได้ไม่ถึงเกณฑ์ ต้นทุนยังไม่ครบและดูดีเกินจริง ระบบจึงแสดงเป็น “อย่างน้อย” และไม่บอกว่าอยู่ในเป้า
            </p>
          </div>

          <button
            type="submit"
            className="btn"
          >
            บันทึก
          </button>
        </form>

        {/* ADR 0042 — saves on its own, outside the form above. */}
        <DailyCloseSettings enabled={dailyClose.enabled} types={dailyClose.types} />
    </div>
  );
}

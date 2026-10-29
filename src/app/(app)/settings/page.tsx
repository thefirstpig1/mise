// ============================================================
// Mise — ตั้งค่าร้าน (review 2026-10-28, mockup 6A5E893FefkuYmW3Z5vzbn)
// ============================================================
// Four sections, each saving on its own (settings-form.tsx says why). Every
// setting keeps the explanation it was given when it was decided — rule N12:
// the shop chooses between two legitimate readings, so each option shows what
// choosing it DOES — but the long version now folds under "อ่านเพิ่ม" and the
// line that stays is the one a person needs to choose.
// ============================================================

import type { ReactNode } from "react";
import Link from "next/link";
import { MeasureInput } from "@/components/ui/NumberField";
import Switch from "@/components/ui/Switch";
import { RECOMMENDED_CANCELLED_SALE_POLICY } from "@/lib/validations/consumption";
import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getDailyCloseSettingsLogic } from "@/server/daily-close";
import { DEFAULT_DEPARTMENT_CODE, getDepartmentsForAdminLogic } from "@/server/department";
import CustomerTypes from "./_components/DailyCloseSettings";
import { ChangedNote, FieldError, SectionForm, SectionNav, UnsavedGuard } from "./_components/settings-form";
import {
  saveAddonsSectionAction,
  saveAdvanceSectionAction,
  saveProfitSectionAction,
  saveShopSectionAction,
  saveStockSectionAction,
} from "./actions";

const SECTIONS = [
  { id: "shop", label: "ข้อมูลร้านและภาษี" },
  { id: "stock", label: "สต๊อกและยอดขาย" },
  { id: "profit", label: "กำไรและเป้าต้นทุน" },
  { id: "addons", label: "แผนกและส่วนเสริม" },
  { id: "advances", label: "เงินสำรองจ่าย" },
];

/** One setting: what it is on the left, the control on the right (stacked on a phone). */
function Row({ title, htmlFor, hint, control, inline = false, children }: { title: string; htmlFor?: string; hint?: ReactNode; control?: ReactNode; inline?: boolean; children?: ReactNode }) {
  // A switch is small enough to stay beside its words on a phone too.
  return (
    <div className={`flex gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-6 ${inline ? "flex-row items-start justify-between" : "flex-col"}`}>
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="font-semibold">
            {title}
          </label>
        ) : (
          <p className="font-semibold">{title}</p>
        )}
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
        {children}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
  );
}

/** One of two legitimate answers, as a card the whole of which is the radio. */
function Option({ name, value, checked, title, example, recommended }: { name: string; value: string; checked: boolean; title: string; example: string; recommended?: boolean }) {
  return (
    <label className="flex min-w-0 flex-1 basis-64 cursor-pointer items-start gap-2.5 rounded-xl border border-border px-3.5 py-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:ring-1 has-[:checked]:ring-primary">
      <input type="radio" name={name} value={value} defaultChecked={checked} className="mt-1 h-[18px] w-[18px] shrink-0 accent-primary" />
      <span className="min-w-0">
        <span className="font-semibold">{title}</span>
        {recommended && <span className="ml-1.5 whitespace-nowrap rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary">แนะนำ</span>}
        <span className="mt-0.5 block text-xs text-muted-foreground">{example}</span>
      </span>
    </label>
  );
}

function More({ children }: { children: ReactNode }) {
  return (
    <details className="mt-1.5 text-sm">
      <summary className="cursor-pointer font-semibold text-primary">อ่านเพิ่ม</summary>
      <div className="mt-1.5 space-y-1 text-muted-foreground">{children}</div>
    </details>
  );
}

/**
 * Kong 2026-10-29: the shop's package and the day it stops being free. Set by
 * the platform (scripts/plan.mjs), never here — so it reads, it does not edit.
 * Nothing is locked when the date passes; that is decided with billing.
 */
function PlanCard({ plan, freeUntil, note }: { plan: string; freeUntil: Date | null; note: string | null }) {
  const name = plan === "standard" ? "แพ็กเกจมาตรฐาน" : "ช่วงทดลองใช้";
  const today = computeBangkokToday();
  const daysLeft = freeUntil ? Math.round((freeUntil.getTime() - today.getTime()) / 86_400_000) : null;
  const thDate = (d: Date) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <section className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-2xl border border-border bg-surface px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">แพ็กเกจของร้าน</p>
        <p className="font-semibold">
          {name}
          {freeUntil && daysLeft !== null && daysLeft >= 0 && <span className="font-normal"> · ใช้ฟรีถึง {thDate(freeUntil)}</span>}
        </p>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      <p className="text-sm text-muted-foreground">
        {freeUntil === null || daysLeft === null
          ? "ยังไม่มีค่าบริการ · ทีมคิดครัวจะติดต่อเรื่องแพ็กเกจก่อนเริ่มคิดค่าบริการ"
          : daysLeft >= 0
            ? `อีก ${daysLeft.toLocaleString("th-TH")} วัน · ก่อนครบกำหนดทีมคิดครัวจะแจ้งรายละเอียดค่าบริการ`
            : `ช่วงใช้ฟรีสิ้นสุดเมื่อ ${thDate(freeUntil)} · ทีมคิดครัวจะติดต่อเรื่องค่าบริการ`}
      </p>
    </section>
  );
}

function Days({ name, value, min, max, label }: { name: string; value: number; min: number; max: number; label: string }) {
  return (
    <div>
      <MeasureInput id={name} name={name} unit="วัน" min={min} max={max} step={1} inputMode="numeric" defaultValue={value} aria-label={label} boxClassName="w-28" />
      <FieldError name={name} />
    </div>
  );
}

export default async function SettingsPage() {
  const { membership } = await requireTenant("settings:write");
  const { tenant } = membership;
  const [dailyClose, departments] = await Promise.all([
    getDailyCloseSettingsLogic(membership.tenantId),
    getDepartmentsForAdminLogic(membership.tenantId),
  ]);
  const active = departments.filter((d) => d.isActive);
  const defaultDept = departments.find((d) => d.code === DEFAULT_DEPARTMENT_CODE);

  const targets = [
    ["food_cost_target_pct", "ต้นทุนอาหาร ไม่เกิน", "% ของยอดขาย", Number(tenant.foodCostTargetPct), 5, 90, 0.5],
    ["prime_cost_target_pct", "ต้นทุนอาหาร + ค่าแรง ไม่เกิน", "% ของยอดขาย", Number(tenant.primeCostTargetPct), 10, 99, 0.5],
    ["count_variance_target_pct", "นับได้ไม่ตรงระบบ ไม่เกิน", "% ของยอดขาย", Number(tenant.countVarianceTargetPct), 0, 20, 0.1],
    ["cost_coverage_min_pct", "เทียบเป้าเมื่อตัดสต๊อกแล้วอย่างน้อย", "% ของยอดขาย", tenant.costCoverageMinPct, 50, 100, 1],
    ["slow_stock_days", "ของค้างนาน เมื่อล็อตเก่าสุดเก่ากว่า", "วัน", tenant.slowStockDays, 7, 365, 1],
  ] as const;

  return (
    // A preferences page reads best narrow: label and switch stay close (kit).
    <div className="max-w-3xl space-y-5 pb-24 lg:pb-0">
      <header>
        <h1 className="text-2xl font-semibold leading-tight">ตั้งค่าร้าน</h1>
        <p className="mt-1 text-sm text-muted-foreground">แต่ละหมวดบันทึกแยกกัน · แก้แล้วยังไม่บันทึก ระบบจะถามก่อนออกจากหน้า</p>
      </header>

      <PlanCard plan={tenant.plan} freeUntil={tenant.planFreeUntil} note={tenant.planNote} />

      <SectionNav sections={SECTIONS} />
      <UnsavedGuard />

      {/* ---------- 1 · shop + tax ---------- */}
      <SectionForm id="shop" title="ข้อมูลร้านและภาษี" action={saveShopSectionAction}>
        <Row
          title="ชื่อร้าน"
          htmlFor="name"
          hint="ขึ้นที่หัวทุกหน้า อีเมลคำเชิญ และใบสั่งซื้อที่ส่งให้ผู้ขาย"
          control={
            <div>
              <input id="name" name="name" defaultValue={tenant.name} required maxLength={100} className="input w-full sm:w-72" />
              <FieldError name="name" />
            </div>
          }
        />
        <Row
          title="จดทะเบียน VAT"
          hint={tenant.isVatRegistered ? "จดแล้ว · ต้นทุนของไม่รวม VAT เพราะขอคืนได้" : "ไม่จด · VAT ที่จ่ายไปนับเป็นต้นทุนของ"}
          control={<Switch name="is_vat_registered" defaultChecked={tenant.isVatRegistered} label="จดทะเบียน VAT" />}
          inline
        >
          <ChangedNote
            name="is_vat_registered"
            savedOn={tenant.isVatRegistered}
            whenOn="มีผลกับใบรับของใบถัดไป: ต้นทุนของจะไม่รวม VAT · ใบที่ยืนยันไปแล้วไม่เปลี่ยน"
            whenOff="มีผลกับใบรับของใบถัดไป: VAT จะนับเป็นต้นทุนของ · ใบที่ยืนยันไปแล้วไม่เปลี่ยน"
          />
          <More>
            <p>ร้านที่จด VAT ขอคืนภาษีซื้อได้ ต้นทุนสต๊อกจึงไม่รวม VAT · ร้านที่ไม่จดจ่าย VAT แล้วจบ ระบบจึงรวม VAT เป็นต้นทุนของ · ต้องจดเมื่อรายได้เกิน ฿1.8 ล้านต่อปี</p>
            <p>ค่านี้ถูกบันทึกติดไปกับใบรับของแต่ละใบตอนกดยืนยัน จึงไม่ย้อนไปตีมูลค่าของเก่าใหม่ เพราะตอนนั้นร้านจ่าย VAT ไปแบบนั้นจริง</p>
          </More>
        </Row>
        <Row
          title="อัตรา VAT"
          htmlFor="default_vat_rate_percent"
          hint="ใช้เติมให้ในใบสั่งซื้อและบิลค่าใช้จ่าย แก้รายใบได้"
          control={
            <div>
              <MeasureInput id="default_vat_rate_percent" name="default_vat_rate_percent" unit="%" min={0} max={30} step={0.01} inputMode="decimal" defaultValue={Number(tenant.defaultVatRatePercent)} boxClassName="w-28" />
              <FieldError name="default_vat_rate_percent" />
            </div>
          }
        />
      </SectionForm>

      {/* ---------- 2 · stock + sales ---------- */}
      <SectionForm id="stock" title="สต๊อกและยอดขาย" action={saveStockSectionAction}>
        {/* ADR 0022 Q3 · rule N12 */}
        <Row title="บิลที่ถูกยกเลิก ตัดสต๊อกไหม" hint="ไฟล์ POS ไม่ได้บอกว่าครัวทำไปแล้วหรือยัง ร้านคุณรู้ดีกว่าระบบว่าแบบไหนเกิดบ่อยกว่า">
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Option
              name="cancelled_sale_policy"
              value="TREAT_AS_COOKED"
              checked={tenant.cancelledSalePolicy === "TREAT_AS_COOKED"}
              recommended={RECOMMENDED_CANCELLED_SALE_POLICY === "TREAT_AS_COOKED"}
              title="ทำไปแล้ว ตัดสต๊อก"
              example="ขาย 12 ยกเลิก 1 → ตัด 12 จาน · ถ้าเดาผิดจะเห็นเป็นของเกินตอนนับ"
            />
            <Option
              name="cancelled_sale_policy"
              value="TREAT_AS_NOT_COOKED"
              checked={tenant.cancelledSalePolicy === "TREAT_AS_NOT_COOKED"}
              recommended={RECOMMENDED_CANCELLED_SALE_POLICY === "TREAT_AS_NOT_COOKED"}
              title="ยังไม่ได้ทำ ไม่ตัด"
              example="ขาย 12 ยกเลิก 1 → ตัด 11 จาน · ถ้าเดาผิดจะเห็นเป็นของขาด เหมือนของหาย"
            />
          </div>
          <More>
            <p>ที่แนะนำแบบ “ทำไปแล้ว” เพราะถ้าเดาผิด ความผิดพลาดจะโผล่ตอนนับสต๊อกเป็นของเกิน ซึ่งมองเห็นและสืบกลับได้ · อีกทางจะโผล่เป็นของขาด ซึ่งหน้าตาเหมือนของหายหรือถูกขโมย</p>
          </More>
        </Row>
        {/* ADR 0035 Q4 */}
        <Row title="มื้อพนักงาน (เมนูในร้าน) ใครตัดสต๊อก" hint="ถ้าร้านคีย์มื้อพนักงานเข้า POS แล้วระบบตัดอีก สต๊อกจะถูกตัดซ้ำสองครั้ง">
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Option name="staff_meal_stock_source" value="SYSTEM" checked={tenant.staffMealStockSource === "SYSTEM"} title="ระบบตัดให้ ตอนหัวหน้าอนุมัติ" example="สำหรับร้านที่ไม่ได้คีย์มื้อพนักงานเข้า POS · ตัดตามสูตรของเมนูนั้น" />
            <Option name="staff_meal_stock_source" value="POS" checked={tenant.staffMealStockSource === "POS"} title="POS ตัดแล้ว ระบบไม่ต้องตัด" example="สำหรับร้านที่คีย์เข้า POS เป็นยอด ฿0 อยู่แล้ว · ตั๋วในระบบใช้คุมโควตาและเป็นหลักฐาน" />
          </div>
          <More>
            <p>ค่านี้ถูกบันทึกติดไปกับตั๋วแต่ละใบตอนกดอนุมัติ เปลี่ยนแล้วมีผลกับตั๋วใบถัดไป ไม่ย้อนไปแก้ของเก่า · แบบ “ทำกินเองจากของในร้าน” ระบบตัดเสมอ เพราะไม่มีใน POS</p>
          </More>
        </Row>
        <Row
          title="เตือนของใกล้หมดล่วงหน้า"
          htmlFor="par_warning_days"
          hint="ขึ้นสีเหลืองเมื่อจะถึงขั้นต่ำภายในกี่วัน ตามที่ใช้จริง · 0 = เตือนเมื่อต่ำกว่าขั้นต่ำแล้วเท่านั้น"
          control={<Days name="par_warning_days" value={tenant.parWarningDays} min={0} max={30} label="เตือนล่วงหน้ากี่วัน" />}
        >
          <More>
            <p>คิดจากปริมาณที่ใช้จริงต่อวัน (จากการตัดสต๊อกตามยอดขาย) · ของที่ยังไม่รู้อัตราการใช้ เตือนเมื่อเหลือไม่ถึง 20% เหนือขั้นต่ำ · ผู้ขายส่งของช้า ตั้งให้มากกว่าจำนวนวันที่รอของ</p>
          </More>
        </Row>
        <Row
          title="นับสต๊อกทุก"
          htmlFor="count_cycle_days"
          hint="หน้างานสต๊อกเตือนเมื่อนับครั้งล่าสุดเก่ากว่านี้"
          control={<Days name="count_cycle_days" value={tenant.countCycleDays} min={1} max={365} label="นับสต๊อกทุกกี่วัน" />}
        />
        {/* ADR 0040 Q2 (Kong 2026-10-29: "เอาตามแนะนำ" — starts as it always was) */}
        <Row title="ใบนับเริ่มต้น" hint="ใบนับที่เปิดใหม่เริ่มแบบนี้ · ตอนเปิดใบยังเลือกเปลี่ยนรายใบได้">
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Option
              name="count_show_expected_default"
              value="SHOW"
              checked={tenant.countShowExpectedDefault}
              title="บอกตัวเลขที่ระบบมี"
              example="นับเร็ว และช่วยใบ้ “กระดูกควรเหลือ ~8 กก.” เวลานับของแปรรูปได้เกิน"
            />
            <Option
              name="count_show_expected_default"
              value="BLIND"
              checked={!tenant.countShowExpectedDefault}
              title="ปิดตา — ไม่บอกตัวเลข"
              example="กันการเขียนตามตัวเลขในระบบ · ยังขอให้นับวัตถุดิบหลัก แต่ไม่บอกว่าควรเหลือเท่าไร"
            />
          </div>
          <More>
            <p>ใบ้ช่วยลดภาระคนนับ แต่ก็บอกคนที่ไม่ซื่อว่าควรเขียนเลขอะไร ร้านเลือกเองว่าแบบไหนเหมาะกับร้าน</p>
          </More>
        </Row>
      </SectionForm>

      {/* ---------- 3 · profit + targets ---------- */}
      <SectionForm id="profit" title="กำไรและเป้าต้นทุน" action={saveProfitSectionAction}>
        {/* ADR 0019 Q17 */}
        <Row title="วิธีคิดกำไรขั้นต้น" hint="ถูกทั้งสองแบบ เลือกตามที่ร้านทำอยู่เป็นประจำ · เปลี่ยนแล้วทุกหน้าที่โชว์กำไรขั้นต้นเปลี่ยนตาม">
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Option name="gross_profit_method" value="PERIODIC_INVENTORY" checked={tenant.grossProfitMethod === "PERIODIC_INVENTORY"} title="จากการนับสต๊อก" example="ต้นงวด + ซื้อ − ปลายงวด · ไม่ต้องมีสูตร · แม่นเท่าที่นับจริง" />
            <Option name="gross_profit_method" value="RECIPE_CONSUMPTION" checked={tenant.grossProfitMethod === "RECIPE_CONSUMPTION"} title="จากสูตรอาหาร" example="วัตถุดิบที่สูตรบอกว่าใช้ · ไม่ต้องรอนับ · ต้องมีสูตรและตัดสต๊อกแล้ว" />
          </div>
          <More>
            <p>กำไรขั้นต้น = รายได้ − ต้นทุนของที่ขายไป ซึ่งไม่เท่ากับของที่ซื้อเข้ามา</p>
            <p>จากการนับสต๊อก: ถ้าไม่เคยนับ ระบบจะบอกกำกับไว้ว่าตัวเลขนั้นมักดูดีเกินจริง</p>
            <p>จากสูตรอาหาร: ช่องกำไรขั้นต้นบอกทุกครั้งว่าตัดสต๊อกไปแล้วกี่วันจากกี่วัน และครอบคลุมยอดขายกี่เปอร์เซ็นต์ · วันที่ยังไม่ได้ตัดยังไม่ถูกนับเป็นต้นทุน</p>
          </More>
        </Row>
        <Row title="เป้าของร้าน" hint="หน้าต้นทุนบอกว่าอยู่ในเป้าหรือเกินเป้าตามตัวเลขนี้ · ค่าเริ่มต้นมาจากเกณฑ์ร้านอาหารทั่วไป">
          <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {targets.map(([name, label, unit, value, min, max, step]) => (
              <div key={name} className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={name} className="text-sm">
                  {label}
                </label>
                <div>
                  <MeasureInput id={name} name={name} unit={unit} min={min} max={max} step={step} inputMode="decimal" defaultValue={value} boxClassName="w-40" />
                  <FieldError name={name} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            ตัดสต๊อกตามยอดขายได้ไม่ถึงเกณฑ์ ต้นทุนยังไม่ครบและดูดีเกินจริง ระบบจึงแสดงเป็น “อย่างน้อย” และไม่บอกว่าอยู่ในเป้า
          </p>
        </Row>
      </SectionForm>

      {/* ---------- 4 · departments + add-ons ---------- */}
      <SectionForm id="addons" title="แผนกและส่วนเสริม" action={saveAddonsSectionAction}>
        <Row
          title="แยกต้นทุนและยอดขายตามแผนก"
          hint={
            <>
              {active.length > 0 ? `ตอนนี้มี ${active.length} แผนก: ${active.map((d) => d.name).join(" · ")}` : "ยังไม่มีแผนก"} ·{" "}
              <Link href="/settings/departments" className="font-semibold text-primary hover:underline">
                จัดการแผนก ›
              </Link>
            </>
          }
          control={<Switch name="enable_departments" defaultChecked={tenant.enableDepartments} label="แยกตามแผนก" />}
          inline
        >
          <ChangedNote
            name="enable_departments"
            savedOn={tenant.enableDepartments}
            whenOn="เปิดแล้ว: ใบขอซื้อและใบรับของเลือกแผนกได้ และหน้าต้นทุนแยกตามแผนก"
            whenOff={`ปิดแล้ว: ของที่ขอซื้อและรับเข้าใหม่ลงที่${defaultDept ? ` ${defaultDept.name}` : "แผนกตั้งต้น"} ทั้งหมด · แผนกและข้อมูลเก่ายังอยู่ เปิดใหม่เมื่อไรก็กลับมา`}
          />
        </Row>
        {/* ADR 0042 */}
        <Row
          title="รายงานปิดร้านประจำวัน"
          hint="ไม่บังคับ · แคชเชียร์กรอกยอด เงินสด ลูกค้า และปัญหาของวันในใบเดียว · ปิดไว้ = คีย์ยอดปิดร้านที่แดชบอร์ดเหมือนเดิม"
          control={<Switch name="daily_close_enabled" defaultChecked={dailyClose.enabled} label="รายงานปิดร้านประจำวัน" />}
          inline
        >
          {dailyClose.enabled && (
            <div className="mt-3">
              <CustomerTypes types={dailyClose.types} />
            </div>
          )}
        </Row>
      </SectionForm>

      {/* ---------- 5 · staff advances (ADR 0037 Q5–Q6) ---------- */}
      <SectionForm id="advances" title="เงินสำรองจ่าย" action={saveAdvanceSectionAction}>
        <Row
          title="ต้องอนุมัติก่อนคืนเงินพนักงานทุกบิล"
          hint="ปิดไว้ = บิลที่มีรูปบิลและสลิปครบ (หรือบัญชีรับรองแล้ว) คืนเงินได้เลย · เปิด = ต้องให้คนที่มีสิทธิ์ส่งใบสั่งซื้อกดอนุมัติก่อนทุกบิล"
          control={<Switch name="refund_approval_all" defaultChecked={tenant.refundApprovalAll} label="ต้องอนุมัติทุกบิล" />}
          inline
        />
        <Row
          title="บิลที่เกินยอดนี้ต้องอนุมัติ"
          htmlFor="refund_approval_over"
          hint="เว้นว่าง = ไม่มีเพดาน · ใช้เมื่อไม่ได้เปิดอนุมัติทุกบิล เช่น ใส่ 1,000 = บิลเกิน ฿1,000 ต้องอนุมัติก่อนคืนเงิน"
          control={
            <div>
              <MeasureInput
                id="refund_approval_over"
                name="refund_approval_over"
                unit="บาท"
                min={1}
                step={1}
                inputMode="numeric"
                defaultValue={tenant.refundApprovalOver === null ? undefined : Number(tenant.refundApprovalOver)}
                aria-label="บิลที่เกินยอดนี้ต้องอนุมัติ"
                boxClassName="w-36"
              />
              <FieldError name="refund_approval_over" />
            </div>
          }
        />
      </SectionForm>
    </div>
  );
}

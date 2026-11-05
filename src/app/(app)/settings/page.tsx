// ============================================================
// Mise — ตั้งค่าร้าน (review 2026-10-28, mockup 6A5E893FefkuYmW3Z5vzbn)
// ============================================================
// Four sections, each saving on its own (settings-form.tsx says why). Every
// setting keeps the explanation it was given when it was decided — rule N12:
// the shop chooses between two legitimate readings, so each option shows what
// choosing it DOES — but the long version now folds under "อ่านเพิ่ม" and the
// line that stays is the one a person needs to choose.
//
// Friend's-shop feedback (Kong 2026-10-31, mockup 1wgaH9Jfx8L7CxqfNHtdn3):
// every setting is now the QUESTION a shop can answer ("ค่าวัตถุดิบไม่ควรเกิน
// กี่ % ของยอดขาย", not "ต้นทุนอาหาร ไม่เกิน"), with an example under it, and
// the "?" beside it says what it is and which pages it moves
// (src/lib/setting-help.ts). "อ่านเพิ่ม" moved into the "?".
// ============================================================

import type { ReactNode } from "react";
import Link from "next/link";
import { MeasureInput } from "@/components/ui/NumberField";
import Switch from "@/components/ui/Switch";
import FieldHelp from "@/components/ui/FieldHelp";
import { SETTING_HELP, type HelpKey } from "@/lib/setting-help";
import { RECOMMENDED_CANCELLED_SALE_POLICY } from "@/lib/validations/consumption";
import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getDailyCloseSettingsLogic } from "@/server/daily-close";
import { DEFAULT_DEPARTMENT_CODE, getDepartmentsForAdminLogic } from "@/server/department";
import CustomerTypes from "./_components/DailyCloseSettings";
import ConfirmShopSettings from "./_components/ConfirmShopSettings";
import { shopSettingsReviewed } from "@/server/onboarding";
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
  { id: "stock", label: "สต็อกและยอดขาย" },
  { id: "profit", label: "กำไรและเป้าต้นทุน" },
  { id: "addons", label: "แผนกและส่วนเสริม" },
  { id: "advances", label: "เงินสำรองจ่าย" },
];

/** One setting: what it is on the left, the control on the right (stacked on a phone). */
function Row({
  title,
  htmlFor,
  hint,
  control,
  inline = false,
  help,
  children,
}: {
  title: string;
  htmlFor?: string;
  hint?: ReactNode;
  control?: ReactNode;
  inline?: boolean;
  help?: HelpKey;
  children?: ReactNode;
}) {
  // A switch is small enough to stay beside its words on a phone too.
  return (
    <div className={`flex gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-6 ${inline ? "flex-row items-start justify-between" : "flex-col"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="font-semibold">
              {title}
            </label>
          ) : (
            <p className="font-semibold">{title}</p>
          )}
          {help && (
            <span className="mt-px">
              <FieldHelp name={help} />
            </span>
          )}
        </div>
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

/**
 * Kong 2026-10-29: the shop's package and the day it stops being free. Set by
 * the platform (scripts/plan.mjs), never here — so it reads, it does not edit.
 * Nothing is locked when the date passes; that is decided with billing.
 */
function PlanCard({ plan, freeUntil, note }: { plan: string; freeUntil: Date | null; note: string | null }) {
  // Kong 2026-10-30: package names bare, in English (plan code `trial` means Free).
  const name = plan === "standard" ? "Standard" : "Free";
  const today = computeBangkokToday();
  const daysLeft = freeUntil ? Math.round((freeUntil.getTime() - today.getTime()) / 86_400_000) : null;
  const thDate = (d: Date) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <section className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-[18px] border border-border/70 bg-surface shadow-card px-5 py-4 sm:px-6">
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
          ? "ยังไม่มีค่าบริการ · ก่อนเริ่มคิดค่าบริการ คิดครัวจะแจ้งให้ทราบล่วงหน้า"
          : daysLeft >= 0
            ? `อีก ${daysLeft.toLocaleString("th-TH")} วัน · ก่อนครบกำหนด คิดครัวจะแจ้งรายละเอียดค่าบริการ`
            : `ช่วงใช้ฟรีสิ้นสุดเมื่อ ${thDate(freeUntil)} · คิดครัวจะติดต่อเรื่องค่าบริการ`}
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

  // [field, under-the-question example, unit, value, min, max, step]
  const targets = [
    ["food_cost_target_pct", "เช่น ขายได้ ฿100 ใช้วัตถุดิบไป ฿35 = 35%", "% ของยอดขาย", Number(tenant.foodCostTargetPct), 5, 90, 0.5],
    ["prime_cost_target_pct", "สองก้อนนี้คือค่าใช้จ่ายที่ใหญ่ที่สุดของร้าน · บางที่เรียกว่า prime cost", "% ของยอดขาย", Number(tenant.primeCostTargetPct), 10, 99, 0.5],
    ["count_variance_target_pct", "เช่น ขาย ฿100,000 นับแล้วหายไป ฿1,500 = 1.5%", "% ของยอดขาย", Number(tenant.countVarianceTargetPct), 0, 20, 0.1],
    [
      "cost_coverage_min_pct",
      "เมนูที่ยังไม่มีสูตรไม่ถูกหักวัตถุดิบ ต้นทุนจึงดูต่ำเกินจริง · ใช้กับร้านที่คิดต้นทุนจากสูตร",
      "% ของยอดขาย",
      tenant.costCoverageMinPct,
      50,
      100,
      1,
    ],
    ["slow_stock_days", "ดูจากของรอบที่ซื้อเก่าที่สุดที่ยังเหลืออยู่", "วัน", tenant.slowStockDays, 7, 365, 1],
  ] as const;

  return (
    // A preferences page reads best narrow: label and switch stay close (kit).
    <div className="max-w-3xl space-y-5 pb-24 lg:pb-0">
      <header>
        <h1 className="page-title">ตั้งค่าทั่วไป</h1>
        <p className="mt-1 text-sm text-muted-foreground">ใช้กับทุกสาขาของร้าน · แต่ละหมวดบันทึกแยกกัน · แก้แล้วยังไม่บันทึก ระบบจะถามก่อนออกจากหน้า</p>
      </header>
      {!shopSettingsReviewed(tenant) && <ConfirmShopSettings />}

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
          title={SETTING_HELP.is_vat_registered.title}
          hint={
            tenant.isVatRegistered
              ? "เปิด = จดแล้ว · VAT ที่จ่ายตอนซื้อของขอคืนได้ จึงไม่นับเป็นต้นทุน"
              : "ปิด = ยังไม่จด · VAT ที่จ่ายตอนซื้อของนับเป็นต้นทุนของร้าน · ร้านที่รายได้เกิน ฿1.8 ล้านต่อปีต้องจด"
          }
          control={<Switch name="is_vat_registered" defaultChecked={tenant.isVatRegistered} label="จดทะเบียน VAT แล้ว" />}
          help="is_vat_registered"
          inline
        >
          <ChangedNote
            name="is_vat_registered"
            savedOn={tenant.isVatRegistered}
            whenOn="มีผลกับใบรับสินค้าใบถัดไป: ต้นทุนของจะไม่รวม VAT · ใบที่ยืนยันไปแล้วไม่เปลี่ยน"
            whenOff="มีผลกับใบรับสินค้าใบถัดไป: VAT จะนับเป็นต้นทุนของ · ใบที่ยืนยันไปแล้วไม่เปลี่ยน"
          />
        </Row>
        <Row
          title={SETTING_HELP.default_vat_rate_percent.title}
          htmlFor="default_vat_rate_percent"
          hint="ปกติ 7% · แก้ได้ทีละใบ"
          help="default_vat_rate_percent"
          control={
            <div>
              <MeasureInput id="default_vat_rate_percent" name="default_vat_rate_percent" unit="%" min={0} max={30} step={0.01} inputMode="decimal" defaultValue={Number(tenant.defaultVatRatePercent)} boxClassName="w-28" />
              <FieldError name="default_vat_rate_percent" />
            </div>
          }
        />
      </SectionForm>

      {/* ---------- 2 · stock + sales ---------- */}
      <SectionForm id="stock" title="สต็อกและยอดขาย" action={saveStockSectionAction}>
        {/* ADR 0022 Q3 · rule N12 */}
        <Row
          title={SETTING_HELP.cancelled_sale_policy.title}
          hint="ไฟล์ POS ไม่บอกว่าครัวทำไปแล้วหรือยัง เลือกแบบที่ร้านเจอบ่อยกว่า · ใช้กับเมนูที่มีสูตร"
          help="cancelled_sale_policy"
        >
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Option
              name="cancelled_sale_policy"
              value="TREAT_AS_COOKED"
              checked={tenant.cancelledSalePolicy === "TREAT_AS_COOKED"}
              recommended={RECOMMENDED_CANCELLED_SALE_POLICY === "TREAT_AS_COOKED"}
              title="ส่วนใหญ่ทำไปแล้ว"
              example="หักวัตถุดิบด้วย · สั่ง 12 ยกเลิก 1 → หัก 12 จาน"
            />
            <Option
              name="cancelled_sale_policy"
              value="TREAT_AS_NOT_COOKED"
              checked={tenant.cancelledSalePolicy === "TREAT_AS_NOT_COOKED"}
              recommended={RECOMMENDED_CANCELLED_SALE_POLICY === "TREAT_AS_NOT_COOKED"}
              title="ส่วนใหญ่ยังไม่ได้ทำ"
              example="ไม่หักจานที่ยกเลิก · สั่ง 12 ยกเลิก 1 → หัก 11 จาน"
            />
          </div>
        </Row>
        {/* ADR 0035 Q4 */}
        <Row title={SETTING_HELP.staff_meal_stock_source.title} help="staff_meal_stock_source">
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Option name="staff_meal_stock_source" value="SYSTEM" checked={tenant.staffMealStockSource === "SYSTEM"} title="ไม่ได้กดใน POS" example="คิดครัวหักวัตถุดิบตามสูตร เมื่อหัวหน้าอนุมัติใบเบิก" />
            <Option name="staff_meal_stock_source" value="POS" checked={tenant.staffMealStockSource === "POS"} title="กดใน POS เป็นยอด ฿0" example="คิดครัวไม่หักซ้ำ · ใบเบิกใช้คุมโควตาและเป็นหลักฐาน" />
          </div>
        </Row>
        <Row
          title={SETTING_HELP.par_warning_days.title}
          htmlFor="par_warning_days"
          hint="ใส่ 0 = เตือนเมื่อต่ำกว่าขั้นต่ำแล้วเท่านั้น"
          control={<Days name="par_warning_days" value={tenant.parWarningDays} min={0} max={30} label="เตือนล่วงหน้ากี่วัน" />}
          help="par_warning_days"
        />
        <Row
          title={SETTING_HELP.count_cycle_days.title}
          htmlFor="count_cycle_days"
          hint="หน้าภาพรวมสต็อกเตือนเมื่อไม่ได้นับเกินจำนวนวันนี้"
          help="count_cycle_days"
          control={<Days name="count_cycle_days" value={tenant.countCycleDays} min={1} max={365} label="นับสต็อกทุกกี่วัน" />}
        />
        {/* ADR 0040 Q2 (Kong 2026-10-29: "เอาตามแนะนำ" — starts as it always was) */}
        <Row
          title={SETTING_HELP.count_show_expected_default.title}
          hint="เป็นค่าเริ่มต้นของใบนับใหม่ · เลือกใหม่ได้ทีละใบตอนเปิดใบนับ"
          help="count_show_expected_default"
        >
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Option
              name="count_show_expected_default"
              value="SHOW"
              checked={tenant.countShowExpectedDefault}
              title="ให้เห็น"
              example="นับเร็วขึ้น เห็นทันทีว่าตัวไหนต่างจากระบบ"
            />
            <Option
              name="count_show_expected_default"
              value="BLIND"
              checked={!tenant.countShowExpectedDefault}
              title="ไม่ให้เห็น"
              example="กันการเขียนตามตัวเลขในระบบ"
            />
          </div>
        </Row>
      </SectionForm>

      {/* ---------- 3 · profit + targets ---------- */}
      <SectionForm id="profit" title="กำไรและเป้าต้นทุน" action={saveProfitSectionAction}>
        {/* ADR 0019 Q17 */}
        <Row
          title={SETTING_HELP.gross_profit_method.title}
          hint="ถูกทั้งสองแบบ เลือกแบบที่ร้านทำได้เป็นประจำ · เปลี่ยนภายหลังได้"
          help="gross_profit_method"
        >
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Option name="gross_profit_method" value="PERIODIC_INVENTORY" checked={tenant.grossProfitMethod === "PERIODIC_INVENTORY"} title="จากการนับสต็อก" example="ไม่ต้องมีสูตร · ต้นทุน = ของที่มีต้นเดือน + ที่ซื้อเข้า − ของที่เหลือสิ้นเดือน" />
            <Option name="gross_profit_method" value="RECIPE_CONSUMPTION" checked={tenant.grossProfitMethod === "RECIPE_CONSUMPTION"} title="จากสูตรของเมนู" example="เห็นต้นทุนทุกวันตามยอดขาย · ต้องเขียนสูตรของเมนู" />
          </div>
        </Row>
        {/* The targets: each its own question now ("ต้นทุนอาหาร ไม่เกิน __%" left
            the shop asking "% of what?"). Defaults come from restaurants in general. */}
        {targets.map(([name, hint, unit, value, min, max, step]) => (
          <Row
            key={name}
            title={SETTING_HELP[name].title}
            htmlFor={name}
            hint={hint}
            help={name}
            control={
              <div>
                <MeasureInput id={name} name={name} unit={unit} min={min} max={max} step={step} inputMode="decimal" defaultValue={value} boxClassName="w-40" />
                <FieldError name={name} />
              </div>
            }
          />
        ))}
      </SectionForm>

      {/* ---------- 4 · departments + add-ons ---------- */}
      <SectionForm id="addons" title="แผนกและส่วนเสริม" action={saveAddonsSectionAction}>
        <Row
          title={SETTING_HELP.enable_departments.title}
          help="enable_departments"
          hint={
            <>
              เปิดแล้ว ใบขอซื้อและใบรับสินค้าเลือกแผนกได้ ·{" "}
              {active.length > 0 ? `ตอนนี้มี ${active.length} แผนก: ${active.map((d) => d.name).join(" · ")}` : "ยังไม่มีแผนก"} ·{" "}
              <Link href="/settings/departments" className="link">
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
            whenOn="เปิดแล้ว: ใบขอซื้อและใบรับสินค้าเลือกแผนกได้ และหน้าต้นทุนแยกตามแผนก"
            whenOff={`ปิดแล้ว: ของที่ขอซื้อและรับเข้าใหม่ลงที่${defaultDept ? ` ${defaultDept.name}` : "แผนกตั้งต้น"} ทั้งหมด · แผนกและข้อมูลเก่ายังอยู่ เปิดใหม่เมื่อไรก็กลับมา`}
          />
        </Row>
        {/* ADR 0042 */}
        <Row
          title={SETTING_HELP.daily_close_enabled.title}
          hint="แคชเชียร์กรอกยอด เงินสด จำนวนลูกค้า และปัญหาของวันในใบเดียว"
          help="daily_close_enabled"
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
          title={SETTING_HELP.refund_approval_all.title}
          hint="ปิด = ไม่ต้อง บิลที่มีรูปบิลและสลิปครบ หรือบัญชีรับรองแล้ว คืนเงินได้เลย · เปิด = ต้องอนุมัติทุกบิล คนที่มีสิทธิ์ส่งใบสั่งซื้อกดอนุมัติก่อน"
          help="refund_approval_all"
          control={<Switch name="refund_approval_all" defaultChecked={tenant.refundApprovalAll} label="ต้องอนุมัติทุกบิล" />}
          inline
        />
        <Row
          title="หรืออนุมัติเฉพาะบิลที่เกินกี่บาท"
          htmlFor="refund_approval_over"
          hint="เว้นว่าง = ไม่มีเพดาน · เช่น ใส่ 1,000 = บิลเกิน ฿1,000 ต้องอนุมัติก่อนคืนเงิน"
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

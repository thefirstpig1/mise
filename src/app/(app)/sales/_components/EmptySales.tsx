// ============================================================
// คิดครัว — /sales before there are sales in the period
// ============================================================
// Kong 2026-11-05 (review item 2): "layout มันต้องเหมือนกันกับตอนที่มีข้อมูล" —
// and, on seeing made-up figures in it: "ตัวกราฟตัวข้อมูลอย่า mislead ไม่งั้นเขา
// เข้าใจผิด แบบเดิมดีแล้ว แต่เขาต้องรู้ว่ามันจะมีกราฟ มีตารางอะไรบ้าง".
//
// So: the filled page's own sections, in the same order and under the same
// headings, each holding the dashed OUTLINE of its chart. Not one number, name
// or date on this page is made up; the "นี่คืออะไร" popup on the daily card is
// the one place a labelled example lives.
// ============================================================

import type { LucideIcon } from "lucide-react";
import { ChartColumn, Tag, Utensils } from "lucide-react";
import IconTile from "@/components/ui/IconTile";
import WaitingFor, { DashBar, Outline } from "@/components/ui/WaitingFor";

const CARD = "rounded-[18px] border border-border/70 bg-surface shadow-card p-5";

const KPIS: { label: string; icon: LucideIcon; note: string }[] = [
  { label: "ยอดขาย", icon: ChartColumn, note: "ไม่รวม VAT และเซอร์วิสชาร์จ" },
  { label: "จำนวนจาน", icon: Utensils, note: "นับเฉพาะวันที่มีข้อมูล" },
  { label: "ราคาเฉลี่ยต่อจาน", icon: Tag, note: "ยอดขาย หาร จำนวนจาน" },
];

export default function EmptySales({ branchId, canProfit }: { branchId?: string; canProfit: boolean }) {
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-3">
        {KPIS.map((k) => (
          <div key={k.label} className="grid content-start gap-2 rounded-[18px] border border-border/70 bg-surface p-4 shadow-card">
            <p className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <IconTile icon={k.icon} />
                {k.label}
              </span>
              <span className="text-right text-[11px] text-muted-subtle">{k.note}</span>
            </p>
            <DashBar className="h-8 w-32" />
            <DashBar className="h-5 w-24" />
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 border-t border-border pt-2 text-xs text-muted-subtle">
              <dt>ช่วงนี้</dt>
              <dd>
                <DashBar className="ml-auto h-3 w-20" />
              </dd>
              <dt>ช่วงก่อน</dt>
              <dd>
                <DashBar className="ml-auto h-3 w-20" />
              </dd>
            </dl>
          </div>
        ))}
      </section>

      <section className={CARD}>
        <h3 className="text-base font-semibold">ยอดขายรายวัน</h3>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">กดที่แท่งเพื่อดูรายละเอียดของวันนั้น</p>
        <WaitingFor figure="dailySales" needs={["sales"]} reason="ยังไม่มียอดขายในช่วงนี้ — นำเข้าไฟล์จาก POS ไฟล์เดียวครอบได้หลายวัน" branchId={branchId} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-base font-semibold">วันไหนของสัปดาห์ขายดี</h3>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
            ยอดขายเฉลี่ยต่อวัน หารด้วยจำนวนวันนั้นที่มีจริงในช่วง — วันที่ดีที่สุดเป็นแท่งสีส้มอิฐ · ใช้วางกะพนักงาน
          </p>
          <Outline shape="bars" sample="week" />
        </section>
        <section className={CARD}>
          <h3 className="text-base font-semibold">สัดส่วนหมวดเมนู</h3>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">ตามยอดขาย · กดหมวดเพื่อดูเมนูในหมวดนั้น</p>
          <Outline shape="donut" />
        </section>
      </div>

      <section className={CARD}>
        <h3 className="text-base font-semibold">แนวโน้มรายหมวด</h3>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">เดือนไหนหมวดไหนขายดี · เฉลี่ยต่อวันที่มีข้อมูล · กดหมวดเพื่อดูกราฟของหมวดนั้น</p>
        <Outline shape="line" />
      </section>

      <section className={CARD}>
        <h3 className="text-base font-semibold">หมวดไหนขายดีวันไหน</h3>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
          เช่น วันเสาร์ ต้มยำคิดเป็นกี่ % ของทั้งวัน เทียบกับเครื่องดื่มหรือเบียร์ · เฉลี่ยจากจำนวนวันนั้นที่มีข้อมูลจริง
        </p>
        <Outline shape="heat" />
      </section>

      <section className={CARD}>
        <h3 className="text-base font-semibold">เมนูที่น่าจับตา</h3>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">เมนูที่ขายขึ้นหรือลงมากที่สุดเมื่อเทียบกับช่วงก่อน · ยอดขายเฉลี่ยต่อวัน</p>
        <Outline shape="list" />
      </section>

      {canProfit ? (
        <section className={CARD}>
          <h3 className="text-base font-semibold">เมนูแต่ละกลุ่ม: ขายได้มากน้อย × กำไรต่อจาน</h3>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">ขายได้กี่จาน × กำไรต่อจาน · ต้องมียอดขายและสูตรอาหาร</p>
          <Outline shape="quadrant" />
        </section>
      ) : null}
    </>
  );
}

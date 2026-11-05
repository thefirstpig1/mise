// ============================================================
// คิดครัว — /sales before there are sales in the period
// ============================================================
// Kong 2026-11-05 (review item 2): "ถ้ายังไม่เคยอัพโหลดไฟล์ หน้าที่ยังไม่มีข้อมูล
// ที่เป็นเส้นประไปก่อนถูกต้อง แต่ layout มันต้องเหมือนกันกับตอนที่มีข้อมูล แล้วต้อง
// มีตัวอย่างให้ดูทุกองค์ประกอบ". The page used to be one empty box. It is now
// the filled page's own sections, in the same order and under the same
// headings, each holding a made-up shop's example in a dashed frame — so a new
// shop sees what this page will answer before it has a single file.
//
// Every number here is made up and tagged ตัวอย่าง; the comparison rows say
// "ช่วงนี้ / ช่วงก่อน" rather than a real month, so nothing reads as a claim
// about THIS shop's period.
// ============================================================

import type { LucideIcon } from "lucide-react";
import { ChartColumn, Tag, Utensils } from "lucide-react";
import IconTile from "@/components/ui/IconTile";
import WaitingFor, { ExampleTag, Ghost } from "@/components/ui/WaitingFor";

const CARD = "rounded-[18px] border border-border/70 bg-surface shadow-card p-5";

const KPIS: { label: string; icon: LucideIcon; note: string; value: string; change: string; perDay: boolean; cur: string; prev: string }[] = [
  { label: "ยอดขาย", icon: ChartColumn, note: "ไม่รวม VAT และเซอร์วิสชาร์จ", value: "฿620,400", change: "▲ 8.1%", perDay: true, cur: "฿23,900/วัน", prev: "฿22,100/วัน" },
  { label: "จำนวนจาน", icon: Utensils, note: "นับเฉพาะวันที่มีข้อมูล", value: "8,450", change: "▲ 5.2%", perDay: true, cur: "325 จาน/วัน", prev: "309 จาน/วัน" },
  { label: "ราคาเฉลี่ยต่อจาน", icon: Tag, note: "ยอดขาย หาร จำนวนจาน", value: "฿73", change: "▲ 2.8%", perDay: false, cur: "฿73", prev: "฿71" },
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
            <div className="grid gap-2 rounded-xl border-[1.5px] border-dashed border-primary-line p-2.5">
              <span className="flex items-center justify-between gap-2">
                <span className="font-display text-2xl font-semibold leading-tight text-muted-subtle tabular-nums">{k.value}</span>
                <ExampleTag />
              </span>
              <span aria-hidden className="w-max rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-subtle">
                {k.change}
                <span className="font-normal">{k.perDay ? " ต่อวัน" : ""}</span>
              </span>
              <dl aria-hidden className="grid grid-cols-[auto_1fr] gap-x-3 border-t border-dashed border-border pt-2 text-xs text-muted-subtle tabular-nums">
                <dt>ช่วงนี้</dt>
                <dd className="text-right">{k.cur}</dd>
                <dt>ช่วงก่อน</dt>
                <dd className="text-right">{k.prev}</dd>
              </dl>
            </div>
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
          <Ghost shape="bars" sample="week" />
        </section>
        <section className={CARD}>
          <h3 className="text-base font-semibold">สัดส่วนหมวดเมนู</h3>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">ตามยอดขาย · กดหมวดเพื่อดูเมนูในหมวดนั้น</p>
          <Ghost shape="donut" />
        </section>
      </div>

      <section className={CARD}>
        <h3 className="text-base font-semibold">แนวโน้มรายหมวด</h3>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">เดือนไหนหมวดไหนขายดี · เฉลี่ยต่อวันที่มีข้อมูล · กดหมวดเพื่อดูกราฟของหมวดนั้น</p>
        <Ghost shape="line" />
      </section>

      <section className={CARD}>
        <h3 className="text-base font-semibold">หมวดไหนขายดีวันไหน</h3>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
          เช่น วันเสาร์ ต้มยำคิดเป็นกี่ % ของทั้งวัน เทียบกับเครื่องดื่มหรือเบียร์ · เฉลี่ยจากจำนวนวันนั้นที่มีข้อมูลจริง
        </p>
        <Ghost shape="heat" />
      </section>

      <section className={CARD}>
        <h3 className="text-base font-semibold">เมนูที่น่าจับตา</h3>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">เมนูที่ขายขึ้นหรือลงมากที่สุดเมื่อเทียบกับช่วงก่อน · ยอดขายเฉลี่ยต่อวัน</p>
        <Ghost shape="list" sample="movers" />
      </section>

      {canProfit ? (
        <section className={CARD}>
          <h3 className="text-base font-semibold">เมนูแต่ละกลุ่ม: ขายได้มากน้อย × กำไรต่อจาน</h3>
          <p className="mb-4 mt-0.5 text-xs text-muted-foreground">ขายได้กี่จาน × กำไรต่อจาน · ต้องมียอดขายและสูตรอาหาร</p>
          <Ghost shape="quadrant" />
        </section>
      ) : null}
    </>
  );
}

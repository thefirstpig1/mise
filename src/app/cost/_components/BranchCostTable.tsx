"use client";

// Sprint 2 Part 14 L5a — the branch comparison (ADR 0014 Q9b).
//
// A business is not a branch. Mise manages the whole restaurant business, so the
// first thing management sees is every branch side by side; the per-branch and
// per-product detail is the drill-down, not the entry point.
//
// The two columns that matter most are the ones no POS reports: what each branch
// THREW AWAY in baht, and what each branch PAID ABOVE the cheapest branch for the
// same goods. Both are money leaking in plain sight.
//
// Revenue and gross profit are rendered as an explicit "รอเชื่อม POS" rather than
// 0 or a blank — a zero would be a lie, and a blank invites someone to assume the
// number is broken instead of absent.
//
// Part 16 (ADR 0016 Q4) restructured rather than appended, as ADR 0014
// Consequence 4 said the next change would have to: **ซื้อของ split into
// ต้นทุนวัตถุดิบ (COGS) and ค่าใช้จ่ายอื่น (OpEx)** — "materials 60,000,
// everything else 40,000" is a sentence an owner acts on, and it becomes food
// cost % the day revenue lands — and **ทุนจมในสต๊อก moved out of the table
// entirely**. It is a balance-sheet figure: sitting in a row of cash-flow
// columns, it invited a reader to add it to numbers it does not belong with. It
// now has its own panel, labelled as what it is.

import { formatMoney } from "./cost-view";
import type { BranchCostSummaryView } from "./cost-view";

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-3 py-2 text-sm";
const tdNum = `${td} text-right tabular-nums`;

export default function BranchCostTable({
  rows,
}: {
  rows: BranchCostSummaryView[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
        ยังไม่มีสาขาในระบบ
      </div>
    );
  }

  const total = rows.reduce(
    (acc, r) => ({
      cogsSpend: acc.cogsSpend + Number(r.cogsSpend),
      opexSpend: acc.opexSpend + Number(r.opexSpend),
      inventoryValue: acc.inventoryValue + Number(r.inventoryValue),
      wasteValue: acc.wasteValue + Number(r.wasteValue),
      varianceValue: acc.varianceValue + Number(r.varianceValue),
      excessSpend: acc.excessSpend + Number(r.excessSpend),
    }),
    {
      cogsSpend: 0,
      opexSpend: 0,
      inventoryValue: 0,
      wasteValue: 0,
      varianceValue: 0,
      excessSpend: 0,
    }
  );

  // Display-only arithmetic on already-rounded 2dp figures — the authoritative
  // per-branch numbers all came from the server as strings (Pitfall #20).
  const fmt = (n: number) =>
    n.toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const hasDataQualityIssue = rows.some(
    (r) => r.negativeStockProducts > 0 || r.unpricedProducts > 0
  );

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[54rem]">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className={th}>สาขา</th>
              <th className={`${th} text-right`}>ต้นทุนวัตถุดิบ</th>
              <th className={`${th} text-right`}>ค่าใช้จ่ายอื่น</th>
              {/* Part 17 Q4: still eight columns (replace, don't append). The
                  two loss columns finally mean what they say — ของเสีย is a
                  waste document, ส่วนต่าง is everything that left without one. */}
              <th className={`${th} text-right`}>ของเสีย (ทิ้ง)</th>
              <th className={`${th} text-right`}>ส่วนต่าง/ปรับปรุง</th>
              <th className={`${th} text-right`}>จ่ายแพงกว่าที่ถูกสุด</th>
              <th className={`${th} text-right`}>รายได้</th>
              <th className={`${th} text-right`}>กำไรขั้นต้น</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const waste = Number(r.wasteValue);
              const variance = Number(r.varianceValue);
              const excess = Number(r.excessSpend);
              return (
                <tr key={r.branchId} className="hover:bg-muted/20">
                  <td className={td}>
                    <span className="font-medium">{r.branchName}</span>
                    {r.branchCode && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.branchCode}
                      </span>
                    )}
                    {(r.negativeStockProducts > 0 || r.unpricedProducts > 0) && (
                      <div className="mt-0.5 text-xs text-amber-700">
                        {r.negativeStockProducts > 0 &&
                          `สต๊อกติดลบ ${r.negativeStockProducts} รายการ`}
                        {r.negativeStockProducts > 0 &&
                          r.unpricedProducts > 0 &&
                          " · "}
                        {r.unpricedProducts > 0 &&
                          `ยังไม่ทราบต้นทุน ${r.unpricedProducts} รายการ`}
                      </div>
                    )}
                  </td>
                  <td className={tdNum}>{formatMoney(r.cogsSpend)}</td>
                  <td className={tdNum}>{formatMoney(r.opexSpend)}</td>
                  <td
                    className={`${tdNum} ${waste > 0 ? "font-medium text-red-700" : "text-muted-foreground"}`}
                  >
                    {formatMoney(r.wasteValue)}
                  </td>
                  <td
                    className={`${tdNum} ${variance > 0 ? "font-medium text-red-700" : "text-muted-foreground"}`}
                  >
                    {formatMoney(r.varianceValue)}
                  </td>
                  <td
                    className={`${tdNum} ${excess > 0 ? "font-medium text-red-700" : "text-muted-foreground"}`}
                  >
                    {formatMoney(r.excessSpend)}
                  </td>
                  <td className={`${tdNum} text-muted-foreground`}>—</td>
                  <td className={`${tdNum} text-muted-foreground`}>—</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-border bg-muted/30">
            <tr>
              <td className={`${td} font-medium`}>รวมทั้งธุรกิจ</td>
              <td className={`${tdNum} font-medium`}>{fmt(total.cogsSpend)}</td>
              <td className={`${tdNum} font-medium`}>{fmt(total.opexSpend)}</td>
              <td className={`${tdNum} font-medium`}>{fmt(total.wasteValue)}</td>
              <td className={`${tdNum} font-medium`}>{fmt(total.varianceValue)}</td>
              <td className={`${tdNum} font-medium`}>{fmt(total.excessSpend)}</td>
              <td className={`${tdNum} text-muted-foreground`}>—</td>
              <td className={`${tdNum} text-muted-foreground`}>—</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/*
        ทุนจมในสต๊อก, out of the cash-flow table (Q4). Every column above answers
        "what happened to the money this period"; this answers "what is sitting on
        the shelf right now", and the two do not add up to anything.
      */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold">ทุนจมในสต๊อก</h3>
          <span className="text-sm font-medium tabular-nums">
            {fmt(total.inventoryValue)} ฿
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          มูลค่าของที่ยังอยู่ในสต๊อก ณ วันสิ้นงวด — ไม่ใช่เงินที่จ่ายออกไปในงวดนี้
          จึงไม่นำไปรวมกับคอลัมน์ด้านบน
        </p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.branchId} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{r.branchName}</span>
              <span className="tabular-nums">{formatMoney(r.inventoryValue)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>ของเสีย (ทิ้ง)</strong> คือของที่มีคนบันทึกไว้ว่าทิ้ง พร้อมวันที่และสาเหตุ —
        คุยกับครัวเรื่องการสั่งและการเก็บรักษา ·{" "}
        <strong>ส่วนต่าง/ปรับปรุง</strong> คือของที่หายไปโดยไม่มีใครบันทึก
        ไม่ว่าจะเจอตอนนับสต๊อกหรือปรับด้วยมือ — คุยกับผู้จัดการสาขาเรื่องการรับของ การคีย์ข้อมูล
        หรือของหาย
      </p>
      <p className="text-xs text-muted-foreground">
        รายการปรับสต๊อกที่เคยเลือกเหตุผล &ldquo;ของเสีย&rdquo; ก่อนหน้านี้
        จะอยู่ในช่องส่วนต่าง/ปรับปรุง เพราะไม่มีเอกสารของเสียกำกับ — ตั้งแต่นี้ไป
        ให้บันทึกที่หน้า{" "}
        <a href="/waste" className="text-primary hover:underline">
          ของเสีย
        </a>{" "}
        เพื่อให้ตัวเลขช่องซ้ายเป็นของเสียจริง ๆ
      </p>

      <p className="text-xs text-muted-foreground">
        <strong>รายได้</strong> และ <strong>กำไรขั้นต้น</strong> ยังว่างอยู่ —
        ระบบยังไม่ได้เชื่อมข้อมูลการขายจาก POS (Sprint 4) ตัวเลขที่แสดงตอนนี้คือฝั่งเงินออกทั้งหมด
      </p>

      {hasDataQualityIssue && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          บางสาขามีสต๊อกติดลบหรือของที่ยังไม่ทราบต้นทุน — ตัวเลขต้นทุนของสาขานั้นจะแม่นขึ้นเมื่อคีย์ใบรับของครบและระบุต้นทุนของที่นับเจอเพิ่ม
        </div>
      )}
    </div>
  );
}

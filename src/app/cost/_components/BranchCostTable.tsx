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
      purchaseSpend: acc.purchaseSpend + Number(r.purchaseSpend),
      inventoryValue: acc.inventoryValue + Number(r.inventoryValue),
      wasteValue: acc.wasteValue + Number(r.wasteValue),
      countVarianceValue: acc.countVarianceValue + Number(r.countVarianceValue),
      excessSpend: acc.excessSpend + Number(r.excessSpend),
    }),
    {
      purchaseSpend: 0,
      inventoryValue: 0,
      wasteValue: 0,
      countVarianceValue: 0,
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
              <th className={`${th} text-right`}>ซื้อของ</th>
              <th className={`${th} text-right`}>ทุนจมในสต๊อก</th>
              <th className={`${th} text-right`}>ของเสีย (ทิ้ง)</th>
              <th className={`${th} text-right`}>ส่วนต่างจากการนับ</th>
              <th className={`${th} text-right`}>จ่ายแพงกว่าที่ถูกสุด</th>
              <th className={`${th} text-right`}>รายได้</th>
              <th className={`${th} text-right`}>กำไรขั้นต้น</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const waste = Number(r.wasteValue);
              const countVariance = Number(r.countVarianceValue);
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
                  <td className={tdNum}>{formatMoney(r.purchaseSpend)}</td>
                  <td className={tdNum}>{formatMoney(r.inventoryValue)}</td>
                  <td
                    className={`${tdNum} ${waste > 0 ? "font-medium text-red-700" : "text-muted-foreground"}`}
                  >
                    {formatMoney(r.wasteValue)}
                  </td>
                  <td
                    className={`${tdNum} ${countVariance > 0 ? "font-medium text-red-700" : "text-muted-foreground"}`}
                  >
                    {formatMoney(r.countVarianceValue)}
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
              <td className={`${tdNum} font-medium`}>{fmt(total.purchaseSpend)}</td>
              <td className={`${tdNum} font-medium`}>{fmt(total.inventoryValue)}</td>
              <td className={`${tdNum} font-medium`}>{fmt(total.wasteValue)}</td>
              <td className={`${tdNum} font-medium`}>{fmt(total.countVarianceValue)}</td>
              <td className={`${tdNum} font-medium`}>{fmt(total.excessSpend)}</td>
              <td className={`${tdNum} text-muted-foreground`}>—</td>
              <td className={`${tdNum} text-muted-foreground`}>—</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>ของเสีย (ทิ้ง)</strong> คือของที่รู้ตัวว่าทิ้ง — คุยกับครัวเรื่องการสั่งและการเก็บรักษา ·{" "}
        <strong>ส่วนต่างจากการนับ</strong> คือของที่หายไปโดยไม่รู้สาเหตุ จนกระทั่งไปนับเจอ —
        คุยกับผู้จัดการสาขาเรื่องการรับของ การคีย์ข้อมูล หรือของหาย
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

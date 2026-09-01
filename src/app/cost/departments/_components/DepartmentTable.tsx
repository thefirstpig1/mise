// Part 32 L4 — the matrix, as far as ADR 0032 lets it go.
//
// MATERIALS and REVENUE only (rule F5). Rent and electricity are operating
// costs of the whole shop; folding them in would make the food-cost percentage
// every restaurant compares itself on mean nothing.
//
// Decimal cannot cross into a Client Component (Pitfall #20), so every figure
// arrives as a formatted string.

const baht = (s: string) =>
  `฿${Number(s).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const pct = (cost: string, revenue: string): string | null => {
  const r = Number(revenue);
  if (!Number.isFinite(r) || r === 0) return null;
  return `${((Number(cost) / r) * 100).toFixed(1)}%`;
};

export type DepartmentRowView = {
  departmentId: string | null;
  name: string;
  materialCost: string;
  revenue: string;
  grossProfit: string;
};

export default function DepartmentTable({
  rows,
  materialCostTotal,
  revenueTotal,
  grossProfitUnavailable,
  skippedCount,
  coveredNetAmount,
  postedDays,
}: {
  rows: DepartmentRowView[];
  materialCostTotal: string;
  revenueTotal: string;
  grossProfitUnavailable: boolean;
  skippedCount: number;
  /** Revenue with consumption behind it — rule F10, and money not days (N3). */
  coveredNetAmount: string;
  postedDays: number;
}) {
  // 🔴 Rule F10. Nothing was posted, so every material cost is zero and the
  // gross profit column would read as the entire revenue at a 0.0% food cost.
  // Every figure would be arithmetically correct and the page would be a lie,
  // which is the one thing a screen in this system may not be.
  const nothingPosted = postedDays === 0 || Number(coveredNetAmount) === 0;
  const coveragePct =
    Number(revenueTotal) === 0
      ? null
      : (Number(coveredNetAmount) / Number(revenueTotal)) * 100;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        ยังไม่มียอดขายหรือการตัดสต๊อกในช่วงนี้
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {nothingPosted && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-4 text-sm">
          <p className="font-medium">ยังไม่ได้ตัดสต๊อกตามยอดขายในช่วงนี้</p>
          <p className="mt-1 text-muted-foreground">
            ยอดขายนำเข้ามาแล้ว แต่ยังไม่ได้กดตัดสต๊อก — ต้นทุนวัตถุดิบจึงเป็น 0 ทุกแผนก
            และ <strong>กำไรขั้นต้นด้านล่างยังไม่ใช่ตัวเลขจริง</strong> ไปที่หน้าตัดสต๊อกตามยอดขายก่อน
            แล้วกลับมาดูอีกครั้ง
          </p>
        </div>
      )}

      {!nothingPosted && coveragePct !== null && coveragePct < 99.5 && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm">
          <p className="font-medium">
            ตัวเลขนี้ครอบคลุมรายได้ {coveragePct.toFixed(1)}% ของช่วงเวลา
          </p>
          <p className="mt-1 text-muted-foreground">
            ส่วนที่เหลือคือวันที่ยังไม่ได้ตัดสต๊อก หรือเมนูที่ระเบิดสูตรไม่ได้ —
            ต้นทุนและกำไรขั้นต้นด้านล่างเป็นของส่วนที่ครอบคลุมเท่านั้น
          </p>
        </div>
      )}

      {grossProfitUnavailable && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm">
          <p className="font-medium">ร้านนี้คิดกำไรขั้นต้นแบบ “นับสต๊อก”</p>
          <p className="mt-1 text-muted-foreground">
            วิธีนั้นแยกตามแผนกไม่ได้ เพราะของที่เหลือในสต๊อกอยู่ในห้องเก็บของของสาขา
            ไม่ได้อยู่ในแผนกไหน — คอลัมน์ต้นทุนด้านล่างมาจากสูตรอาหาร
            จึงใช้ดูสัดส่วนระหว่างแผนกได้ แต่ไม่ตรงกับกำไรขั้นต้นในหน้า /cost
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2">แผนก</th>
              <th className="py-2 text-right">ต้นทุนวัตถุดิบ</th>
              <th className="py-2 text-right">รายได้</th>
              <th className="py-2 text-right">กำไรขั้นต้น</th>
              <th className="py-2 text-right">ต้นทุนวัตถุดิบ %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.departmentId ?? "none"}
                className="border-b border-border/50"
              >
                <td className="py-2">
                  {r.departmentId === null ? (
                    <span className="text-muted-foreground">{r.name}</span>
                  ) : (
                    r.name
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {baht(r.materialCost)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {baht(r.revenue)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {baht(r.grossProfit)}
                </td>
                <td className="py-2 text-right tabular-nums text-muted-foreground">
                  {/* No denominator, no percentage — a department with cost and
                      no revenue is a real state, and printing 0% or ∞ for it
                      would be a number that means nothing. */}
                  {pct(r.materialCost, r.revenue) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-2">รวม</td>
              <td className="py-2 text-right tabular-nums">
                {baht(materialCostTotal)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {baht(revenueTotal)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {baht(String(Number(revenueTotal) - Number(materialCostTotal)))}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {pct(materialCostTotal, revenueTotal) ?? "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-2 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">ต้นทุนวัตถุดิบ</strong> คือมูลค่าของที่
          <em>ถูกใช้ไปจริง</em> ตามสูตร ไม่ใช่ของที่ซื้อเข้ามาในช่วงนี้ —
          สองตัวเลขนี้ไม่เท่ากันและบวกกันไม่ได้ ส่วนต่างคือของที่ยังอยู่ในสต๊อก
        </p>
        <p>
          <strong className="text-foreground">ค่าเช่า ค่าไฟ เงินเดือน</strong>{" "}
          ไม่ได้อยู่ในตารางนี้ — เป็นค่าใช้จ่ายของทั้งร้าน ไม่ใช่ต้นทุนวัตถุดิบ
        </p>
        <p>
          <strong className="text-foreground">ไม่ระบุแผนก</strong>{" "}
          คือเมนูที่ขายแล้วยังไม่ได้เลือกแผนกให้ · ตั้งแผนกให้เมนูได้ที่หน้าเมนู
          แล้วตัวเลขจะย้ายไปแถวที่ถูกต้องเอง
        </p>
        <p>
          <strong className="text-foreground">ของเสียกับการปรับสต๊อกมือไม่อยู่ในตารางนี้</strong>{" "}
          — ตารางนี้นับเฉพาะของที่ถูกใช้ไปตามสูตรเพื่อขาย ซึ่งคือตัวที่คู่กับรายได้เป็นกำไรขั้นต้น ·
          ของเสียมีคอลัมน์ของตัวเองในหน้าต้นทุน และของที่หายโดยไม่มีใครบันทึกอยู่ในหน้า “ของหายไปไหน”
        </p>
        {skippedCount > 0 && (
          <p className="text-warn">
            มี {skippedCount} เมนูที่ระเบิดสูตรไม่ได้ในช่วงนี้ —
            ยอดขายของมันอยู่ในคอลัมน์รายได้ แต่ต้นทุนไม่ได้ถูกนับ
          </p>
        )}
      </div>
    </div>
  );
}

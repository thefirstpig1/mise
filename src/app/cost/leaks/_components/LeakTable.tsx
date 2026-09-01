// Part 32 L5 — the leak table (ADR 0032 Q6/Q7).
//
// 🔴 THERE IS NO DEPARTMENT COLUMN AND THAT IS THE POINT (rule F6). Nobody
// recorded whose hands the missing stock left, so apportioning the loss by
// usage share would put a guess in a column readers take as fact. The last
// column names who USES the product — an owner reads it and knows who to ask,
// and the system has not accused anybody.
//
// Decimal cannot cross into a Client Component (Pitfall #20): strings only.

const baht = (s: string) =>
  `฿${Number(s).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const qty = (s: string) => Number(s).toLocaleString("th-TH");

export type LeakRowView = {
  productId: string;
  productName: string;
  expectedQty: string;
  countedQty: string;
  varianceQty: string;
  /** What the count itself found, valued by the ledger. Pairs with the qty columns. */
  countVarianceValue: string;
  /** Manual write-offs and transfers that never arrived — a different fact. */
  otherLossValue: string;
  totalLossValue: string;
  /** Money left this product but no count in the window looked at it. */
  neverCounted: boolean;
  usage: { name: string; percent: number }[];
};

export default function LeakTable({ rows }: { rows: LeakRowView[] }) {
  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          ยังไม่มีการนับสต๊อกที่ปิดแล้วในช่วงนี้
        </p>
        <p className="text-xs text-muted-foreground">
          ตารางนี้เปรียบเทียบยอดที่ระบบคิดว่าควรเหลือ กับยอดที่คนไปนับมาจริง —
          ถ้ายังไม่เคยนับ ก็ยังไม่มีอะไรให้เทียบ
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2">วัตถุดิบ</th>
              <th className="py-2 text-right">ควรเหลือ</th>
              <th className="py-2 text-right">นับได้</th>
              <th className="py-2 text-right">ส่วนต่าง</th>
              <th className="py-2 text-right">มูลค่าที่นับเจอ</th>
              <th className="py-2 text-right">ตัดจำหน่าย/ขาดส่ง</th>
              <th className="py-2">แผนกที่ใช้</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const short = Number(r.varianceQty) < 0;
              return (
                <tr key={r.productId} className="border-b border-border/50">
                  <td className="py-2">{r.productName}</td>
                  {r.neverCounted ? (
                    // Not "0 / 0 / 0", which reads as counted-and-fine. Money
                    // left this product and no count in the window looked at it.
                    <td className="py-2 text-xs text-muted-foreground" colSpan={3}>
                      ยังไม่ได้นับในช่วงนี้
                    </td>
                  ) : (
                    <>
                      <td className="py-2 text-right tabular-nums">
                        {qty(r.expectedQty)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {qty(r.countedQty)}
                      </td>
                      <td
                        className={`py-2 text-right tabular-nums ${
                          short ? "text-bad" : "text-muted-foreground"
                        }`}
                      >
                        {qty(r.varianceQty)}
                      </td>
                    </>
                  )}
                  <td className="py-2 text-right font-medium tabular-nums">
                    {Number(r.countVarianceValue) === 0
                      ? "—"
                      : baht(r.countVarianceValue)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(r.otherLossValue) === 0
                      ? "—"
                      : baht(r.otherLossValue)}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {r.usage.length === 0
                      ? "ไม่ได้ใช้ผ่านสูตรในช่วงนี้"
                      : r.usage.map((u) => `${u.name} ${u.percent}%`).join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">มูลค่าที่นับเจอ</strong>{" "}
          คือส่วนต่างจากการนับ ซึ่งคู่กับสามคอลัมน์ทางซ้ายของมัน ·{" "}
          <strong className="text-foreground">ตัดจำหน่าย/ขาดส่ง</strong>{" "}
          คือของที่หายด้วยเหตุอื่นในช่วงเดียวกัน — คนกดตัดจำหน่ายเอง
          หรือของที่ส่งข้ามสาขาแล้วไปไม่ถึง · สองคอลัมน์นี้เป็นคนละเรื่องกัน
          จึงไม่รวมเป็นตัวเลขเดียว แต่บวกกันแล้วเท่ากับ ส่วนต่าง/ปรับปรุง ในหน้าต้นทุน
        </p>
        <p>
          <strong className="text-foreground">ควรเหลือ</strong>{" "}
          คือยอดที่ระบบคิดไว้ตอนที่คนกดบันทึกการนับ — ซื้อเข้า ลบที่ตัดตามสูตร
          ลบของเสียที่บันทึกไว้ · ส่วนต่างคือของที่หายไปโดยไม่มีใครบันทึก
        </p>
        <p>
          <strong className="text-foreground">แผนกที่ใช้</strong>{" "}
          บอกว่าใครใช้วัตถุดิบตัวนี้ ไม่ได้บอกว่าใครทำหาย —
          ระบบไม่มีข้อมูลว่าของหายจากมือใคร จึงไม่หารส่วนต่างเข้าแผนก
        </p>
      </div>
    </div>
  );
}

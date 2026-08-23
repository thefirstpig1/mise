// Sprint 5 Part 21 L5c — what the recipe costs, and why to doubt it.
//
// A Server Component: nothing here is interactive, and the figures arrive
// already serialized (Decimal cannot cross to a Client Component — Pitfall #20).
//
// THE CAVEAT IS NOT A FOOTNOTE. Q6 exists because six ingredients resolving and
// one silently free produces a number that looks exactly like a good one; so the
// confidence line sits directly under the figure, the unpriced components are
// NAMED with what to do about each, and a broken graph says which fault it is
// instead of rendering a zero.
//
// The lines add up to `costPerBatch` exactly — the walk runs at batch scale and
// the division into a serving happens on the MONEY (rule R15), so a reader who
// adds the column up gets the total rather than a rounding drift.

import type { RecipeCostView } from "./recipe-view";

const tone: Record<string, string> = {
  HIGH: "border-emerald-200 bg-emerald-50 text-emerald-800",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-900",
  LOW: "border-red-200 bg-red-50 text-red-800",
};

export default function RecipeCostPanel({
  cost,
  branchName,
  asOfLabel,
  isPreppedOutput,
}: {
  cost: RecipeCostView | null;
  branchName: string;
  asOfLabel: string;
  isPreppedOutput: boolean;
}) {
  if (cost === null) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
        ยังคิดต้นทุนไม่ได้ — บันทึกสูตรก่อน
      </div>
    );
  }

  if (cost.problem !== null) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <p className="font-medium">คิดต้นทุนไม่ได้</p>
        <p className="mt-1">{cost.problemLabel}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs text-muted-foreground">
          ต้นทุนที่ <strong>{branchName}</strong> ณ วันที่ {asOfLabel}
        </p>
        <p className="mt-2 text-3xl font-bold tabular-nums">
          {cost.costPerServing}
          <span className="ml-1 text-base font-normal text-muted-foreground">
            บาท / {isPreppedOutput ? "หน่วย" : "จาน"}
          </span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          ทำครั้งละ {cost.servings} {isPreppedOutput ? "หน่วย" : "จาน"} ·
          ต้นทุนต่อครั้ง {cost.costPerBatch} บาท
        </p>

        <div className={`mt-3 rounded-lg border p-3 text-xs ${tone[cost.confidence]}`}>
          <p className="font-medium">ความน่าเชื่อถือ: {cost.confidenceLabel}</p>
          <p className="mt-0.5">{cost.confidenceHint}</p>
        </div>

        {/* Q16: read BACKWARDS out of the arithmetic, never typed in. Only a
            production recipe whose inputs share a dimension has an answer. */}
        {cost.yieldPercentComputed !== null ? (
          <p className="mt-3 text-xs text-muted-foreground">
            เทียบเท่าเปอร์เซ็นต์ผลผลิต{" "}
            <strong>{cost.yieldPercentComputed}%</strong> — คำนวณจากสูตรนี้เอง
            ไม่ได้กรอกไว้
          </p>
        ) : null}
      </div>

      {cost.unpriced.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">
            ตัวเลขนี้ต่ำกว่าความจริง — มี {cost.unpriced.length} อย่างที่ยังไม่รู้ต้นทุน
          </p>
          <ul className="mt-2 space-y-1">
            {cost.unpriced.map((u) => (
              <li key={`${u.kind}:${u.id}`}>
                <span className="font-medium">{u.name}</span> — {u.reasonLabel}
                {u.reason === "NEVER_PURCHASED" ? (
                  <>
                    {" · "}
                    <a href="/cost" className="underline">
                      ระบุราคาเองที่หน้าต้นทุน
                    </a>
                  </>
                ) : (
                  <>
                    {" · "}
                    <a href="/recipes" className="underline">
                      เขียนสูตรของมันก่อน
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[24rem]">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                ส่วนประกอบ
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                จำนวน
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                ต้นทุนต่อครั้ง (บาท)
              </th>
            </tr>
          </thead>
          <tbody>
            {cost.lines.map((l) => (
              <tr key={l.ingredientId} className="border-t border-border">
                <td className="px-3 py-2 text-sm">
                  {l.label}
                  {l.confidence !== "HIGH" ? (
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      {l.confidenceLabel}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right text-sm tabular-nums text-muted-foreground">
                  {l.qty} {l.unitName ?? "จาน"}
                </td>
                <td className="px-3 py-2 text-right text-sm tabular-nums">
                  {l.cost}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border bg-muted/30">
            <tr>
              <td className="px-3 py-2 text-sm font-medium" colSpan={2}>
                รวมต่อครั้ง
              </td>
              <td className="px-3 py-2 text-right text-sm font-medium tabular-nums">
                {cost.costPerBatch}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        ต้นทุนนี้คำนวณสด ๆ ทุกครั้งที่เปิดหน้า ไม่ได้เก็บไว้ — ราคาของที่ซื้อเข้ามา
        เปลี่ยนเมื่อไร ตัวเลขนี้เปลี่ยนตามทันที
      </p>
    </div>
  );
}

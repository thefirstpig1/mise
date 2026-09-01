// Sprint 3 Part 18 L5b — "something is on its way here" (ADR 0018 Q8).
//
// A Server Component shared by /stock, /stock-counts and the dashboard, because
// **the receiving half of a transfer is somebody else's work in another branch**
// and no earlier Part has been true of that. A waste log, a count and a receipt
// are each finished by the person who started them; a transfer is not, and the
// person at the far end has no way to learn a truck is coming except by being
// telephoned.
//
// Two of Part 17's UX-pass lessons are applied here before they can bite:
//
//   * An empty state is only rendered when the caller asks for it. A box that
//     always says "nothing incoming" is noise on the page a shop uses daily; a
//     box that renders NOTHING when a feature is unused is how par level stayed
//     invisible to every shop that never set one. `variant` decides which.
//   * `SENT` never appears without its sentence. On its own it reads as "the
//     stock has not arrived", and the stock is already in this branch's balance.

import type { TransferView } from "./transfer-view";

export default function IncomingTransfers({
  transfers,
  branchName,
  variant = "quiet",
  countWarning = false,
}: {
  transfers: TransferView[];
  branchName: string;
  /**
   * `quiet` renders nothing when there is nothing to say — for pages where this
   * is a side note. `always` renders the reassuring empty state too — for the
   * stock page, where "nothing on the way" is itself information.
   */
  variant?: "quiet" | "always";
  /**
   * On the stock-count screens, add the consequence: counting now finds a
   * shortage exactly the size of the truck, and Part 15 posts it as a real loss
   * with the counter's name on it (ADR 0018 Q7).
   */
  countWarning?: boolean;
}) {
  if (transfers.length === 0) {
    if (variant === "quiet") return null;
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        ไม่มีของกำลังส่งมาที่{branchName}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warn-border bg-warn-bg p-4">
      <p className="text-sm font-medium text-warn">
        มีของกำลังส่งมาที่{branchName} {transfers.length} ใบ ยังไม่มีใครกดรับ
      </p>
      <p className="mt-1 text-xs text-warn">
        ของอยู่ในยอดคงเหลือของสาขานี้เรียบร้อยแล้ว — ที่ยังค้างคือการนับยืนยันว่าได้รับจริง
      </p>

      {countWarning && (
        <p className="mt-2 rounded-lg border border-warn-border bg-warn-bg p-2 text-xs text-warn">
          ถ้านับสต๊อกตอนนี้โดยของยังไม่ถึง จะนับได้ขาดเท่าจำนวนที่อยู่บนรถพอดี
          และระบบจะบันทึกส่วนต่างนั้นเป็นของหายจริงพร้อมชื่อคนนับ — นับรวมของบนรถ
          หรือรอให้ของถึงก่อนก็ได้ แต่ควรตั้งใจเลือก
        </p>
      )}

      <ul className="mt-3 space-y-1 text-sm">
        {transfers.map((t) => (
          <li key={t.id}>
            <a href={`/transfers/${t.id}`} className="text-warn hover:underline">
              {t.tfNumber}
            </a>{" "}
            <span className="text-warn">
              จาก {t.fromBranch.name} · {t.lineCount} รายการ · ส่ง {t.dispatchedAtLabel}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

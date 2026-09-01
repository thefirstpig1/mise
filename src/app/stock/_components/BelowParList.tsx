"use client";

// Sprint 3 Part 17 L5b — the below-par list (ADR 0017 Q6/Q6b).
//
// Interactive CARDS, not table rows (Kong's call): a row carries four facts and
// they only help if reaching them costs nothing. Collapsed says what to do —
// product, gap, state, and how old the number is. Expanded says why — the order
// behind it, and the count date in full.
//
// The freshness line is deliberately visible while COLLAPSED. ADR 0017 Q6b calls
// it the row's own health warning rather than decoration: with a monthly count
// and nothing yet deducting what was sold, the on-hand figure is true on count
// day and drifts for three more weeks. A warning you have to open a card to see
// is not a warning.
//
// What this list will NOT do, and the absence is the design (Q5/Q6):
//   - it never offers to order anything;
//   - stock on order does not suppress a row. An order placed and never chased is
//     the failure nobody notices until service, so the order becomes CONTEXT on
//     the row instead of a reason to hide it.

import { useState } from "react";
import type { ParLevelRowView } from "./par-level-view";

const STATE_STYLES: Record<string, string> = {
  NEEDS_ORDER: "border-bad-border bg-bad-bg text-bad",
  OVERDUE: "border-warn-border bg-warn-bg text-warn",
  ON_ORDER: "border-blue-300 bg-blue-50 text-blue-800",
  OK: "border-border bg-muted/30 text-muted-foreground",
};

function Card({ row, branchId }: { row: ParLevelRowView; branchId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {row.product.name}
          </span>
          {/* The health warning, visible without opening anything. */}
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {row.freshnessLabel}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <span className="text-right text-sm">
            <span className="block tabular-nums">
              {row.onHand} / {row.parQty} {row.product.baseUnitName ?? ""}
            </span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              ขาด {row.gap} {row.product.baseUnitName ?? ""}
            </span>
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              STATE_STYLES[row.state] ?? STATE_STYLES.OK
            }`}
          >
            {row.stateLabel}
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs">
          {row.openOrder ? (
            <div className="space-y-0.5">
              <p>
                สั่งไว้แล้ว{" "}
                <strong className="tabular-nums">
                  {row.openOrder.qtyOutstanding} {row.product.baseUnitName ?? ""}
                </strong>{" "}
                จาก {row.openOrder.supplierName}
              </p>
              <p className="text-muted-foreground">
                {row.openOrder.poNumber}
                {row.openOrder.orderCount > 1 &&
                  ` และอีก ${row.openOrder.orderCount - 1} ใบ`}
                {" · "}
                {row.openOrder.expectedDeliveryLabel
                  ? `นัดส่ง ${row.openOrder.expectedDeliveryLabel}`
                  : // Expected dates are optional on a PO (Consequence 7): a shop
                    // that never fills them in gets the two-state list, and saying
                    // so beats leaving ตามของ mysteriously unreachable.
                    "ไม่ได้ระบุวันนัดส่ง — ระบบจึงบอกไม่ได้ว่าของเลยกำหนดหรือยัง"}
              </p>
              <a
                href={`/purchase-orders/${row.openOrder.purchaseOrderId}`}
                className="inline-block text-primary hover:underline"
              >
                ดูใบสั่งซื้อ
              </a>
            </div>
          ) : (
            <p className="text-muted-foreground">ยังไม่มีใบสั่งซื้อที่ค้างอยู่</p>
          )}

          <p className="text-muted-foreground">
            {row.lastCountedAt
              ? `ยอดนี้ยืนยันครั้งล่าสุดจากการนับเมื่อ ${row.freshnessLabel.replace("นับล่าสุด ", "")}`
              : "ยอดนี้ยังไม่เคยถูกยืนยันด้วยการนับจริง"}{" "}
            — ระหว่างรอบนับ ระบบยังไม่หักของที่ขายออกไป ตัวเลขจึงมีแนวโน้มสูงกว่าของจริง
          </p>

          <a
            href={`/stock-counts/new?branch=${branchId}`}
            className="inline-block text-primary hover:underline"
          >
            เปิดใบนับสต๊อกสาขานี้
          </a>
        </div>
      )}
    </li>
  );
}

export default function BelowParList({
  rows,
  branchId,
  parCount,
}: {
  rows: ParLevelRowView[];
  branchId: string;
  /** How many pars exist at this branch AT ALL — see the empty states below. */
  parCount: number;
}) {
  // Three states, not two. Rendering nothing when the list is empty would hide
  // the feature from the shop that has never used it (Consequence 4) AND deny
  // the shop that is doing fine the one useful thing an empty list can say.
  if (parCount === 0) {
    return (
      <section className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        ยังไม่ได้ตั้ง <strong>ขั้นต่ำที่ควรมี</strong> ให้วัตถุดิบไหนเลย —
        ตั้งได้ที่หน้าวัตถุดิบแต่ละตัว แล้วหน้านี้จะเตือนให้เองเมื่อของเหลือน้อยกว่าที่ตั้งไว้
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-lg border border-good-border bg-good-bg p-4 text-sm text-good">
        ของทุกตัวที่ตั้งขั้นต่ำไว้ ({parCount} รายการ) ยังอยู่เหนือขั้นต่ำ
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">ของใกล้หมด ({rows.length})</h3>
        <p className="text-xs text-muted-foreground">
          เทียบกับของที่อยู่ในร้านจริง ไม่หักของที่สั่งไว้แล้ว
        </p>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <Card key={row.id} row={row} branchId={branchId} />
        ))}
      </ul>
    </section>
  );
}

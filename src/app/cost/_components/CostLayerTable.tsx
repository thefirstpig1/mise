"use client";

// Sprint 2 Part 14 L5b — the layer stack behind one product's cost.
//
// This table is the answer to "why is the cost that number?", and it is the only
// place a user can FIND the rows the system priced by guesswork — without it,
// "correct it when you find the invoice" is a promise the UI cannot keep
// (ADR 0014 Q11, UX guardrail 3).
//
// A layer sourced from an ADJUSTMENT can be priced by a human; one sourced from a
// receipt cannot, because that price belongs to its document and ADR 0013 Q6
// already decided a receipt is voided rather than edited.

import { useState } from "react";
import { getCostDeclarationsAction } from "../actions";
import { formatMoney, formatQty } from "./cost-view";
import type { CostDeclarationView, CostLayerView } from "./cost-view";
import DeclareCostForm, { type DeclareUnitOption } from "./DeclareCostForm";

const PRICING_LABEL: Record<string, string> = {
  DOCUMENT: "จากใบรับของ",
  DECLARED: "ระบุเอง",
  LAST_KNOWN: "ระบบเดาต้นทุนให้",
  UNPRICED: "ยังไม่ทราบต้นทุน",
};

const PRICING_CLASS: Record<string, string> = {
  DOCUMENT: "bg-good-bg text-good border-good-border",
  DECLARED: "bg-muted text-muted-foreground border-border-strong",
  LAST_KNOWN: "bg-warn-bg text-warn border-warn-border",
  UNPRICED: "bg-bad-bg text-bad border-bad-border",
};

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-3 py-2 text-sm";
const tdNum = `${td} text-right tabular-nums`;

export default function CostLayerTable({
  layers,
  units,
  baseUnitName,
}: {
  layers: CostLayerView[];
  units: DeclareUnitOption[];
  baseUnitName: string;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, CostDeclarationView[]>>({});

  const open = async (movementId: string) => {
    if (openFor === movementId) {
      setOpenFor(null);
      return;
    }
    setOpenFor(movementId);
    if (!history[movementId]) {
      const res = await getCostDeclarationsAction(movementId);
      if (res.ok) setHistory((h) => ({ ...h, [movementId]: res.data }));
    }
  };

  if (layers.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
        ไม่มีของคงเหลือในสาขานี้ — ต้นทุนที่แสดงด้านบนมาจากราคาซื้อครั้งล่าสุด
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[40rem]">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th className={th}>เข้าเมื่อ</th>
            <th className={`${th} text-right`}>คงเหลือในล็อต</th>
            <th className={`${th} text-right`}>ต้นทุน/{baseUnitName || "หน่วย"}</th>
            <th className={`${th} text-right`}>มูลค่า</th>
            <th className={th}>ที่มาของราคา</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {layers.map((l) => {
            const negative = Number(l.qty) < 0;
            const declarable = l.sourceType === "ADJUSTMENT";
            const isOpen = openFor === l.movementId;

            return (
              <tr key={l.movementId} className="align-top">
                <td colSpan={5} className="p-0">
                  <div
                    className={`grid grid-cols-[1fr_auto_auto_auto_auto] items-center ${negative ? "bg-bad-bg/50" : ""}`}
                  >
                    <div className={td}>
                      {l.occurredAtLabel}
                      {negative && (
                        <span className="ml-2 text-xs font-medium text-bad">
                          ติดลบ — ใช้ของที่ยังไม่ได้บันทึกรับ
                        </span>
                      )}
                    </div>
                    <div className={tdNum}>{formatQty(l.qty)}</div>
                    <div className={tdNum}>{formatMoney(l.unitCost)}</div>
                    <div className={tdNum}>{formatMoney(l.value)}</div>
                    <div className={td}>
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs ${PRICING_CLASS[l.pricing] ?? ""}`}
                      >
                        {PRICING_LABEL[l.pricing] ?? l.pricing}
                      </span>
                      {declarable && (
                        <button
                          type="button"
                          onClick={() => open(l.movementId)}
                          className="ml-2 text-xs text-primary hover:underline"
                        >
                          {isOpen ? "ปิด" : "ระบุต้นทุน"}
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-border px-3 py-3">
                      <DeclareCostForm
                        movementId={l.movementId}
                        units={units}
                        history={history[l.movementId] ?? []}
                        currentLabel={`${formatMoney(l.unitCost)} ฿ / ${baseUnitName || "หน่วย"} (${PRICING_LABEL[l.pricing] ?? l.pricing})`}
                        onDone={() => setOpenFor(null)}
                      />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

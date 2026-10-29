"use client";

// Rule PG4 — the price list on an OPENING count's close sheet (Kong 2026-10-30
// chose A, proposal Xp9sMJsQhHzYrNrx9Auq9z). The first count of a branch is
// the stock it starts from, so each line that enters stock needs a price or the
// shelf is worth ฿0 and gross profit stays "—" (rule PG1). Counters never see
// this: it appears only on the close sheet, only for someone with cost:view.
//
// Prices arrive filled in by the server (the cost the ledger already holds,
// else the price set on a supplier); the person closing corrects or fills in
// the rest. A missing price warns and never blocks.

import { useEffect, useMemo, useState } from "react";
import { readApi } from "@/lib/read-api";
import type { OpeningPriceLine } from "@/server/stock-count";
import { formatMoney, formatQty } from "./stock-count-view";

export type OpeningPrice = { productId: string; unitId: string; unitCost: string };

const SOURCE_LABEL: Record<NonNullable<OpeningPriceLine["source"]>, string> = {
  LEDGER: "ต้นทุนในระบบ",
  SUPPLIER: "ราคาจากผู้ขาย",
};

const priced = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;

export default function OpeningPrices({ countId, onChange }: { countId: string; onChange: (prices: OpeningPrice[]) => void }) {
  const [lines, setLines] = useState<OpeningPriceLine[] | null | "error">(null);
  const [typed, setTyped] = useState<Record<string, { unitId: string; unitCost: string }>>({});

  useEffect(() => {
    let on = true;
    void readApi<{ ok: true; lines: OpeningPriceLine[] | null }>("/api/stock-counts", "opening", countId).then((r) => {
      if (!on) return;
      if (!r.ok) return setLines("error");
      const got = r.lines ?? [];
      setLines(got);
      setTyped(Object.fromEntries(got.map((l) => [l.productId, { unitId: l.unitId ?? l.units[0]?.id ?? "", unitCost: l.unitCost ?? "" }])));
    });
    return () => {
      on = false;
    };
  }, [countId]);

  const list = Array.isArray(lines) ? lines : [];
  const ratioOf = (line: OpeningPriceLine, unitId: string) => Number(line.units.find((u) => u.id === unitId)?.toBaseRatio ?? 1) || 1;
  const missing = list.filter((l) => !priced(typed[l.productId]?.unitCost ?? ""));
  const value = useMemo(
    () =>
      list.reduce((s, l) => {
        const t = typed[l.productId];
        return t && priced(t.unitCost) ? s + (Number(l.qty) / ratioOf(l, t.unitId)) * Number(t.unitCost) : s;
      }, 0),
    [list, typed]
  );

  useEffect(() => {
    onChange(
      list
        .map((l) => ({ productId: l.productId, ...typed[l.productId] }))
        .filter((p): p is OpeningPrice => !!p.unitId && priced(p.unitCost ?? ""))
    );
    // `list` is derived from `lines`; listing it would refire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, typed, onChange]);

  if (lines === null) return <p className="text-sm text-muted-foreground">กำลังเตรียมราคา…</p>;
  if (lines === "error") return <p className="text-sm text-bad">โหลดราคาไม่ได้ — ปิดใบได้ แต่รายการที่ยังไม่มีราคาจะต้องใส่ภายหลังที่หน้าต้นทุน</p>;
  if (list.length === 0) return null;

  return (
    <section className="space-y-2" aria-label="ราคาของยอดยกมา">
      <p className="text-sm text-muted-foreground">ราคาต่อหน่วย · ระบบเติมให้เท่าที่รู้ แก้ได้</p>
      <ul className="max-h-[38vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {list.map((l) => {
          const t = typed[l.productId] ?? { unitId: "", unitCost: "" };
          const set = (patch: Partial<typeof t>) => setTyped((m) => ({ ...m, [l.productId]: { ...t, ...patch } }));
          const has = priced(t.unitCost);
          const edited = has && (t.unitCost !== (l.unitCost ?? "") || t.unitId !== (l.unitId ?? ""));
          return (
            <li key={l.productId} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{l.productName}</p>
                <p className="text-xs text-muted-foreground">
                  นับได้ {formatQty(l.qty)} {l.baseUnitName ?? ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">฿</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={t.unitCost}
                    onChange={(e) => set({ unitCost: e.target.value })}
                    placeholder="ใส่ราคา"
                    aria-label={`ราคา ${l.productName}`}
                    className={`input h-9 w-24 text-right tabular-nums ${has ? "" : "border-dashed"}`}
                  />
                  {l.units.length > 1 ? (
                    <select value={t.unitId} onChange={(e) => set({ unitId: e.target.value })} aria-label={`หน่วยของราคา ${l.productName}`} className="input h-9 w-auto pr-7 text-sm">
                      {l.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          /{u.unitName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sm text-muted-foreground">/{l.units[0]?.unitName ?? l.baseUnitName}</span>
                  )}
                </div>
                <span className={`text-[11px] ${has ? "text-muted-subtle" : "text-warn"}`}>
                  {!has ? "ยังไม่มีราคา" : edited || !l.source ? "ใส่เอง" : SOURCE_LABEL[l.source]}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">มูลค่าสต๊อกตั้งต้น</span>
        <span className="font-display font-semibold tabular-nums">
          {missing.length === list.length ? "—" : `${missing.length > 0 ? "อย่างน้อย " : ""}฿${formatMoney(String(value))}`}
        </span>
      </p>
      {missing.length > 0 && (
        <p className="rounded-xl border border-warn-border bg-warn-bg p-2.5 text-sm text-warn">
          ยังไม่มีราคา {missing.length} รายการ — ปิดใบได้ แต่กำไรขั้นต้นจะขึ้น “—” จนกว่าจะใส่ราคาที่หน้าต้นทุน
        </p>
      )}
    </section>
  );
}

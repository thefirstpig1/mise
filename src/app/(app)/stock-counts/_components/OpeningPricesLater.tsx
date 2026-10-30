"use client";

// Rule PG6 — opening stock still unpriced takes its first receipt's price, when
// the shop says so (Kong 2026-10-30, "อนุมัติการเพิ่มกฎคำนวณ"). Shown on a
// CLOSED opening count, only to someone with cost:view, only while some line
// has no price. Each line offers what its first receipt after the count paid —
// VAT included when the shop cannot reclaim it, the same figure the ledger puts
// on that receipt — and the shop confirms one line or all of them, changing the
// figure if it knows better. Nothing is priced without that press.

import { useEffect, useState } from "react";
import { readApi } from "@/lib/read-api";
import { orStale } from "@/lib/stale-tab";
import type { UnpricedOpeningLine } from "@/server/stock-count";
import { declareOpeningPricesAction } from "../actions";
import { formatMoney, formatQty } from "./stock-count-view";

const priced = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
const day = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });

export default function OpeningPricesLater({ countId }: { countId: string }) {
  const [lines, setLines] = useState<UnpricedOpeningLine[] | null | "error">(null);
  const [typed, setTyped] = useState<Record<string, { unitId: string; unitCost: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);

  useEffect(() => {
    let on = true;
    void readApi<{ ok: true; lines: UnpricedOpeningLine[] | null }>("/api/stock-counts", "unpriced", countId).then((r) => {
      if (!on) return;
      if (!r.ok) return setLines("error");
      const got = r.lines ?? [];
      setLines(got);
      setTyped(
        Object.fromEntries(
          got.map((l) => [l.movementId, { unitId: l.suggestion?.unitId ?? l.units.find((u) => u.unitName === l.baseUnitName)?.id ?? l.units[0]?.id ?? "", unitCost: l.suggestion?.unitCost ?? "" }])
        )
      );
    });
    return () => {
      on = false;
    };
  }, [countId]);

  if (lines === null || lines === "error") return null;
  if (lines.length === 0 && done === 0) return null;

  const noteOf = (l: UnpricedOpeningLine) => {
    const t = typed[l.movementId];
    const s = l.suggestion;
    const asSuggested = s && t && t.unitId === s.unitId && Number(t.unitCost) === Number(s.unitCost);
    return asSuggested ? `ยอดยกมา · ราคารับของครั้งแรก ${s.grNumber}` : "ยอดยกมา · ใส่ราคาภายหลัง";
  };

  const confirm = async (which: UnpricedOpeningLine[], key: string) => {
    const ready = which.filter((l) => priced(typed[l.movementId]?.unitCost ?? "") && typed[l.movementId]?.unitId);
    if (ready.length === 0) return;
    setBusy(key);
    setError(null);
    const res = await orStale(
      declareOpeningPricesAction({
        countId,
        lines: ready.map((l) => ({ movementId: l.movementId, unitId: typed[l.movementId].unitId, unitCost: Number(typed[l.movementId].unitCost), note: noteOf(l) })),
      })
    );
    setBusy(null);
    if (!res.ok) return setError(res.error);
    const gone = new Set(ready.map((l) => l.movementId));
    setLines((all) => (Array.isArray(all) ? all.filter((l) => !gone.has(l.movementId)) : all));
    setDone((n) => n + res.declared);
  };

  const suggested = lines.filter((l) => l.suggestion !== null && priced(typed[l.movementId]?.unitCost ?? ""));

  return (
    <section
      className={`space-y-3 rounded-2xl border p-4 ${lines.length > 0 ? "border-warn-border bg-warn-bg/40" : "border-good-border bg-good-bg"}`}
      aria-label="ราคาสต๊อกยกมาที่ยังไม่มี"
    >
      {lines.length > 0 ? (
        <>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">ราคาสต๊อกยกมาที่ยังไม่มี · {lines.length.toLocaleString("th-TH")} รายการ</h3>
            <p className="text-sm text-muted-foreground">
              ตอนปิดใบนับยังไม่ได้ใส่ราคา ของเหล่านี้จึงยังคิดต้นทุนไม่ได้ เมื่อรับของครั้งแรกหลังวันนับ ระบบเสนอราคาจากใบรับของนั้นให้ แก้ได้ แล้วกดยืนยันทีละรายการหรือทั้งหมด
            </p>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {lines.map((l) => {
              const t = typed[l.movementId] ?? { unitId: "", unitCost: "" };
              const set = (patch: Partial<typeof t>) => setTyped((m) => ({ ...m, [l.movementId]: { ...t, ...patch } }));
              const s = l.suggestion;
              return (
                <li key={l.movementId} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{l.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      ยอดยกมา {formatQty(l.qty)} {l.baseUnitName}
                    </p>
                    <p className={`text-xs ${s ? "text-muted-foreground" : "text-warn"}`}>
                      {s ? `รับของครั้งแรก ${day(s.receivedAt)} · ${s.supplierName} · ${s.grNumber} · ฿${formatMoney(s.unitCost)}/${s.unitName}` : "ยังไม่ได้รับของหลังวันนับ — ใส่ราคาเองได้"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
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
                      className={`input h-9 w-24 text-right tabular-nums ${priced(t.unitCost) ? "" : "border-dashed"}`}
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
                    <button
                      type="button"
                      onClick={() => void confirm([l], l.movementId)}
                      disabled={busy !== null || !priced(t.unitCost)}
                      className="btn-secondary btn-sm disabled:opacity-50"
                    >
                      {busy === l.movementId ? "กำลังบันทึก…" : "ยืนยัน"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-[560px] text-xs text-muted-foreground">
              ถ้าราคาช่วงที่นับกับตอนซื้อครั้งแรกต่างกันมาก ต้นทุนและกำไรของเดือนแรกจะคลาดตาม · แก้ราคาได้ภายหลังที่หน้าต้นทุน
            </p>
            {suggested.length > 0 && (
              <button type="button" onClick={() => void confirm(suggested, "all")} disabled={busy !== null} className="btn btn-sm disabled:opacity-50">
                {busy === "all" ? "กำลังบันทึก…" : `ยืนยันราคาที่เสนอทั้งหมด ${suggested.length.toLocaleString("th-TH")} รายการ`}
              </button>
            )}
          </div>
        </>
      ) : null}
      {done > 0 && (
        <p className="text-sm text-good">
          บันทึกราคาสต๊อกยกมาแล้ว {done.toLocaleString("th-TH")} รายการ · ต้นทุนทุกหน้าคิดใหม่ตามราคานี้ทันที
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}

"use client";

// ============================================================
// Mise — cutting a round (Part 38, ADR 0036 Q4/Q12)
// ============================================================
// One row per waiting line: supplier (every supplier's latest price per base
// unit beside it, cheapest marked), quantity, unit, unit price — prefilled from
// the chosen supplier's latest price and always editable. The kitchen's note
// sits on the row; moving the line to another supplier asks for an answer to it
// first (Q4). "ไม่สั่ง" needs a reason and leaves the line visible to the kitchen.
//
// The result is DRAFT orders, one per supplier; they can be opened and checked
// one by one, or all sent at once.
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import type { CutSheet as Sheet, CutSheetLine } from "@/server/purchase-request";
import { cutRoundAction, rejectRequestLineAction, type CutActionState } from "../actions";
import { sendPurchaseOrderAction } from "@/app/(app)/purchase-orders/actions";

type Row = { include: boolean; supplierId: string; qty: string; unitId: string; unitPrice: string; reply: string };

const thaiDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const baht = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;

function priceFor(line: CutSheetLine, supplierId: string, unitId: string): string {
  const p = line.prices.find((x) => x.supplierId === supplierId);
  const u = line.units.find((x) => x.id === unitId);
  return p && u ? String(round4(p.pricePerBase * u.toBase)) : "";
}

export default function CutSheet({ sheet, branchId }: { sheet: Sheet; branchId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      sheet.lines.map((l) => {
        const supplierId = l.supplierId ?? "";
        return [l.id, { include: true, supplierId, qty: String(l.qty), unitId: l.unitId, unitPrice: priceFor(l, supplierId, l.unitId), reply: "" }];
      })
    )
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; lineId?: string } | null>(null);
  const [result, setResult] = useState<Extract<CutActionState, { ok: true }>["orders"] | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});

  const patch = (id: string, next: Partial<Row>) => setRows((rs) => ({ ...rs, [id]: { ...rs[id], ...next } }));
  const chosen = sheet.lines.filter((l) => rows[l.id]?.include);
  const needsReply = (l: CutSheetLine) => Boolean(l.note && l.supplierId && rows[l.id].supplierId !== l.supplierId);
  const blocked = chosen.some((l) => !rows[l.id].supplierId || !rows[l.id].unitPrice || (needsReply(l) && !rows[l.id].reply.trim()));

  const bySupplier = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of chosen) m.set(rows[l.id].supplierId, (m.get(rows[l.id].supplierId) ?? 0) + 1);
    return m;
  }, [chosen, rows]);

  const cut = async () => {
    setBusy(true);
    setError(null);
    const r = await orStale(
      cutRoundAction({
        branchId,
        picks: chosen.map((l) => ({
          lineId: l.id,
          supplierId: rows[l.id].supplierId,
          qty: rows[l.id].qty,
          unitId: rows[l.id].unitId,
          unitPrice: rows[l.id].unitPrice,
          reply: rows[l.id].reply,
        })),
      })
    );
    setBusy(false);
    if (r.ok) setResult(r.orders);
    else setError({ text: r.formError, lineId: "lineId" in r ? r.lineId : undefined });
  };

  const reject = async (l: CutSheetLine) => {
    const reason = window.prompt(`ไม่สั่ง “${l.product.name}” เพราะอะไร (ครัวจะเห็นเหตุผลนี้)`, "");
    if (!reason?.trim()) return;
    const r = await orStale(rejectRequestLineAction({ lineId: l.id, reason }));
    if (!r.ok) setError({ text: r.formError, lineId: l.id });
    else router.refresh();
  };

  const sendAll = async () => {
    if (!result || !window.confirm(`ส่งใบสั่งซื้อทั้ง ${result.length} ใบ? ส่งแล้วแก้ไม่ได้`)) return;
    setBusy(true);
    for (const o of result) {
      if (sent[o.id]) continue;
      const r = await orStale(sendPurchaseOrderAction(o.id));
      setSent((s) => ({ ...s, [o.id]: r.ok ? "ส่งแล้ว" : ("formError" in r && r.formError) || "ส่งไม่สำเร็จ" }));
    }
    setBusy(false);
    router.refresh();
  };

  if (result) {
    return (
      <section className="space-y-4 rounded-xl border border-good-border bg-good-bg/40 p-5">
        <h2 className="text-lg font-semibold">สร้างใบสั่งซื้อร่างแล้ว {result.length} ใบ</h2>
        <p className="text-sm text-muted-foreground">
          ตรวจ VAT ยอดขั้นต่ำ และหมายเหตุถึงผู้ขายได้ในแต่ละใบ แล้วส่งทีละใบ หรือส่งทั้งหมดทีเดียว · ครัวเห็นรายการของตัวเองเป็น “จัดซื้อกำลังเตรียมสั่ง”
        </p>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {result.map((o) => (
            <li key={o.id} className="group relative flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50">
              <Link href={`/purchase-orders/${o.id}` as Route} className="font-medium after:absolute after:inset-0 after:content-['']">
                {o.poNumber} · {o.supplierName}
              </Link>
              <span className="text-muted-foreground">
                {o.lines} รายการ{sent[o.id] ? ` · ${sent[o.id]}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex gap-3">
          <button type="button" className="btn" disabled={busy} onClick={sendAll}>
            {busy ? "กำลังส่ง…" : "ส่งทั้งหมด"}
          </button>
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => router.refresh()}>
            ตัดรอบต่อ
          </button>
        </div>
      </section>
    );
  }

  const r = sheet.readiness;
  return (
    <div className="space-y-4">
      <section className={`rounded-xl border p-4 text-sm ${r.allReady ? "border-good-border bg-good-bg" : "border-warn-border bg-warn-bg"}`}>
        <p className="font-medium">{r.allReady ? "ทุกแผนกพร้อมแล้ว" : "ยังมีแผนกที่ไม่พร้อม — ตัดรอบก่อนได้ แต่ของที่เพิ่มทีหลังจะไปรอบถัดไป"}</p>
        <p className="mt-1 text-xs">
          {r.departments.map((d) => `${d.name}: ${d.ready ? `พร้อม (${d.ready.by})` : `ยังไม่พร้อม · ${d.waitingLines} รายการ`}`).join(" · ")}
        </p>
      </section>

      {sheet.lines.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
          ไม่มีรายการรอสั่ง
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunk text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2">วัตถุดิบ · ครัวขอ</th>
                <th className="px-3 py-2">ผู้ขาย</th>
                <th className="px-3 py-2">จำนวน · หน่วย</th>
                <th className="px-3 py-2">ราคา/หน่วย (ไม่รวม VAT)</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {sheet.lines.map((l) => {
                const row = rows[l.id];
                const cheapest = [...l.prices].sort((a, b) => a.pricePerBase - b.pricePerBase)[0];
                const reqUnit = l.units.find((u) => u.id === l.unitId)?.name ?? "";
                const hl = error?.lineId === l.id;
                return (
                  <tr key={l.id} className={`${row.include ? "" : "opacity-50"} ${hl ? "bg-bad-bg" : ""}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={row.include} onChange={(e) => patch(l.id, { include: e.target.checked })} aria-label="สั่งรายการนี้" />
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{l.product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.department.name} · {l.requestedBy} · ขอ {l.qty} {reqUnit}
                        {l.onHandQty !== null ? ` · เหลือจริง ${l.onHandQty}` : ""}
                      </p>
                      {l.note && <p className="mt-1 text-xs">📝 ครัว: {l.note}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={row.supplierId}
                        onChange={(e) => patch(l.id, { supplierId: e.target.value, unitPrice: priceFor(l, e.target.value, row.unitId) || row.unitPrice })}
                        className={`input w-56 ${!row.supplierId && row.include ? "border-bad" : ""}`}
                      >
                        <option value="">— เลือกผู้ขาย —</option>
                        {sheet.suppliers.map((s) => {
                          const p = l.prices.find((x) => x.supplierId === s.id);
                          return (
                            <option key={s.id} value={s.id}>
                              {s.name}
                              {p ? ` · ${baht(p.pricePerBase)}/${l.units[0]?.name ?? "หน่วย"} (${thaiDate(p.asOf)})${p === cheapest && l.prices.length > 1 ? " ★ถูกสุด" : ""}` : ""}
                              {s.id === l.supplierId ? " · ครัวเลือก" : ""}
                            </option>
                          );
                        })}
                      </select>
                      {needsReply(l) && (
                        <input
                          value={row.reply}
                          onChange={(e) => patch(l.id, { reply: e.target.value })}
                          placeholder="ตอบหมายเหตุของครัวก่อนเปลี่ยนผู้ขาย"
                          className={`input mt-2 w-56 ${!row.reply.trim() ? "border-warn" : ""}`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <input type="number" min="0" step="0.001" value={row.qty} onChange={(e) => patch(l.id, { qty: e.target.value })} className="input w-24" />
                        <select
                          value={row.unitId}
                          onChange={(e) => patch(l.id, { unitId: e.target.value, unitPrice: priceFor(l, row.supplierId, e.target.value) || row.unitPrice })}
                          className="input w-28"
                        >
                          {l.units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <input type="number" min="0" step="0.0001" value={row.unitPrice} onChange={(e) => patch(l.id, { unitPrice: e.target.value })} className="input w-28" />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" onClick={() => reject(l)} className="whitespace-nowrap text-xs text-bad hover:underline">
                        ไม่สั่ง
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">
          {error.text}
        </p>
      )}

      {sheet.lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn" disabled={busy || chosen.length === 0 || blocked} onClick={cut}>
            {busy ? "กำลังสร้าง…" : `สร้างใบสั่งซื้อร่าง ${bySupplier.size} ใบ (${chosen.length} รายการ)`}
          </button>
          {blocked && <span className="text-xs text-warn">ยังมีรายการที่ไม่ได้เลือกผู้ขาย ไม่มีราคา หรือยังไม่ได้ตอบหมายเหตุของครัว</span>}
        </div>
      )}
    </div>
  );
}

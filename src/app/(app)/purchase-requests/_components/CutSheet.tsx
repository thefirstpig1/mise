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
//
// Review 2026-10-27 (mockup 5sMMvLFbYSjsXDVpZirBXM): the supplier is a search
// box whose list puts "เคยซื้อของนี้" (with the latest price) above every other
// supplier, readiness reads as two clearly different states, and "ไม่สั่ง" /
// "ส่งทั้งหมด" ask in the app's own dialogs instead of prompt() / confirm().
// ============================================================

import { useMemo, useState } from "react";
import QtyStepper from "@/components/ui/QtyStepper";
import SelectChip from "@/components/ui/SelectChip";
import { MoneyInput } from "@/components/ui/NumberField";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import ProductPicker from "@/components/ui/ProductPicker";
import { ConfirmDialog } from "@/app/(app)/menus/_components/sheet-parts";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
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
  const [rejecting, setRejecting] = useState<CutSheetLine | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);

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

  const reject = async (l: CutSheetLine, reason: string) => {
    if (!reason.trim()) return;
    setRejecting(null);
    setRejectReason("");
    const r = await orStale(rejectRequestLineAction({ lineId: l.id, reason }));
    if (!r.ok) setError({ text: r.formError, lineId: l.id });
    else router.refresh();
  };

  const sendAll = async () => {
    if (!result) return;
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
          <button type="button" className="btn" disabled={busy} onClick={() => setConfirmSend(true)}>
            {busy ? "กำลังส่ง…" : "ส่งทั้งหมด"}
          </button>
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => router.refresh()}>
            ตัดรอบต่อ
          </button>
        </div>
        {confirmSend && (
          <ConfirmDialog
            spec={{
              title: `ส่งใบสั่งซื้อทั้ง ${result.length} ใบ?`,
              lines: result.map((o) => `${o.poNumber} · ${o.supplierName} · ${o.lines} รายการ`),
              money: null,
              who: "ส่งแล้วแก้ใบไม่ได้ ถ้าต้องเปลี่ยนต้องยกเลิกแล้วออกใบใหม่",
              go: "ส่งทั้งหมด",
              back: "ยังไม่ส่ง",
              onGo: () => void sendAll(),
            }}
            onClose={() => setConfirmSend(false)}
          />
        )}
      </section>
    );
  }

  const r = sheet.readiness;
  return (
    <div className="space-y-4">
      <section className={`rounded-xl border p-4 text-sm ${r.allReady ? "border-good-border bg-good-bg" : "border-warn-border bg-warn-bg"}`}>
        <p className="font-medium">{r.allReady ? "ทุกแผนกพร้อมแล้ว" : "ยังมีแผนกที่ไม่พร้อม — ตัดรอบก่อนได้ แต่ของที่เพิ่มทีหลังจะไปรอบถัดไป"}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {r.departments.map((d) => (
            <span
              key={d.id}
              className={
                d.ready
                  ? "rounded-full border border-good-border bg-good-bg px-2.5 py-0.5 text-good"
                  : "rounded-full border-[1.5px] border-dashed border-border-strong bg-surface px-2.5 py-0.5 text-muted-foreground"
              }
            >
              {d.ready ? `✓ ${d.name} · พร้อมแล้ว (${d.ready.by})` : `${d.name} · ยังไม่พร้อม · ${d.waitingLines} รายการ`}
            </span>
          ))}
        </div>
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
                      <div className="w-64">
                        <ProductPicker
                          products={sheet.suppliers.map((sp) => {
                            const p = l.prices.find((x) => x.supplierId === sp.id);
                            return {
                              id: sp.id,
                              name: sp.name,
                              sku: "",
                              imageUrl: null,
                              section: p ? "เคยซื้อของนี้" : "ผู้ขายอื่น",
                              group: null,
                              baseUnitName: null,
                              detail: [
                                p
                                  ? `${baht(p.pricePerBase)}/${l.units[0]?.name ?? "หน่วย"} · ${thaiDate(p.asOf)}${p === cheapest && l.prices.length > 1 ? " · ★ถูกสุด" : ""}`
                                  : "ยังไม่เคยซื้อของนี้",
                                sp.id === l.supplierId ? "ครัวเลือก" : null,
                              ]
                                .filter(Boolean)
                                .join(" · "),
                            };
                          })}
                          value={row.supplierId}
                          onChange={(id) =>
                            patch(l.id, { supplierId: id, unitPrice: id ? priceFor(l, id, row.unitId) || row.unitPrice : row.unitPrice })
                          }
                          thumbs={false}
                          invalid={!row.supplierId && row.include}
                          placeholder="เลือกผู้ขาย — พิมพ์ชื่อเพื่อค้นหา"
                        />
                      </div>
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
                        <QtyStepper value={row.qty} onChange={(qty) => patch(l.id, { qty })} label={`จำนวน ${l.product.name}`} />
                        <SelectChip
                          value={row.unitId}
                          onChange={(v) => patch(l.id, { unitId: v, unitPrice: priceFor(l, row.supplierId, v) || row.unitPrice })}
                          options={l.units.map((u) => ({ value: u.id, label: u.name }))}
                          className="w-36"
                          selectProps={{ "aria-label": `หน่วย ${l.product.name}` }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <MoneyInput value={row.unitPrice} onChange={(e) => patch(l.id, { unitPrice: e.target.value })} aria-label={`ราคาต่อหน่วย ${l.product.name}`} boxClassName="w-32" />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" onClick={() => setRejecting(l)} className="whitespace-nowrap text-xs text-bad hover:underline">
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

      {rejecting && (
        <ModalShell onClose={() => setRejecting(null)} labelledBy="reject-title">
          <h3 id="reject-title" className="pr-10 text-lg font-semibold">
            ไม่สั่ง “{rejecting.product.name}”?
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">ครัวจะเห็นเหตุผลนี้ในใบขอซื้อของแผนก และตอบกลับหรือขอใหม่ได้</p>
          <input
            autoFocus
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="เช่น ยังมีพอถึงสัปดาห์หน้า"
            className="input mt-3 w-full"
          />
          <div className="mt-4 flex gap-3">
            <button type="button" className="btn" disabled={!rejectReason.trim()} onClick={() => reject(rejecting, rejectReason)}>
              ไม่สั่งรายการนี้
            </button>
            <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setRejecting(null)}>
              กลับ
            </button>
          </div>
        </ModalShell>
      )}

      {sheet.lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn" disabled={busy || chosen.length === 0 || blocked} onClick={cut}>
            {busy ? "กำลังสร้าง…" : `สร้างใบสั่งซื้อ ${bySupplier.size} ใบ (แยกตามผู้ขาย · ${chosen.length} รายการ)`}
          </button>
          {blocked && <span className="text-xs text-warn">ยังมีรายการที่ไม่ได้เลือกผู้ขาย ไม่มีราคา หรือยังไม่ได้ตอบหมายเหตุของครัว</span>}
        </div>
      )}
    </div>
  );
}

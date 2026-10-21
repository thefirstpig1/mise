"use client";

// "+ ขอซื้อ" from the products screen (Kong 2026-10-21, suggestion mockup
// point 3): add a product to the branch's purchase request without leaving
// the page, starting from the rule PAR-4 quantity. Posts through the request
// page's own action, so its duplicate guard (ADR 0036 Q3) applies here too.

import { useEffect, useState } from "react";
import { addRequestLineAction } from "@/app/(app)/purchase-requests/actions";
import type { ProductSheetForm } from "@/server/product-list";
import { orStale } from "@/lib/stale-tab";
import QtyStepper from "@/components/ui/QtyStepper";
import { qtyFmt, unitTh } from "@/app/(app)/menus/_components/manager-format";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";

export default function QuickRequest({
  productId,
  productName,
  branchId,
  branchName,
  suggest,
  onHand,
  par,
  baseUnitName,
  onClose,
  onDone,
}: {
  productId: string;
  productName: string;
  branchId: string;
  branchName: string;
  suggest: { qty: number; unitId: string; unitName: string } | null;
  onHand: number;
  par: number | null;
  baseUnitName: string | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  useTopLayer(onClose);
  const [units, setUnits] = useState<ProductSheetForm["units"] | null>(null);
  const [qty, setQty] = useState(suggest ? String(suggest.qty) : "");
  const [unitId, setUnitId] = useState(suggest?.unitId ?? "");
  const [supplier, setSupplier] = useState<"auto" | "">("auto");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    fetch(`/api/products?what=sheet&id=${productId}`, { cache: "no-store" })
      .then((r) => (r.headers.get("content-type")?.includes("json") ? r.json() : null))
      .then((j) => {
        if (!on || !j?.ok) return;
        setUnits(j.form.units);
        if (!unitId) setUnitId(j.form.units.find((u: { isDefaultBuyUnit: boolean }) => u.isDefaultBuyUnit)?.id ?? j.form.units[0]?.id ?? "");
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const send = async (acknowledgeDuplicate = false) => {
    setBusy(true);
    setError(null);
    const res = await orStale(addRequestLineAction({ branchId, productId, qty, unitId, supplierId: supplier, note, acknowledgeDuplicate }));
    setBusy(false);
    if (res.ok) {
      const u = units?.find((x) => x.id === unitId)?.unitName ?? suggest?.unitName ?? "";
      onDone(`ขอซื้อ ${productName} ${qty} ${unitTh(u)} แล้ว · ป้ายเปลี่ยนเป็น “ขอซื้อแล้ว รอสั่ง”`);
      return;
    }
    if ("duplicates" in res && res.duplicates?.length) {
      setDupes(res.duplicates.map((d) => `${d.qty} ${unitTh(d.unitName)} · ${d.departmentName}${d.poNumber ? ` · ${d.poNumber}` : ""}`));
      return;
    }
    setError(res.formError ?? "บันทึกไม่ได้");
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] grid animate-fade-in place-items-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" aria-labelledby="qr-title" className="w-full max-w-sm animate-pop-in space-y-3 rounded-2xl bg-surface p-5 shadow-2xl">
          <div>
            <h3 id="qr-title" className="text-base font-semibold">
              ขอซื้อ {productName}
            </h3>
            <p className="text-xs text-muted-foreground">
              {branchName} · มี {qtyFmt(onHand, baseUnitName)}
              {par !== null ? ` / ขั้นต่ำ ${qtyFmt(par, baseUnitName)}` : ""}
              {suggest ? " · จำนวนแนะนำเติมไว้แล้ว แก้ได้" : ""}
            </p>
          </div>
          <div className="grid gap-1 text-xs text-muted-foreground">
            จำนวน
            <span className="flex flex-wrap items-center gap-2">
              <QtyStepper value={qty} onChange={setQty} label="จำนวน" inputClassName="text-foreground" inputProps={{ autoFocus: true }} />
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="input py-1 text-sm text-foreground" aria-label="หน่วย">
                {(units ?? (suggest ? [{ id: suggest.unitId, unitName: suggest.unitName }] : [])).map((u) => (
                  <option key={u.id} value={u.id}>
                    {unitTh(u.unitName)}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <label className="grid gap-1 text-xs text-muted-foreground">
            ผู้ขาย
            <select value={supplier} onChange={(e) => setSupplier(e.target.value as "auto" | "")} className="input py-1 text-sm text-foreground">
              <option value="auto">ระบบเลือกให้ (ผู้ขายประจำหรือที่ซื้อล่าสุด)</option>
              <option value="">ให้จัดซื้อเลือก</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            หมายเหตุ (ไม่บังคับ)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ใช้หมดเร็วช่วงนี้" className="input py-1 text-sm text-foreground" />
          </label>
          {dupes && (
            <div className="rounded-lg border border-warn-border bg-warn-bg p-2.5 text-xs text-warn">
              มีรายการนี้อยู่แล้ว: {dupes.join(" · ")}
              <button type="button" onClick={() => send(true)} disabled={busy} className="mt-1.5 block rounded-full border border-border-strong bg-surface px-3 py-0.5 text-foreground hover:bg-muted">
                ขอเพิ่มอีกรายการ
              </button>
            </div>
          )}
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-full border border-border-strong px-4 py-1.5 text-sm hover:bg-muted">
              ยกเลิก
            </button>
            <button type="button" onClick={() => send(false)} disabled={busy || !(Number(qty) > 0) || !unitId} className="btn">
              {busy ? "กำลังบันทึก…" : "เพิ่มเข้าใบขอซื้อ"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

"use client";

// ADR 0036 Q8/R7 — the supplier's promised delivery date. The one thing a sent
// order may still change, because it is the supplier's answer, not the order.
// Every promise is kept, so a supplier that keeps slipping shows it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { setDeliveryPromiseAction } from "../actions";

export type PromiseRow = { id: string; promisedDate: string; note: string | null; setAt: string; setBy: string };

const thaiDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const thaiTime = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

export default function DeliveryPromise({
  purchaseOrderId,
  promises,
  canSet,
  open,
}: {
  purchaseOrderId: string;
  promises: PromiseRow[];
  canSet: boolean;
  /** The order is out with the supplier and not fully received. */
  open: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = promises[0];

  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await orStale(setDeliveryPromiseAction({ purchaseOrderId, promisedDate: date, note }));
    setBusy(false);
    if (r.ok) {
      setDate("");
      setNote("");
      router.refresh();
    } else setError(r.formError);
  };

  if (!open && promises.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-4 print:hidden">
      <h3 className="text-sm font-semibold">ผู้ขายนัดส่ง</h3>
      <p className="mt-1 text-lg font-semibold">
        {current ? thaiDate(current.promisedDate) : <span className="text-base font-normal text-muted-foreground">ยังไม่ได้ยืนยันกับผู้ขาย</span>}
      </p>
      {current?.note && <p className="text-sm text-muted-foreground">{current.note}</p>}

      {open && canSet && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            {current ? "ผู้ขายเลื่อน / นัดใหม่" : "ผู้ขายยืนยันว่าจะส่ง"}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input mt-1 block" />
          </label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ เช่น รถเสีย เลื่อน 1 วัน" className="input min-w-[16rem] flex-1" />
          <button type="button" className="btn" disabled={busy || !date} onClick={save}>
            {busy ? "กำลังบันทึก…" : "บันทึกวันนัด"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}

      {promises.length > 1 && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">ประวัติการนัด ({promises.length} ครั้ง)</summary>
          <ul className="mt-2 space-y-1">
            {promises.map((p) => (
              <li key={p.id}>
                {thaiDate(p.promisedDate)} · บันทึกโดย {p.setBy} {thaiTime(p.setAt)}
                {p.note ? ` · ${p.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

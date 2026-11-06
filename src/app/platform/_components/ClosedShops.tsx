"use client";

// ADR 0045 Q10 — ร้านที่ปิดรอลบ. Closed shops let nobody in; each may be
// reopened before its day, and erased for good on or after it — only when the
// operator presses, with the name typed. Nothing erases by itself.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { nameConfirmed } from "@/lib/platform-requests";
import type { ClosedShopRow } from "@/server/platform";
import { purgeShopAction, reopenShopAction } from "../actions";
import { Frame, Toast, fullDate } from "./platform-ui";

export default function ClosedShops({ shops }: { shops: ClosedShopRow[] }) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [purging, setPurging] = useState<ClosedShopRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  if (shops.length === 0) return null;

  const reopen = async (s: ClosedShopRow) => {
    setBusy(s.id);
    const res = await orStale(reopenShopAction({ tenantId: s.id }));
    setBusy(null);
    if (!res.ok) return setToast(res.formError);
    setToast(`เปิดร้าน ${s.name} อีกครั้งแล้ว · คนในร้านเข้าได้ตามเดิม`);
    startRefresh(() => router.refresh());
  };

  return (
    <section className="space-y-2" aria-label="ร้านที่ปิดรอลบ">
      <h2 className="text-base font-semibold">ร้านที่ปิดรอลบ · {shops.length} ร้าน</h2>
      <p className="text-sm text-muted-foreground">คนในร้านเข้าไม่ได้แล้ว · ลบถาวรได้เมื่อถึงวัน และต้องกดเอง ระบบไม่ลบให้อัตโนมัติ</p>
      <ul className="space-y-2">
        {shops.map((s) => (
          <li key={s.id} className="grid gap-3 rounded-[18px] border border-bad-border/60 bg-surface p-4 shadow-card sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <b className="font-display font-semibold">{s.name}</b>
                <span className={`chip ${s.due ? "chip-bad" : "chip-warn"}`}>{s.due ? "ถึงวันลบแล้ว" : `ลบได้ตั้งแต่ ${fullDate(s.purgeAfter)}`}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                ปิดเมื่อ {fullDate(new Date(new Date(s.closedAt).getTime() + 7 * 3_600_000).toISOString().slice(0, 10))} · เจ้าของ {s.owners.join(", ") || "—"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button type="button" className="btn-secondary btn-sm" disabled={busy === s.id} onClick={() => reopen(s)}>
                ยกเลิกการปิด
              </button>
              <button type="button" className="btn-danger btn-sm" disabled={!s.due} title={s.due ? undefined : "ยังไม่ถึงวันลบ"} onClick={() => setPurging(s)}>
                ลบถาวร
              </button>
            </div>
          </li>
        ))}
      </ul>
      {purging && (
        <PurgeDialog
          shop={purging}
          onClose={() => setPurging(null)}
          onDone={(m) => {
            setPurging(null);
            setToast(m);
            startRefresh(() => router.refresh());
          }}
        />
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </section>
  );
}

function PurgeDialog({ shop, onClose, onDone }: { shop: ClosedShopRow; onClose: () => void; onDone: (m: string) => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const purge = async () => {
    setBusy(true);
    setError(null);
    const res = await orStale(purgeShopAction({ tenantId: shop.id, confirmName: typed }));
    setBusy(false);
    if (!res.ok) return setError(res.formError);
    onDone(res.message);
  };
  return (
    <Frame title={`ลบข้อมูลร้าน ${shop.name} ถาวร`} onClose={onClose}>
      <div className="space-y-2 rounded-xl border border-bad-border bg-bad-bg p-3 text-sm">
        <p>
          ลบทุกอย่างของร้านนี้: สาขา สินค้า เอกสาร ยอดขาย สต็อก บิล รูป และบัญชีของคนในร้านที่ไม่ได้อยู่ร้านอื่น · <b className="text-bad">ย้อนกลับไม่ได้</b>
        </p>
        <p>คำขอลบของร้านนี้จะถูกบันทึกว่าทำแล้ว และบันทึกการแก้ไขยังเก็บชื่อร้านไว้เป็นหลักฐาน</p>
      </div>
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">พิมพ์ชื่อร้านเพื่อยืนยัน</span>
        <input className="input w-full" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={shop.name} />
      </label>
      {error && <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          กลับ
        </button>
        <button type="button" className="btn-danger-solid" disabled={busy || !nameConfirmed(typed, shop.name)} onClick={purge}>
          {busy ? "กำลังลบ…" : "ลบถาวร"}
        </button>
      </div>
    </Frame>
  );
}

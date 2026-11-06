"use client";

// ADR 0045 part B — คำขอข้อมูล. Open requests first, by due date; each says
// what to do next (download the shop's file, close the shop, or mark done).

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { orStale } from "@/lib/stale-tab";
import { REQUEST_KINDS, REQUEST_LABEL, requestDue, type RequestKind } from "@/lib/platform-requests";
import type { RequestRow } from "@/server/platform";
import { markRequestDoneAction, recordRequestAction } from "../actions";
import { Frame, Toast, fullDate } from "./platform-ui";

type Shop = { id: string; name: string; owners: string[] };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export default function RequestsView({
  requests,
  shops,
  today,
  preset,
}: {
  requests: RequestRow[];
  shops: Shop[];
  today: string;
  preset: { shopId: string | null; kind: RequestKind | null };
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(preset.shopId !== null || preset.kind !== null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const open = requests.filter((r) => !r.doneAt);
  const done = requests.filter((r) => r.doneAt);

  const mark = async (r: RequestRow, isDone: boolean) => {
    setBusy(r.id);
    const res = await orStale(markRequestDoneAction({ id: r.id, done: isDone }));
    setBusy(null);
    if (!res.ok) return setToast(res.formError);
    setToast(isDone ? "บันทึกว่าทำแล้ว" : "เปิดคำขอนี้อีกครั้งแล้ว");
    startRefresh(() => router.refresh());
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-xs font-semibold tracking-[0.12em] text-gold-ink">หน้าควบคุมระบบ</p>
          <h1 className="page-title">คำขอข้อมูล</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            ร้านขอข้อมูลคืน ขอลบข้อมูล หรือคนขอดู แก้ ลบข้อมูลของตัวเอง · ทุกคำขอต้องทำให้เสร็จภายใน 30 วันนับจากวันที่ขอ · คำขอที่ยังไม่เสร็จขึ้นในกล่องต้องทำพร้อมวันครบกำหนด
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden /> บันทึกคำขอ
        </button>
      </div>

      <section className="space-y-2" aria-label="คำขอที่ยังไม่เสร็จ">
        <h2 className="text-base font-semibold">ยังไม่เสร็จ {open.length > 0 && <span className="text-muted-foreground">· {open.length} เรื่อง</span>}</h2>
        {open.length === 0 ? (
          <p className="rounded-[18px] border border-dashed border-border-strong bg-background px-4 py-5 text-sm text-muted-foreground">
            ไม่มีคำขอค้าง · เมื่อร้านหรือใครขอ ให้กด “บันทึกคำขอ” วันที่ขอจะนับเส้นตาย 30 วันให้เอง
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((r) => {
              const left = daysBetween(today, r.dueOn);
              return (
                <li key={r.id} className="grid gap-3 rounded-[18px] border border-border/70 bg-surface p-4 shadow-card sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <b className="font-display font-semibold">{r.kind === "personal" ? r.requester : (r.shopName ?? "—")}</b>
                      <span className="chip">{REQUEST_LABEL[r.kind].short}</span>
                      <span className={`chip ${left <= 7 ? "chip-bad" : "chip-warn"}`}>
                        {left < 0 ? `เลยกำหนด ${-left} วัน` : left === 0 ? "ครบกำหนดวันนี้" : `เหลือ ${left} วัน`}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ขอเมื่อ {fullDate(r.requestedOn)} · ครบกำหนด {fullDate(r.dueOn)} · ผู้ขอ {r.requester}
                      {r.kind === "delete" && r.shopState === "closed" && r.purgeAfter ? ` · ร้านปิดแล้ว ลบได้ตั้งแต่ ${fullDate(r.purgeAfter)}` : ""}
                    </p>
                    {r.note && <p className="text-sm">{r.note}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {r.kind === "export" && r.shopId && r.shopState !== "gone" && (
                      <a href={`/api/platform/export?id=${r.shopId}`} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                        <Download className="h-4 w-4" aria-hidden /> ดาวน์โหลดข้อมูลร้าน
                      </a>
                    )}
                    {r.kind === "delete" && r.shopState === "open" && r.shopName && (
                      <Link href={`/platform/shops?q=${encodeURIComponent(r.shopName)}` as Route} className="btn-secondary btn-sm">
                        ไปปิดร้าน
                      </Link>
                    )}
                    {r.kind === "delete" ? (
                      <span className="text-xs text-muted-foreground">เสร็จเองเมื่อกดลบถาวร</span>
                    ) : (
                      <button type="button" className="btn btn-sm" disabled={busy === r.id} onClick={() => mark(r, true)}>
                        ทำแล้ว
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="space-y-2" aria-label="คำขอที่ทำแล้ว">
          <h2 className="text-base font-semibold">ทำแล้ว</h2>
          <div className="overflow-x-auto rounded-[18px] border border-border/70 bg-surface shadow-card">
            <table className="data-table w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th>คำขอ</th>
                  <th>ขอเมื่อ</th>
                  <th>ทำเสร็จ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {done.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.kind === "personal" ? r.requester : (r.shopName ?? "—")} <span className="chip ml-1">{REQUEST_LABEL[r.kind].short}</span>
                    </td>
                    <td>{fullDate(r.requestedOn)}</td>
                    <td>
                      {fullDate(r.doneAt!.slice(0, 10))} <span className="text-xs text-muted-subtle">· {r.doneBy}</span>
                    </td>
                    <td className="text-right">
                      {r.kind !== "delete" && (
                        <button type="button" className="link text-xs" disabled={busy === r.id} onClick={() => mark(r, false)}>
                          เปิดอีกครั้ง
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-subtle">คำขอที่ทำแล้วเก็บไว้ 3 ปีเป็นหลักฐาน แล้วลบเอง</p>
        </section>
      )}

      {adding && (
        <AddRequest
          shops={shops}
          today={today}
          preset={preset}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setToast("บันทึกคำขอแล้ว");
            startRefresh(() => router.refresh());
          }}
        />
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function AddRequest({
  shops,
  today,
  preset,
  onClose,
  onSaved,
}: {
  shops: Shop[];
  today: string;
  preset: { shopId: string | null; kind: RequestKind | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<RequestKind>(preset.kind ?? "export");
  const [shopId, setShopId] = useState<string | null>(preset.shopId);
  const [q, setQ] = useState("");
  const [requester, setRequester] = useState(() => shops.find((s) => s.id === preset.shopId)?.owners[0] ?? "");
  const [requestedOn, setRequestedOn] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shop = shops.find((s) => s.id === shopId) ?? null;
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return shops.filter((s) => s.name.toLowerCase().includes(t) || s.owners.some((o) => o.toLowerCase().includes(t))).slice(0, 8);
  }, [q, shops]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await orStale(recordRequestAction({ kind, shopId: kind === "personal" ? null : shopId, requester, requestedOn, note: note.trim() || null }));
    setBusy(false);
    if (!res.ok) return setError(res.formError);
    onSaved();
  };

  return (
    <Frame title="บันทึกคำขอ" onClose={onClose}>
      <div className="space-y-1">
        <p className="text-sm font-semibold">ขออะไร</p>
        <div className="seg flex-wrap" role="group" aria-label="ขออะไร">
          {REQUEST_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`seg-item ${kind === k ? "is-on" : ""}`}>
              {REQUEST_LABEL[k].short}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{REQUEST_LABEL[kind].title}</p>
      </div>

      {kind !== "personal" && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">ร้านไหน</p>
          {shop ? (
            <p className="flex items-center gap-2 text-sm">
              <b>{shop.name}</b>
              <button type="button" className="link text-xs" onClick={() => setShopId(null)}>
                เปลี่ยน
              </button>
            </p>
          ) : (
            <>
              <input className="input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์ชื่อร้านหรืออีเมลเจ้าของ" autoFocus />
              {found.length > 0 && (
                <ul className="max-h-48 overflow-y-auto rounded-xl border border-border/70">
                  {found.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/60"
                        onClick={() => {
                          setShopId(s.id);
                          if (!requester) setRequester(s.owners[0] ?? "");
                        }}
                      >
                        {s.name} <span className="text-xs text-muted-subtle">· {s.owners.join(", ") || "—"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <label className="block space-y-1">
        <span className="block text-sm font-semibold">ใครเป็นคนขอ</span>
        <input className="input w-full" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="อีเมลหรือชื่อ" maxLength={200} />
      </label>
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">ขอเมื่อ</span>
        <input type="date" className="input w-full" value={requestedOn} max={today} onChange={(e) => setRequestedOn(e.target.value)} />
        <span className="block text-xs text-muted-foreground">ครบกำหนด {requestedOn ? fullDate(requestDue(requestedOn)) : "—"} (30 วัน)</span>
      </label>
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">หมายเหตุ (ไม่บังคับ)</span>
        <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ขอทางอีเมล ยืนยันตัวตนแล้ว" maxLength={500} />
      </label>
      {error && <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          กลับ
        </button>
        <button type="button" className="btn" onClick={save} disabled={busy}>
          {busy ? "กำลังบันทึก…" : "บันทึกคำขอ"}
        </button>
      </div>
    </Frame>
  );
}

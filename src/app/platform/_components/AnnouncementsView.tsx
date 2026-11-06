"use client";

// ADR 0045 part B — set, preview and stop an announcement. The preview is the
// shop's own strip (AnnouncementBar), so what Kong sees is what shops will see.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plus } from "lucide-react";
import { orStale } from "@/lib/stale-tab";
import type { AnnouncementRow } from "@/server/platform";
import AnnouncementBar from "@/components/layout/AnnouncementBar";
import { createAnnouncementAction, stopAnnouncementAction } from "../actions";
import { Frame, Toast } from "./platform-ui";

const STATE = { live: { label: "กำลังแสดง", cls: "chip-good" }, upcoming: { label: "ยังไม่ถึงเวลา", cls: "chip-warn" }, ended: { label: "จบแล้ว", cls: "" } } as const;
const when = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** A <input type="datetime-local"> value in Bangkok time, `hours` from now. */
function localIn(hours: number): string {
  const d = new Date(Date.now() + hours * 3_600_000 + 7 * 3_600_000);
  return d.toISOString().slice(0, 16);
}
/** datetime-local (Bangkok) → ISO instant. */
const bangkokToIso = (v: string) => new Date(`${v}:00+07:00`).toISOString();

export default function AnnouncementsView({ items }: { items: AnnouncementRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const stop = async (a: AnnouncementRow) => {
    const res = await orStale(stopAnnouncementAction({ id: a.id }));
    if (!res.ok) return setToast(res.formError);
    setToast("หยุดแสดงแล้ว · ร้านจะไม่เห็นประกาศนี้ภายใน 1 นาที");
    startRefresh(() => router.refresh());
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-xs font-semibold tracking-[0.12em] text-gold-ink">หน้าควบคุมระบบ</p>
          <h1 className="page-title">ประกาศ</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            ขึ้นเป็นแถบบนสุดของทุกหน้า ทุกร้าน ตามช่วงเวลาที่ตั้ง · “แจ้งให้ทราบ” คนอ่านกดปิดได้ · “สำคัญ” อยู่จนหมดเวลา · ก่อนเก็บค่าบริการหรือเปลี่ยนข้อกำหนด ต้องประกาศล่วงหน้า 30 วัน และส่งอีเมลถึงเจ้าของร้านด้วย
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden /> ตั้งประกาศ
        </button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-[18px] border border-dashed border-border-strong bg-background px-4 py-5 text-sm text-muted-foreground">
          ยังไม่เคยตั้งประกาศ · เช่น แจ้งปิดปรับปรุงระบบ หรือฟีเจอร์ใหม่
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className="grid gap-3 rounded-[18px] border border-border/70 bg-surface p-4 shadow-card sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${STATE[a.state].cls}`}>{STATE[a.state].label}</span>
                  <span className="chip">{a.tone === "important" ? "สำคัญ" : "แจ้งให้ทราบ"}</span>
                  <span className="text-xs text-muted-subtle">
                    {when(a.startsAt)} – {when(a.endsAt)}
                    {a.stoppedAt ? ` · หยุดเมื่อ ${when(a.stoppedAt)}` : ""}
                  </span>
                </p>
                <p className="text-sm">{a.message}</p>
              </div>
              {a.state !== "ended" && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => stop(a)}>
                  หยุดแสดง
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddAnnouncement
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setToast("ตั้งประกาศแล้ว · ร้านจะเห็นภายใน 1 นาทีเมื่อถึงเวลา");
            startRefresh(() => router.refresh());
          }}
        />
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function AddAnnouncement({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"info" | "important">("info");
  const [startsAt, setStartsAt] = useState(localIn(0));
  const [endsAt, setEndsAt] = useState(localIn(48));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await orStale(createAnnouncementAction({ message, tone, startsAt: startsAt ? bangkokToIso(startsAt) : "", endsAt: endsAt ? bangkokToIso(endsAt) : "" }));
    setBusy(false);
    if (!res.ok) return setError(res.formError);
    onSaved();
  };

  return (
    <Frame title="ประกาศถึงทุกร้าน" onClose={onClose}>
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">ข้อความ</span>
        <textarea className="input min-h-24 w-full py-2" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} placeholder="เช่น คืนวันศุกร์ เวลา 23:00–23:15 คิดครัวปิดปรับปรุงระบบ ระหว่างนี้บันทึกข้อมูลไม่ได้" />
        <span className="block text-right text-xs text-muted-subtle">{message.length}/300</span>
      </label>
      <div className="space-y-1">
        <p className="text-sm font-semibold">แบบ</p>
        <div className="seg" role="group" aria-label="แบบ">
          <button type="button" className={`seg-item ${tone === "info" ? "is-on" : ""}`} onClick={() => setTone("info")}>
            แจ้งให้ทราบ
          </button>
          <button type="button" className={`seg-item ${tone === "important" ? "is-on" : ""}`} onClick={() => setTone("important")}>
            สำคัญ
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-sm font-semibold">เริ่มแสดง</span>
          <input type="datetime-local" className="input w-full" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-semibold">หยุดแสดง</span>
          <input type="datetime-local" className="input w-full" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
      </div>
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Megaphone className="h-4 w-4 text-primary" aria-hidden /> ตัวอย่างที่ร้านเห็น
        </p>
        <div className="overflow-hidden rounded-xl border border-border/70">
          <AnnouncementBar items={[{ id: "preview", message: message || "ข้อความของประกาศ", tone, endsAt: "" }]} />
        </div>
        <p className="text-xs text-muted-foreground">เวลาเป็นเวลาไทย</p>
      </div>
      {error && <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          กลับ
        </button>
        <button type="button" className="btn" onClick={save} disabled={busy}>
          {busy ? "กำลังบันทึก…" : "ตั้งประกาศ"}
        </button>
      </div>
    </Frame>
  );
}

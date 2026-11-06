"use client";

// ADR 0045 part B — when an owner can no longer reach their address. Changes
// the ACCOUNT, so every shop the person is in moves together; both the old and
// the new address get a letter, and sign-in links already sent stop working.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { changeUserEmailAction } from "../actions";
import { Frame, Toast } from "./platform-ui";

export default function ChangeEmail({ userId, email, shops }: { userId: string; email: string; shops: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await orStale(changeUserEmailAction({ userId, newEmail: next }));
    setBusy(false);
    if (!res.ok) return setError(res.formError);
    setOpen(false);
    setToast(res.emailed > 0 ? `เปลี่ยนอีเมลแล้ว · ส่งอีเมลแจ้ง ${res.emailed} ฉบับ` : "เปลี่ยนอีเมลแล้ว · ยังส่งอีเมลแจ้งไม่ได้ (ยังไม่ได้ตั้งระบบส่งอีเมล)");
    startRefresh(() => router.push(`/platform/users?q=${encodeURIComponent(next.trim().toLowerCase())}`));
  };

  return (
    <>
      <button type="button" className="link text-xs" onClick={() => setOpen(true)}>
        เปลี่ยนอีเมล
      </button>
      {open && (
        <Frame title="เปลี่ยนอีเมลของบัญชี" onClose={() => setOpen(false)}>
          <p className="text-sm">
            บัญชี <b>{email}</b>
            {shops.length > 0 && <span className="text-muted-foreground"> · อยู่ร้าน {shops.join(", ")}</span>}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>ยืนยันตัวตนเจ้าของบัญชีจากช่องทางอื่นก่อน เช่น ข้อมูลร้านและเบอร์โทรที่เคยคุย</li>
            <li>อีเมลใหม่ใช้กับทุกร้านที่บัญชีนี้อยู่ ประวัติและสิทธิ์อยู่ครบ</li>
            <li>ระบบส่งอีเมลแจ้งทั้งอีเมลเก่าและใหม่ และลิงก์เข้าสู่ระบบที่ส่งไปอีเมลเก่าใช้ไม่ได้แล้ว</li>
          </ol>
          <label className="block space-y-1">
            <span className="block text-sm font-semibold">อีเมลใหม่</span>
            <input type="email" className="input w-full" value={next} onChange={(e) => setNext(e.target.value)} placeholder="name@example.com" autoFocus />
          </label>
          {error && <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              กลับ
            </button>
            <button type="button" className="btn" disabled={busy || !next.includes("@")} onClick={save}>
              {busy ? "กำลังเปลี่ยน…" : "เปลี่ยนอีเมล"}
            </button>
          </div>
        </Frame>
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

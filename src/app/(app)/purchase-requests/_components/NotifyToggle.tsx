"use client";

// ADR 0036 Q9 — "ส่งหาทุกคนโดยไม่ต้องตั้งค่า แต่ตั้งได้": on by default, and each
// purchaser turns their own off here, where the e-mail's link lands.

import { useState } from "react";
import { orStale } from "@/lib/stale-tab";
import { setMyPurchaseNotifyAction } from "../actions";

export default function NotifyToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const toggle = async (next: boolean) => {
    setOn(next);
    const r = await orStale(setMyPurchaseNotifyAction({ on: next }));
    if (!r.ok) {
      setOn(!next);
      setNote(r.formError);
    } else setNote(next ? "จะส่งอีเมลแจ้งเมื่อทุกแผนกพร้อม" : "ปิดอีเมลแจ้งเตือนแล้ว");
  };
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
      ส่งอีเมลบอกฉันเมื่อทุกแผนกของสาขากดพร้อมแล้ว
      {note && <span className="text-xs">· {note}</span>}
    </label>
  );
}

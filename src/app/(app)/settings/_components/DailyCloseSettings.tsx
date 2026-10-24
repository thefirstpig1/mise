"use client";

// ตั้งค่าร้าน › รายงานปิดร้าน (ADR 0042): the add-on switch and the shop's own
// list of customer types. Each change saves at once — a separate block from
// the page's big form, so nobody has to remember to press บันทึก below.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { addCustomerTypeAction, removeCustomerTypeAction, setDailyCloseEnabledAction } from "@/app/(app)/closing/actions";

export default function DailyCloseSettings({ enabled, types }: { enabled: boolean; types: { id: string; name: string; used: boolean }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(enabled);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (call: () => Promise<{ ok: boolean; formError?: string }>, after?: () => void) =>
    start(async () => {
      const r = await orStale(call() as Promise<{ ok: boolean; formError?: string }>);
      if (r.ok) {
        setError(null);
        after?.();
        router.refresh();
      } else setError(r.formError ?? "บันทึกไม่สำเร็จ");
    });

  return (
    <div id="daily-close" className="mt-6 rounded-lg border border-border bg-surface p-6">
      <h3 className="mb-1 font-medium">รายงานปิดร้านประจำวัน</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        ไม่บังคับ — เปิดแล้วคนปิดร้านกรอกยอด เงินสด ลูกค้า และปัญหาของวันในใบเดียว ผู้จัดการเขียนความเห็นต่อได้ ·
        ปิดไว้ = คีย์ยอดปิดร้านที่แดชบอร์ดเหมือนเดิม
      </p>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.checked;
            setOn(v);
            run(() => setDailyCloseEnabledAction(v));
          }}
        />
        <span className="font-medium">ใช้รายงานปิดร้าน</span>
      </label>

      {on && (
        <div className="mt-5 space-y-2">
          <p className="font-medium">ประเภทลูกค้าของร้าน</p>
          <p className="text-xs text-muted-foreground">
            คนปิดร้านประเมินว่า “ถ้าลูกค้า 10 คน ส่วนใหญ่เป็นใคร” · ลบประเภทที่เคยใช้แล้ว = ซ่อนจากฟอร์ม ตัวเลขเก่ายังอยู่
          </p>
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface py-0.5 pl-3 pr-1 text-sm">
                {t.name}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeCustomerTypeAction(t.id))}
                  className="rounded-full px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-bad"
                  aria-label={`ลบ ${t.name}`}
                  title={t.used ? "เคยใช้แล้ว — จะซ่อนจากฟอร์ม ตัวเลขเก่ายังอยู่" : "ลบ"}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="เช่น นักศึกษา" className="input flex-1 text-sm" />
            <button type="button" disabled={pending || name.trim() === ""} onClick={() => run(() => addCustomerTypeAction(name), () => setName(""))} className="btn disabled:opacity-50">
              + เพิ่ม
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}

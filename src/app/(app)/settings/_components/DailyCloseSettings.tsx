"use client";

// ตั้งค่าร้าน › รายงานปิดร้าน (ADR 0042): the shop's own list of customer
// types. The add-on's on/off switch moved into the แผนกและส่วนเสริม section
// (review 2026-10-28) and saves with it; editing this list still saves each
// change at once — it is a list of names, not a setting with a บันทึก.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { addCustomerTypeAction, removeCustomerTypeAction } from "@/app/(app)/closing/actions";

export default function CustomerTypes({ types }: { types: { id: string; name: string; used: boolean }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
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
    <div className="space-y-2">
      <p className="text-sm font-semibold">ประเภทลูกค้าของร้าน <span className="font-normal text-muted-foreground">· แก้แล้วบันทึกทันที</span></p>
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
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-muted-foreground hover:bg-muted hover:text-bad"
              aria-label={`ลบ ${t.name}`}
              title={t.used ? "เคยใช้แล้ว — จะซ่อนจากฟอร์ม ตัวเลขเก่ายังอยู่" : "ลบ"}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex max-w-md gap-2">
        {/* No `name`: this box must not count as an unsaved change of the section around it. */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          // Enter would submit the section form this sits in.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (name.trim() !== "") run(() => addCustomerTypeAction(name), () => setName(""));
          }} maxLength={40} placeholder="เช่น นักศึกษา" aria-label="ประเภทลูกค้าใหม่" className="input flex-1 text-sm" />
        <button type="button" disabled={pending || name.trim() === ""} onClick={() => run(() => addCustomerTypeAction(name), () => setName(""))} className="btn disabled:opacity-50">
          + เพิ่ม
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

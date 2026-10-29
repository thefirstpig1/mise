"use client";

// ตั้งค่าร้าน › "ใช้ค่าตามนี้" (setup trial 2026-10-30). The first setup step,
// ตรวจตั้งค่าร้าน, ticks on a save — and a shop whose defaults are already right
// has nothing to save, so the step could never tick. Shown only until it has.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { confirmShopSettingsAction } from "../actions";

export default function ConfirmShopSettings() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary-line bg-primary-soft px-5 py-4">
      <div className="min-w-0">
        <p className="font-semibold">ตรวจการตั้งค่าแล้วใช่ไหม</p>
        <p className="text-sm text-muted-foreground">ถ้าค่าข้างล่างถูกกับร้านอยู่แล้ว กดใช้ค่าตามนี้ได้เลย ไม่ต้องแก้อะไร · เปลี่ยนภายหลังได้เสมอ</p>
        {error && <p className="mt-1 text-sm text-bad">{error}</p>}
      </div>
      <button
        type="button"
        disabled={pending}
        className="btn"
        onClick={() =>
          start(async () => {
            const r = await orStale(confirmShopSettingsAction());
            if (r.ok) router.refresh();
            else setError(r.formError);
          })
        }
      >
        {pending ? "กำลังบันทึก…" : "ใช้ค่าตามนี้"}
      </button>
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import Switch from "@/components/ui/Switch";
import { setMarketingConsentAction } from "../actions";

const day = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });

/** Given or withdrawn at once — no "are you sure": either way is the person's right. */
export default function MarketingConsent({ optedIn, since }: { optedIn: boolean; since: string | null }) {
  const router = useRouter();
  const [on, setOn] = useState(optedIn);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const flip = () => {
    const next = !on;
    setOn(next);
    setError(null);
    start(async () => {
      const res = await orStale(setMarketingConsentAction({ optIn: next }));
      if (!res.ok) {
        setOn(!next);
        setError(res.formError);
        return;
      }
      router.refresh();
    });
  };
  return (
    <section className="flex items-start justify-between gap-4 rounded-[18px] border border-border/70 bg-surface p-4 shadow-card">
      <div className="min-w-0 space-y-1">
        <p className="font-medium">
          รับข่าวสาร ฟีเจอร์ใหม่ และ<span className="whitespace-nowrap">โปรโมชั่นทางอีเมล</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {on ? `ยินยอมแล้ว${since && optedIn ? ` ตั้งแต่ ${day(since)}` : ""} · ยกเลิกได้ทุกเมื่อ` : "ไม่ได้รับ · อีเมลเรื่องการใช้งาน เช่น ลิงก์เข้าสู่ระบบ ยังส่งตามปกติ"}
        </p>
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
      <div className="mt-0.5">
        <Switch name="marketing_opt_in" label="รับข่าวสารทางอีเมล" checked={on} onChange={flip} disabled={pending} />
      </div>
    </section>
  );
}

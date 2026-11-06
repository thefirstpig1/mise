"use client";

// ADR 0045 Q14 — "เล่าเกี่ยวกับร้านสักนิด": three optional answers for คิดครัว's
// own counts (mockup Q7BabbD2jHMDtdqEYxLmUR §4). Not a setup step — a shop that
// skips it is never told its setup is unfinished. "ไว้ทีหลัง" is remembered in
// this browser; once answered it leaves for good and lives in ตั้งค่าทั่วไป.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircleQuestion } from "lucide-react";
import IconTile from "@/components/ui/IconTile";
import { orStale } from "@/lib/stale-tab";
import { HEARD_FROM, PROVINCES, SHOP_TYPES } from "@/lib/platform-requests";
import { saveShopAnswersAction } from "../../settings/actions";

const KEY = "kitkrua.about-shop.later";

export default function AboutShopCard() {
  const router = useRouter();
  const [later, setLater] = useState<boolean | null>(null);
  const [shopType, setShopType] = useState<string | null>(null);
  const [province, setProvince] = useState("");
  const [heardFrom, setHeardFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startRefresh] = useTransition();

  useEffect(() => {
    try {
      setLater(localStorage.getItem(KEY) === "1");
    } catch {
      setLater(false);
    }
  }, []);
  if (later !== false) return null;

  const skip = () => {
    setLater(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private window: hidden for this visit */
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await orStale(saveShopAnswersAction({ shopType, province, heardFrom }));
    setBusy(false);
    if (!res.ok) return setError(res.formError);
    startRefresh(() => router.refresh());
  };
  const pill = (on: boolean) => `pill ${on ? "is-on" : ""}`;

  return (
    <section className="space-y-3 rounded-[18px] border border-border/70 bg-surface p-4 shadow-card" aria-label="เล่าเกี่ยวกับร้าน">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <IconTile icon={MessageCircleQuestion} />
          เล่าเกี่ยวกับร้านสักนิด
        </h2>
        <span className="chip">ไม่บังคับ · ข้ามได้</span>
      </div>
      <p className="text-sm text-muted-foreground">ช่วยให้คิดครัวรู้ว่าร้านแบบไหนใช้งานอยู่ · ใช้ดูเป็นตัวเลขรวมเท่านั้น · แก้ได้ทีหลังที่ตั้งค่าทั่วไป</p>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">ร้านของคุณเป็นแบบไหน</p>
        <div className="flex flex-wrap gap-1.5">
          {SHOP_TYPES.map((t) => (
            <button key={t} type="button" className={pill(shopType === t)} onClick={() => setShopType(shopType === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <label className="block space-y-1.5">
        <span className="block text-sm font-semibold">อยู่จังหวัดไหน</span>
        <select className="input w-full sm:w-72" value={province} onChange={(e) => setProvince(e.target.value)}>
          <option value="">ไม่ระบุ</option>
          {PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">รู้จักคิดครัวจากไหน</p>
        <div className="flex flex-wrap gap-1.5">
          {HEARD_FROM.map((t) => (
            <button key={t} type="button" className={pill(heardFrom === t)} onClick={() => setHeardFrom(heardFrom === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" disabled={busy || (!shopType && !province && !heardFrom)} onClick={save}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={skip}>
          ไว้ทีหลัง
        </button>
      </div>
    </section>
  );
}

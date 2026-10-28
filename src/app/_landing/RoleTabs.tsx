"use client";

// หน้าแรก › ใครทำอะไร (Kong 2026-10-28, mockup GG5e43SSLmNFxEHfa5RQJH):
// one tab per job, each saying what that person does here and what they do
// NOT see — that the cook never sees a price is a selling point, not a gap.

import { useState } from "react";

type Role = {
  key: string;
  name: string;
  sub: string;
  title: string;
  can: string[];
  cant?: string;
  shots: { src: string; alt: string; w: number; h: number; phone?: boolean }[];
};

const ROLES: Role[] = [
  {
    key: "owner",
    name: "เจ้าของร้าน",
    sub: "กำไร ยอดขาย ต้นทุน",
    title: "เห็นภาพทั้งร้าน และเจาะได้ทุกตัวเลข",
    can: ["ยอดขาย กำไรรายเมนู และเมนูที่ควรปรับ", "รายจ่ายแยกหมวดและผู้ขาย ราคาวัตถุดิบที่ขึ้น", "ของหายจากการนับ และกำไรสุทธิรายเดือนแยกสาขา"],
    shots: [{ src: "/landing/sales-app.png", alt: "หน้ายอดขายของร้านตัวอย่าง", w: 1456, h: 821 }],
  },
  {
    key: "kitchen",
    name: "ครัว",
    sub: "ขอของ นับสต๊อก ของเสีย",
    title: "ทำงานจากมือถือ ไม่ต้องเปิดคอม",
    can: ["กดขอของที่ใกล้หมด ระบบเสนอจำนวนให้", "นับสต๊อกทีละหมวด เห็นทันทีว่าต่างจากระบบเท่าไร", "บันทึกของเสียและมื้อพนักงาน"],
    cant: "ไม่เห็นราคาซื้อ ต้นทุน และกำไร",
    shots: [
      { src: "/landing/catalog.png", alt: "ใบขอซื้อบนมือถือ", w: 780, h: 1520, phone: true },
      { src: "/landing/count.png", alt: "ใบนับสต๊อกบนมือถือ", w: 780, h: 1520, phone: true },
    ],
  },
  {
    key: "buyer",
    name: "จัดซื้อ",
    sub: "ตัดรอบ สั่งซื้อ รับของ",
    title: "จากใบขอของครัว เป็นใบสั่งซื้อในครั้งเดียว",
    can: ["ตัดรอบแล้วได้ใบสั่งซื้อแยกตามผู้ขาย", "เห็นว่าผู้ขายไหนถูกกว่าเมื่อซื้อครั้งล่าสุด", "รับของแล้วสต๊อกขึ้นและบิลสร้างเอง"],
    shots: [{ src: "/landing/supplier.png", alt: "หน้าผู้ขายของร้านตัวอย่าง", w: 1272, h: 952 }],
  },
  {
    key: "account",
    name: "บัญชี",
    sub: "บิล ค่าใช้จ่าย ภาษี",
    title: "บิลทุกใบอยู่ที่เดียว พร้อม VAT และหัก ณ ที่จ่าย",
    can: ["บิลจากการรับของสร้างเอง ไม่ต้องคีย์ซ้ำ", "ค่าใช้จ่ายประจำเตือนเมื่อถึงงวด", "วิเคราะห์รายจ่ายแยกหมวดและผู้ขาย"],
    cant: "ไม่แก้งานหน้าร้าน",
    shots: [{ src: "/landing/expenses.png", alt: "วิเคราะห์รายจ่ายของร้านตัวอย่าง", w: 1232, h: 980 }],
  },
  {
    key: "cashier",
    name: "แคชเชียร์",
    sub: "ปิดร้าน นำเข้ายอดขาย",
    title: "ปิดร้านและส่งยอดขายในไม่กี่นาที",
    can: ["กรอกยอดปิดร้าน เงินสด และลูกค้าของวัน", "อัปโหลดไฟล์ POS ระบบเช็กให้ว่ายอดตรงกัน", "บันทึกปัญหาของวันให้ผู้จัดการเห็น"],
    cant: "ไม่เห็นต้นทุนและกำไร",
    shots: [],
  },
];

function Tick() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C6D08F" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="mt-1 shrink-0">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Hidden() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="mt-1 shrink-0">
      <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12.6 12.6 0 0 1-3.2 4.3M6.1 6.1A12.4 12.4 0 0 0 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4-.9" />
    </svg>
  );
}

export default function RoleTabs() {
  const [key, setKey] = useState(ROLES[0].key);
  const r = ROLES.find((x) => x.key === key)!;

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[260px_1fr]">
      <div role="tablist" aria-label="หน้าที่" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {ROLES.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={x.key === key}
            onClick={() => setKey(x.key)}
            className={`flex shrink-0 flex-col items-start rounded-2xl px-4 py-3 text-left transition-colors ${
              x.key === key ? "bg-[#F8F3E1] text-[#262811]" : "text-[#F8F3E1] hover:bg-white/5"
            }`}
          >
            <span className="font-display text-[17px] font-semibold">{x.name}</span>
            <span className="text-[13px] opacity-75">{x.sub}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" className="grid items-center gap-10 md:grid-cols-2">
        <div className="space-y-3.5">
          <h3 className="text-[26px] font-semibold leading-snug">{r.title}</h3>
          {r.can.map((c) => (
            <p key={c} className="flex gap-3 text-base leading-relaxed">
              <Tick />
              <span>{c}</span>
            </p>
          ))}
          {r.cant && (
            <p className="flex gap-3 text-[15px] leading-relaxed text-[#F8F3E1]/60">
              <Hidden />
              <span>{r.cant}</span>
            </p>
          )}
        </div>

        <div className="flex items-start justify-center gap-4">
          {r.shots.length === 0 ? (
            <div className="w-full max-w-sm rounded-3xl border border-white/20 bg-white/5 p-7">
              <p className="text-[13px] font-bold tracking-[.1em] text-[#D9AC42]">ปิดร้านประจำวัน</p>
              <p className="mt-3 font-display text-[22px] font-semibold leading-snug">ยอดปิดร้าน · เงินสดในลิ้นชัก · ลูกค้าวันนี้ · ปัญหาที่เจอ</p>
              <p className="mt-3 text-[15px] leading-relaxed text-[#E3DBBB]">ใบเดียวจบบนมือถือ ผู้จัดการเขียนความเห็นต่อได้</p>
            </div>
          ) : r.shots.length === 2 ? (
            r.shots.map((s, i) => (
              <div
                key={s.src}
                className={`w-[46%] max-w-[230px] rounded-[40px] bg-[#1C1D0B] p-[9px] shadow-[0_40px_70px_-20px_rgba(28,29,11,.55)] ${i === 0 ? "-rotate-2" : "mt-12 rotate-2"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={s.alt} width={s.w} height={s.h} loading="lazy" className="block h-auto w-full rounded-[32px]" />
              </div>
            ))
          ) : (
            <div className="w-full overflow-hidden rounded-[14px] bg-white shadow-[0_40px_80px_-20px_rgba(0,0,0,.5)]">
              <div className="flex h-7 items-center gap-1.5 border-b border-[#E9E3C8] bg-[#F3EFDF] px-3">
                <i className="h-2 w-2 rounded-full bg-[#D2CBA4]" />
                <i className="h-2 w-2 rounded-full bg-[#D2CBA4]" />
                <i className="h-2 w-2 rounded-full bg-[#D2CBA4]" />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.shots[0].src} alt={r.shots[0].alt} width={r.shots[0].w} height={r.shots[0].h} loading="lazy" className="block h-auto w-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

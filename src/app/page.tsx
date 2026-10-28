// ============================================================
// คิดครัว — หน้าแรก (Kong 2026-10-28, mockup GG5e43SSLmNFxEHfa5RQJH)
// ============================================================
// The page that used to say "Sprint 0 — Foundation + Auth + Tenant +
// Department" to every visitor. Every picture is a real screen from the demo
// shop (public/landing/), captured with the owner's e-mail replaced and a real
// chain's name swapped for "ห้างค้าส่ง" — never a drawing of the product.
//
// What it leads with is what Kong named as the product's best: the sales
// page, menu engineering, expense analysis, ingredient prices, and where stock
// goes — then who does what, because every person sees only their own work.
// Each feature lists WHAT it shows, not the demo's numbers (Kong: "ให้เขาดูใน
// รูปเอา").
//
// 📌 The slogan is Kong's to write. Until then the headline is the plain
// sentence below; put the slogan in SLOGAN and it takes the headline's place.
// ============================================================

import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import RoleTabs from "./_landing/RoleTabs";

const SLOGAN: string | null = null;

const ICONS: Record<string, ReactNode> = {
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  chart: <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" />,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  star: <path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8z" />,
  coin: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 8h3.5a2 2 0 0 1 0 4H9.5h4a2 2 0 0 1 0 4H9.5zM11 6.5v11" /></>,
  menu: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  pie: <><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>,
  truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  box: <><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
};

type Feature = {
  tag: string;
  title: string;
  body: string;
  img: { src: string; alt: string; w: number; h: number };
  points: [icon: string, head: string, sub: string][];
};

const FEATURES: Feature[] = [
  {
    tag: "ยอดขาย",
    title: "รู้ว่าหมวดไหนขายดีวันไหน",
    body: "ทุกตัวเลขเทียบเป็นต่อวัน ไม่ใช่ยอดรวมที่จำนวนวันไม่เท่ากัน ใช้วางของและวางคนได้",
    img: { src: "/landing/heatmap.png", alt: "ตารางหมวดไหนขายดีวันไหน", w: 1567, h: 742 },
    points: [
      ["calendar", "ยอดขายรายวัน", "แยกวันธรรมดากับเสาร์อาทิตย์ พร้อมเส้นค่าเฉลี่ย"],
      ["chart", "วันไหนของสัปดาห์ขายดี", "เฉลี่ยต่อวันจริง เอาไปวางคนและเตรียมของ"],
      ["grid", "หมวดไหนขายดีวันไหน", "ตารางสีเข้ม-อ่อน ติดดาววันที่โดดเด่นของแต่ละหมวด"],
      ["trend", "เมนูที่น่าจับตา", "เมนูที่ขายเพิ่มขึ้นหรือลดลง เทียบกับช่วงก่อน"],
    ],
  },
  {
    tag: "Menu engineering",
    title: "เมนูไหนควรดัน เมนูไหนควรปรับราคา",
    body: "เอาจำนวนจานที่ขายได้มาวางคู่กับกำไรต่อจานจากสูตรจริง กดเมนูไหนก็เห็นเหตุผล",
    img: { src: "/landing/menu-eng.png", alt: "เมนูไหนควรทำอะไร: ดาวเด่น ม้างาน ปริศนา ทบทวน", w: 1372, h: 891 },
    points: [
      ["star", "4 กลุ่มเมนู", "ดาวเด่น ม้างาน ปริศนา และเมนูที่ควรทบทวน"],
      ["coin", "กำไรต่อจานจากสูตรจริง", "ต้นทุนวัตถุดิบตามสูตร ณ สิ้นช่วงที่ดู"],
      ["menu", "กดเมนูเพื่อดูเหตุผล", "ขายกี่จาน กำไรเท่าไร ต้นทุนมาจากอะไร"],
      ["search", "ค้นและกรองตามหมวด", "ดูเฉพาะเครื่องดื่มหรือเฉพาะอาหารจานเดียวได้"],
    ],
  },
  {
    tag: "วิเคราะห์รายจ่าย",
    title: "เงินออกไปที่ไหน แตะทีเดียวเจาะถึงบิล",
    body: "แยกตามหมวดและตามผู้ขาย กดชิ้นในวงกลมเพื่อลงไปดูกลุ่ม วัตถุดิบ และบิลแต่ละใบ",
    img: { src: "/landing/expenses.png", alt: "วิเคราะห์รายจ่ายแยกตามหมวดและผู้ขาย", w: 1232, h: 980 },
    points: [
      ["pie", "แยกตามหมวด", "อาหาร เครื่องดื่ม ค่าเช่า สาธารณูปโภค เป็นสัดส่วน"],
      ["truck", "แยกตามผู้ขาย", "จ่ายใครเท่าไร รวมรายจ่ายที่ไม่มีผู้ขาย"],
      ["receipt", "เจาะลงถึงบิล", "หมวด → กลุ่ม → วัตถุดิบและบิลแต่ละใบ"],
      ["calendar", "เลือกเดือนและสาขา", "ตามวันที่ในบิล ไม่รวม VAT"],
    ],
  },
  {
    tag: "ราคาวัตถุดิบ",
    title: "ราคาขึ้นตัวไหน ทำให้จ่ายเพิ่มเท่าไร",
    body: "ติดตามราคาที่จ่ายจริงจากใบรับของทุกสัปดาห์ และเมนูไหนต้นทุนขึ้นจนเกินเป้า",
    img: { src: "/landing/prices.png", alt: "แนวโน้มราคาวัตถุดิบรายสินค้า", w: 1568, h: 733 },
    points: [
      ["trend", "แนวโน้มราคารายสินค้า", "ขึ้นหรือลงกี่เปอร์เซ็นต์จากช่วงที่เลือก"],
      ["coin", "จ่ายเพิ่มหรือประหยัดกี่บาท", "จากราคาที่จ่ายจริงในใบรับของ"],
      ["menu", "เมนูที่ต้นทุนขึ้นเกินเป้า", "รู้ว่าต้องปรับราคาหรือสูตรเมนูไหน"],
      ["list", "เรียงตามเงิน", "ตัวที่กระทบร้านมากที่สุดขึ้นก่อน"],
    ],
  },
  {
    tag: "ของหายไปไหน",
    title: "นับสต๊อกแล้วรู้ว่าหายกี่บาท และน่าจะเพราะอะไร",
    body: "เทียบของที่นับได้กับที่ควรเหลือจากยอดขาย เรียงตามเงิน ของเสียแยกออกให้แล้ว",
    img: { src: "/landing/leaks.png", alt: "รายงานของหายไปไหน", w: 1301, h: 924 },
    points: [
      ["box", "หายกี่บาท เทียบเป้า", "เทียบของที่นับได้กับที่ควรเหลือจากยอดขาย"],
      ["list", "ตัวไหนหาย เรียงตามเงิน", "รายการที่หายมากที่สุดอยู่บนสุด"],
      ["search", "น่าจะหายเพราะอะไร", "ตัดเกินสูตร รับของวันเดียวกับที่นับ ฯลฯ"],
      ["target", "ต้องไปดูที่ไหน", "บอกเอกสารที่ควรตรวจของแต่ละรายการ"],
    ],
  },
];

const WHY: [string, string][] = [
  ["ต้นทุนจริง ไม่ใช่ราคาล่าสุด", "คิดตามล็อตที่ซื้อเข้ามาก่อนใช้ก่อน ร้านที่ไม่ได้จด VAT ต้นทุนรวม VAT ให้ถูกตั้งแต่ต้น"],
  ["ใช้กับ POS ที่ร้านมีอยู่", "นำเข้าไฟล์ยอดขายได้เลย ยอดในไฟล์ไม่ตรงกับยอดปิดร้าน ระบบเตือนก่อนนำเข้า"],
  ["เริ่มได้ แม้ยังไม่มีสูตร", "นับสต๊อกอย่างเดียวก็รู้กำไรขั้นต้น ใส่สูตรเมื่อพร้อม แล้วสต๊อกจะลดเองตามยอดขาย"],
  ["ไม่มีตัวเลขเดา", "ข้อมูลยังไม่ครบ ระบบบอกว่าขาดอะไรและครอบคลุมกี่เปอร์เซ็นต์ ไม่แสดง ฿0 แทนคำว่ายังไม่รู้"],
];

const DARK = "bg-[#23240C] text-[#F8F3E1]";

function Mark({ light = false }: { light?: boolean }) {
  return (
    <svg aria-hidden width="34" height="34" viewBox="0 0 48 48">
      <path d="M37.5,9.5 L19.5,30.5 A9.5,9.5 0 0 0 38.5,30.5" fill="none" stroke={light ? "#F8F3E1" : "#41431B"} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M0,-11 C4.8,-7.2 6.5,-3 6.5,0.8 C6.5,5.6 3.9,9.8 0,11 C-3.9,9.8 -6.5,5.6 -6.5,0.8 C-6.5,-3 -4.8,-7.2 0,-11 Z" fill="#D9AC42" transform="translate(13,14) rotate(-16) scale(0.7)" />
    </svg>
  );
}

function Browser({ src, alt, w, h, className = "" }: { src: string; alt: string; w: number; h: number; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-[14px] bg-white shadow-[0_40px_80px_-20px_rgba(28,29,11,.45)] ring-1 ring-black/5 ${className}`}>
      <div className="flex h-7 items-center gap-1.5 border-b border-[#E9E3C8] bg-[#F3EFDF] px-3" aria-hidden>
        <i className="h-2 w-2 rounded-full bg-[#D2CBA4]" />
        <i className="h-2 w-2 rounded-full bg-[#D2CBA4]" />
        <i className="h-2 w-2 rounded-full bg-[#D2CBA4]" />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} width={w} height={h} className="block h-auto w-full" />
    </div>
  );
}

function Panel({ src, alt, w, h }: Feature["img"]) {
  return (
    <div className="overflow-hidden rounded-[20px] bg-white shadow-[0_30px_60px_-24px_rgba(28,29,11,.35)] ring-1 ring-[#E9E3C8]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} width={w} height={h} loading="lazy" className="block h-auto w-full" />
    </div>
  );
}

function FeatureRow({ f, flip, band }: { f: Feature; flip: boolean; band: boolean }) {
  return (
    <div className={band ? "bg-[#F3EFDF] py-20 md:py-24" : "py-20 md:py-24"}>
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-6 md:grid-cols-2 md:gap-14">
        <div className={`space-y-4 ${flip ? "md:order-2" : ""}`}>
          <span className="inline-flex h-[30px] items-center gap-2 rounded-full bg-primary-soft px-3 text-[13px] font-semibold text-primary">
            <i className="h-2 w-2 rounded-full bg-[#B9673A]" aria-hidden />
            {f.tag}
          </span>
          <h3 className="text-[28px] font-semibold leading-tight md:text-[32px]">{f.title}</h3>
          <p className="text-[17px] leading-relaxed text-muted-foreground">{f.body}</p>
          <ul className="grid gap-x-6 gap-y-[18px] pt-1.5 sm:grid-cols-2">
            {f.points.map(([icon, head, sub]) => (
              <li key={head} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-[#E3DBBB]" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#41431B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {ICONS[icon]}
                  </svg>
                </span>
                <span>
                  <span className="block font-display text-base font-semibold leading-snug">{head}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{sub}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={flip ? "md:order-1" : ""}>
          <Panel {...f.img} />
        </div>
      </div>
    </div>
  );
}

export default async function HomePage() {
  const session = await auth();
  // Signed in → straight to work.
  if (session?.user) redirect("/home");

  return (
    <div className="overflow-hidden">
      {/* ===================== HERO ===================== */}
      <section
        className={DARK}
        style={{ backgroundImage: "radial-gradient(900px 600px at 85% 30%, #55581F 0%, rgba(85,88,31,0) 65%), radial-gradient(700px 400px at 0% 100%, #3A3C15 0%, rgba(58,60,21,0) 70%)" }}
      >
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-3 px-6 py-5">
          <span className="flex items-center gap-2.5">
            <Mark light />
            <span className="font-display text-[22px] font-semibold">คิดครัว</span>
          </span>
          <nav className="flex items-center gap-1.5">
            <a href="#best" className="hidden h-11 items-center px-3.5 text-[#E3DBBB] hover:text-white sm:inline-flex">ทีเด็ด</a>
            <a href="#roles" className="hidden h-11 items-center px-3.5 text-[#E3DBBB] hover:text-white sm:inline-flex">ใครทำอะไร</a>
            <Link href="/login" className="ml-1.5 inline-flex h-11 items-center rounded-xl border border-[#F8F3E1]/30 px-4 font-semibold text-[#F8F3E1] hover:bg-white/5">
              เข้าสู่ระบบ
            </Link>
          </nav>
        </div>

        <div className="mx-auto flex max-w-[1240px] flex-col items-center gap-5 px-6 pt-12 text-center md:pt-16">
          <p className="text-[13px] font-bold tracking-[.12em] text-[#D9AC42]">ระบบหลังร้านสำหรับร้านอาหาร</p>
          <h1 className="max-w-3xl text-[34px] font-semibold leading-tight text-[#F8F3E1] md:text-[48px]">
            {SLOGAN ?? "ยอดขาย กำไรรายเมนู รายจ่าย และราคาวัตถุดิบ ในที่เดียว"}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-[#E3DBBB]">
            {SLOGAN ? "ยอดขาย กำไรรายเมนู รายจ่าย และราคาวัตถุดิบ ในที่เดียว จากไฟล์ POS ที่ร้านใช้อยู่แล้ว" : "จากไฟล์ POS ที่ร้านใช้อยู่แล้ว ไม่ต้องเปลี่ยนเครื่อง ไม่ต้องมีสูตรก็เริ่มได้"}
          </p>
          <div className="mt-1.5 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="inline-flex h-[54px] items-center rounded-2xl bg-[#F8F3E1] px-7 text-[17px] font-bold text-[#23240C] hover:bg-white">
              สมัครใช้งาน
            </Link>
            <a href="#best" className="inline-flex h-[54px] items-center rounded-2xl border border-[#F8F3E1]/30 px-6 text-[17px] font-semibold text-[#F8F3E1] hover:bg-white/5">
              ดูหน้าจอจริง
            </a>
          </div>
        </div>

        <div className="mx-auto mt-14 max-w-[1240px] px-6 md:mt-16">
          <div className="relative mx-auto max-w-[1080px]">
            <Browser src="/landing/sales-app.png" alt="หน้ายอดขายของร้านตัวอย่าง: ยอดขายรายวัน วันที่ขายดี และสัดส่วนหมวดเมนู" w={1456} h={821} className="rounded-b-none" />
            <div className="absolute -bottom-10 -right-2 w-[24%] max-w-[230px] rotate-[2.5deg] rounded-[34px] bg-[#1C1D0B] p-[7px] shadow-[0_40px_70px_-20px_rgba(28,29,11,.55)] sm:-right-9 sm:rounded-[40px] sm:p-[9px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/catalog.png" alt="ใบขอซื้อบนมือถือ" width={780} height={1520} className="block h-auto w-full rounded-[28px] sm:rounded-[32px]" />
            </div>
          </div>
        </div>
      </section>

      {/* ===================== BEST ===================== */}
      <section id="best" className="scroll-mt-4 pt-24 md:pt-28">
        <div className="mx-auto max-w-[1240px] px-6 text-center">
          <p className="text-[13px] font-bold tracking-[.12em] text-[#B07A1E]">ทีเด็ดของคิดครัว</p>
          <h2 className="mx-auto mt-2.5 max-w-3xl text-[32px] font-semibold leading-tight md:text-[40px]">ไม่ใช่แค่ยอดขาย แต่รู้ว่าทำไม และต้องทำอะไรต่อ</h2>
        </div>
        {FEATURES.map((f, i) => (
          <FeatureRow key={f.tag} f={f} flip={i % 2 === 1} band={i % 2 === 1} />
        ))}
      </section>

      {/* ===================== ROLES ===================== */}
      <section
        id="roles"
        className={`${DARK} scroll-mt-4 py-24 md:py-28`}
        style={{ backgroundImage: "radial-gradient(800px 500px at 100% 0%, #4A4C1B 0%, rgba(74,76,27,0) 65%)" }}
      >
        <div className="mx-auto max-w-[1240px] space-y-12 px-6">
          <div className="max-w-3xl">
            <p className="text-[13px] font-bold tracking-[.12em] text-[#D9AC42]">ใครทำอะไร</p>
            <h2 className="mt-2.5 text-[32px] font-semibold leading-tight text-[#F8F3E1] md:text-[40px]">แต่ละคนเห็นเฉพาะงานของตัวเอง</h2>
            <p className="mt-3.5 text-lg leading-relaxed text-[#E3DBBB]">
              ครัวขอของ จัดซื้อสั่ง บัญชีดูรายจ่าย เจ้าของดูกำไร ทุกคนทำงานบนข้อมูลชุดเดียวกัน และคนที่ไม่เกี่ยวไม่เห็นตัวเลขเงิน
            </p>
          </div>
          <RoleTabs />
        </div>
      </section>

      {/* ===================== WHY ===================== */}
      <section className="mx-auto grid max-w-[1240px] gap-12 px-6 py-24 md:grid-cols-2 md:py-28">
        <div>
          <p className="text-[13px] font-bold tracking-[.12em] text-[#B07A1E]">ทำไมเชื่อตัวเลขได้</p>
          <h2 className="mt-2.5 text-[32px] font-semibold leading-tight md:text-[40px]">ตัวเลขที่ถูก และบอกเสมอว่าครบแค่ไหน</h2>
        </div>
        <dl className="border-b border-border-strong">
          {WHY.map(([t, d]) => (
            <div key={t} className="space-y-1.5 border-t border-border-strong py-5">
              <dt className="font-display text-lg font-semibold">{t}</dt>
              <dd className="text-[15px] leading-relaxed text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ===================== CTA ===================== */}
      <section className="mx-auto max-w-[1240px] px-6 pb-16">
        <div
          className={`${DARK} flex flex-wrap items-center justify-between gap-6 rounded-[28px] p-8 md:p-12`}
          style={{ backgroundImage: "radial-gradient(700px 300px at 90% 0%, #55581F 0%, rgba(85,88,31,0) 70%)" }}
        >
          <div className="max-w-xl">
            <h2 className="text-[28px] font-semibold leading-tight text-[#F8F3E1] md:text-[32px]">เริ่มจากร้านเดียว สาขาเดียวก็ได้</h2>
            <p className="mt-2.5 text-[17px] text-[#E3DBBB]">สมัครแล้วระบบพาตั้งร้านทีละขั้น จนตัวเลขวันแรกขึ้นบนแดชบอร์ด</p>
          </div>
          <Link href="/signup" className="inline-flex h-[54px] items-center rounded-2xl bg-[#F8F3E1] px-7 text-[17px] font-bold text-[#23240C] hover:bg-white">
            สมัครใช้งาน
          </Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-3 border-t border-border px-6 py-6 text-[13px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <Mark />
          คิดครัว · KitKrua
        </span>
        <span className="self-center">ภาพหน้าจอทั้งหมดมาจากร้านตัวอย่าง</span>
      </footer>
    </div>
  );
}

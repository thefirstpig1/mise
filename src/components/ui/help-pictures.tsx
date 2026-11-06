// ============================================================
// Mise — a picture for every "?" (Kong 2026-11-01)
// ============================================================
// Round 2 of the friend's-shop feedback: "ส่วนของปุ่ม ? ต้องทำให้ชัดเจนเห็นภาพ
// กว่านี้ ใช้รูปภาพประกอบ หรือทำเป็น diagram" → "อยากให้เห็นภาพแบบหนังสือเรียน
// เอาง่ายๆ". Mockup 225p68BDqKAZTpd9MqDeph. One small figure per setting,
// drawn the way a school textbook draws one: real objects (a receipt, a
// plate, a count sheet), a baht figure the shop would recognise, labels on
// the thing itself, and the setting's own number marked on it. The words
// under it (`example` in src/lib/setting-help.ts) are its caption.
//
// Plain components, no state: FieldHelp (a client component) renders them,
// and nothing here is a value a server page needs.
// ============================================================

import type { ReactNode } from "react";
import { ChefHat, ClipboardList, Eye, EyeOff, FileSpreadsheet, HandCoins, Pencil, Receipt, Soup, Store, Wine } from "lucide-react";
import { TONES } from "@/components/charts/chart-theme";
import type { HelpKey } from "@/lib/setting-help";

/** The one thing a figure points at (chart rule: terracotta marks it). */
const CLAY = TONES.clay[0];
const INK = "#41431B";
const MUTED = "#5A5C31";
const SAGE = "#AEB784";
const WASH = "#E3DBBB";
const WARN_BG = "#F8EFD6";
const WARN = "#A87C1C";
const BAD = "#A83A22";

// ---------- pieces ----------

type Tone = "ink" | "sage" | "wash" | "clay" | "bad";
const toneClass: Record<Tone, string> = {
  ink: "bg-primary text-primary-foreground",
  sage: "bg-sage text-foreground",
  wash: "bg-wash text-muted-foreground",
  clay: "text-white",
  bad: "bg-bad-bg text-bad",
};

/** A bar cut into labelled parts, with an optional dashed marker at a % (the setting's own number). */
function Bar({ parts, marker, h = 26 }: { parts: { w: number; label: string; tone: Tone }[]; marker?: { at: number; label: string }; h?: number }) {
  return (
    <div className={`relative ${marker ? "pt-4" : ""}`}>
      {marker ? (
        <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10.5px] font-semibold" style={{ left: `${marker.at}%`, color: CLAY }}>
          {marker.label}
        </span>
      ) : null}
      <div className="flex gap-[2px] overflow-hidden rounded-md" style={{ height: h }}>
        {parts.map((p) => (
          <span
            key={p.label}
            className={`grid min-w-0 place-items-center overflow-hidden whitespace-nowrap px-1 font-display text-[10.5px] font-semibold ${toneClass[p.tone]}`}
            style={{ flex: p.w, ...(p.tone === "clay" ? { background: CLAY } : {}) }}
          >
            {p.label}
          </span>
        ))}
      </div>
      {marker ? (
        <span aria-hidden className="absolute bottom-[-4px] border-l-2 border-dashed" style={{ left: `${marker.at}%`, top: 14, borderColor: CLAY }} />
      ) : null}
    </div>
  );
}

/** A box in a little sum or flow: the figure big, what it is small. */
function Box({ v, label, result = false, bad = false }: { v: ReactNode; label?: string; result?: boolean; bad?: boolean }) {
  return (
    <span
      className={`inline-grid min-w-0 rounded-lg border px-2 py-1 text-center font-display text-[11.5px] font-semibold leading-tight ${
        result ? "border-primary bg-primary text-primary-foreground" : bad ? "border-bad-border bg-bad-bg text-bad" : "border-border-strong bg-surface text-foreground"
      }`}
    >
      {v}
      {label ? <small className={`font-sans text-[10px] font-normal ${result ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{label}</small> : null}
    </span>
  );
}

const Op = ({ children }: { children: ReactNode }) => <span className="font-display text-base font-semibold leading-none text-muted-foreground">{children}</span>;

/** A row label sitting on the left of a figure line. */
const Side = ({ children }: { children: ReactNode }) => <span className="text-[11px] leading-tight text-muted-foreground">{children}</span>;

/** A piece of paper: receipt, slip, count sheet. */
function Paper({ title, icon, children, className = "" }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-lg border border-dashed border-border-strong bg-surface px-2.5 py-1.5 text-[11px] leading-snug ${className}`}>
      <p className="mb-0.5 flex items-center gap-1 font-display text-[11px] font-semibold text-foreground">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

const Line = ({ l, r, strong = false }: { l: ReactNode; r: ReactNode; strong?: boolean }) => (
  <span className={`flex justify-between gap-2 ${strong ? "border-t border-dashed border-border-strong pt-0.5 font-semibold text-foreground" : "text-muted-foreground"}`}>
    <span>{l}</span>
    <span className="font-display tabular-nums text-foreground">{r}</span>
  </span>
);

const icon = "h-3.5 w-3.5 shrink-0";

// ---------- the pictures ----------

function Vat() {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3">
      <Paper title="ใบเสร็จค่าหมู" icon={<Receipt className={icon} />}>
        <Line l="หมู" r="฿100" />
        <Line l="VAT 7%" r="฿7" />
        <Line l="ร้านจ่าย" r="฿107" strong />
      </Paper>
      <div className="grid gap-2">
        <div className="grid gap-0.5">
          <Side>จดแล้ว</Side>
          <Bar parts={[{ w: 72, label: "ต้นทุน ฿100", tone: "ink" }, { w: 28, label: "฿7 ขอคืน", tone: "sage" }]} />
        </div>
        <div className="grid gap-0.5">
          <Side>ยังไม่จด</Side>
          <Bar parts={[{ w: 100, label: "ต้นทุน ฿107", tone: "ink" }]} />
        </div>
      </div>
    </div>
  );
}

function Cutoff() {
  return (
    <svg viewBox="0 0 300 84" width="100%" role="img" aria-label="เส้นเวลา 18:00 ถึง 08:00 ตัดวันที่ 05:00">
      <text x="10" y="12" fontSize="10" fill={MUTED}>คืนวันที่ 1</text>
      <text x="290" y="12" textAnchor="end" fontSize="10" fill={MUTED}>เช้าวันที่ 2</text>
      <rect x="10" y="30" width="216" height="16" rx="5" fill={SAGE} />
      <rect x="230" y="30" width="60" height="16" rx="5" fill={WASH} />
      <text x="118" y="41.5" textAnchor="middle" fontSize="10" fontWeight="600" fill="#262811">ยอดของวันที่ 1</text>
      <text x="260" y="41.5" textAnchor="middle" fontSize="10" fill={MUTED}>วันที่ 2</text>
      <line x1="88" y1="22" x2="88" y2="54" stroke={MUTED} strokeDasharray="3 3" />
      <text x="88" y="66" textAnchor="middle" fontSize="10" fill={MUTED}>เที่ยงคืน</text>
      <line x1="228" y1="20" x2="228" y2="56" stroke={CLAY} strokeWidth="2" />
      <text x="228" y="18" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={CLAY}>05:00 ตัดวัน</text>
      <circle cx="139" cy="38" r="6" fill={INK} stroke="#fff" strokeWidth="2" />
      <text x="139" y="66" textAnchor="middle" fontSize="10" fontWeight="600" fill="#262811">บิล 01:30</text>
      <text x="10" y="80" fontSize="9.5" fill={MUTED}>18:00</text>
      <text x="290" y="80" textAnchor="end" fontSize="9.5" fill={MUTED}>08:00</text>
    </svg>
  );
}

function VatRate() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
      <Paper title="ใบสั่งซื้อใบใหม่" icon={<FileSpreadsheet className={icon} />}>
        <Line l="ผักรวม" r="฿500" />
        <span className="mt-0.5 flex items-center justify-between gap-2 rounded-md px-1 py-0.5 ring-2" style={{ ["--tw-ring-color" as string]: CLAY }}>
          <span className="text-foreground">VAT</span>
          <span className="rounded border border-border-strong bg-surface-sunk px-1.5 font-display font-semibold tabular-nums text-foreground">7 %</span>
        </span>
        <Line l="รวม" r="฿535" strong />
      </Paper>
      <p className="flex items-start gap-1 text-[11px] leading-snug" style={{ color: CLAY }}>
        <span aria-hidden className="font-display text-sm leading-none">←</span>
        <span>
          ระบบเติมให้
          <span className="flex items-center gap-1 text-muted-foreground">
            <Pencil className="h-3 w-3" /> แก้ในใบได้
          </span>
        </span>
      </p>
    </div>
  );
}

function Plates({ n, cancelled }: { n: number; cancelled: number }) {
  return (
    <span className="flex flex-wrap gap-[3px]">
      {Array.from({ length: n }, (_, i) => {
        const x = i >= n - cancelled;
        return (
          <span
            key={i}
            aria-hidden
            className={`relative grid h-[17px] w-[17px] place-items-center rounded-full border-2 border-surface text-[11px] font-bold leading-none outline outline-1 outline-border-strong ${x ? "bg-bad-bg text-bad" : "bg-sage"}`}
          >
            {x ? "×" : null}
          </span>
        );
      })}
    </span>
  );
}

function Cancelled() {
  const Way = ({ title, plates, wrong, bad = false }: { title: string; plates: number; wrong: string; bad?: boolean }) => (
    <div className="grid gap-0.5 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[11px] leading-snug">
      <span className="font-display font-semibold text-foreground">{title}</span>
      <span>
        หักวัตถุดิบ <b className="font-display text-[13px]">{plates}</b> จาน
      </span>
      <span className="text-muted-foreground">
        ถ้าเลือกผิด นับแล้วเห็น<b className={bad ? "text-bad" : "text-foreground"}>{wrong}</b>
      </span>
    </div>
  );
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Plates n={12} cancelled={1} />
        <Side>สั่ง 12 จาน · ยกเลิก 1</Side>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Way title="ส่วนใหญ่ทำไปแล้ว" plates={12} wrong="ของเกิน" />
        <Way title="ส่วนใหญ่ยังไม่ได้ทำ" plates={11} wrong="ของหาย" bad />
      </div>
    </div>
  );
}

function StaffMeal() {
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
        <Box v="POS กด ฿0" label="หักวัตถุดิบ" />
        <span className="grid place-items-center text-center">
          <Soup className="h-5 w-5 text-primary" aria-hidden />
          <small className="text-[10px] text-muted-foreground">ข้าวพนักงาน 1 จาน</small>
        </span>
        <Box v="ใบเบิกในคิดครัว" label="หักวัตถุดิบ" />
      </div>
      <div className="flex items-center justify-center gap-2">
        <span aria-hidden className="font-display text-muted-foreground">↘</span>
        <Box v="หมูสับถูกหัก 2 รอบ" label="ถ้าหักทั้งสองทาง" bad />
        <span aria-hidden className="font-display text-muted-foreground">↙</span>
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        ข้อนี้เลือกให้หัก <b className="text-foreground">ทางเดียว</b>: กดใน POS → หักจาก POS · ไม่ได้กด → หักจากใบเบิก
      </p>
    </div>
  );
}

function StaffQuota() {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Box v="กะเพรา ฿60" />
        <Op>+</Op>
        <Box v="กะเพรา ฿60" />
        <Op>+</Op>
        <Box v="ข้าวผัด ฿45" />
        <Op>=</Op>
        <Box v="฿165" label="พี่แดง วันนี้" bad />
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        โควตาวันละ <b className="text-foreground">฿150</b> · เกิน ฿15 ระบบเตือน ไม่ห้ามเบิก
      </p>
    </div>
  );
}

function MenuCeiling() {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Box v="ข้าวผัด ฿45" label="ไม่เกินเพดาน" />
        <Box v="ต้มยำกุ้ง ฿159" label="เกินเพดาน" bad />
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        เพดานราคา <b className="text-foreground">฿120</b> · จานที่แพงกว่าขึ้นคำเตือน ไม่ห้ามเบิก
      </p>
    </div>
  );
}

function ParWarning() {
  return (
    <svg viewBox="0 0 300 100" width="100%" role="img" aria-label="หมูสับลดลงวันละ 2 kg ถึงขั้นต่ำในอีก 2 วัน">
      <rect x="150" y="6" width="90" height="70" fill={WARN_BG} />
      <text x="195" y="18" textAnchor="middle" fontSize="9.5" fontWeight="600" fill={WARN}>ช่วงเตือน 3 วัน</text>
      <line x1="20" y1="58" x2="290" y2="58" stroke={BAD} strokeDasharray="4 3" />
      <text x="288" y="53" textAnchor="end" fontSize="9.5" fill={BAD}>ขั้นต่ำ 5 kg</text>
      <polyline points="30,22 90,34 150,46 210,58 270,70" fill="none" stroke={INK} strokeWidth="2.5" />
      <text x="30" y="16" fontSize="9.5" fill={MUTED}>หมูสับ</text>
      <circle cx="150" cy="46" r="5.5" fill={CLAY} stroke="#fff" strokeWidth="2" />
      <text x="150" y="92" textAnchor="middle" fontSize="10" fontWeight="600" fill="#262811">วันนี้ เหลือ 9 kg</text>
      <text x="210" y="92" textAnchor="middle" fontSize="10" fill={MUTED}>+2 วัน</text>
      <text x="270" y="92" textAnchor="middle" fontSize="10" fill={MUTED}>+3 วัน</text>
    </svg>
  );
}

function CountCycle() {
  return (
    <svg viewBox="0 0 300 76" width="100%" role="img" aria-label="นับล่าสุด 1 ต.ค. ครบรอบ 30 วันวันที่ 31 ต.ค. วันนี้ 3 พ.ย. เลยรอบ 3 วัน">
      <rect x="20" y="30" width="220" height="12" rx="4" fill={SAGE} />
      <rect x="242" y="30" width="38" height="12" rx="4" fill={WARN_BG} stroke={WARN} strokeDasharray="3 2" />
      <text x="130" y="24" textAnchor="middle" fontSize="10" fontWeight="600" fill="#262811">รอบ 30 วัน</text>
      <text x="261" y="24" textAnchor="middle" fontSize="10" fontWeight="600" fill={WARN}>เลย 3 วัน</text>
      <circle cx="20" cy="36" r="6" fill={INK} stroke="#fff" strokeWidth="2" />
      <line x1="241" y1="26" x2="241" y2="46" stroke={MUTED} />
      <circle cx="280" cy="36" r="6" fill={CLAY} stroke="#fff" strokeWidth="2" />
      <text x="20" y="60" textAnchor="start" fontSize="10" fill="#262811">นับล่าสุด 1 ต.ค.</text>
      <text x="236" y="60" textAnchor="end" fontSize="10" fill={MUTED}>ครบรอบ 31 ต.ค.</text>
      <text x="290" y="72" textAnchor="end" fontSize="10" fontWeight="600" fill={CLAY}>วันนี้ 3 พ.ย.</text>
    </svg>
  );
}

function CountSheet({ show }: { show: boolean }) {
  return (
    <Paper title={show ? "ให้เห็น" : "ไม่ให้เห็น"} icon={show ? <Eye className={icon} /> : <EyeOff className={icon} />}>
      <span className="block text-foreground">หมูสับ</span>
      <span className="flex items-center justify-between gap-1 text-muted-foreground">
        ระบบคิด
        <b className="font-display tabular-nums text-foreground">{show ? "9.0 kg" : "• • •"}</b>
      </span>
      <span className="mt-0.5 flex items-center justify-between gap-1 text-muted-foreground">
        นับได้
        <span className="h-[18px] w-14 rounded border border-border-strong bg-surface-sunk" />
      </span>
    </Paper>
  );
}

function ShowExpected() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <CountSheet show />
      <CountSheet show={false} />
    </div>
  );
}

function ProfitMethod() {
  return (
    <div className="grid gap-2">
      <Side>แบบที่ 1 · จากการนับสต็อก (ทั้งเดือน)</Side>
      <div className="flex flex-wrap items-center gap-1">
        <Box v="฿20,000" label="ต้นเดือน" />
        <Op>+</Op>
        <Box v="฿100,000" label="ซื้อเข้า" />
        <Op>−</Op>
        <Box v="฿25,000" label="นับสิ้นเดือน" />
        <Op>=</Op>
        <Box v="฿95,000" label="ใช้ไป" result />
      </div>
      <Side>แบบที่ 2 · จากสูตรของเมนู (ทุกวัน)</Side>
      <div className="flex flex-wrap items-center gap-1">
        <Box v="ขาย 40 จาน" label="กะเพราวันนี้" />
        <Op>×</Op>
        <Box v="หมูสับ 80 g" label="ตามสูตร" />
        <Op>=</Op>
        <Box v="3.2 kg" label="ใช้ไปวันนี้" result />
      </div>
    </div>
  );
}

function Per100({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Store className={icon} /> ทุก ฿100 ที่ขายได้
      </span>
      {children}
    </div>
  );
}

function FoodCost() {
  return (
    <Per100>
      <Bar
        h={30}
        parts={[
          { w: 32, label: "วัตถุดิบ ฿32", tone: "ink" },
          { w: 68, label: "ส่วนที่เหลือ ฿68", tone: "wash" },
        ]}
        marker={{ at: 35, label: "เป้า 35%" }}
      />
    </Per100>
  );
}

function PrimeCost() {
  return (
    <Per100>
      <Bar
        h={30}
        parts={[
          { w: 32, label: "วัตถุดิบ ฿32", tone: "ink" },
          { w: 30, label: "ค่าแรง ฿30", tone: "sage" },
          { w: 38, label: "ส่วนที่เหลือ", tone: "wash" },
        ]}
        marker={{ at: 65, label: "เป้า 65%" }}
      />
    </Per100>
  );
}

function Variance() {
  return (
    <div className="grid gap-1.5">
      <div className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-2">
        <Side>ระบบคิดว่าเหลือ</Side>
        <Bar parts={[{ w: 100, label: "฿10,000", tone: "sage" }]} h={22} />
        <Side>นับได้จริง</Side>
        <Bar
          h={22}
          parts={[
            { w: 85, label: "฿8,500", tone: "ink" },
            { w: 15, label: "หาย", tone: "bad" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Box v="หาย ฿1,500" bad />
        <Op>÷</Op>
        <Box v="฿100,000" label="ยอดขายช่วงนี้" />
        <Op>=</Op>
        <Box v="1.5%" label="เป้าไม่เกิน 2%" result />
      </div>
    </div>
  );
}

function Coverage() {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] text-muted-foreground">ยอดขายเดือนนี้ 100%</span>
      <Bar
        h={28}
        parts={[
          { w: 80, label: "เมนูที่มีสูตร 80%", tone: "ink" },
          { w: 20, label: "ไม่มีสูตร", tone: "wash" },
        ]}
        marker={{ at: 90, label: "เกณฑ์ 90%" }}
      />
      <p className="text-[11px] text-muted-foreground">
        ยังไม่ถึงเส้น → ต้นทุนขึ้นเป็น <b className="text-foreground">“อย่างน้อย 28%”</b> และยังไม่เทียบเป้า
      </p>
    </div>
  );
}

function SlowStock() {
  return (
    <svg viewBox="0 0 300 76" width="100%" role="img" aria-label="ซื้อ 28 ส.ค. ครบ 45 วัน 12 ต.ค. วันนี้ 31 ต.ค. 64 วัน">
      <text x="20" y="14" fontSize="10" fill={MUTED}>เส้นจันท์ 1 ถุง</text>
      <rect x="20" y="28" width="176" height="12" rx="4" fill={SAGE} />
      <rect x="198" y="28" width="82" height="12" rx="4" fill={WARN_BG} stroke={WARN} strokeDasharray="3 2" />
      <text x="108" y="24" textAnchor="middle" fontSize="10" fontWeight="600" fill="#262811">45 วัน</text>
      <text x="239" y="24" textAnchor="middle" fontSize="10" fontWeight="600" fill={WARN}>ค้างนาน</text>
      <circle cx="20" cy="34" r="6" fill={INK} stroke="#fff" strokeWidth="2" />
      <line x1="197" y1="24" x2="197" y2="44" stroke={MUTED} />
      <circle cx="280" cy="34" r="6" fill={CLAY} stroke="#fff" strokeWidth="2" />
      <text x="20" y="58" fontSize="10" fill="#262811">ซื้อ 28 ส.ค.</text>
      <text x="197" y="58" textAnchor="middle" fontSize="10" fill={MUTED}>12 ต.ค.</text>
      <text x="290" y="72" textAnchor="end" fontSize="10" fontWeight="600" fill={CLAY}>วันนี้ 31 ต.ค. · 64 วัน</text>
    </svg>
  );
}

function Departments() {
  const Dept = ({ i, name, sales, pct }: { i: ReactNode; name: string; sales: string; pct: string }) => (
    <div className="grid gap-0.5 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[11px]">
      <span className="flex items-center gap-1 font-display font-semibold text-foreground">
        {i}
        {name}
      </span>
      <Line l="ยอดขาย" r={sales} />
      <Line l="ค่าวัตถุดิบ" r={pct} />
    </div>
  );
  return (
    <div className="grid gap-1.5">
      <div className="mx-auto grid w-fit gap-0.5 rounded-lg bg-primary px-3 py-1 text-center font-display text-[11px] font-semibold text-primary-foreground">
        ทั้งร้าน · ขาย ฿100,000 · วัตถุดิบ 30%
      </div>
      <div aria-hidden className="text-center font-display text-sm leading-none text-muted-foreground">
        ↙ ↘
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Dept i={<ChefHat className={icon} />} name="ครัว" sales="฿70,000" pct="33%" />
        <Dept i={<Wine className={icon} />} name="บาร์" sales="฿30,000" pct="24%" />
      </div>
    </div>
  );
}

function DailyClose() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <Paper title="ใบปิดร้าน 31 ต.ค." icon={<ClipboardList className={icon} />}>
        <Line l="ยอดรวม" r="฿12,340" />
        <Line l="ลูกค้า" r="85 คน" />
      </Paper>
      <span className="grid place-items-center font-display text-[11px] font-semibold" style={{ color: CLAY }}>
        ≠
      </span>
      <Paper title="ไฟล์ POS วันเดียวกัน" icon={<FileSpreadsheet className={icon} />}>
        <Line l="ยอดรวม" r="฿9,800" />
        <span className="mt-0.5 block font-semibold text-warn">ไฟล์อาจไม่ครบทั้งวัน</span>
      </Paper>
    </div>
  );
}

function Refund() {
  const Arrow = () => <span aria-hidden className="font-display text-muted-foreground">→</span>;
  const Paid = () => <Box v={<HandCoins className="mx-auto h-4 w-4" />} label="พนักงานจ่าย" />;
  return (
    <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
      <Side>เปิด</Side>
      <span className="flex items-center gap-1">
        <Paid />
        <Arrow />
        <Box v="อนุมัติ" label="ทุกบิล" result />
        <Arrow />
        <Box v="คืนเงิน" />
      </span>
      <Side>ปิด</Side>
      <span className="flex items-center gap-1">
        <Paid />
        <Arrow />
        <Box v="บิล + สลิป" label="ครบ" />
        <Arrow />
        <Box v="คืนเงิน" label="ได้เลย" />
      </span>
    </div>
  );
}

export const HELP_PICTURES: Record<HelpKey, () => ReactNode> = {
  is_vat_registered: Vat,
  sales_day_cutoff: Cutoff,
  default_vat_rate_percent: VatRate,
  cancelled_sale_policy: Cancelled,
  staff_meal_stock_source: StaffMeal,
  staff_meal_daily_quota: StaffQuota,
  staff_meal_max_menu_price: MenuCeiling,
  par_warning_days: ParWarning,
  count_cycle_days: CountCycle,
  count_show_expected_default: ShowExpected,
  gross_profit_method: ProfitMethod,
  food_cost_target_pct: FoodCost,
  prime_cost_target_pct: PrimeCost,
  count_variance_target_pct: Variance,
  cost_coverage_min_pct: Coverage,
  slow_stock_days: SlowStock,
  enable_departments: Departments,
  daily_close_enabled: DailyClose,
  refund_approval_all: Refund,
};

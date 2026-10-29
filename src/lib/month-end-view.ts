// ============================================================
// คิดครัว — the month-end close as the page and the file see it
// ============================================================
// Plain module (no "use client"): the page, the client view and the download
// route all import from here, and a value imported from a client file arrives
// on the server as a reference instead (mise-ui-review §7).
//
// Dates become "YYYY-MM-DD" strings here, once, so the readiness notes the
// page shows are the same sentences the file carries (rule ME5).
// ============================================================

import type { MonthEnd } from "@/server/month-end";
import type { MonthEndFigures } from "@/lib/month-end-journal";

const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "2026-09" → "ก.ย. 2569". */
export function monthTitleTh(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${TH_MONTH[m - 1]} ${y + 543}`;
}

/** "2026-09" → "ก.ย. 69", for chips. */
export function monthChipTh(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${TH_MONTH[m - 1]} ${String(y + 543).slice(-2)}`;
}

/** "2026-09-27" → "27 ก.ย." */
export function dayLabelTh(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MONTH[m - 1]}`;
}

/** The month before / after "YYYY-MM". */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type MonthEndBranchView = Omit<MonthEnd["branches"][number], "lastCountDate"> & { lastCountDate: string | null };
export type MonthEndBillView = Omit<MonthEnd["bills"][number], "billDate"> & { billDate: string };
export type MonthEndView = {
  month: string;
  from: string;
  to: string;
  monthEnded: boolean;
  recipeMethod: boolean;
  vatRegistered: boolean;
  branches: MonthEndBranchView[];
  total: MonthEndBranchView;
  stock: MonthEnd["stock"];
  billCount: number;
  bills: MonthEndBillView[];
};

const cents = (n: number) => Math.round(n * 100);
const sum = (rows: MonthEndBranchView[], pick: (b: MonthEndBranchView) => number) =>
  rows.reduce((s, b) => s + cents(pick(b)), 0) / 100;

export function toMonthEndView(m: MonthEnd): MonthEndView {
  const branches: MonthEndBranchView[] = m.branches.map((b) => ({
    ...b,
    lastCountDate: b.lastCountDate ? isoDay(b.lastCountDate) : null,
  }));
  const anySold = branches.some((b) => b.sold !== null);
  const total: MonthEndBranchView = {
    branchId: "ALL",
    branchName: "รวมทั้งร้าน",
    branchCode: null,
    opening: sum(branches, (b) => b.opening),
    purchases: sum(branches, (b) => b.purchases),
    transfersIn: sum(branches, (b) => b.transfersIn),
    transfersOut: sum(branches, (b) => b.transfersOut),
    closing: sum(branches, (b) => b.closing),
    cogs: sum(branches, (b) => b.cogs),
    sold: anySold ? sum(branches, (b) => b.sold ?? 0) : null,
    waste: sum(branches, (b) => b.waste),
    staffMeals: sum(branches, (b) => b.staffMeals),
    shortage: sum(branches, (b) => b.shortage),
    other: sum(branches, (b) => b.other),
    lastCountDate: null,
    unpricedProducts: branches.reduce((s, b) => s + b.unpricedProducts, 0),
    negativeStockProducts: branches.reduce((s, b) => s + b.negativeStockProducts, 0),
    inTransitCount: branches.reduce((s, b) => s + b.inTransitCount, 0),
    inTransitValue: sum(branches, (b) => b.inTransitValue),
    draftReceipts: branches.reduce((s, b) => s + b.draftReceipts, 0),
  };
  return {
    month: m.month,
    from: isoDay(m.from),
    to: isoDay(m.to),
    monthEnded: m.monthEnded,
    recipeMethod: m.method === "RECIPE_CONSUMPTION",
    vatRegistered: m.vatRegistered,
    branches,
    total,
    stock: m.stock,
    billCount: m.billCount,
    bills: m.bills.map((b) => ({ ...b, billDate: isoDay(b.billDate) })),
  };
}

/**
 * What a shop may book on its own "stock short on count" account. Only a shop
 * that runs recipes can tell it apart from what was cooked: under นับสต๊อก the
 * ledger never hears about cooking, so every count's loss IS the usage.
 */
export function shrinkageOf(b: MonthEndBranchView, recipeMethod: boolean): number {
  return recipeMethod ? (cents(b.shortage) + cents(b.other)) / 100 : 0;
}

export function journalFigures(v: MonthEndView): MonthEndFigures[] {
  return v.branches.map((b) => ({
    branchName: b.branchName,
    opening: b.opening,
    purchases: b.purchases,
    transfersIn: b.transfersIn,
    transfersOut: b.transfersOut,
    closing: b.closing,
    shrinkage: shrinkageOf(b, v.recipeMethod),
  }));
}

export type ReadinessNote = {
  tone: "ok" | "warn" | "info";
  title: string;
  detail: string;
  /** Where to fix it, when there is somewhere. */
  href?: string;
  action?: string;
};

const money = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (name: string) => name.replace(/^สาขา/, "");

/** Rule ME5: everything worth knowing before the file goes, none of it a gate. */
export function readinessOf(v: MonthEndView): ReadinessNote[] {
  const notes: ReadinessNote[] = [];
  const multi = v.branches.length > 1;
  const who = (b: MonthEndBranchView) => (multi ? `${short(b.branchName)}: ` : "");

  if (!v.monthEnded) {
    notes.push({
      tone: "info",
      title: "เดือนนี้ยังไม่จบ",
      detail: "ตัวเลขยังเปลี่ยนได้จนถึงสิ้นเดือน — ส่งให้บัญชีหลังวันสุดท้ายของเดือนจะตรงที่สุด",
    });
  }

  const endTime = Date.parse(v.to);
  const stale = v.branches.filter((b) => !b.lastCountDate || endTime - Date.parse(b.lastCountDate) > 7 * 86_400_000);
  if (stale.length === 0) {
    const dates = v.branches.map((b) => `${multi ? short(b.branchName) + " " : ""}${dayLabelTh(b.lastCountDate!)}`).join(" · ");
    notes.push({
      tone: "ok",
      title: multi ? `นับสต๊อกใกล้สิ้นเดือนแล้วทั้ง ${v.branches.length} สาขา` : "นับสต๊อกใกล้สิ้นเดือนแล้ว",
      detail: `${dates} — ยอดสิ้นเดือนคือที่นับได้ บวกลบของที่เข้าออกหลังนับ`,
    });
  } else {
    for (const b of stale) {
      notes.push({
        tone: "warn",
        title: `${who(b)}${b.lastCountDate ? `นับสต๊อกล่าสุด ${dayLabelTh(b.lastCountDate)}` : "ยังไม่เคยนับสต๊อก"}`,
        detail: "สต๊อกสิ้นเดือนจึงเป็นยอดที่ระบบคิด ไม่ใช่ยอดที่นับ — นับภายใน 7 วันก่อนสิ้นเดือนจะเชื่อได้มากกว่า",
        href: "/stock-counts",
        action: "นับสต๊อก",
      });
    }
  }

  for (const b of v.branches) {
    if (b.draftReceipts > 0) {
      notes.push({
        tone: "warn",
        title: `${who(b)}ใบรับของ ${b.draftReceipts} ใบยังไม่ยืนยัน`,
        detail: "ของในใบเหล่านี้ยังไม่เข้าสต๊อกและยอดซื้อ",
        href: "/goods-receipts",
        action: "ดูใบรับของ",
      });
    }
    if (b.unpricedProducts > 0) {
      notes.push({
        tone: "warn",
        title: `${who(b)}วัตถุดิบ ${b.unpricedProducts} รายการยังไม่มีราคาทุน`,
        detail: "มูลค่าสต๊อกสิ้นเดือนอาจต่ำกว่าจริง",
        href: "/cost",
        action: "ใส่ราคา",
      });
    }
    if (b.negativeStockProducts > 0) {
      notes.push({
        tone: "warn",
        title: `${who(b)}สินค้า ${b.negativeStockProducts} รายการที่ระบบคิดว่าติดลบ`,
        detail: "มักแปลว่ามีของเข้าที่ไม่ได้บันทึกรับ — มูลค่าสต๊อกของรายการนั้นเป็นศูนย์",
        href: "/stock",
        action: "ดูสต๊อก",
      });
    }
    if (b.cogs < 0) {
      notes.push({
        tone: "warn",
        title: `${who(b)}ต้นทุนขายติดลบ ฿${money(-b.cogs)}`,
        detail: "สต๊อกสิ้นเดือนมากกว่าที่ยกมาบวกที่ซื้อ — มักเกิดจากซื้อของแล้วไม่ได้บันทึกบิล หรือนับเจอของมากกว่าที่ระบบมี",
        href: "/stock-counts",
        action: "ดูการนับ",
      });
    }
    if (b.inTransitCount > 0) {
      notes.push({
        tone: "info",
        title: `${who(b)}โอนของ ${b.inTransitCount} ใบยังไม่กดรับ ฿${money(b.inTransitValue)}`,
        detail: "นับเป็นของสาขาที่รับตั้งแต่ส่งออกแล้ว ไม่ต้องทำอะไรก่อนส่ง",
      });
    }
  }
  return notes;
}

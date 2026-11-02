// ============================================================
// คิดครัว — what a figure is waiting for (queue item 10, Kong 2026-11-02)
// ============================================================
// "ถ้าข้อมูลนำเสนอส่วนไหน ที่ต้องการข้อมูลส่วนที่ user ยังไม่ได้อัปโหลด
// หรือยังไม่ได้กรอก … มีปุ่มให้กด บอกว่าข้อมูลส่วนนี้คืออะไร มีตัวอย่าง แล้วมี
// ปุ่มให้ map ไปทำการอัปโหลดหรือกรอกได้ เอาให้ครบๆ"
//
// Round 3 of the design (mockup UqiLTa77CSent1W8HuoQoC, Kong: "เอาแบบที่ 1"):
// a figure with nothing behind it yet is drawn as its own OUTLINE — dashed,
// no colour, no numbers — never blurred. Blur reads as "the data is there and
// we are hiding it" (Kong), which is how a paywall looks; the Standard teaser
// keeps that meaning to itself.
//
// Two registries, both plain data so a server page and a client card can
// share them (mise-ui-review §7):
//   NEEDS    — each kind of data a shop enters: its name, where it is entered,
//              and how far along this shop is (from src/server/data-readiness.ts)
//   FIGURES  — each figure that waits on them: what question it answers and
//              how it is worked out, for the "นี่คืออะไร" window
// Which needs a figure is waiting on is the PAGE's to say — it already knows
// why its number is null (a blocker, a coverage, a method).
// ============================================================

export const NEED_KEYS = ["sales", "recipe", "price", "count", "posted", "receipt", "expense", "guests", "category", "par"] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

export type NeedCopy = {
  /** The data, as the shop calls it. */
  label: string;
  /** "เติมเอง…" — when the figure fills in by itself. */
  when: string;
  /** Where it is entered. */
  href: string;
  cta: string;
  /** A second way in, when there are two. */
  alt?: { href: string; cta: string };
};

export const NEEDS: Record<NeedKey, NeedCopy> = {
  sales: { label: "ยอดขาย", when: "เมื่อมียอดขาย", href: "/sales/import", cta: "นำเข้ายอดขาย" },
  recipe: { label: "สูตรของเมนู", when: "เมื่อมีสูตรของเมนู", href: "/menus/import", cta: "นำเข้าสูตร" },
  // A supplier's price list prices an order, not the stock (data-readiness.ts):
  // stock gets its cost from a goods receipt, or from the opening count.
  price: {
    label: "ราคาวัตถุดิบ",
    when: "เมื่อวัตถุดิบมีราคา",
    href: "/goods-receipts/new",
    cta: "รับสินค้า",
    alt: { href: "/stock-counts/new", cta: "นับสต๊อกพร้อมราคา" },
  },
  count: { label: "การนับสต๊อก", when: "เมื่อนับสต๊อกแล้ว", href: "/stock-counts/new", cta: "เริ่มนับสต๊อก" },
  posted: { label: "ตัดสต๊อกตามยอดขาย", when: "เมื่อตัดสต๊อกตามยอดขายแล้ว", href: "/consumption", cta: "ไปตัดสต๊อก" },
  receipt: { label: "ใบรับสินค้า", when: "เมื่อมีใบรับสินค้า", href: "/goods-receipts/new", cta: "รับสินค้า" },
  expense: { label: "ค่าใช้จ่าย", when: "เมื่อบันทึกค่าใช้จ่าย", href: "/expenses/new", cta: "บันทึกค่าใช้จ่าย" },
  guests: { label: "จำนวนลูกค้า", when: "เมื่อกรอกจำนวนลูกค้า", href: "/closing/day", cta: "กรอกจำนวนลูกค้า" },
  category: { label: "หมวดของเมนู", when: "เมื่อจัดหมวดเมนู", href: "/menus", cta: "จัดหมวดเมนู" },
  par: { label: "ขั้นต่ำของวัตถุดิบ", when: "เมื่อตั้งขั้นต่ำ", href: "/products", cta: "ตั้งขั้นต่ำ" },
};

/** What the shop has entered so far, within the reader's reach (src/server/data-readiness.ts). */
export type Readiness = {
  salesDays: number;
  menus: number;
  menusWithRecipe: number;
  products: number;
  pricedProducts: number;
  closedCounts: number;
  postedDays: number;
  receipts: number;
  expenses: number;
  guestDays: number;
  categorisedMenus: number;
  parLevels: number;
};

export type NeedStatus = { done: boolean; text: string };

const n = (x: number) => x.toLocaleString("th-TH");

/** One line per need for the checklist — what this shop has, never a promise. */
export function needStatus(key: NeedKey, r: Readiness): NeedStatus {
  switch (key) {
    case "sales":
      return r.salesDays > 0 ? { done: true, text: `มีแล้ว ${n(r.salesDays)} วัน` } : { done: false, text: "ยังไม่มีไฟล์ยอดขาย" };
    case "recipe":
      if (r.menus === 0) return { done: false, text: "ยังไม่มีเมนู · เมนูมาพร้อมไฟล์ยอดขาย" };
      return { done: r.menusWithRecipe >= r.menus, text: `มีสูตรแล้ว ${n(r.menusWithRecipe)} จาก ${n(r.menus)} เมนู` };
    case "price":
      if (r.products === 0) return { done: false, text: "ยังไม่มีวัตถุดิบในระบบ" };
      return { done: r.pricedProducts >= r.products, text: `มีราคาแล้ว ${n(r.pricedProducts)} จาก ${n(r.products)} รายการ` };
    case "count":
      return r.closedCounts > 0 ? { done: true, text: `ปิดใบนับแล้ว ${n(r.closedCounts)} ใบ` } : { done: false, text: "ยังไม่เคยนับ" };
    case "posted":
      return r.postedDays > 0 ? { done: true, text: `ตัดแล้ว ${n(r.postedDays)} วัน` } : { done: false, text: "ยังไม่ได้ตัดสต๊อก" };
    case "receipt":
      return r.receipts > 0 ? { done: true, text: `มีแล้ว ${n(r.receipts)} ใบ` } : { done: false, text: "ยังไม่มีใบรับสินค้า" };
    case "expense":
      return r.expenses > 0 ? { done: true, text: `มีแล้ว ${n(r.expenses)} บิล` } : { done: false, text: "ยังไม่มีบิลค่าใช้จ่าย" };
    case "guests":
      return r.guestDays > 0 ? { done: true, text: `กรอกแล้ว ${n(r.guestDays)} วัน` } : { done: false, text: "ยังไม่ได้กรอก" };
    case "category":
      if (r.menus === 0) return { done: false, text: "ยังไม่มีเมนู" };
      return { done: r.categorisedMenus >= r.menus, text: `จัดหมวดแล้ว ${n(r.categorisedMenus)} จาก ${n(r.menus)} เมนู` };
    case "par":
      return r.parLevels > 0 ? { done: true, text: `ตั้งแล้ว ${n(r.parLevels)} รายการ` } : { done: false, text: "ยังไม่ได้ตั้ง" };
  }
}

/** The outline a figure is drawn as while it waits (src/components/ui/WaitingFor.tsx). */
export type OutlineShape = "bars" | "line" | "quadrant" | "donut" | "heat" | "list" | "flow";

export type FigureCopy = {
  title: string;
  /** "ตอบว่า…" — the owner's question this figure answers. */
  question: string;
  /** One sentence: how it is worked out, under the example. */
  how: string;
  shape: OutlineShape;
};

export const FIGURES = {
  foodCost: {
    title: "ต้นทุนอาหาร",
    question: "ตอบว่าวัตถุดิบที่ใช้ไป คิดเป็นกี่ % ของยอดขาย",
    how: "วิธีนับสต๊อก: สต๊อกต้นงวด + ซื้อเข้า − สต๊อกปลายงวด · วิธีสูตรอาหาร: จำนวนจานที่ขาย × ต้นทุนต่อจาน แล้วหารด้วยยอดขาย",
    shape: "bars",
  },
  netProfit: {
    title: "กำไรสุทธิ",
    question: "ตอบว่ายอดขายช่วงนี้ เหลือเป็นกำไรหลังหักต้นทุนอาหารและค่าใช้จ่ายเท่าไร",
    how: "ยอดขาย − ต้นทุนอาหาร − ค่าใช้จ่ายดำเนินงาน (ค่าแรง ค่าเช่า ค่าน้ำไฟ และอื่น ๆ ที่บันทึกไว้)",
    shape: "flow",
  },
  salesToProfit: {
    title: "จากยอดขายสู่กำไร",
    question: "ตอบว่าเงินจากยอดขายแต่ละ 100 บาท ไปเป็นต้นทุนอาหาร ค่าใช้จ่าย และกำไร อย่างละเท่าไร",
    how: "ยอดขาย แยกเป็นต้นทุนอาหาร ค่าใช้จ่ายดำเนินงาน และส่วนที่เหลือเป็นกำไร",
    shape: "flow",
  },
  trend6: {
    title: "6 เดือนล่าสุด",
    question: "ตอบว่ายอดขาย ค่าใช้จ่าย และกำไร แต่ละเดือนขึ้นหรือลง",
    how: "แต่ละเดือนคิดแบบเดียวกับกำไรสุทธิ เดือนที่ยังคิดต้นทุนอาหารไม่ได้จะไม่มีจุดกำไร",
    shape: "bars",
  },
  dailySales: {
    title: "ยอดขายรายวัน",
    question: "ตอบว่าแต่ละวันขายได้เท่าไร วันไหนขายดี",
    how: "รวมยอดขายจากไฟล์ POS ของแต่ละวัน หลังหักส่วนลด ไม่รวม VAT และ service charge",
    shape: "bars",
  },
  recipeProfit: {
    title: "กำไรขั้นต้นจากสูตร",
    question: "ตอบว่ายอดขายช่วงนี้ เหลือเป็นกำไรหลังหักต้นทุนวัตถุดิบตามสูตรเท่าไร",
    how: "ยอดขาย − จำนวนจานที่ขาย × ต้นทุนต่อจานจากสูตร · เมนูที่ยังไม่มีสูตรไม่นับ และบอกยอดขายส่วนนั้นไว้",
    shape: "bars",
  },
  profitByWeekday: {
    title: "กำไรตามวันในสัปดาห์",
    question: "ตอบว่าวันไหนของสัปดาห์ได้กำไรมากที่สุด",
    how: "กำไรจากสูตรของแต่ละวัน เฉลี่ยตามวันในสัปดาห์",
    shape: "bars",
  },
  categoryMix: {
    title: "สัดส่วนหมวดเมนู",
    question: "ตอบว่ายอดขายหรือกำไรมาจากหมวดไหนมากที่สุด",
    how: "รวมยอดของเมนูในแต่ละหมวด เมนูที่ยังไม่ได้จัดหมวดอยู่ในกลุ่ม “ยังไม่ระบุหมวด”",
    shape: "donut",
  },
  categoryHeat: {
    title: "หมวดไหนขายดีวันไหน",
    question: "ตอบว่าแต่ละหมวดขายดีวันไหนของสัปดาห์",
    how: "ยอดเฉลี่ยต่อวันของแต่ละหมวด แยกตามวันในสัปดาห์ ช่องที่เข้มที่สุดคือวันที่ขายดีที่สุด",
    shape: "heat",
  },
  menuMovers: {
    title: "เมนูที่น่าจับตา",
    question: "ตอบว่าเมนูไหนกำไรขึ้นหรือลงมากที่สุด เทียบกับช่วงก่อน",
    how: "เทียบกำไรต่อวันของแต่ละเมนูระหว่างสองช่วง คิดเฉพาะเมนูที่มีสูตร",
    shape: "list",
  },
  menuEngineering: {
    title: "เมนูแต่ละกลุ่ม",
    question: "ตอบว่าเมนูไหนขายดีและกำไรดี เมนูไหนขายดีแต่กำไรต่อจานน้อย เมนูไหนกำไรดีแต่ขายได้น้อย",
    how: "แต่ละจุดคือหนึ่งเมนู วางตามจำนวนจานที่ขายกับกำไรต่อจาน เส้นแบ่งคือค่ากลางของร้านเอง ระบบชี้ว่าเมนูอยู่กลุ่มไหน ไม่ได้บอกว่าต้องทำอะไร",
    shape: "quadrant",
  },
  menuCost: {
    title: "ต้นทุนตามสูตร เทียบยอดขาย",
    question: "ตอบว่าวัตถุดิบตามสูตร คิดเป็นกี่ % ของยอดขายของเมนูที่มีสูตร",
    how: "จำนวนจานที่ขาย × ต้นทุนต่อจาน หารด้วยยอดขายของเมนูเหล่านั้น ใน 30 วันล่าสุด",
    shape: "bars",
  },
  overTarget: {
    title: "เกินเป้าต้นทุน",
    question: "ตอบว่าเมนูไหนต้นทุนต่อจานเกินเป้า % ที่ร้านตั้งไว้",
    how: "ต้นทุนต่อจาน หารด้วยราคาเฉลี่ยที่ขายได้จริง เทียบกับเป้าของเมนูนั้นหรือของร้าน",
    shape: "list",
  },
} as const satisfies Record<string, FigureCopy>;

export type FigureKey = keyof typeof FIGURES;

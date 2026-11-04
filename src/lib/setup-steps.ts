// ============================================================
// Mise — ตั้งร้าน: what each setup step is, where, and what it gives
// ============================================================
// Friend's-shop feedback (Kong 2026-10-31, mockup 1wgaH9Jfx8L7CxqfNHtdn3):
// after signup "ระบบปล่อยล้อฟรี" — the checklist lived only on the dashboard,
// so a shop that clicked into a step's page lost it, and no page said what to
// do there. One place for every step's words, read by the dashboard checklist,
// the setup bar on every page and its "ขั้นนี้ทำอะไร" box.
//
// A plain module: the dashboard (a Server Component) and the bar (a client
// one) both import it. Which steps are DONE is decided in
// src/server/onboarding.ts from what the shop has actually recorded.
//
// No promise here that is not measured (Kong 2026-10-30): no minutes per
// step, and what a step "gives" is what the system then shows, nothing more.
// ============================================================

/** Ordered as the setup runs. `team` is not here — it can happen any time. */
export const SETUP_STEPS = ["shop", "sales", "product", "supplier", "recipe", "count"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type SetupKey = SetupStep | "team";

export type SetupCopy = {
  title: string;
  /** Where the step is done. */
  href: string;
  cta: string;
  /** "ขั้นนี้ทำอะไร" */
  todo: string[];
  /** "ทำแล้วจะได้" */
  gets: string;
  /** "ระบบติ๊กให้เองเมื่อ" — what src/server/onboarding.ts checks. */
  doneWhen: string;
};

type Method = "PERIODIC_INVENTORY" | "RECIPE_CONSUMPTION";

export function setupCopy(key: SetupKey, method: Method): SetupCopy {
  switch (key) {
    case "shop":
      return {
        title: "ตั้งค่าร้าน",
        href: "/settings",
        cta: "ไปที่ตั้งค่าทั่วไป",
        todo: ["ตอบคำถามในหน้านี้ทีละหมวด ช่องที่มีปุ่ม ? กดดูได้ว่าคืออะไรและมีผลกับหน้าไหน", "ถ้าค่าที่ตั้งไว้ตรงกับร้านแล้ว กด “ใช้ค่าตามนี้” ได้เลย"],
        gets: "ตัวเลขทุกหน้าคิดตามแบบของร้าน",
        doneWhen: "เมื่อบันทึก หรือกดใช้ค่าตามนี้",
      };
    case "sales":
      return {
        title: "นำเข้ายอดขาย",
        href: "/sales/import",
        cta: "นำเข้ายอดขาย",
        todo: [
          "ดาวน์โหลดรายงานยอดขายจากหลังบ้าน POS ที่ร้านใช้ เป็นไฟล์ .csv หรือ Excel (.xlsx)",
          "เลือกยี่ห้อ POS อัปไฟล์ แล้วตอบทีละหน้าว่าคอลัมน์ไหนคืออะไร ทำครั้งแรกครั้งเดียว",
          "ตรวจที่ระบบอ่านทวน แล้วกดนำเข้า",
        ],
        gets: "ยอดขายรายวัน เมนูขายดี วันไหนขายดี",
        doneWhen: "เมื่อมียอดขายเข้าระบบอย่างน้อยหนึ่งวัน",
      };
    case "product":
      return {
        title: "เพิ่มวัตถุดิบ",
        href: "/products/import",
        cta: "นำเข้าวัตถุดิบ",
        todo: [
          "ดาวน์โหลดไฟล์ตัวอย่าง หรือใช้ไฟล์ที่ร้านมี",
          "อัปโหลด ตรวจรายการที่ระบบอ่านได้ แล้วกดนำเข้า",
          "หรือเพิ่มทีละตัวที่หน้าสินค้า/วัตถุดิบ",
        ],
        gets: "รายการที่ใช้นับสต็อกและจับคู่กับบิลซื้อ · ของที่ไม่อยู่ในรายการจะไม่ถูกนับ",
        doneWhen: "เมื่อมีวัตถุดิบอย่างน้อยหนึ่งรายการ",
      };
    case "supplier":
      return {
        title: "นำเข้าบิลซื้อย้อนหลัง",
        href: "/suppliers/import",
        cta: "นำเข้าบิลซื้อ",
        todo: [
          "ถ่ายรูปหรือสแกนบิลซื้อเก่า ให้ AI ของร้านอ่านเป็นไฟล์ตามตัวอย่าง",
          "อัปโหลด ระบบจับคู่แต่ละบรรทัดกับวัตถุดิบ",
          "ตรวจแล้วกดนำเข้า",
        ],
        gets: "ผู้ขาย และราคาของแต่ละวัตถุดิบ ใช้ใส่ราคาตอนนับเปิดระบบ",
        doneWhen: "เมื่อมีผู้ขายอย่างน้อยหนึ่งราย",
      };
    case "recipe":
      return {
        title: "สูตรของเมนู",
        href: "/menus/import",
        cta: "นำเข้าสูตร",
        todo: ["นำเข้าจากไฟล์ หรือเขียนเองเริ่มจากเมนูขายดี", "กดใช้สูตรทีละเมนู"],
        gets: "ต้นทุนต่อจาน และระบบหักวัตถุดิบตามยอดขาย",
        doneWhen: "เมื่อมีสูตรของเมนูอย่างน้อยหนึ่งเมนู",
      };
    case "count":
      return {
        title: "นับสต็อกเปิดระบบ",
        href: "/stock-counts/new",
        cta: "เริ่มนับ",
        todo: ["คืนสุดท้ายของเดือน หลังปิดร้าน", "นับทุกรายการพร้อมราคาทุน", "ปิดใบนับ"],
        gets:
          method === "RECIPE_CONSUMPTION"
            ? "ยอดตั้งต้นของสต็อก · ระบบหักวัตถุดิบตามยอดขายต่อจากยอดนี้ และนับครั้งต่อไปจะเห็นว่าตัดตามสูตรตรงกับที่ใช้จริงไหม"
            : "ยอดตั้งต้น · นับอีกครั้งสิ้นเดือนถัดไป แล้วจะได้ต้นทุนวัตถุดิบและกำไรของเดือน",
        doneWhen: "เมื่อปิดใบนับใบแรก",
      };
    case "team":
      return {
        title: "เชิญผู้ใช้งาน",
        href: "/settings/members",
        cta: "เชิญคน",
        todo: ["ใส่อีเมลของคนในร้าน เลือกหน้าที่และสาขา", "เขาได้อีเมลแจ้ง แล้วเข้าระบบด้วยอีเมลนั้นได้เลย"],
        gets: "ครัว จัดซื้อ แคชเชียร์ ทำงานในระบบเดียวกัน แต่ละคนเห็นเฉพาะงานของตัวเอง",
        doneWhen: "เมื่อมีคนในร้านเพิ่มอีกอย่างน้อยหนึ่งคน",
      };
  }
}

/**
 * The step a page belongs to, so the bar can say "กำลังทำอยู่ในหน้านี้" and open
 * its box there. /settings alone is the shop step — its sub-pages are not.
 */
export function setupStepOfPath(path: string): SetupKey | null {
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  if (path === "/settings") return "shop";
  if (under("/settings/members")) return "team";
  if (under("/sales/import")) return "sales";
  if (under("/products/import") || path === "/products/new") return "product";
  if (under("/suppliers/import") || path === "/suppliers/new") return "supplier";
  if (under("/menus/import")) return "recipe";
  if (under("/stock-counts")) return "count";
  return null;
}

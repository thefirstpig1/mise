// ============================================================
// คิดครัว — what a figure is waiting for (queue item 10, Kong 2026-11-02)
// ============================================================
// Every "ไปใส่ข้อมูล" button must land on a page that exists, and the
// checklist line must say what the shop HAS — a need counts as done only when
// the count says so.
// ============================================================

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NEEDS, NEED_KEYS, needStatus, FIGURES, type Readiness } from "@/lib/data-needs";

const NONE: Readiness = {
  salesDays: 0,
  menus: 0,
  menusWithRecipe: 0,
  products: 0,
  pricedProducts: 0,
  closedCounts: 0,
  postedDays: 0,
  receipts: 0,
  expenses: 0,
  guestDays: 0,
  categorisedMenus: 0,
  parLevels: 0,
};

const pageFor = (href: string) => join(process.cwd(), "src/app/(app)", href.split("?")[0], "page.tsx");

describe("NEEDS", () => {
  it("DN1 — every button goes to a page that exists", () => {
    for (const k of NEED_KEYS) {
      const n = NEEDS[k];
      expect(existsSync(pageFor(n.href)), `${k} → ${n.href}`).toBe(true);
      if (n.alt) expect(existsSync(pageFor(n.alt.href)), `${k} alt → ${n.alt.href}`).toBe(true);
    }
  });

  it("DN2 — a shop that has entered nothing has no need done", () => {
    for (const k of NEED_KEYS) expect(needStatus(k, NONE).done, k).toBe(false);
  });

  it("DN3 — recipes are done only when every menu has one, and say how many", () => {
    expect(needStatus("recipe", { ...NONE, menus: 42, menusWithRecipe: 3 })).toEqual({ done: false, text: "มีสูตรแล้ว 3 จาก 42 เมนู" });
    expect(needStatus("recipe", { ...NONE, menus: 42, menusWithRecipe: 42 }).done).toBe(true);
    expect(needStatus("recipe", NONE).text).toBe("ยังไม่มีเมนู · เมนูมาพร้อมไฟล์ยอดขาย");
  });

  it("DN4 — prices: done only when every raw ingredient has one", () => {
    expect(needStatus("price", { ...NONE, products: 38, pricedProducts: 12 })).toEqual({ done: false, text: "มีราคาแล้ว 12 จาก 38 รายการ" });
    expect(needStatus("price", { ...NONE, products: 38, pricedProducts: 38 }).done).toBe(true);
  });

  it("DN5 — a counted thing is done from the first one", () => {
    expect(needStatus("sales", { ...NONE, salesDays: 26 })).toEqual({ done: true, text: "มีแล้ว 26 วัน" });
    expect(needStatus("count", { ...NONE, closedCounts: 1 })).toEqual({ done: true, text: "ปิดใบนับแล้ว 1 ใบ" });
    expect(needStatus("posted", { ...NONE, postedDays: 1_250 }).text).toBe("ตัดแล้ว 1,250 วัน");
  });

  it("DN6 — every figure names a question and how it is worked out", () => {
    for (const [k, f] of Object.entries(FIGURES)) {
      expect(f.question.startsWith("ตอบว่า"), k).toBe(true);
      expect(f.how.length, k).toBeGreaterThan(10);
    }
  });

});

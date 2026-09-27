// ============================================================
// Mise — every door in the app, grouped (Part 35 L4)
// ============================================================
// Until Part 35 this list lived on the dashboard as a grid of nineteen links,
// which made the dashboard the only way anywhere: open a recipe, and the way
// to the stock screen was back to the dashboard first. It is now the sidebar,
// on every page, grouped by the job a person is doing rather than by table.
//
// The capability beside each link is the SAME one its page declares to
// `requireTenant` — tests/permissions-nav.test.ts reads both and fails if they
// drift, because a menu that offers a door which refuses looks exactly like a
// bug (Part 28 L5, ADR 0029 Q13), and the opposite drift hides a page someone
// is allowed to use, silently, for ever.
// ============================================================

import type { Requirement } from "@/lib/permissions/service";

export interface NavItem {
  href: string;
  label: string;
  need: Requirement;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "ภาพรวม",
    items: [{ href: "/dashboard", label: "แดชบอร์ด", need: "any:member" }],
  },
  {
    label: "ซื้อของ",
    items: [
      { href: "/suppliers", label: "ซัพพลายเออร์", need: "any:member" },
      { href: "/purchase-orders", label: "ใบสั่งซื้อ", need: "purchase:write" },
      { href: "/goods-receipts", label: "รับสินค้า", need: "receive:write" },
    ],
  },
  {
    label: "สต๊อก",
    items: [
      { href: "/products", label: "สินค้า/วัตถุดิบ", need: "any:member" },
      { href: "/stock", label: "สต๊อกคงเหลือ", need: "any:member" },
      { href: "/stock-counts", label: "นับสต๊อก", need: "count:write" },
      { href: "/waste", label: "ของเสีย", need: "stock:write" },
      { href: "/transfers", label: "โอนของระหว่างสาขา", need: "any:member" },
      { href: "/staff-meals", label: "มื้อพนักงาน", need: "staffmeal:write" },
    ],
  },
  {
    label: "ขายและเมนู",
    items: [
      { href: "/sales", label: "ยอดขาย", need: "sales:view" },
      { href: "/menus", label: "เมนู", need: "any:member" },
      { href: "/recipes", label: "สูตรอาหาร", need: "any:member" },
      { href: "/menus/lab", label: "ทดลองเมนู", need: "recipe:write" },
      { href: "/menus/coverage", label: "เมนูที่ยังไม่มีสูตร", need: "sales:view" },
      { href: "/consumption", label: "ตัดสต๊อกตามยอดขาย", need: "consumption:post" },
    ],
  },
  {
    label: "การเงิน",
    items: [
      { href: "/expenses", label: "ค่าใช้จ่าย", need: "expense:view" },
      { href: "/cost", label: "ต้นทุน", need: "cost:view" },
      { href: "/cost/departments", label: "ต้นทุนตามแผนก", need: "cost:view" },
      { href: "/cost/leaks", label: "ของหายไปไหน", need: "cost:view" },
    ],
  },
  {
    label: "ตั้งค่า",
    items: [
      { href: "/settings", label: "ตั้งค่าร้าน", need: "settings:write" },
      { href: "/settings/branches", label: "สาขา", need: "settings:write" },
      { href: "/settings/departments", label: "แผนก", need: "settings:write" },
      { href: "/categories", label: "หมวดบัญชี", need: "any:member" },
      { href: "/settings/members", label: "คนในร้าน", need: "member:manage" },
    ],
  },
];

/** Every link, flat — for the drift test and for "which item is current". */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * The item a path belongs to: the LONGEST href that prefixes it, so
 * /cost/leaks lights "ของหายไปไหน" rather than "ต้นทุน", and /recipes/abc
 * lights "สูตรอาหาร".
 */
export function currentNavHref(pathname: string): string | null {
  let best: string | null = null;
  for (const item of NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(item.href + "/")) {
      if (!best || item.href.length > best.length) best = item.href;
    }
  }
  return best;
}

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
  /** Shown only when the shop has switched this add-on on (ADR 0042). */
  addon?: "dailyClose";
  /**
   * Other address prefixes that are this item (Kong 2026-11-05: merged pages
   * keep their own addresses — /advances is a tab of สำรองจ่าย).
   */
  also?: readonly string[];
  /** For a reader without `need` who holds this one: the same item opens here. */
  alt?: { href: string; need: Requirement };
  /** Set by the layout when `alt` replaced `href` — the item's identity stays `href`. */
  match?: string;
}

export interface NavGroup {
  label: string;
  /** A second line under the heading that says what level the group is about (Kong 2026-11-02). */
  hint?: string;
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
      { href: "/purchase-requests", label: "ใบขอซื้อ", need: "purchase:request" },
      { href: "/suppliers", label: "ผู้ขาย", need: "any:member" },
      { href: "/purchase-orders", label: "ใบสั่งซื้อ", need: "purchase:write" },
      { href: "/goods-receipts", label: "รับสินค้า", need: "receive:write" },
      // ADR 0037 Q6 + Q5, one item since 2026-11-05 (Kong: merge what reads as the
      // same thing): what a staff member paid with their own money, and paying it back.
      { href: "/my-advances", label: "สำรองจ่าย", need: "purchase:self", also: ["/advances"], alt: { href: "/advances", need: "refund:pay" } },
    ],
  },
  {
    label: "สต็อก",
    items: [
      { href: "/products", label: "สินค้า/วัตถุดิบ", need: "any:member" },
      { href: "/stock", label: "ภาพรวมสต็อก", need: "any:member" },
      { href: "/stock-counts", label: "นับสต็อก", need: "count:write" },
      { href: "/waste", label: "ของเสีย", need: "waste:write" },
      // ADR 0040: what the kitchen made — the cook who made it records it (Q6).
      { href: "/production", label: "การผลิต", need: "stock:write" },
      { href: "/transfers", label: "โอนของระหว่างสาขา", need: "any:member" },
      { href: "/staff-meals", label: "มื้อพนักงาน", need: "staffmeal:write" },
    ],
  },
  {
    label: "ขายและเมนู",
    items: [
      { href: "/sales", label: "ยอดขาย", need: "sales:view" },
      { href: "/closing", label: "ปิดร้านประจำวัน", need: "any:member", addon: "dailyClose" },
      // ทดลองเมนู is the "กำลังทดลอง" tab of this page since 2026-11-05.
      { href: "/menus", label: "จัดการเมนู", need: "any:member" },
      { href: "/consumption", label: "ตัดสต็อกตามยอดขาย", need: "consumption:post" },
    ],
  },
  {
    label: "การเงิน",
    items: [
      // Kong 2026-11-05: one item each, the rest are tabs. The analysis stays the
      // way in (Kong 2026-10-28: it is what an owner opens this section for).
      { href: "/expenses/analysis", label: "ค่าใช้จ่าย", need: "expense:view", also: ["/expenses"] },
      // ภาพรวม · ตามแผนก · ของหายไปไหน · ราคาวัตถุดิบ — all under /cost.
      { href: "/cost", label: "ต้นทุน", need: "cost:view" },
      // Kong 2026-10-29: the month's stock and cost of sales, in the accounting program's own file.
      { href: "/month-end", label: "ปิดเดือน · ส่งให้บัญชี", need: "cost:view" },
    ],
  },
  // Kong 2026-11-02: "ทำให้มันชัดเจน ว่าตรงไหนจัดการร้าน ตรงไหนจัดการสาขา" —
  // "ตั้งค่าร้าน" read as "this shop" to a branch manager, so each group names
  // its level. ร้าน = the whole business (every branch), สาขา = one location.
  {
    label: "ตั้งค่าทั้งร้าน",
    hint: "ใช้ร่วมกันทุกสาขา",
    items: [
      { href: "/settings", label: "ตั้งค่าทั่วไป", need: "settings:write" },
      { href: "/settings/members", label: "ผู้ใช้งาน", need: "member:manage" },
      { href: "/settings/permissions", label: "สิทธิ์การใช้งาน", need: "member:manage" },
      { href: "/settings/departments", label: "แผนก", need: "settings:write" },
      { href: "/categories", label: "หมวดบัญชี", need: "any:member" },
    ],
  },
  {
    label: "ตั้งค่าสาขา",
    hint: "แต่ละสาขาแยกกัน",
    items: [{ href: "/settings/branches", label: "สาขาทั้งหมด", need: "settings:write" }],
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
  let bestLength = 0;
  for (const item of NAV_ITEMS) {
    for (const prefix of [item.href, ...(item.also ?? [])]) {
      if (pathname === prefix || pathname.startsWith(prefix + "/")) {
        if (!best || prefix.length > bestLength) {
          best = item.href;
          bestLength = prefix.length;
        }
      }
    }
  }
  return best;
}

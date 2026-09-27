// ============================================================
// Mise — the categories every new shop starts with (Part 35 L2)
// ============================================================
// These were English (Meat, Vegetables, Rent…) from Sprint 0 until a demo
// shop was seeded for Kong to use and the first thing on /categories was a
// list of English words in a Thai product.
//
// ONE LIST, TWO READERS. `tenant-init.ts` seeds from `th`, and
// `prisma/manual/category_names_th.sql` renames rows still carrying `en` in
// shops created before this Part. The SQL cannot import this file, so
// `tests/category-seed.test.ts` reads the SQL and fails if the two lists ever
// disagree — the same arrangement as manual-sql-order.mjs and its test.
// ============================================================

export type SeedCategory = {
  account: "COGS" | "OpEx";
  en: { section: string; group: string };
  th: { section: string; group: string };
};

export const DEFAULT_CATEGORIES: readonly SeedCategory[] = [
  // COGS — food
  { account: "COGS", en: { section: "Food", group: "Meat" }, th: { section: "อาหาร", group: "เนื้อสัตว์" } },
  { account: "COGS", en: { section: "Food", group: "Seafood" }, th: { section: "อาหาร", group: "อาหารทะเล" } },
  { account: "COGS", en: { section: "Food", group: "Vegetables" }, th: { section: "อาหาร", group: "ผักและผลไม้" } },
  { account: "COGS", en: { section: "Food", group: "Dry goods" }, th: { section: "อาหาร", group: "ของแห้งและเครื่องปรุง" } },
  // COGS — beverage
  { account: "COGS", en: { section: "Beverage", group: "Coffee" }, th: { section: "เครื่องดื่ม", group: "กาแฟและชา" } },
  { account: "COGS", en: { section: "Beverage", group: "Alcohol" }, th: { section: "เครื่องดื่ม", group: "เครื่องดื่มแอลกอฮอล์" } },
  { account: "COGS", en: { section: "Beverage", group: "Soft drinks" }, th: { section: "เครื่องดื่ม", group: "น้ำอัดลมและน้ำดื่ม" } },
  // COGS — packaging
  { account: "COGS", en: { section: "Packaging", group: "Single-use" }, th: { section: "บรรจุภัณฑ์", group: "ภาชนะใช้ครั้งเดียว" } },
  // OpEx — utilities
  { account: "OpEx", en: { section: "Utilities", group: "Electricity" }, th: { section: "สาธารณูปโภค", group: "ค่าไฟฟ้า" } },
  { account: "OpEx", en: { section: "Utilities", group: "Water" }, th: { section: "สาธารณูปโภค", group: "ค่าน้ำประปา" } },
  { account: "OpEx", en: { section: "Utilities", group: "Internet" }, th: { section: "สาธารณูปโภค", group: "อินเทอร์เน็ตและโทรศัพท์" } },
  // OpEx — rent
  { account: "OpEx", en: { section: "Rent", group: "Building" }, th: { section: "ค่าเช่า", group: "ค่าเช่าร้าน" } },
  // OpEx — labour
  { account: "OpEx", en: { section: "Labor", group: "Salary" }, th: { section: "ค่าแรง", group: "เงินเดือน" } },
  { account: "OpEx", en: { section: "Labor", group: "Service charge" }, th: { section: "ค่าแรง", group: "เซอร์วิสชาร์จพนักงาน" } },
  // OpEx — marketing
  { account: "OpEx", en: { section: "Marketing", group: "Online ads" }, th: { section: "การตลาด", group: "โฆษณาออนไลน์" } },
  // OpEx — commission (Part 19, ADR 0019 Q12). A delivery platform keeps
  // 25-32% of an order; the Thai trade calls that "GP", which is NOT this
  // project's gross profit. Seeded so every shop files it in the same place.
  // Revenue stays the price on the bill — the commission is an expense, never
  // a deduction from revenue (rule P16).
  { account: "OpEx", en: { section: "Commission", group: "Delivery apps" }, th: { section: "ค่าคอมมิชชัน", group: "แอปเดลิเวอรี" } },
  // OpEx — professional services
  { account: "OpEx", en: { section: "Professional", group: "Accounting" }, th: { section: "ค่าบริการวิชาชีพ", group: "ค่าทำบัญชี" } },
];

/**
 * The on-demand bucket for a receipt line whose product has no category
 * (expense.ts, resolveUncategorisedCategoryId). Its SECTION must match the
 * food section above, or a shop's first uncategorised receipt grows a second
 * "Food" heading beside "อาหาร".
 */
export const UNCATEGORISED = {
  account: "COGS",
  en: { section: "Food", group: "ไม่ระบุหมวด" },
  th: { section: "อาหาร", group: "ไม่ระบุหมวด" },
} as const;

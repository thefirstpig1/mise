// ============================================================
// คิดครัว — raw Excel export: what a download may ask for (2026-10-31)
// ============================================================
// Kong 2026-10-31: "ดึงข้อมูลดิบเป็น Excel" — the first quality-of-life piece of
// the Standard package (open to every shop until Standard is sold). The query
// string is the page's own filters plus a period; it is parsed here and never
// trusted further: the branch is narrowed to the reader's reach again on the
// server, and money columns follow the reader's cost ticket, not the URL.
//
// Plain module (no "use client"): the route, the server and the button all
// import from here (mise-ui-review §7).
// ============================================================

import { z } from "zod";
import { GOODS_RECEIPT_STATUS_VALUES } from "./goods-receipt";
import { STOCK_COUNT_STATUS_VALUES } from "./stock-count";
import { EXPENSE_PAYMENT_STATUS_VALUES, EXPENSE_SOURCE_VALUES } from "./expense";
import { MOVEMENT_ORIGIN_VALUES, MOVEMENT_TYPE_VALUES, SOURCE_TYPE_VALUES } from "./stock-movement";

export const EXPORT_DATASETS = ["sales", "goods-receipts", "expenses", "stock-counts", "stock-movements", "products"] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

/** What one row of each file is, in the shop's words — the dialog says this before anyone downloads. */
export const EXPORT_DATASET_TH: Record<ExportDataset, { title: string; row: string; slug: string; period: boolean }> = {
  sales: { title: "ยอดขาย", row: "เมนูที่ขาย ต่อวัน ต่อสาขา (หรือต่อบิล ถ้าไฟล์ POS แยกบิล)", slug: "sales", period: true },
  "goods-receipts": { title: "รับสินค้า", row: "รายการในใบรับสินค้า ทีละบรรทัด", slug: "goods-receipts", period: true },
  expenses: { title: "ค่าใช้จ่าย", row: "รายการในบิลค่าใช้จ่าย ทีละบรรทัด พร้อมแผ่นสรุปรายบิล", slug: "expenses", period: true },
  "stock-counts": { title: "นับสต๊อก", row: "สินค้าที่นับในแต่ละใบนับ พร้อมจำนวนที่ระบบคาด", slug: "stock-counts", period: true },
  "stock-movements": { title: "ความเคลื่อนไหวสต๊อก", row: "ทุกการเข้าออกของสินค้า (รับ ใช้ ทิ้ง โอน นับ)", slug: "stock-movements", period: true },
  products: { title: "สินค้าและวัตถุดิบ", row: "สินค้าแต่ละตัว พร้อมหน่วย", slug: "products", period: false },
};

/** One file never spans more than this many days — a 1 GB machine writes it. */
export const EXPORT_MAX_DAYS = 366;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const day = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());
const uuid = z.preprocess(blank, z.string().uuid().optional());

export const rawExportQuerySchema = z
  .object({
    dataset: z.enum(EXPORT_DATASETS),
    from: day,
    to: day,
    branch: uuid,
    /** goods-receipts / stock-counts status, or the expense payment status. */
    status: z.preprocess(
      blank,
      z
        .enum([...new Set([...GOODS_RECEIPT_STATUS_VALUES, ...STOCK_COUNT_STATUS_VALUES, ...EXPENSE_PAYMENT_STATUS_VALUES])] as [string, ...string[]])
        .optional()
    ),
    category: uuid,
    product: uuid,
    supplier: uuid,
    type: z.preprocess(blank, z.enum(MOVEMENT_TYPE_VALUES).optional()),
    origin: z.preprocess(blank, z.enum(MOVEMENT_ORIGIN_VALUES).optional()),
    /** The history page's older single-source filter, still reachable from links. */
    stype: z.preprocess(blank, z.enum(SOURCE_TYPE_VALUES).optional()),
    source: z.preprocess(blank, z.enum(EXPENSE_SOURCE_VALUES).optional()),
    flagged: z.preprocess(blank, z.enum(["1"]).optional()),
    /** "1" answers with the row count only — the dialog's "392 แถว". */
    count: z.preprocess(blank, z.enum(["1"]).optional()),
  })
  .superRefine((q, ctx) => {
    if (!EXPORT_DATASET_TH[q.dataset].period) return;
    if (!q.from || !q.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["from"], message: "กรุณาเลือกช่วงวันที่" });
      return;
    }
    const from = Date.parse(`${q.from}T00:00:00Z`);
    const to = Date.parse(`${q.to}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "ช่วงวันที่ไม่ถูกต้อง" });
    } else if ((to - from) / 86_400_000 + 1 > EXPORT_MAX_DAYS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "ดาวน์โหลดได้ครั้งละไม่เกิน 12 เดือน" });
    }
  });

export type RawExportQuery = z.infer<typeof rawExportQuerySchema>;

const be = (iso: string) => `${Number(iso.slice(0, 4)) + 543}${iso.slice(4)}`;

/**
 * "คิดครัว-รับสินค้า-2569-09-01_2569-09-30-ทุกสาขา.xlsx" — what the file is, of
 * which days and which branch, so a folder of them sorts and reads at a glance.
 * One function for the dialog's preview and the server's header, so the name
 * shown before the press is the name that arrives.
 */
export function exportFileName(dataset: ExportDataset, from: string | undefined, to: string | undefined, branchName: string | null) {
  const meta = EXPORT_DATASET_TH[dataset];
  const span = from && to ? (from === to ? `-${be(from)}` : `-${be(from)}_${be(to)}`) : "";
  const asciiSpan = from && to ? (from === to ? `-${from}` : `-${from}_${to}`) : "";
  return {
    thai: `คิดครัว-${meta.title.replace(/\s+/g, "")}${span}-${branchName ?? "ทุกสาขา"}.xlsx`,
    ascii: `kitkrua-${meta.slug}${asciiSpan}.xlsx`,
  };
}

/** The dialog's branch line and the file name's branch, from what the page is showing. */
export function exportBranchScope(branches: readonly { id: string; name: string }[], branchId: string | undefined) {
  const picked = branchId ? branches.find((b) => b.id === branchId) : undefined;
  return picked
    ? { line: `สาขา: ${picked.name}`, name: picked.name }
    : { line: `สาขา: ${branches.length > 1 ? `ทุกสาขาที่คุณดูได้ (${branches.length} สาขา)` : (branches[0]?.name ?? "—")}`, name: branches.length === 1 ? branches[0].name : null };
}

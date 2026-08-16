// ============================================================
// Mise — Goods Receipt validation (Sprint 2 Part 13 L2; ADR 0013)
// ============================================================
// One write schema for the DRAFT document (header + lines), the two lifecycle
// transitions a user can trigger that carry data (void, close-short), and the
// list filter. Mirrors validations/purchase-order.ts.
//
// What is NOT here, by design:
//   - `tenantId` / `receivedBy` — from requireTenant + session server-side.
//   - `grNumber` — generated server-side at create ({BRANCH_CODE}-GR-####).
//   - The SNAPSHOT fields (`receivedUnitName`, `toBaseRatio`, `lineTotalActual`)
//     and `hasDiscrepancy`. The client sends what was *counted*; the server
//     resolves and freezes what it *means* (ADR 0013 Q1/Q7) — a client that
//     could post its own `toBaseRatio` could rewrite how much stock arrived.
//   - Ownership checks and "the unit belongs to the product" — DB lookups (L3).
//   - Status transition legality (only DRAFT is editable, Q2) — needs the row's
//     current status, so it is enforced in the *Logic layer.
//   - **The over-receipt note rule (Q3).** Whether a line over-delivers is only
//     knowable from the PO line's `qty_ordered − qty_received`, which is a DB
//     read. Requiring the note here would mean trusting a client-sent
//     "outstanding" number, so the rule lives in L3b as a typed error mapped
//     back onto that line's `notes` field. The form mirrors it for feedback.
//
// Error messages are Thai (shown to user); code is English.
// ============================================================

import { z } from "zod";
import type { GoodsReceiptStatus } from "@prisma/client";
import {
  addDays,
  bangkokDayEndUtc,
  bangkokDayStartUtc,
  computeBangkokToday,
} from "@/lib/bangkok-date";

// ------------------------------------------------------------
// Enum — local const array (the Sprint 1 / Part 10 / Part 11 pattern)
// ------------------------------------------------------------
// z.nativeEnum would pull the Prisma client into any Client Component importing
// this file; the local const + type-only drift guard costs nothing at runtime
// and still fails `pnpm tsc` if schema.prisma renames a member.

export const GOODS_RECEIPT_STATUS_VALUES = [
  "DRAFT",
  "CONFIRMED",
  "VOIDED",
] as const;

type _AssertGrStatus = GoodsReceiptStatus extends (typeof GOODS_RECEIPT_STATUS_VALUES)[number]
  ? (typeof GOODS_RECEIPT_STATUS_VALUES)[number] extends GoodsReceiptStatus
    ? true
    : never
  : never;
export type _GrEnumDriftGuard = [_AssertGrStatus];

/** Thai gloss per status — the list badges + detail header. */
export const GOODS_RECEIPT_STATUS_LABELS_TH: Record<
  (typeof GOODS_RECEIPT_STATUS_VALUES)[number],
  string
> = {
  DRAFT: "ร่าง",
  CONFIRMED: "รับเข้าคลังแล้ว",
  VOIDED: "ยกเลิกใบรับ",
};

/** PO statuses a receipt may be raised against (ADR 0013 Q1/Q3). */
export const RECEIVABLE_PO_STATUSES = [
  "SENT",
  "PARTIALLY_RECEIVED",
  // A fully-received order can still take one more delivery: Q3 says an
  // over-delivery is recorded, never refused.
  "RECEIVED",
] as const;

// ------------------------------------------------------------
// Shared field pieces (inline per-file, matching the Sprint 1 convention)
// ------------------------------------------------------------

/** A missing/blank field means "not provided" → null. */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/** Blank → undefined, for `.optional()` filters. */
const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/**
 * Decimal-place guard by `toFixed` ROUND-TRIP, never `Number.isInteger(n * 10^k)`
 * — the multiply trick rejects ~1.2% of legitimate 3-decimal values (Pitfall #30).
 */
const withinDecimals = (places: number) => (n: number) =>
  Number(n.toFixed(places)) === n;

/** `qty_received_actual` is Decimal(15,3) — 12 integer digits, 3 dp. */
export const QTY_MAX = 999_999_999_999.999;
/** `unit_price_actual` is Decimal(15,4) — 11 integer digits, 4 dp. */
export const UNIT_PRICE_MAX = 99_999_999_999.9999;
/** Keep one receipt (and therefore one confirm transaction) a sane size. */
export const MAX_LINES = 200;
/** Same window the ledger already enforces on a manual adjustment (ADR 0011 Q5). */
export const MAX_BACKDATE_DAYS = 90;

// ------------------------------------------------------------
// 1. Line
// ------------------------------------------------------------

/**
 * One received product.
 *
 * `qtyReceivedActual` is expressed in `receivedUnitId` — for a PO-based line the
 * unit the order was placed in, so the two documents talk about the same thing.
 * It is always POSITIVE here: a reversal line is written by the void path, never
 * submitted by a user (Q6).
 *
 * `purchaseOrderItemId` is nullable — a standalone receipt has no order line to
 * point at (Q1), and neither does an extra item that arrived alongside one.
 */
export const goodsReceiptLineInputSchema = z
  .object({
    purchaseOrderItemId: z.preprocess(
      blankToNull,
      z.string().uuid("รายการในใบสั่งซื้อไม่ถูกต้อง").nullable()
    ),
    productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
    receivedUnitId: z.string().uuid("หน่วยที่รับไม่ถูกต้อง"),
    qtyReceivedActual: z.coerce
      .number({ invalid_type_error: "จำนวนที่รับไม่ถูกต้อง" })
      .positive("จำนวนที่รับต้องมากกว่า 0")
      .max(QTY_MAX, "จำนวนที่รับเกินค่าที่ระบบรองรับ")
      .refine(withinDecimals(3), "จำนวนที่รับต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
    unitPriceActual: z.coerce
      .number({ invalid_type_error: "ราคาไม่ถูกต้อง" })
      .min(0, "ราคาต้องไม่ติดลบ")
      .max(UNIT_PRICE_MAX, "ราคาเกินค่าที่ระบบรองรับ")
      .refine(withinDecimals(4), "ราคามีทศนิยมได้ไม่เกิน 4 ตำแหน่ง"),
    notes: z.preprocess(
      blankToNull,
      z.string().trim().max(500, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร").nullable()
    ),
    /**
     * OPTIONAL: omitted, the server writes the single "Main" department row
     * (ADR 0012 Q2 / ADR 0013 Consequence 7). When departments become
     * user-facing the same field carries the split, and the sum rule below
     * already holds it to `qtyReceivedActual`.
     */
    allocations: z
      .array(
        z.object({
          departmentId: z.string().uuid("แผนกไม่ถูกต้อง"),
          qtyAllocatedActual: z.coerce
            .number({ invalid_type_error: "จำนวนปันส่วนไม่ถูกต้อง" })
            .positive("จำนวนปันส่วนต้องมากกว่า 0")
            .max(QTY_MAX, "จำนวนปันส่วนเกินค่าที่ระบบรองรับ")
            .refine(withinDecimals(3), "จำนวนปันส่วนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
        })
      )
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.allocations?.length) return;

    // Compare in integer thousandths: both sides are 3-dp-bounded above, so this
    // is exact, whereas summing the floats would drift (0.1 + 0.2 ≠ 0.3).
    const thousandths = (n: number) => Math.round(n * 1000);
    const sum = val.allocations.reduce(
      (t, a) => t + thousandths(a.qtyAllocatedActual),
      0
    );
    if (sum !== thousandths(val.qtyReceivedActual)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ยอดปันส่วนตามแผนกต้องรวมเท่ากับจำนวนที่รับ",
        path: ["allocations"],
      });
    }

    const seen = new Set<string>();
    for (const a of val.allocations) {
      if (seen.has(a.departmentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "แต่ละแผนกใส่ได้ครั้งเดียวต่อหนึ่งรายการ",
          path: ["allocations"],
        });
        return;
      }
      seen.add(a.departmentId);
    }
  });

export type GoodsReceiptLineInput = z.infer<typeof goodsReceiptLineInputSchema>;

// ------------------------------------------------------------
// 2. Header + lines — the DRAFT write schema (create AND update)
// ------------------------------------------------------------

/**
 * The editable body of a goods receipt. Used for both create and update, since a
 * DRAFT is fully editable and nothing else is editable at all (Q2/Q6).
 *
 * **`submitKey` is the document's id.** The client mints one uuid per form and
 * the server uses it AS `goods_receipt.id`, so a double POST — progressive
 * enhancement without JS, back-then-resubmit, a network retry — resolves to the
 * same row instead of a second receipt. This is the fix for the second open item
 * in Part 10's post-completion review (ADR 0013 Consequence 4); Part 10's
 * adjustment form still mints its source id server-side and remains exposed.
 *
 * `receivedAt` is a TRUE INSTANT (Q4), not a date: it becomes every movement's
 * `occurred_at`, and Part 14 orders by it. The window is the same one the ledger
 * already enforces — no later than the end of today in Bangkok, no earlier than
 * 90 days back — with both ends computed as real Bangkok day boundaries so a
 * delivery logged at 23:30 is not "tomorrow".
 */
export const goodsReceiptInputSchema = z.object({
  submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  supplierId: z.string().uuid("ผู้ขายไม่ถูกต้อง"),
  purchaseOrderId: z.preprocess(
    blankToNull,
    z.string().uuid("ใบสั่งซื้อไม่ถูกต้อง").nullable()
  ),
  invoiceNo: z.preprocess(
    blankToNull,
    z.string().trim().max(64, "เลขที่ใบส่งของต้องไม่เกิน 64 ตัวอักษร").nullable()
  ),
  receivedAt: z.coerce
    .date({
      required_error: "ต้องระบุวันเวลาที่รับของ",
      invalid_type_error: "วันเวลาที่รับของไม่ถูกต้อง",
    })
    .refine(
      (d) => d.getTime() < bangkokDayEndUtc(computeBangkokToday()).getTime(),
      { message: "วันเวลาที่รับของต้องไม่เป็นอนาคต" }
    )
    .refine(
      (d) =>
        d.getTime() >=
        bangkokDayStartUtc(
          addDays(computeBangkokToday(), -MAX_BACKDATE_DAYS)
        ).getTime(),
      { message: `ย้อนหลังได้ไม่เกิน ${MAX_BACKDATE_DAYS} วัน` }
    ),
  notes: z.preprocess(
    blankToNull,
    z.string().trim().max(1000, "หมายเหตุต้องไม่เกิน 1000 ตัวอักษร").nullable()
  ),
  lines: z
    .array(goodsReceiptLineInputSchema)
    .min(1, "ต้องมีอย่างน้อย 1 รายการ")
    .max(MAX_LINES, `ใบรับสินค้าหนึ่งใบมีได้ไม่เกิน ${MAX_LINES} รายการ`)
    .superRefine((lines, ctx) => {
      // Two rows for the same PO line would each be diffed against the same
      // outstanding quantity, and the second would look like an over-receipt
      // that isn't one. One PO line, one receipt line — split deliveries are
      // separate receipts, which is the whole point of PARTIALLY_RECEIVED.
      const seenPoLine = new Set<string>();
      for (const l of lines) {
        if (!l.purchaseOrderItemId) continue;
        if (seenPoLine.has(l.purchaseOrderItemId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "มีรายการจากใบสั่งซื้อบรรทัดเดียวกันซ้ำ — รวมเป็นรายการเดียว",
          });
          return;
        }
        seenPoLine.add(l.purchaseOrderItemId);
      }

      // For lines with no PO line behind them, the same product in the same unit
      // twice is a duplicated row, not intent (same rule as a PO).
      const seenFree = new Set<string>();
      for (const l of lines) {
        if (l.purchaseOrderItemId) continue;
        const key = `${l.productId}::${l.receivedUnitId}`;
        if (seenFree.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "มีวัตถุดิบและหน่วยซ้ำกัน — รวมเป็นรายการเดียว",
          });
          return;
        }
        seenFree.add(key);
      }
    }),
});

export type GoodsReceiptInput = z.infer<typeof goodsReceiptInputSchema>;

/** Thai display labels per header field (keyed by zod issue.path[0]). */
export const GOODS_RECEIPT_FIELD_LABELS_TH: Record<
  keyof GoodsReceiptInput,
  string
> = {
  submitKey: "คีย์การบันทึก",
  branchId: "สาขา",
  supplierId: "ผู้ขาย",
  purchaseOrderId: "ใบสั่งซื้อ",
  invoiceNo: "เลขที่ใบส่งของ",
  receivedAt: "วันเวลาที่รับของ",
  notes: "หมายเหตุ",
  lines: "รายการที่รับ",
};

// ------------------------------------------------------------
// 3. Lifecycle transitions
// ------------------------------------------------------------

/**
 * Voiding is the only thing that can be done to a confirmed receipt (Q6), and
 * unlike a PO cancel the reason is **required**: a confirmed GR moved real stock,
 * so the compensating entries it produces always have something to explain. The
 * reason is the only prose an auditor gets for why the ledger doubled back.
 */
export const voidGoodsReceiptInputSchema = z.object({
  id: z.string().uuid("ใบรับสินค้าไม่ถูกต้อง"),
  voidReason: z
    .string({ required_error: "ต้องระบุเหตุผลในการยกเลิก" })
    .trim()
    .min(1, "ต้องระบุเหตุผลในการยกเลิก")
    .max(500, "เหตุผลต้องไม่เกิน 500 ตัวอักษร"),
});

export type VoidGoodsReceiptInput = z.infer<typeof voidGoodsReceiptInputSchema>;

/**
 * Declaring a short-delivered order finished (Q8). The reason is required for the
 * same argument as a void: the status says RECEIVED while the quantities say
 * otherwise, and only this sentence reconciles them.
 */
export const closePurchaseOrderShortInputSchema = z.object({
  id: z.string().uuid("ใบสั่งซื้อไม่ถูกต้อง"),
  closedShortReason: z
    .string({ required_error: "ต้องระบุเหตุผลในการปิดรับ" })
    .trim()
    .min(1, "ต้องระบุเหตุผลในการปิดรับ")
    .max(500, "เหตุผลต้องไม่เกิน 500 ตัวอักษร"),
});

export type ClosePurchaseOrderShortInput = z.infer<
  typeof closePurchaseOrderShortInputSchema
>;

// ------------------------------------------------------------
// 4. List query
// ------------------------------------------------------------

/**
 * Filters for the receipt list. No pagination — same call as the PO list: a
 * restaurant's recent deliveries are a screenful, and adding a cursor now would
 * be scaffolding with no user behind it.
 */
export const getGoodsReceiptsQuerySchema = z.object({
  branchId: z.preprocess(
    blankToUndefined,
    z.string().uuid("สาขาไม่ถูกต้อง").optional()
  ),
  supplierId: z.preprocess(
    blankToUndefined,
    z.string().uuid("ผู้ขายไม่ถูกต้อง").optional()
  ),
  purchaseOrderId: z.preprocess(
    blankToUndefined,
    z.string().uuid("ใบสั่งซื้อไม่ถูกต้อง").optional()
  ),
  status: z.preprocess(
    blankToUndefined,
    z
      .enum(GOODS_RECEIPT_STATUS_VALUES, {
        errorMap: () => ({ message: "สถานะไม่ถูกต้อง" }),
      })
      .optional()
  ),
  /** Show only receipts flagged for review (Q3). */
  discrepancyOnly: z.coerce.boolean().optional(),
});

export type GetGoodsReceiptsQuery = z.infer<typeof getGoodsReceiptsQuerySchema>;

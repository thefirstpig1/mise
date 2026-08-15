// ============================================================
// Mise — Purchase Order validation (Sprint 2 Part 11 L2; ADR 0012)
// ============================================================
// One write schema for the DRAFT document (header + lines), plus the small
// schemas for the two lifecycle transitions a user can trigger (send, cancel)
// and the list filter.
//
// What is NOT here, by design:
//   - `tenantId` / `createdBy` — from requireTenant + session server-side.
//   - `poNumber` — generated server-side at create ({BRANCH_CODE}-PO-####, Q8).
//   - The SNAPSHOT fields (`orderUnitName`, `toBaseRatio`, `lineTotal`, and the
//     header's VAT amounts). The client sends what was *chosen*; the server
//     resolves and freezes what it *means* (Q3) — a client that could post its
//     own `toBaseRatio` could rewrite what the order was worth.
//   - Ownership checks (product/branch/supplier/unit belong to the tenant, and
//     the unit belongs to the product) — DB lookups, so they live in L3.
//   - Status transition legality (only DRAFT is editable, Q4) — needs the row's
//     current status, so it is enforced in the *Logic layer.
//
// Error messages are Thai (shown to user); code is English.
// ============================================================

import { z } from "zod";
import type { PurchaseOrderStatus } from "@prisma/client";

// ------------------------------------------------------------
// Enum — local const array (the Sprint 1 / Part 10 pattern)
// ------------------------------------------------------------
// z.nativeEnum would pull the Prisma client into any Client Component importing
// this file; the local const + type-only drift guard costs nothing at runtime
// and still fails `pnpm tsc` if schema.prisma renames a member.

export const PURCHASE_ORDER_STATUS_VALUES = [
  "DRAFT",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

type _AssertPoStatus = PurchaseOrderStatus extends (typeof PURCHASE_ORDER_STATUS_VALUES)[number]
  ? (typeof PURCHASE_ORDER_STATUS_VALUES)[number] extends PurchaseOrderStatus
    ? true
    : never
  : never;
export type _PoEnumDriftGuard = [_AssertPoStatus];

/** Thai gloss per status — the list badges + detail header. */
export const PURCHASE_ORDER_STATUS_LABELS_TH: Record<
  (typeof PURCHASE_ORDER_STATUS_VALUES)[number],
  string
> = {
  DRAFT: "ร่าง",
  SENT: "ส่งแล้ว",
  PARTIALLY_RECEIVED: "รับของบางส่วน",
  RECEIVED: "รับของครบแล้ว",
  CANCELLED: "ยกเลิก",
};

/** The two statuses Part 13 (GR) owns — never written by a Part 11 action. */
export const GR_OWNED_STATUSES = ["PARTIALLY_RECEIVED", "RECEIVED"] as const;

// ------------------------------------------------------------
// Shared field pieces (inline per-file, matching the Sprint 1 convention)
// ------------------------------------------------------------

/** A missing/blank field means "not provided" → null. Same helper as product.ts. */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/** Blank → undefined, for `.optional()` filters. Same helper as product-restore.ts. */
const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/**
 * Decimal-place guard by `toFixed` ROUND-TRIP, never `Number.isInteger(n * 10^k)`.
 *
 * The multiply trick is wrong: `1.005 * 1000` is `1004.9999999999999` in binary
 * floating point, so it rejects ~1.2% of legitimate 3-decimal values. That bug
 * shipped in Part 10 and is recorded as **Pitfall #30**; `supplier.ts` has had
 * the correct round-trip since Sprint 1.
 */
const withinDecimals = (places: number) => (n: number) =>
  Number(n.toFixed(places)) === n;

/** `qty_ordered` / `qty_allocated` are Decimal(15,3) — 12 integer digits, 3 dp. */
export const QTY_MAX = 999_999_999_999.999;
/** `unit_price` is Decimal(15,4) — 11 integer digits, 4 dp (matches the mapping). */
export const UNIT_PRICE_MAX = 99_999_999_999.9999;
/** Keep one order (and therefore one transaction) a sane size. */
export const MAX_LINES = 200;

// ------------------------------------------------------------
// 1. Line
// ------------------------------------------------------------

/**
 * One ordered product.
 *
 * `qtyOrdered` is expressed in `orderUnitId` — the unit the supplier will invoice
 * in (Q3). `unitPrice` is per that unit, excluding VAT; it may be typed by hand
 * when the price list has nothing current (Q5), which is why the schema never
 * requires a mapping id.
 *
 * `allocations` is OPTIONAL: omitted, the server writes the single department row
 * (Q2). When departments become user-facing the same field carries the split, and
 * the sum rule below already holds it to `qtyOrdered`.
 */
export const purchaseOrderLineInputSchema = z
  .object({
    productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
    orderUnitId: z.string().uuid("หน่วยสั่งซื้อไม่ถูกต้อง"),
    qtyOrdered: z.coerce
      .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
      .positive("จำนวนต้องมากกว่า 0")
      .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
      .refine(withinDecimals(3), "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"),
    unitPrice: z.coerce
      .number({ invalid_type_error: "ราคาไม่ถูกต้อง" })
      .min(0, "ราคาต้องไม่ติดลบ")
      .max(UNIT_PRICE_MAX, "ราคาเกินค่าที่ระบบรองรับ")
      .refine(withinDecimals(4), "ราคามีทศนิยมได้ไม่เกิน 4 ตำแหน่ง"),
    /** Provenance (Q3). null = typed by hand, not taken from the price list (Q5). */
    supplierProductMappingId: z.preprocess(
      blankToNull,
      z.string().uuid("อ้างอิงราคาไม่ถูกต้อง").nullable()
    ),
    notes: z.preprocess(
      blankToNull,
      z.string().trim().max(500, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร").nullable()
    ),
    allocations: z
      .array(
        z.object({
          departmentId: z.string().uuid("แผนกไม่ถูกต้อง"),
          qtyAllocated: z.coerce
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
    const sum = val.allocations.reduce((t, a) => t + thousandths(a.qtyAllocated), 0);
    if (sum !== thousandths(val.qtyOrdered)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ยอดปันส่วนตามแผนกต้องรวมเท่ากับจำนวนที่สั่ง",
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

export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

// ------------------------------------------------------------
// 2. Header + lines — the DRAFT write schema (create AND update)
// ------------------------------------------------------------

/**
 * The editable body of a purchase order. Used for both create and update, since
 * a DRAFT is fully editable and nothing else is editable at all (Q4).
 *
 * `vatRatePercent` is **blank = this order carries no VAT** — one meaning, no
 * undefined-vs-null ambiguity across the FormData boundary. The form prefills it
 * from the supplier (or the tenant default) so "blank" is always a deliberate
 * choice by the person placing the order.
 *
 * `expectedDeliveryDate` is deliberately unbounded: a draft raised today may
 * legitimately record a delivery agreed for any date, and a backdate guard here
 * would only fight the user (unlike Q5 on the ledger, where the date decides
 * which period the stock landed in).
 */
export const purchaseOrderInputSchema = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  supplierId: z.string().uuid("ผู้ขายไม่ถูกต้อง"),
  expectedDeliveryDate: z.preprocess(
    blankToNull,
    z.coerce.date({ invalid_type_error: "วันที่คาดว่าจะได้รับไม่ถูกต้อง" }).nullable()
  ),
  vatRatePercent: z.preprocess(
    blankToNull,
    z.coerce
      .number({ invalid_type_error: "อัตรา VAT ไม่ถูกต้อง" })
      .min(0, "อัตรา VAT ต้องไม่ติดลบ")
      .max(100, "อัตรา VAT ต้องไม่เกิน 100")
      .refine(withinDecimals(2), "อัตรา VAT มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง")
      .nullable()
  ),
  notes: z.preprocess(
    blankToNull,
    z.string().trim().max(1000, "หมายเหตุต้องไม่เกิน 1000 ตัวอักษร").nullable()
  ),
  lines: z
    .array(purchaseOrderLineInputSchema)
    .min(1, "ต้องมีอย่างน้อย 1 รายการ")
    .max(MAX_LINES, `ใบสั่งซื้อหนึ่งใบมีได้ไม่เกิน ${MAX_LINES} รายการ`)
    .superRefine((lines, ctx) => {
      // The same product MAY appear twice (different unit, split delivery), but
      // the same product in the same unit twice is a duplicated row, not intent.
      const seen = new Set<string>();
      for (const l of lines) {
        const key = `${l.productId}::${l.orderUnitId}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "มีวัตถุดิบและหน่วยซ้ำกัน — รวมเป็นรายการเดียว",
          });
          return;
        }
        seen.add(key);
      }
    }),
});

export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;

/** Thai display labels per header field (keyed by zod issue.path[0]). */
export const PURCHASE_ORDER_FIELD_LABELS_TH: Record<
  keyof PurchaseOrderInput,
  string
> = {
  branchId: "สาขา",
  supplierId: "ผู้ขาย",
  expectedDeliveryDate: "วันที่คาดว่าจะได้รับ",
  vatRatePercent: "อัตรา VAT",
  notes: "หมายเหตุ",
  lines: "รายการสั่งซื้อ",
};

// ------------------------------------------------------------
// 3. Lifecycle transitions
// ------------------------------------------------------------

/**
 * Cancelling is the ONLY thing that can be done to a sent order (Q4/Q9), so the
 * reason is worth capturing — it is the sole audit trail for why a real document
 * was withdrawn. Optional, because a DRAFT cancelled the minute after it was
 * raised has nothing to explain.
 */
export const cancelPurchaseOrderInputSchema = z.object({
  id: z.string().uuid("ใบสั่งซื้อไม่ถูกต้อง"),
  cancelReason: z.preprocess(
    blankToNull,
    z.string().trim().max(500, "เหตุผลต้องไม่เกิน 500 ตัวอักษร").nullable()
  ),
});

export type CancelPurchaseOrderInput = z.infer<
  typeof cancelPurchaseOrderInputSchema
>;

// ------------------------------------------------------------
// 4. List query
// ------------------------------------------------------------

/**
 * Filters for the order list. No pagination — same call as the Sprint 1 supplier
 * and product lists (Part 5 Q7): a restaurant's open orders are a screenful, and
 * adding a cursor now would be scaffolding with no user behind it.
 */
export const getPurchaseOrdersQuerySchema = z.object({
  branchId: z.preprocess(
    blankToUndefined,
    z.string().uuid("สาขาไม่ถูกต้อง").optional()
  ),
  supplierId: z.preprocess(
    blankToUndefined,
    z.string().uuid("ผู้ขายไม่ถูกต้อง").optional()
  ),
  status: z.preprocess(
    blankToUndefined,
    z
      .enum(PURCHASE_ORDER_STATUS_VALUES, {
        errorMap: () => ({ message: "สถานะไม่ถูกต้อง" }),
      })
      .optional()
  ),
});

export type GetPurchaseOrdersQuery = z.infer<typeof getPurchaseOrdersQuerySchema>;

// ============================================================
// Mise — inter-branch transfer zod schemas (Sprint 3 Part 18 L2, ADR 0018)
// ============================================================
// Three write shapes and one read query: DISPATCH (which posts both ledger legs
// at once, Q1), RECEIVE (which takes a count and may post a shortfall, Q2), and
// VOID (which appends reversal lines, Q6).
//
// What is NOT here, deliberately:
//   - **Any cost field.** The money is computed by replaying the sending
//     branch's FIFO queue and FROZEN onto the line by the server (Q5). A cost
//     that arrived from the browser would be a number the sender could type
//     rather than one their own stock actually cost.
//   - The base-unit quantities and their signs. The user types positive
//     magnitudes in a unit of their choosing; L3 multiplies by the unit's
//     `toBaseRatio` and decides which leg is negative. Direction is never typed —
//     a void is a reversal line, not a minus sign.
//   - `qtyReceived <= qtySent`. The dispatched quantity is not in this payload
//     and must not be trusted from it; L3 compares against the stored row and the
//     DB backs it with stock_transfer_item_received_le_sent_check.
//   - `tenantId` / `dispatchedBy` / `receivedBy` — from requireTenant + session.
//   - Whether the branches, products and units belong to the tenant, and whether
//     the unit belongs to the product — DB lookups, so they live in L3.
//
// This file must not import from src/server/* — it is bundled into the browser.
// ============================================================

import { z } from "zod";
import type { StockTransferStatus } from "@prisma/client";
import {
  addDays,
  bangkokDayEndUtc,
  bangkokDayStartUtc,
  computeBangkokToday,
} from "@/lib/bangkok-date";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";

/** Blank → null. Same helper as every other validations file. */
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

const blankToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v;

/**
 * Checkbox/query-string → boolean. Only "true" / true / "on" are truthy:
 * `z.coerce.boolean` reads the non-empty string "false" as `true`, so a link
 * carrying `?includeVoided=false` would do the opposite of what it says. Same
 * helper, and the same reason, as waste.ts.
 */
const flagPreprocess = (v: unknown) => v === "true" || v === true || v === "on";

// ------------------------------------------------------------
// Enum — local const array (the Sprint 1 pattern), NOT z.nativeEnum
// ------------------------------------------------------------

/**
 * The document's lifecycle (Q1). Read this list as being about **paperwork**:
 * `SENT` does NOT mean the stock is missing from the receiving branch — both
 * ledger legs are already posted — it means nobody there has confirmed it yet.
 */
export const TRANSFER_STATUS_VALUES = ["SENT", "RECEIVED", "VOIDED"] as const;

// Compile-time drift guard, ACTUALLY asserted: a type alias resolving to `never`
// is not an error until something is assigned into it (the hole that let Part
// 13's enum drift stay green).
type _AssertTransferStatus = StockTransferStatus extends (typeof TRANSFER_STATUS_VALUES)[number]
  ? (typeof TRANSFER_STATUS_VALUES)[number] extends StockTransferStatus
    ? true
    : never
  : never;
const _statusDriftGuard: _AssertTransferStatus = true;
void _statusDriftGuard;

export const TRANSFER_STATUS_LABELS_TH: Record<
  (typeof TRANSFER_STATUS_VALUES)[number],
  string
> = {
  SENT: "กำลังส่ง",
  RECEIVED: "รับแล้ว",
  VOIDED: "ยกเลิก",
};

/** Longer gloss — the one the UI must show, because the short label invites the
 *  exact wrong guess about whether the stock has moved. */
export const TRANSFER_STATUS_HINTS_TH: Record<
  (typeof TRANSFER_STATUS_VALUES)[number],
  string
> = {
  SENT: "ของถูกตัดจากสาขาต้นทางและเข้าสาขาปลายทางแล้ว รอคนปลายทางกดรับ",
  RECEIVED: "มีคนที่สาขาปลายทางนับและยืนยันแล้ว",
  VOIDED: "ใบนี้ถูกยกเลิก ของกลับไปเป็นของสาขาต้นทาง",
};

/** Quantities are Decimal(15,3), like every ledger quantity. */
export const QTY_MAX = 999_999_999_999.999;
const QTY_DECIMAL_PLACES = 3;

/** `toFixed` round-trip, never `n * 1000` (Pitfall #30). */
const hasAtMostThreeDecimals = (n: number) =>
  Number(n.toFixed(QTY_DECIMAL_PLACES)) === n;

/**
 * A quantity that must be TYPED, never defaulted.
 *
 * `z.coerce.number()` reads `null`, `undefined` and `""` as **0** — and on the
 * receive form 0 is a legal, meaningful answer ("nothing arrived"), so a blank box
 * would sail through validation and write the whole line off as lost in transit,
 * naming a driver who did nothing wrong. Every other quantity in the system is
 * saved from this by a `.positive()` that happens to reject the coerced 0; this
 * is the first one where 0 is allowed, so the blank has to be caught before the
 * coercion instead of after it.
 */
const blankToUndefinedNumber = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    // Leave unparseable text alone so z.number reports it as the wrong TYPE
    // rather than as a missing value — "abc" is a different mistake from "".
    return Number.isNaN(n) ? v : n;
  }
  return v;
};

export const MAX_LINES = 200;
export const MAX_TRANSFER_NOTE_LENGTH = 500;
const MAX_PERSON_NAME_LENGTH = 100;

// ------------------------------------------------------------
// 1. Dispatch — the document, and both ledger legs
// ------------------------------------------------------------

const dispatchLineInputSchema = z.object({
  productId: z.string().uuid("วัตถุดิบไม่ถูกต้อง"),
  /** A positive magnitude. Zero is not a dispatch, and a negative is what a
   *  reversal LINE is for — never something anyone types. */
  qtySent: z.preprocess(
    blankToUndefinedNumber,
    z
      .number({
        required_error: "ต้องระบุจำนวนที่ส่ง",
        invalid_type_error: "จำนวนไม่ถูกต้อง",
      })
      .positive("จำนวนต้องมากกว่า 0")
      .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
      .refine(hasAtMostThreeDecimals, "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง")
  ),
  inputUnitId: z.string().uuid("หน่วยไม่ถูกต้อง"),
  notes: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(MAX_TRANSFER_NOTE_LENGTH, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร")
      .nullable()
  ),
});

export type DispatchTransferLineInput = z.infer<typeof dispatchLineInputSchema>;

/**
 * Sending goods to another branch. Posting is immediate and complete: the moment
 * this succeeds, the stock has LEFT the sending branch and ARRIVED at the
 * receiving one (Q1). There is no draft, because a draft transfer is real stock
 * sitting in a state the ledger cannot see.
 *
 * **`submitKey` is the document's id** (Part 13.5's pattern, shared with the
 * goods receipt, the adjustment and the waste log). The client mints one uuid per
 * form and the server uses it AS `stock_transfer.id`, so a double POST — no-JS
 * progressive enhancement, back-then-resubmit, a network retry — resolves to the
 * same document instead of moving the same goods twice. Moving them twice is
 * worse than double-writing anywhere else in the system: it is wrong at TWO
 * branches at once, and the two errors are equal and opposite, so neither looks
 * obviously wrong when someone finally checks.
 *
 * `dispatchedAt` is a TRUE INSTANT, not a date, for the same reason a goods
 * receipt's `receivedAt` is (ADR 0013 Q4): it becomes both movements'
 * `occurred_at`, and ADR 0014 Q9b resolves a date-only value to the END of its
 * Bangkok day for costing — which would put every transfer after every receipt of
 * the same day and draw the goods from the wrong FIFO layer.
 */
export const dispatchTransferInputSchema = z
  .object({
    submitKey: z.string().uuid("คีย์การบันทึกไม่ถูกต้อง"),
    fromBranchId: z.string().uuid("สาขาต้นทางไม่ถูกต้อง"),
    toBranchId: z.string().uuid("สาขาปลายทางไม่ถูกต้อง"),
    dispatchedAt: z.coerce
      .date({
        required_error: "ต้องระบุวันเวลาที่ส่งของ",
        invalid_type_error: "วันเวลาที่ส่งของไม่ถูกต้อง",
      })
      .refine(
        (d) => d.getTime() < bangkokDayEndUtc(computeBangkokToday()).getTime(),
        { message: "วันเวลาที่ส่งของต้องไม่เป็นอนาคต" }
      )
      .refine(
        (d) =>
          d.getTime() >=
          bangkokDayStartUtc(
            addDays(computeBangkokToday(), -MAX_BACKDATE_DAYS)
          ).getTime(),
        { message: `ย้อนหลังได้ไม่เกิน ${MAX_BACKDATE_DAYS} วัน` }
      ),
    /** Who actually handed the goods over, when that is not the account holder
     *  (ADR 0015 Q2's pattern — the first of this document's three people). */
    dispatchedByName: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(MAX_PERSON_NAME_LENGTH, "ชื่อผู้ส่งต้องไม่เกิน 100 ตัวอักษร")
        .nullable()
    ),
    /**
     * The driver (Q3). A hired outside driver will never have a login, so the
     * name is the record; a company driver's FK fills in the day user management
     * ships, with no migration.
     */
    driverName: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(MAX_PERSON_NAME_LENGTH, "ชื่อคนขับต้องไม่เกิน 100 ตัวอักษร")
        .nullable()
    ),
    /**
     * The driver counted at the roadside and agreed the quantities on this
     * document. **There is no separate "quantity the driver accepted" column** —
     * that number IS `qtySent`, typed at the sending branch in front of them.
     * Adding a third quantity would create two figures for one count with nothing
     * able to keep them honest, which is the argument ADR 0017 used against
     * storing a base qty beside the ledger's.
     */
    driverConfirmed: z.preprocess(flagPreprocess, z.boolean()),
    notes: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .max(MAX_TRANSFER_NOTE_LENGTH, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร")
        .nullable()
    ),
    lines: z
      .array(dispatchLineInputSchema)
      .min(1, "ต้องมีอย่างน้อย 1 รายการ")
      .max(MAX_LINES, `ใบโอนหนึ่งใบมีได้ไม่เกิน ${MAX_LINES} รายการ`)
      .superRefine((lines, ctx) => {
        // The same product in the same unit twice is a duplicated row, not
        // intent — a PO's and a receipt's rule. Two rows would also mean two
        // (TRANSFER_OUT, id) source keys for one physical pile, which is exactly
        // the ambiguity the ledger's source key exists to prevent.
        const seen = new Set<string>();
        for (const l of lines) {
          const key = `${l.productId}::${l.inputUnitId}`;
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
  })
  .superRefine((val, ctx) => {
    // Mirrors stock_transfer_branch_differs_check. Caught here so the user gets a
    // Thai sentence on the right field instead of a constraint violation.
    if (val.fromBranchId === val.toBranchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "สาขาปลายทางต้องไม่ใช่สาขาเดียวกับต้นทาง",
        path: ["toBranchId"],
      });
    }

    // A confirmation attached to nobody is not a confirmation (Q3), and the DB
    // says so too. Only the name is checkable from the browser: the FK is filled
    // server-side and is null for every row until user management ships.
    if (val.driverConfirmed && !val.driverName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ต้องระบุชื่อคนขับ ถ้าจะยืนยันว่าคนขับรับของแล้ว",
        path: ["driverName"],
      });
    }
  });

export type DispatchTransferInput = z.infer<typeof dispatchTransferInputSchema>;

// ------------------------------------------------------------
// 2. Receiving — the count at the far end
// ------------------------------------------------------------

const receiveLineInputSchema = z.object({
  itemId: z.string().uuid("รายการในใบโอนไม่ถูกต้อง"),
  /**
   * What was actually counted on arrival (Q2). **0 is a real observation** — the
   * crate arrived empty, or did not arrive at all — and is therefore allowed,
   * exactly as a counted 0 is on a stock count line. The state that is NOT
   * expressible here is "nobody has counted", which is the stored `NULL`; a form
   * that submits has counted by definition.
   */
  qtyReceived: z.preprocess(
    blankToUndefinedNumber,
    z
      .number({
        required_error: "ต้องระบุจำนวนที่รับ",
        invalid_type_error: "จำนวนที่รับไม่ถูกต้อง",
      })
      .min(0, "จำนวนที่รับต้องไม่ติดลบ")
      .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
      .refine(hasAtMostThreeDecimals, "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง")
  ),
});

export type ReceiveTransferLineInput = z.infer<typeof receiveLineInputSchema>;

/**
 * Confirming a delivery. This posts **no** arrival — the goods arrived in the
 * ledger when they were dispatched (Q1) — it posts the SHORTFALL, if any, as a
 * `TRANSFER_SHORTAGE` outflow at the receiving branch.
 *
 * Every line must be answered. A partially-answered receipt would leave some
 * lines confirmed and others still `NULL` under a document that says `RECEIVED`,
 * and nobody reading the list later could tell which of the two the blank meant.
 *
 * There is no `submitKey`: receiving twice is idempotent by nature, because the
 * shortfall movement's source key is `(TRANSFER_SHORTAGE, itemId)` and the ledger
 * already refuses a second row for it.
 */
export const receiveTransferInputSchema = z.object({
  id: z.string().uuid("ใบโอนไม่ถูกต้อง"),
  /** Who actually counted, when that is not the account holder. */
  receivedByName: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(MAX_PERSON_NAME_LENGTH, "ชื่อผู้รับต้องไม่เกิน 100 ตัวอักษร")
      .nullable()
  ),
  notes: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(MAX_TRANSFER_NOTE_LENGTH, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร")
      .nullable()
  ),
  lines: z
    .array(receiveLineInputSchema)
    .min(1, "ต้องมีอย่างน้อย 1 รายการ")
    .max(MAX_LINES, `ใบโอนหนึ่งใบมีได้ไม่เกิน ${MAX_LINES} รายการ`)
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      for (const l of lines) {
        if (seen.has(l.itemId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "มีรายการซ้ำในใบเดียวกัน",
          });
          return;
        }
        seen.add(l.itemId);
      }
    }),
});

export type ReceiveTransferInput = z.infer<typeof receiveTransferInputSchema>;

// ------------------------------------------------------------
// 3. Voiding
// ------------------------------------------------------------

/**
 * **A void is not a transfer back** (Q6). This says the document should never
 * have existed — wrong product, wrong branch, keyed twice — and the goods never
 * travelled. If the goods really did come back, that is a NEW transfer in the
 * opposite direction, and the UI must say so where someone would otherwise reach
 * for this: collapse the two and a crate that made two journeys reads as a crate
 * that never left.
 *
 * Allowed even after the far end has confirmed receipt, because that is usually
 * when a keying error surfaces.
 *
 * No `submitKey`: idempotency comes from `stock_transfer_item_reversal_unique`
 * (one reversal per line), which is stronger than a client key — it holds when
 * the second void arrives from a different browser.
 *
 * A reason is REQUIRED, as it is for voiding a count (ADR 0015 Q6) and a waste
 * entry. A void moves stock at two branches at once, and "why did this not happen
 * after all" is asked exactly once — at the only moment anyone still knows.
 */
export const voidTransferInputSchema = z.object({
  id: z.string().uuid("ใบโอนไม่ถูกต้อง"),
  voidReason: z
    .string({ required_error: "ต้องระบุเหตุผลที่ยกเลิก" })
    .trim()
    .min(1, "ต้องระบุเหตุผลที่ยกเลิก")
    .max(MAX_TRANSFER_NOTE_LENGTH, "เหตุผลต้องไม่เกิน 500 ตัวอักษร"),
});

export type VoidTransferInput = z.infer<typeof voidTransferInputSchema>;

// ------------------------------------------------------------
// 4. Read query
// ------------------------------------------------------------

/**
 * Which end of the journey the caller is asking about. This has no equivalent in
 * any earlier Part, because no earlier document had two branches: `/transfers`
 * for ทองหล่อ means "what we sent" to the person who sent it and "what is coming"
 * to the person waiting for it, and a single `branchId` filter cannot tell those
 * apart.
 */
export const TRANSFER_DIRECTION_VALUES = ["OUT", "IN", "ANY"] as const;

export const TRANSFER_DIRECTION_LABELS_TH: Record<
  (typeof TRANSFER_DIRECTION_VALUES)[number],
  string
> = {
  OUT: "ส่งออกจากสาขานี้",
  IN: "ส่งเข้าสาขานี้",
  ANY: "ทั้งเข้าและออก",
};

export const getTransfersQuerySchema = z.object({
  branchId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  /** Ignored when `branchId` is absent — there is no end to be at. */
  direction: z.preprocess(
    blankToUndefined,
    z.enum(TRANSFER_DIRECTION_VALUES).optional()
  ),
  status: z.preprocess(
    blankToUndefined,
    z.enum(TRANSFER_STATUS_VALUES).optional()
  ),
  productId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  from: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  to: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  /**
   * A missing flag is FALSE — `flagPreprocess` already yields that, so there is
   * no `.default()` here to imply a second, unreachable rule. Unlike waste's
   * equivalent, a voided TRANSFER is not hidden by this: `status` filters that.
   * This one controls whether the reversal LINES appear inside a document.
   */
  includeReversalLines: z.preprocess(flagPreprocess, z.boolean()),
});

export type GetTransfersQuery = z.infer<typeof getTransfersQuerySchema>;

/** Thai display labels per field (keyed by zod `issue.path[0]`). */
export const TRANSFER_FIELD_LABELS_TH: Record<string, string> = {
  submitKey: "คีย์การบันทึก",
  fromBranchId: "สาขาต้นทาง",
  toBranchId: "สาขาปลายทาง",
  dispatchedAt: "วันเวลาที่ส่งของ",
  dispatchedByName: "ผู้ส่ง",
  driverName: "คนขับ",
  driverConfirmed: "คนขับยืนยันรับของ",
  receivedByName: "ผู้รับ",
  notes: "หมายเหตุ",
  lines: "รายการที่โอน",
  productId: "วัตถุดิบ",
  qtySent: "จำนวนที่ส่ง",
  qtyReceived: "จำนวนที่รับ",
  inputUnitId: "หน่วย",
  itemId: "รายการในใบโอน",
  voidReason: "เหตุผลที่ยกเลิก",
};

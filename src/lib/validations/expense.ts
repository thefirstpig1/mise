// ============================================================
// Mise — expense zod schemas (Sprint 3 Part 16 L2, ADR 0016)
// ============================================================
// Three write shapes (a bill, a recurring template, and the small edit variants)
// plus two read queries.
//
// What is NOT here, by design:
//   - **All of the money arithmetic.** `subtotal_excl_vat`, `vat_amount`,
//     `total_amount`, `wht_amount` and `net_payment_amount` are DERIVED, and they
//     are derived server-side in `Prisma.Decimal` — the same rule Part 11 applied
//     to a PO's header totals (ADR 0012 Q3). A client that could post its own
//     `total_amount` could tell `/cost` what the branch spent. What the client
//     sends is what the human TYPED; what it means is the server's answer.
//   - `is_price_vat_inclusive` therefore records only the DIRECTION the maths
//     will run (Decision #36): inclusive → `subtotal = total ÷ (1 + rate)`,
//     exclusive → `total = subtotal × (1 + rate)`. It is kept because a reader
//     cannot recover from the results which way it ran.
//   - **WHT's base.** It is `subtotal_excl_vat × rate/100` — the PRE-VAT amount
//     (ADR 0016 Q6). master-spec §5.4's formula uses the VAT-inclusive total and
//     over-withholds on every bill carrying both: 10,000 + 7% at 3% is 300, not
//     321, and the 50 ทวิ certificate has to match what the recipient claims.
//     The formula lives in L3 with the rest of the arithmetic; it is named here
//     so nobody re-derives it from the superseded spec.
//   - Ownership checks (branch / supplier / category / product belong to the
//     tenant) and "which fields of a GR-created expense are editable" (Q3.4) —
//     both need DB reads, so both live in the *Logic layer.
//
// This file must not import from src/server/* — it is bundled into the browser.
// Error messages are Thai (shown to user); code and comments are English.
// ============================================================

import { z } from "zod";
import type { ExpenseSource, ExpensePaymentStatus } from "@prisma/client";

// ------------------------------------------------------------
// Enums — local const arrays + type-only drift guards
// ------------------------------------------------------------
// z.nativeEnum would pull the Prisma client into any Client Component importing
// this file. The local array costs nothing at runtime and still fails `pnpm tsc`
// if schema.prisma renames or adds a member — the guard that caught Part 15's
// `SourceType.STOCK_COUNT` the moment it landed.

export const EXPENSE_SOURCE_VALUES = ["MANUAL", "FROM_GOODS_RECEIPT"] as const;

type _AssertSource = ExpenseSource extends (typeof EXPENSE_SOURCE_VALUES)[number]
  ? (typeof EXPENSE_SOURCE_VALUES)[number] extends ExpenseSource
    ? true
    : never
  : never;
export type _ExpenseSourceDriftGuard = [_AssertSource];

/** `PARTIAL` is deliberately absent — it describes an amount, and there is no
 *  payments module to hold one (ADR 0016 Q6). */
export const EXPENSE_PAYMENT_STATUS_VALUES = ["UNPAID", "PAID"] as const;

type _AssertPaymentStatus =
  ExpensePaymentStatus extends (typeof EXPENSE_PAYMENT_STATUS_VALUES)[number]
    ? (typeof EXPENSE_PAYMENT_STATUS_VALUES)[number] extends ExpensePaymentStatus
      ? true
      : never
    : never;
export type _ExpensePaymentStatusDriftGuard = [_AssertPaymentStatus];

export const EXPENSE_SOURCE_LABELS_TH: Record<
  (typeof EXPENSE_SOURCE_VALUES)[number],
  string
> = {
  MANUAL: "บันทึกเอง",
  FROM_GOODS_RECEIPT: "จากใบรับของ",
};

export const EXPENSE_PAYMENT_STATUS_LABELS_TH: Record<
  (typeof EXPENSE_PAYMENT_STATUS_VALUES)[number],
  string
> = {
  UNPAID: "ยังไม่จ่าย",
  PAID: "จ่ายแล้ว",
};

// ------------------------------------------------------------
// Shared field pieces (inline per-file, matching the Sprint 1 convention)
// ------------------------------------------------------------

/** Blank → null. Same helper as every other validations file. */
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
 * — the multiply trick rejects ~1.2% of legitimate values in binary floating
 * point (Pitfall #30).
 */
const withinDecimals = (places: number) => (n: number) =>
  Number(n.toFixed(places)) === n;

/** Money columns are Decimal(15,2) — 13 integer digits, 2 dp (satang). */
export const MONEY_MAX = 9_999_999_999_999.99;
/** `unit_price` is Decimal(15,4) — 11 integer digits, 4 dp (matches the PO line). */
export const UNIT_PRICE_MAX = 99_999_999_999.9999;
/** `qty` is Decimal(15,3), like every quantity in the system. */
export const QTY_MAX = 999_999_999_999.999;
/**
 * One bill's line count. Matches the PO's `MAX_LINES`, and must not be lower:
 * confirming a goods receipt writes one expense item per received line (Q3), so
 * a smaller cap here would make a legal receipt impossible to book.
 */
export const MAX_EXPENSE_ITEMS = 200;

/**
 * "YYYY-MM" — the same regex the `expense_period_format_check` and
 * `recurring_expense_period_check` CHECKs enforce in the database. A period is a
 * LABEL, not a timestamp: there is no timezone question to get wrong
 * (Decision #60), but there is a format one.
 */
export const PERIOD_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

const periodString = z
  .string()
  .trim()
  .regex(PERIOD_REGEX, "งวดต้องอยู่ในรูปแบบ YYYY-MM");

/** A VAT or WHT rate: percent, 0–100, two decimals. */
const ratePercent = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label}ไม่ถูกต้อง` })
    .min(0, `${label}ต้องไม่ติดลบ`)
    .max(100, `${label}ต้องไม่เกิน 100`)
    .refine(withinDecimals(2), `${label}มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง`);

// ------------------------------------------------------------
// 1. One line of a bill
// ------------------------------------------------------------

/**
 * `lineTotal` is what the human typed on that line, and it is AUTHORITATIVE.
 * `qty` and `unitPrice` are descriptive and both optional — rent and wages have
 * neither, and a bill that reads "3 × 100, less discount = 290" is a real bill.
 * Cross-checking the two would therefore reject correct data, so the server
 * stores what was typed and lets the description carry the explanation.
 *
 * Whether `lineTotal` is gross or net is decided ONCE at the header by
 * `isPriceVatInclusive`; the stored `expense_item.total_price` is always net
 * (Decision #35 — the tax sits at the header).
 */
export const expenseItemInputSchema = z
  .object({
    categoryId: z.string().uuid("หมวดบัญชีไม่ถูกต้อง"),
    /** null = shared / overhead (Decision #31). Always null while departments are off. */
    departmentId: z.preprocess(
      blankToNull,
      z.string().uuid("แผนกไม่ถูกต้อง").nullable()
    ),
    productId: z.preprocess(
      blankToNull,
      z.string().uuid("วัตถุดิบไม่ถูกต้อง").nullable()
    ),
    productUnitId: z.preprocess(
      blankToNull,
      z.string().uuid("หน่วยไม่ถูกต้อง").nullable()
    ),
    description: z
      .string({ required_error: "ต้องระบุรายละเอียด" })
      .trim()
      .min(1, "ต้องระบุรายละเอียด")
      .max(200, "รายละเอียดต้องไม่เกิน 200 ตัวอักษร"),
    qty: z.preprocess(
      blankToNull,
      z.coerce
        .number({ invalid_type_error: "จำนวนไม่ถูกต้อง" })
        .min(0, "จำนวนต้องไม่ติดลบ")
        .max(QTY_MAX, "จำนวนเกินค่าที่ระบบรองรับ")
        .refine(withinDecimals(3), "จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง")
        .nullable()
    ),
    unitPrice: z.preprocess(
      blankToNull,
      z.coerce
        .number({ invalid_type_error: "ราคาต่อหน่วยไม่ถูกต้อง" })
        .min(0, "ราคาต่อหน่วยต้องไม่ติดลบ")
        .max(UNIT_PRICE_MAX, "ราคาต่อหน่วยเกินค่าที่ระบบรองรับ")
        .refine(withinDecimals(4), "ราคาต่อหน่วยมีทศนิยมได้ไม่เกิน 4 ตำแหน่ง")
        .nullable()
    ),
    /**
     * Zero IS allowed: a zero-rated line, a free item on an invoice, or a
     * supplier's ฿0 delivery charge are all real, and the DB CHECK allows them
     * for the same reason. Negative is not — a refund is not an expense.
     */
    lineTotal: z.coerce
      .number({ invalid_type_error: "จำนวนเงินไม่ถูกต้อง" })
      .min(0, "จำนวนเงินต้องไม่ติดลบ")
      .max(MONEY_MAX, "จำนวนเงินเกินค่าที่ระบบรองรับ")
      .refine(withinDecimals(2), "จำนวนเงินมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง"),
  })
  .superRefine((item, ctx) => {
    // A unit with no product is a dangling reference: `product_unit` is only
    // meaningful relative to the product that owns it (ADR 0005), and the pair
    // is written together on every line a goods receipt generates.
    if (item.productUnitId !== null && item.productId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productUnitId"],
        message: "ระบุหน่วยได้เมื่อเลือกวัตถุดิบแล้วเท่านั้น",
      });
    }
  });

export type ExpenseItemInput = z.infer<typeof expenseItemInputSchema>;

// ------------------------------------------------------------
// 2. The bill
// ------------------------------------------------------------

const expenseInputShape = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  /** Nullable: an electricity bill has no supplier row, and forcing one would
   *  fill the supplier list with utilities nobody orders from. */
  supplierId: z.preprocess(
    blankToNull,
    z.string().uuid("ผู้ขายไม่ถูกต้อง").nullable()
  ),
  /**
   * The document's own date, and the date `/cost` books the spend under. Left
   * UNBOUNDED, like the PO's `expectedDeliveryDate` and the count's `countDate`:
   * a bill that arrives three months late is still that bill's date, and the
   * ledger's 90-day backdate guard exists to protect STOCK history, which an
   * expense does not touch.
   */
  billDate: z.coerce.date({
    required_error: "ต้องระบุวันที่บิล",
    invalid_type_error: "วันที่บิลไม่ถูกต้อง",
  }),
  billNo: z.preprocess(
    blankToNull,
    z.string().trim().max(100, "เลขที่บิลต้องไม่เกิน 100 ตัวอักษร").nullable()
  ),
  /** The tax-invoice number — what an input-VAT claim is filed against, and the
   *  one field a GR-created expense most often needs added by hand (Q3.4). */
  vatInvoiceNo: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(100, "เลขที่ใบกำกับภาษีต้องไม่เกิน 100 ตัวอักษร")
      .nullable()
  ),

  /** Blank = **this bill carries no VAT** — one meaning, no undefined-vs-null
   *  ambiguity across the FormData boundary (the PO's rule, ADR 0012). */
  vatRatePercent: z.preprocess(blankToNull, ratePercent("อัตรา VAT").nullable()),
  /** Which way the maths runs, not a rate. Thai bills usually show the total
   *  (inclusive); a tax invoice shows both. Default matches the DB default. */
  isPriceVatInclusive: z.coerce.boolean().default(true),

  subjectToWht: z.coerce.boolean().default(false),
  whtRatePercent: z.preprocess(
    blankToNull,
    ratePercent("อัตราภาษีหัก ณ ที่จ่าย").nullable()
  ),
  /** 50 ทวิ. Issued at payment, so it is routinely filled in later. */
  whtCertificateNo: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(100, "เลขที่หนังสือรับรองต้องไม่เกิน 100 ตัวอักษร")
      .nullable()
  ),

  paymentMethod: z.preprocess(
    blankToNull,
    z.string().trim().max(50, "วิธีชำระเงินต้องไม่เกิน 50 ตัวอักษร").nullable()
  ),
  paymentStatus: z
    .enum(EXPENSE_PAYMENT_STATUS_VALUES, {
      invalid_type_error: "สถานะการจ่ายเงินไม่ถูกต้อง",
    })
    .default("UNPAID"),
  /**
   * A PAID bill must record WHEN — the `expense_paid_stamped_check` CHECK, and
   * the same rule Part 11 applied to a sent order. It is still nullable here:
   * marking a bill paid today should be one click, so an omitted date on a PAID
   * bill is **stamped `now()` by the server**. What zod refuses is the other
   * direction — a payment date on a bill nobody has paid.
   */
  paidAt: z.preprocess(
    blankToNull,
    z.coerce.date({ invalid_type_error: "วันที่จ่ายเงินไม่ถูกต้อง" }).nullable()
  ),

  /**
   * Set only when this bill is the confirmation of a recurring template (Q5).
   * Confirming is therefore an ordinary create with these two fields filled —
   * one write path, and the partial unique on the pair makes it idempotent.
   */
  recurringExpenseId: z.preprocess(
    blankToNull,
    z.string().uuid("รายการประจำไม่ถูกต้อง").nullable()
  ),
  period: z.preprocess(blankToNull, periodString.nullable()),

  notes: z.preprocess(
    blankToNull,
    z.string().trim().max(1000, "หมายเหตุต้องไม่เกิน 1000 ตัวอักษร").nullable()
  ),

  items: z
    .array(expenseItemInputSchema)
    .min(1, "ต้องมีอย่างน้อย 1 รายการ")
    .max(MAX_EXPENSE_ITEMS, `บิลหนึ่งใบมีได้ไม่เกิน ${MAX_EXPENSE_ITEMS} รายการ`),
});

/**
 * The rules that span two fields. Shared by create and update so the two cannot
 * drift — an edit that could reach a state a create refuses would be a hole in
 * exactly the table `/cost` reads its spend from.
 */
const refineExpense = (
  input: z.infer<typeof expenseInputShape>,
  ctx: z.RefinementCtx
) => {
  // --- WHT: the flag and the rate are one decision, stated twice ---
  // The DB CHECK requires rate AND amount together with the flag; the amount is
  // computed, so the client's half of that contract is the rate.
  if (input.subjectToWht && input.whtRatePercent === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["whtRatePercent"],
      message: "ต้องระบุอัตราภาษีหัก ณ ที่จ่าย",
    });
  }
  if (input.subjectToWht && input.whtRatePercent === 0) {
    // 0% withholding withholds nothing. It is either a mis-typed rate or the
    // flag should be off, and both are better said now than filed on a ภงด.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["whtRatePercent"],
      message: "อัตราภาษีหัก ณ ที่จ่ายต้องมากกว่า 0",
    });
  }
  if (!input.subjectToWht && input.whtRatePercent !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["whtRatePercent"],
      message: "ไม่ได้เลือกหักภาษี ณ ที่จ่าย จึงระบุอัตราไม่ได้",
    });
  }

  // --- Payment: a date on an unpaid bill is a contradiction ---
  if (input.paymentStatus === "UNPAID" && input.paidAt !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["paidAt"],
      message: "บิลที่ยังไม่จ่าย ระบุวันที่จ่ายเงินไม่ได้",
    });
  }

  // --- Recurring: both halves of the identity, or neither ---
  // Mirrors `expense_recurring_pair_check`. Half a pair would leave the
  // idempotency index unable to see the row it exists to protect.
  const hasRecurring = input.recurringExpenseId !== null;
  const hasPeriod = input.period !== null;
  if (hasRecurring !== hasPeriod) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasRecurring ? ["period"] : ["recurringExpenseId"],
      message: "รายการประจำและงวดต้องระบุคู่กัน",
    });
  }
};

export const expenseInputSchema = expenseInputShape.superRefine(refineExpense);
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

/**
 * Editing an existing bill. The shape is identical because a manual bill is
 * fully editable; **which fields are ignored for a `FROM_GOODS_RECEIPT` expense
 * (amounts, supplier, branch — Q3.4) is enforced in L3**, where the row's
 * `source` can actually be read.
 */
export const updateExpenseInputSchema = expenseInputShape
  .extend({ id: z.string().uuid("รายการค่าใช้จ่ายไม่ถูกต้อง") })
  .superRefine(refineExpense);
export type UpdateExpenseInput = z.infer<typeof updateExpenseInputSchema>;

export const deleteExpenseInputSchema = z.object({
  id: z.string().uuid("รายการค่าใช้จ่ายไม่ถูกต้อง"),
});
export type DeleteExpenseInput = z.infer<typeof deleteExpenseInputSchema>;

/** Marking a bill paid (or un-paid) without opening the whole form. */
export const setExpensePaymentInputSchema = z
  .object({
    id: z.string().uuid("รายการค่าใช้จ่ายไม่ถูกต้อง"),
    paymentStatus: z.enum(EXPENSE_PAYMENT_STATUS_VALUES, {
      invalid_type_error: "สถานะการจ่ายเงินไม่ถูกต้อง",
    }),
    paidAt: z.preprocess(
      blankToNull,
      z.coerce.date({ invalid_type_error: "วันที่จ่ายเงินไม่ถูกต้อง" }).nullable()
    ),
    paymentMethod: z.preprocess(
      blankToNull,
      z.string().trim().max(50, "วิธีชำระเงินต้องไม่เกิน 50 ตัวอักษร").nullable()
    ),
  })
  .superRefine((input, ctx) => {
    if (input.paymentStatus === "UNPAID" && input.paidAt !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paidAt"],
        message: "บิลที่ยังไม่จ่าย ระบุวันที่จ่ายเงินไม่ได้",
      });
    }
  });
export type SetExpensePaymentInput = z.infer<typeof setExpensePaymentInputSchema>;

// ------------------------------------------------------------
// 3. The recurring template
// ------------------------------------------------------------

const recurringExpenseInputShape = z.object({
  branchId: z.string().uuid("สาขาไม่ถูกต้อง"),
  supplierId: z.preprocess(
    blankToNull,
    z.string().uuid("ผู้ขายไม่ถูกต้อง").nullable()
  ),
  /** Required, unlike a bill's line: a template with no category could not tell
   *  `/cost` whether the money it stands for is COGS or OpEx (Q4). */
  categoryId: z.string().uuid("หมวดบัญชีไม่ถูกต้อง"),
  description: z
    .string({ required_error: "ต้องระบุรายละเอียด" })
    .trim()
    .min(1, "ต้องระบุรายละเอียด")
    .max(200, "รายละเอียดต้องไม่เกิน 200 ตัวอักษร"),
  /**
   * A STARTING POINT, not a value — an electricity bill differs every month,
   * which is the whole reason Q5 chose confirm-don't-auto. Zero is allowed: a
   * template whose amount is never the same twice is honestly described by 0.
   */
  defaultAmount: z.coerce
    .number({ invalid_type_error: "จำนวนเงินไม่ถูกต้อง" })
    .min(0, "จำนวนเงินต้องไม่ติดลบ")
    .max(MONEY_MAX, "จำนวนเงินเกินค่าที่ระบบรองรับ")
    .refine(withinDecimals(2), "จำนวนเงินมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง"),

  isPriceVatInclusive: z.coerce.boolean().default(true),
  vatRatePercent: z.preprocess(blankToNull, ratePercent("อัตรา VAT").nullable()),
  subjectToWht: z.coerce.boolean().default(false),
  whtRatePercent: z.preprocess(
    blankToNull,
    ratePercent("อัตราภาษีหัก ณ ที่จ่าย").nullable()
  ),

  /**
   * Capped at 28 by the DB CHECK and repeated here so the user hears WHY: a
   * template due on the 30th would skip February, and a template that silently
   * skips a month is worse than one that lands early.
   */
  dayOfMonth: z.coerce
    .number({ invalid_type_error: "วันที่ครบกำหนดไม่ถูกต้อง" })
    .int("วันที่ครบกำหนดต้องเป็นจำนวนเต็ม")
    .min(1, "วันที่ครบกำหนดต้องอยู่ระหว่าง 1–28")
    .max(28, "วันที่ครบกำหนดต้องอยู่ระหว่าง 1–28 (เพื่อไม่ให้ข้ามเดือนกุมภาพันธ์)"),

  startPeriod: periodString,
  /** null = no end. The template stops being due when `isActive` goes false. */
  endPeriod: z.preprocess(blankToNull, periodString.nullable()),
  isActive: z.coerce.boolean().default(true),
});

const refineRecurringExpense = (
  input: z.infer<typeof recurringExpenseInputShape>,
  ctx: z.RefinementCtx
) => {
  if (input.subjectToWht && input.whtRatePercent === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["whtRatePercent"],
      message: "ต้องระบุอัตราภาษีหัก ณ ที่จ่าย",
    });
  }
  if (input.subjectToWht && input.whtRatePercent === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["whtRatePercent"],
      message: "อัตราภาษีหัก ณ ที่จ่ายต้องมากกว่า 0",
    });
  }
  if (!input.subjectToWht && input.whtRatePercent !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["whtRatePercent"],
      message: "ไม่ได้เลือกหักภาษี ณ ที่จ่าย จึงระบุอัตราไม่ได้",
    });
  }
  // "YYYY-MM" sorts lexicographically, which is why the DB CHECK compares the
  // strings directly and why this one can too.
  if (input.endPeriod !== null && input.endPeriod < input.startPeriod) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endPeriod"],
      message: "งวดสิ้นสุดต้องไม่ก่อนงวดเริ่มต้น",
    });
  }
};

export const recurringExpenseInputSchema =
  recurringExpenseInputShape.superRefine(refineRecurringExpense);
export type RecurringExpenseInput = z.infer<typeof recurringExpenseInputSchema>;

export const updateRecurringExpenseInputSchema = recurringExpenseInputShape
  .extend({ id: z.string().uuid("รายการประจำไม่ถูกต้อง") })
  .superRefine(refineRecurringExpense);
export type UpdateRecurringExpenseInput = z.infer<
  typeof updateRecurringExpenseInputSchema
>;

export const deleteRecurringExpenseInputSchema = z.object({
  id: z.string().uuid("รายการประจำไม่ถูกต้อง"),
});
export type DeleteRecurringExpenseInput = z.infer<
  typeof deleteRecurringExpenseInputSchema
>;

// ------------------------------------------------------------
// 4. Read queries
// ------------------------------------------------------------

export const getExpensesQuerySchema = z
  .object({
    branchId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
    supplierId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
    source: z.preprocess(
      blankToUndefined,
      z.enum(EXPENSE_SOURCE_VALUES).optional()
    ),
    paymentStatus: z.preprocess(
      blankToUndefined,
      z.enum(EXPENSE_PAYMENT_STATUS_VALUES).optional()
    ),
    /** Inclusive bounds on `bill_date`. */
    from: z.preprocess(
      blankToUndefined,
      z.coerce.date({ invalid_type_error: "วันที่เริ่มต้นไม่ถูกต้อง" }).optional()
    ),
    to: z.preprocess(
      blankToUndefined,
      z.coerce.date({ invalid_type_error: "วันที่สิ้นสุดไม่ถูกต้อง" }).optional()
    ),
  })
  .superRefine((q, ctx) => {
    if (q.from && q.to && q.to < q.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น",
      });
    }
  });
export type GetExpensesQuery = z.infer<typeof getExpensesQuerySchema>;

/**
 * What the "ถึงกำหนด" panel asks for. `asOfPeriod` exists so the computation is
 * a pure function of its input rather than of the clock — the same reason the
 * cost engine takes an `asOf` date (ADR 0014). Omitted, L3 uses the current
 * month in the tenant's timezone.
 */
export const getDueRecurringQuerySchema = z.object({
  branchId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  asOfPeriod: z.preprocess(blankToUndefined, periodString.optional()),
});
export type GetDueRecurringQuery = z.infer<typeof getDueRecurringQuerySchema>;

// ------------------------------------------------------------
// 5. Thai display labels (keyed by zod `issue.path[0]`)
// ------------------------------------------------------------

export const EXPENSE_FIELD_LABELS_TH: Record<string, string> = {
  branchId: "สาขา",
  supplierId: "ผู้ขาย",
  billDate: "วันที่บิล",
  billNo: "เลขที่บิล",
  vatInvoiceNo: "เลขที่ใบกำกับภาษี",
  vatRatePercent: "อัตรา VAT",
  isPriceVatInclusive: "ราคารวม VAT แล้ว",
  subjectToWht: "หักภาษี ณ ที่จ่าย",
  whtRatePercent: "อัตราภาษีหัก ณ ที่จ่าย",
  whtCertificateNo: "เลขที่หนังสือรับรอง (50 ทวิ)",
  paymentMethod: "วิธีชำระเงิน",
  paymentStatus: "สถานะการจ่ายเงิน",
  paidAt: "วันที่จ่ายเงิน",
  recurringExpenseId: "รายการประจำ",
  period: "งวด",
  notes: "หมายเหตุ",
  items: "รายการค่าใช้จ่าย",
  categoryId: "หมวดบัญชี",
  departmentId: "แผนก",
  productId: "วัตถุดิบ",
  productUnitId: "หน่วย",
  description: "รายละเอียด",
  qty: "จำนวน",
  unitPrice: "ราคาต่อหน่วย",
  lineTotal: "จำนวนเงิน",
};

export const RECURRING_EXPENSE_FIELD_LABELS_TH: Record<string, string> = {
  branchId: "สาขา",
  supplierId: "ผู้ขาย",
  categoryId: "หมวดบัญชี",
  description: "รายละเอียด",
  defaultAmount: "จำนวนเงินตั้งต้น",
  isPriceVatInclusive: "ราคารวม VAT แล้ว",
  vatRatePercent: "อัตรา VAT",
  subjectToWht: "หักภาษี ณ ที่จ่าย",
  whtRatePercent: "อัตราภาษีหัก ณ ที่จ่าย",
  dayOfMonth: "วันที่ครบกำหนด",
  startPeriod: "งวดเริ่มต้น",
  endPeriod: "งวดสิ้นสุด",
  isActive: "เปิดใช้งาน",
};

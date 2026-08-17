// ============================================================
// Mise — Expense logic (Sprint 3 Part 16 L3a, ADR 0016)
// ============================================================
// Every baht that leaves the business. Reads and writes live together here,
// following stock-count.ts rather than splitting the file.
//
// Four things carry the Part's weight:
//
//   * **All of the money is computed HERE, in `Prisma.Decimal`** — never
//     accepted from the client and never done in JS floats. `computeExpenseAmounts`
//     is the single implementation; L4's live form preview and L3b's goods-receipt
//     hook both call it, so a bill typed by hand and a bill created by a receipt
//     cannot disagree about what 7% of something is.
//   * **WHT is withheld on `subtotal_excl_vat`** (Q6). master-spec §5.4 computes
//     it on the VAT-inclusive total, which over-withholds on every bill carrying
//     both: 10,000 + 7% VAT at 3% is 300, not 321, and the figure on the 50 ทวิ
//     certificate has to match what the recipient claims to have been withheld.
//   * **A recurring template generates nothing** (Q5). `getDueRecurringLogic`
//     ASKS which months have no expense carrying the template's id; confirming is
//     an ordinary create with the pair filled in, and the partial unique on
//     `(recurring_expense_id, period)` is what makes a double-confirm impossible
//     rather than merely unlikely.
//   * **A goods-receipt expense is not editable where the receipt spoke** (Q3.4).
//     The receipt is the document of record for what arrived and what it cost;
//     an expense that could disagree with it would put two different numbers in
//     front of the same owner. What the receipt never knew — the tax-invoice
//     number, withholding, payment — stays editable.
//
// The goods-receipt hook itself (confirm writes an expense, void removes it) is
// L3b, in goods-receipt.ts where the transaction already is.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient, Expense, RecurringExpense } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";
import { computeBangkokToday } from "@/lib/bangkok-date";
import type {
  DeleteExpenseInput,
  DeleteRecurringExpenseInput,
  ExpenseInput,
  ExpenseItemInput,
  GetDueRecurringQuery,
  GetExpensesQuery,
  RecurringExpenseInput,
  SetExpensePaymentInput,
  UpdateExpenseInput,
  UpdateRecurringExpenseInput,
} from "@/lib/validations/expense";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const MONEY_SCALE = 2;

/** THB satang. Every stored money column is Decimal(_,2). */
const money = (d: Prisma.Decimal): Prisma.Decimal =>
  d.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

export class ExpenseNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Expense "${id}" does not exist for this tenant`);
    this.name = "ExpenseNotFoundError";
  }
}

/**
 * Thrown when an edit reaches a field a goods receipt owns (Q3.4).
 *
 * The form renders those fields read-only, so reaching this means a stale tab or
 * a hand-made POST — either way the user's edit must not be silently dropped.
 */
export class ExpenseSourceLockedError extends Error {
  constructor(
    public readonly id: string,
    public readonly field: string
  ) {
    super(`Expense "${id}" comes from a goods receipt; "${field}" is not editable`);
    this.name = "ExpenseSourceLockedError";
  }
}

/** Thrown when a unit is not a unit of the product on the same line. */
export class ExpenseUnitMismatchError extends Error {
  constructor(
    public readonly unitId: string,
    public readonly productId: string
  ) {
    super(`Unit "${unitId}" is not a unit of product "${productId}"`);
    this.name = "ExpenseUnitMismatchError";
  }
}

export class RecurringExpenseNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Recurring expense "${id}" does not exist for this tenant`);
    this.name = "RecurringExpenseNotFoundError";
  }
}

/**
 * Thrown when a confirmation does not match the template it claims to confirm.
 *
 * One error with a reason rather than three classes: the action layer switches
 * on `reason` for the Thai message, and the three cases are the same mistake
 * seen from different sides — a form that has drifted from its template.
 */
export class RecurringExpenseConfirmError extends Error {
  constructor(
    public readonly id: string,
    public readonly reason: "INACTIVE" | "WINDOW" | "BRANCH",
    public readonly period: string
  ) {
    super(`Recurring expense "${id}" cannot be confirmed for ${period}: ${reason}`);
    this.name = "RecurringExpenseConfirmError";
  }
}

/** Thrown when the month has already been confirmed — the partial unique firing. */
export class RecurringPeriodAlreadyConfirmedError extends Error {
  constructor(
    public readonly recurringExpenseId: string,
    public readonly period: string
  ) {
    super(`Recurring expense "${recurringExpenseId}" already has an expense for ${period}`);
    this.name = "RecurringPeriodAlreadyConfirmedError";
  }
}

/**
 * Narrow P2002 to the constraint that actually fired, never "some unique broke"
 * — Pitfall #24, logged when Part 7a's SKU handler swallowed every P2002.
 *
 * Matched by COLUMN, not by index name: the two expense uniques are PARTIAL
 * indexes written by hand (`prisma/manual/expense_unique.sql`), and Prisma
 * reports them as the column list (`recurring_expense_id`, `period`) rather than
 * as `expense_recurring_period_unique`. Both spellings are checked so a future
 * driver that reports the name instead does not silently stop matching.
 */
const isUniqueViolationOn = (e: unknown, columns: string[], indexName: string): boolean => {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") {
    return false;
  }
  const target = e.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.includes(indexName) || columns.every((c) => asText.includes(c));
};

/** `expense_recurring_period_unique` — one confirmation per template per month. */
const RECURRING_PERIOD_UNIQUE = {
  columns: ["recurring_expense_id", "period"],
  indexName: "expense_recurring_period_unique",
};

// ------------------------------------------------------------
// The money
// ------------------------------------------------------------

/** What one line contributes, once the tax has been taken out of it. */
export type ComputedExpenseItem = {
  /** ALWAYS excluding VAT — the header carries the tax (Decision #35). */
  totalPrice: Prisma.Decimal;
};

export type ComputedExpenseAmounts = {
  subtotalExclVat: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  /** null unless the bill is subject to withholding. */
  whtAmount: Prisma.Decimal | null;
  /** `total − wht`. What actually leaves the bank. */
  netPaymentAmount: Prisma.Decimal;
  /** Per line, in the order given. */
  items: ComputedExpenseItem[];
};

type AmountsInput = {
  items: { lineTotal: number | Prisma.Decimal }[];
  vatRatePercent: number | Prisma.Decimal | null;
  isPriceVatInclusive: boolean;
  subjectToWht: boolean;
  whtRatePercent: number | Prisma.Decimal | null;
};

/**
 * Turn what the human TYPED into what the bill means.
 *
 * Two directions, and `is_price_vat_inclusive` is the only record of which one
 * ran (Decision #36) — a reader cannot recover it from the results:
 *
 *   inclusive   subtotal = typed ÷ (1 + rate)      total = typed
 *   exclusive   subtotal = typed                   total = typed × (1 + rate)
 *
 * Rounding happens in this order: each line is rounded to satang, the subtotal is
 * their EXACT sum, and VAT is rounded once against the subtotal — the same order
 * `purchase-order.ts` uses, so a PO and the expense its receipt creates agree to
 * the satang.
 *
 * In the inclusive direction the rounded lines can miss the rounded subtotal by a
 * satang or two; the remainder is given to the LARGEST line, where it is
 * proportionally smallest and cannot turn a small line negative. Without it,
 * `Σ items.total_price ≠ subtotal_excl_vat` and every reconciliation downstream
 * inherits the discrepancy.
 */
export function computeExpenseAmounts(input: AmountsInput): ComputedExpenseAmounts {
  const typed = input.items.map((i) => money(new Prisma.Decimal(i.lineTotal)));
  const typedTotal = typed.reduce((s, v) => s.plus(v), ZERO);

  const vatRate =
    input.vatRatePercent === null ? null : new Prisma.Decimal(input.vatRatePercent);
  const hasVat = vatRate !== null && !vatRate.isZero();

  let subtotalExclVat: Prisma.Decimal;
  let vatAmount: Prisma.Decimal;
  let totalAmount: Prisma.Decimal;
  let itemTotals: Prisma.Decimal[];

  if (!hasVat) {
    // A rate of null means "no VAT on this bill"; a rate of 0 means "zero-rated
    // and I checked". Both produce the same arithmetic, and the stored rate keeps
    // the difference between them visible.
    subtotalExclVat = typedTotal;
    vatAmount = ZERO;
    totalAmount = typedTotal;
    itemTotals = typed;
  } else if (input.isPriceVatInclusive) {
    const divisor = HUNDRED.plus(vatRate!).div(HUNDRED);
    subtotalExclVat = money(typedTotal.div(divisor));
    vatAmount = money(typedTotal.minus(subtotalExclVat));
    totalAmount = typedTotal;

    itemTotals = typed.map((t) => money(t.div(divisor)));
    const drift = subtotalExclVat.minus(itemTotals.reduce((s, v) => s.plus(v), ZERO));
    if (!drift.isZero() && itemTotals.length > 0) {
      let largest = 0;
      for (let i = 1; i < itemTotals.length; i++) {
        if (itemTotals[i].greaterThan(itemTotals[largest])) largest = i;
      }
      itemTotals[largest] = itemTotals[largest].plus(drift);
    }
  } else {
    subtotalExclVat = typedTotal;
    vatAmount = money(subtotalExclVat.mul(vatRate!).div(HUNDRED));
    totalAmount = money(subtotalExclVat.plus(vatAmount));
    itemTotals = typed;
  }

  // THE correction (Q6): the base is the PRE-VAT amount. Withholding on the
  // VAT-inclusive total over-withholds on every bill carrying both taxes.
  const whtRate =
    input.subjectToWht && input.whtRatePercent !== null
      ? new Prisma.Decimal(input.whtRatePercent)
      : null;
  const whtAmount = whtRate ? money(subtotalExclVat.mul(whtRate).div(HUNDRED)) : null;

  return {
    subtotalExclVat,
    vatAmount,
    totalAmount,
    whtAmount,
    netPaymentAmount: money(totalAmount.minus(whtAmount ?? ZERO)),
    items: itemTotals.map((totalPrice) => ({ totalPrice })),
  };
}

// ------------------------------------------------------------
// Periods
// ------------------------------------------------------------

/**
 * A period is the LABEL "YYYY-MM", not a timestamp — no timezone question to get
 * wrong (Decision #60), which is why it sorts and compares as a plain string.
 */
export function periodOf(day: Date): string {
  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The current month in Bangkok. Hardcoded tz until per-tenant tz lands (Sprint 3+). */
export const currentPeriod = (): string => periodOf(computeBangkokToday());

export function addPeriods(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * How far back the due panel looks.
 *
 * A template that started two years ago and was never confirmed would otherwise
 * report 24 months due, which is not a to-do list — it is a wall someone closes.
 * Twelve months is a year of catching up, and the cap is stated on screen rather
 * than hidden.
 */
export const DUE_LOOKBACK_MONTHS = 12;

// ------------------------------------------------------------
// Shapes
// ------------------------------------------------------------

const ITEM_INCLUDE = {
  category: {
    select: {
      id: true,
      account: true,
      accountingSection: true,
      groupName: true,
    },
  },
  department: { select: { id: true, name: true } },
  product: { select: { id: true, name: true, sku: true, deletedAt: true } },
  productUnit: { select: { id: true, unitName: true } },
} as const;

const DETAIL_INCLUDE = {
  branch: { select: { id: true, name: true, code: true } },
  supplier: { select: { id: true, nameFull: true, nameShort: true, code: true, deletedAt: true } },
  sourceGr: { select: { id: true, grNumber: true, status: true } },
  recurring: { select: { id: true, description: true } },
  createdByUser: { select: { id: true, name: true, email: true } },
  items: { include: ITEM_INCLUDE, orderBy: { lineNo: "asc" } },
} as const;

export type ExpenseDetail = Prisma.ExpenseGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

export type ExpenseListRow = Prisma.ExpenseGetPayload<{
  include: {
    branch: { select: { id: true; name: true; code: true } };
    supplier: { select: { id: true; nameFull: true; nameShort: true } };
    _count: { select: { items: true } };
  };
}>;

export type RecurringExpenseRow = Prisma.RecurringExpenseGetPayload<{
  include: {
    branch: { select: { id: true; name: true; code: true } };
    supplier: { select: { id: true; nameFull: true; nameShort: true } };
    category: {
      select: {
        id: true;
        account: true;
        accountingSection: true;
        groupName: true;
      };
    };
  };
}>;

/** One template and the months it is waiting for. */
export type DueRecurringRow = {
  template: RecurringExpenseRow;
  /** Oldest first — the order someone works through them. */
  duePeriods: string[];
};

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

export async function getExpensesLogic(
  tenantId: string,
  query: GetExpensesQuery = {}
): Promise<ExpenseListRow[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.expense.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
        ...(query.from || query.to
          ? {
              billDate: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, nameFull: true, nameShort: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
    })
  );
}

export async function getExpenseByIdLogic(
  tenantId: string,
  id: string
): Promise<ExpenseDetail | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.expense.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: DETAIL_INCLUDE,
    })
  );
}

/**
 * The expense a receipt created, if any — the link Q7 asks for.
 *
 * Without it a system-created document cannot be found from the document that
 * created it, which is the fastest way to make people distrust automation.
 */
export async function getExpenseByGoodsReceiptLogic(
  tenantId: string,
  goodsReceiptId: string
): Promise<Expense | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.expense.findFirst({
      where: { tenantId, sourceGrId: goodsReceiptId, deletedAt: null },
    })
  );
}

export async function getRecurringExpensesLogic(
  tenantId: string,
  branchId?: string
): Promise<RecurringExpenseRow[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.recurringExpense.findMany({
      where: { tenantId, deletedAt: null, ...(branchId ? { branchId } : {}) },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, nameFull: true, nameShort: true } },
        category: {
    select: {
      id: true,
      account: true,
      accountingSection: true,
      groupName: true,
    },
  },
      },
      orderBy: [{ isActive: "desc" }, { dayOfMonth: "asc" }, { description: "asc" }],
    })
  );
}

export async function getRecurringExpenseByIdLogic(
  tenantId: string,
  id: string
): Promise<RecurringExpenseRow | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.recurringExpense.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, nameFull: true, nameShort: true } },
        category: {
    select: {
      id: true,
      account: true,
      accountingSection: true,
      groupName: true,
    },
  },
      },
    })
  );
}

/**
 * What is due, COMPUTED — nothing was ever generated to look up (Q5).
 *
 * For each active template, every month in its window up to `asOfPeriod` that
 * carries no expense with this template's id is a month still owed. A soft-deleted
 * expense does not count as a confirmation, which is what makes deleting a
 * mistakenly-confirmed month put it back on the list rather than lose it.
 */
export async function getDueRecurringLogic(
  tenantId: string,
  query: GetDueRecurringQuery = {}
): Promise<DueRecurringRow[]> {
  const asOf = query.asOfPeriod ?? currentPeriod();
  const floor = addPeriods(asOf, -(DUE_LOOKBACK_MONTHS - 1));

  return withTenantContext(tenantId, async (tx) => {
    const templates = await tx.recurringExpense.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        startPeriod: { lte: asOf },
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, nameFull: true, nameShort: true } },
        category: {
    select: {
      id: true,
      account: true,
      accountingSection: true,
      groupName: true,
    },
  },
      },
      orderBy: [{ dayOfMonth: "asc" }, { description: "asc" }],
    });
    if (templates.length === 0) return [];

    const confirmed = await tx.expense.findMany({
      where: {
        tenantId,
        deletedAt: null,
        recurringExpenseId: { in: templates.map((t) => t.id) },
      },
      select: { recurringExpenseId: true, period: true },
    });
    const confirmedKeys = new Set(
      confirmed.map((c) => `${c.recurringExpenseId}|${c.period}`)
    );

    const rows: DueRecurringRow[] = [];
    for (const template of templates) {
      const start = template.startPeriod > floor ? template.startPeriod : floor;
      const end =
        template.endPeriod && template.endPeriod < asOf ? template.endPeriod : asOf;

      const duePeriods: string[] = [];
      for (let p = start; p <= end; p = addPeriods(p, 1)) {
        if (!confirmedKeys.has(`${template.id}|${p}`)) duePeriods.push(p);
      }
      if (duePeriods.length > 0) rows.push({ template, duePeriods });
    }
    return rows;
  });
}

// ------------------------------------------------------------
// Write helpers
// ------------------------------------------------------------

/**
 * Every FK on the bill points at a LIVE row of this tenant.
 *
 * RLS is inert until Sprint 7 (ADR 0004), so this is the guard, not a formality:
 * without it a hand-made POST could file another tenant's category against this
 * tenant's spend and land it in `/cost`. Ids are de-duplicated first — a 200-line
 * receipt usually references a handful of distinct categories.
 */
async function assertItemRefs(
  tx: PrismaClient,
  tenantId: string,
  items: ExpenseItemInput[]
): Promise<void> {
  const distinct = <T>(xs: (T | null)[]): T[] =>
    Array.from(new Set(xs.filter((x): x is T => x !== null)));

  for (const id of distinct(items.map((i) => i.categoryId))) {
    await assertRefBelongsToTenant(tx, tenantId, "category", id);
  }
  for (const id of distinct(items.map((i) => i.departmentId))) {
    await assertRefBelongsToTenant(tx, tenantId, "department", id);
  }
  for (const id of distinct(items.map((i) => i.productId))) {
    await assertRefBelongsToTenant(tx, tenantId, "product", id);
  }

  // A unit belongs to its product (ADR 0005). zod can only see that both are
  // uuids; that they belong together is a DB fact, so it is checked here.
  const pairs = items.filter((i) => i.productUnitId !== null && i.productId !== null);
  if (pairs.length > 0) {
    // `product_unit` carries no `tenant_id` of its own — it is scoped through the
    // product that owns it, which the loop above has already proved belongs here.
    const units = await tx.productUnit.findMany({
      where: {
        product: { tenantId },
        id: { in: distinct(pairs.map((i) => i.productUnitId)) },
      },
      select: { id: true, productId: true },
    });
    const productOfUnit = new Map(units.map((u) => [u.id, u.productId]));
    for (const item of pairs) {
      if (productOfUnit.get(item.productUnitId!) !== item.productId) {
        throw new ExpenseUnitMismatchError(item.productUnitId!, item.productId!);
      }
    }
  }
}

/**
 * A confirmation must match the template it claims to confirm.
 *
 * Checked rather than trusted because the branch decides where the money lands
 * in `/cost`, and the window decides whether the month was ever due — a
 * confirmation outside it would show up as spend nobody expected, in a month the
 * due panel would go on asking for.
 */
async function assertRecurringConfirmable(
  tx: PrismaClient,
  tenantId: string,
  recurringExpenseId: string,
  period: string,
  branchId: string
): Promise<void> {
  const template = await tx.recurringExpense.findFirst({
    where: { id: recurringExpenseId, tenantId, deletedAt: null },
  });
  if (!template) throw new RecurringExpenseNotFoundError(recurringExpenseId);

  if (!template.isActive) {
    throw new RecurringExpenseConfirmError(recurringExpenseId, "INACTIVE", period);
  }
  if (template.branchId !== branchId) {
    throw new RecurringExpenseConfirmError(recurringExpenseId, "BRANCH", period);
  }
  if (
    period < template.startPeriod ||
    (template.endPeriod !== null && period > template.endPeriod)
  ) {
    throw new RecurringExpenseConfirmError(recurringExpenseId, "WINDOW", period);
  }
}

/** The fields a goods receipt owns. Editing any of them is refused (Q3.4). */
const GR_LOCKED_FIELDS = [
  "branchId",
  "supplierId",
  "billDate",
  "billNo",
  "vatRatePercent",
  "isPriceVatInclusive",
] as const;

const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime();

function assertGrLockedFieldsUnchanged(
  existing: Expense,
  input: UpdateExpenseInput
): void {
  const differs: Record<(typeof GR_LOCKED_FIELDS)[number], boolean> = {
    branchId: existing.branchId !== input.branchId,
    supplierId: (existing.supplierId ?? null) !== (input.supplierId ?? null),
    billDate: !sameDay(existing.billDate, input.billDate),
    billNo: (existing.billNo ?? null) !== (input.billNo ?? null),
    vatRatePercent:
      (existing.vatRatePercent === null) !== (input.vatRatePercent === null) ||
      (existing.vatRatePercent !== null &&
        input.vatRatePercent !== null &&
        !existing.vatRatePercent.equals(input.vatRatePercent)),
    isPriceVatInclusive: existing.isPriceVatInclusive !== input.isPriceVatInclusive,
  };

  for (const field of GR_LOCKED_FIELDS) {
    if (differs[field]) throw new ExpenseSourceLockedError(existing.id, field);
  }
}

// ------------------------------------------------------------
// Writes — the bill
// ------------------------------------------------------------

export async function createExpenseLogic(
  tenantId: string,
  input: ExpenseInput,
  userId: string
): Promise<ExpenseDetail> {
  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
    await assertRefBelongsToTenant(tx, tenantId, "supplier", input.supplierId);
    await assertItemRefs(tx, tenantId, input.items);

    if (input.recurringExpenseId !== null && input.period !== null) {
      await assertRecurringConfirmable(
        tx,
        tenantId,
        input.recurringExpenseId,
        input.period,
        input.branchId
      );
    }

    const amounts = computeExpenseAmounts(input);

    // A PAID bill must record WHEN (`expense_paid_stamped_check`). Marking a bill
    // paid should be one click, so an omitted date is stamped rather than refused.
    const paidAt =
      input.paymentStatus === "PAID" ? (input.paidAt ?? new Date()) : null;

    try {
      const created = await tx.expense.create({
        data: {
          tenantId,
          branchId: input.branchId,
          supplierId: input.supplierId,
          source: "MANUAL",
          sourceGrId: null,
          recurringExpenseId: input.recurringExpenseId,
          period: input.period,
          billDate: input.billDate,
          billNo: input.billNo,
          vatInvoiceNo: input.vatInvoiceNo,
          subtotalExclVat: amounts.subtotalExclVat,
          vatRatePercent: input.vatRatePercent,
          vatAmount: amounts.vatAmount,
          isPriceVatInclusive: input.isPriceVatInclusive,
          totalAmount: amounts.totalAmount,
          subjectToWht: input.subjectToWht,
          whtRatePercent: input.subjectToWht ? input.whtRatePercent : null,
          whtAmount: amounts.whtAmount,
          whtCertificateNo: input.whtCertificateNo,
          netPaymentAmount: amounts.netPaymentAmount,
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentStatus,
          paidAt,
          notes: input.notes,
          createdBy: userId,
          items: {
            create: input.items.map((item, index) => ({
              tenantId,
              lineNo: index + 1,
              categoryId: item.categoryId,
              departmentId: item.departmentId,
              productId: item.productId,
              productUnitId: item.productUnitId,
              description: item.description,
              qty: item.qty,
              unitPrice: item.unitPrice,
              totalPrice: amounts.items[index].totalPrice,
            })),
          },
        },
        include: DETAIL_INCLUDE,
      });
      return created;
    } catch (e) {
      if (
        input.recurringExpenseId !== null &&
        input.period !== null &&
        isUniqueViolationOn(
          e,
          RECURRING_PERIOD_UNIQUE.columns,
          RECURRING_PERIOD_UNIQUE.indexName
        )
      ) {
        throw new RecurringPeriodAlreadyConfirmedError(
          input.recurringExpenseId,
          input.period
        );
      }
      throw e;
    }
  });
}

/**
 * Rewrite a bill.
 *
 * A manual bill is replaced wholesale — header and lines — because a bill is a
 * small document typed in one go, and diffing lines would buy nothing but a
 * chance to get it wrong (the same call ADR 0013 made for a draft receipt).
 *
 * A goods-receipt bill takes only what the receipt never knew. Its lines are the
 * receipt's lines and are not touched at all; its locked scalars are CHECKED
 * rather than ignored, so a stale form is told rather than silently overruled.
 */
export async function updateExpenseLogic(
  tenantId: string,
  input: UpdateExpenseInput
): Promise<ExpenseDetail> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id: input.id, tenantId, deletedAt: null },
    });
    if (!existing) throw new ExpenseNotFoundError(input.id);

    const paidAt =
      input.paymentStatus === "PAID" ? (input.paidAt ?? new Date()) : null;

    if (existing.source === "FROM_GOODS_RECEIPT") {
      assertGrLockedFieldsUnchanged(existing, input);

      // The subtotal is the receipt's, so withholding is recomputed against what
      // is STORED — never against the items in a form that cannot change them.
      const whtAmount =
        input.subjectToWht && input.whtRatePercent !== null
          ? money(
              existing.subtotalExclVat
                .mul(new Prisma.Decimal(input.whtRatePercent))
                .div(HUNDRED)
            )
          : null;

      return tx.expense.update({
        where: { id: input.id },
        data: {
          vatInvoiceNo: input.vatInvoiceNo,
          subjectToWht: input.subjectToWht,
          whtRatePercent: input.subjectToWht ? input.whtRatePercent : null,
          whtAmount,
          whtCertificateNo: input.whtCertificateNo,
          netPaymentAmount: money(existing.totalAmount.minus(whtAmount ?? ZERO)),
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentStatus,
          paidAt,
          notes: input.notes,
        },
        include: DETAIL_INCLUDE,
      });
    }

    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
    await assertRefBelongsToTenant(tx, tenantId, "supplier", input.supplierId);
    await assertItemRefs(tx, tenantId, input.items);

    if (input.recurringExpenseId !== null && input.period !== null) {
      await assertRecurringConfirmable(
        tx,
        tenantId,
        input.recurringExpenseId,
        input.period,
        input.branchId
      );
    }

    const amounts = computeExpenseAmounts(input);

    // Lines are replaced, not diffed: they carry no identity anyone refers to
    // (nothing points at an `expense_item`), so a delete-and-recreate loses
    // nothing and cannot leave a half-updated bill behind.
    await tx.expenseItem.deleteMany({ where: { tenantId, expenseId: input.id } });

    try {
      return await tx.expense.update({
        where: { id: input.id },
        data: {
          branchId: input.branchId,
          supplierId: input.supplierId,
          recurringExpenseId: input.recurringExpenseId,
          period: input.period,
          billDate: input.billDate,
          billNo: input.billNo,
          vatInvoiceNo: input.vatInvoiceNo,
          subtotalExclVat: amounts.subtotalExclVat,
          vatRatePercent: input.vatRatePercent,
          vatAmount: amounts.vatAmount,
          isPriceVatInclusive: input.isPriceVatInclusive,
          totalAmount: amounts.totalAmount,
          subjectToWht: input.subjectToWht,
          whtRatePercent: input.subjectToWht ? input.whtRatePercent : null,
          whtAmount: amounts.whtAmount,
          whtCertificateNo: input.whtCertificateNo,
          netPaymentAmount: amounts.netPaymentAmount,
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentStatus,
          paidAt,
          notes: input.notes,
          items: {
            create: input.items.map((item, index) => ({
              tenantId,
              lineNo: index + 1,
              categoryId: item.categoryId,
              departmentId: item.departmentId,
              productId: item.productId,
              productUnitId: item.productUnitId,
              description: item.description,
              qty: item.qty,
              unitPrice: item.unitPrice,
              totalPrice: amounts.items[index].totalPrice,
            })),
          },
        },
        include: DETAIL_INCLUDE,
      });
    } catch (e) {
      if (
        input.recurringExpenseId !== null &&
        input.period !== null &&
        isUniqueViolationOn(
          e,
          RECURRING_PERIOD_UNIQUE.columns,
          RECURRING_PERIOD_UNIQUE.indexName
        )
      ) {
        throw new RecurringPeriodAlreadyConfirmedError(
          input.recurringExpenseId,
          input.period
        );
      }
      throw e;
    }
  });
}

/** Mark a bill paid or unpaid without opening the whole form. */
export async function setExpensePaymentLogic(
  tenantId: string,
  input: SetExpensePaymentInput
): Promise<Expense> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id: input.id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new ExpenseNotFoundError(input.id);

    return tx.expense.update({
      where: { id: input.id },
      data: {
        paymentStatus: input.paymentStatus,
        paidAt:
          input.paymentStatus === "PAID" ? (input.paidAt ?? new Date()) : null,
        paymentMethod: input.paymentMethod,
      },
    });
  });
}

/**
 * Hide a bill. Soft delete, like every document in this system.
 *
 * A goods-receipt bill cannot be deleted on its own: it exists because stock
 * arrived, and removing the money while the stock stays would make `/cost`
 * understate spend with nothing on screen to explain it. **Void the receipt** —
 * that removes both, in one transaction (Q3.3).
 */
export async function deleteExpenseLogic(
  tenantId: string,
  input: DeleteExpenseInput
): Promise<Expense> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id: input.id, tenantId, deletedAt: null },
    });
    if (!existing) throw new ExpenseNotFoundError(input.id);
    if (existing.source === "FROM_GOODS_RECEIPT") {
      throw new ExpenseSourceLockedError(input.id, "delete");
    }

    return tx.expense.update({
      where: { id: input.id },
      data: { deletedAt: new Date() },
    });
  });
}

// ------------------------------------------------------------
// Writes — the recurring template
// ------------------------------------------------------------

export async function createRecurringExpenseLogic(
  tenantId: string,
  input: RecurringExpenseInput
): Promise<RecurringExpenseRow> {
  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
    await assertRefBelongsToTenant(tx, tenantId, "supplier", input.supplierId);
    await assertRefBelongsToTenant(tx, tenantId, "category", input.categoryId);

    return tx.recurringExpense.create({
      data: {
        tenantId,
        branchId: input.branchId,
        supplierId: input.supplierId,
        categoryId: input.categoryId,
        description: input.description,
        defaultAmount: input.defaultAmount,
        isPriceVatInclusive: input.isPriceVatInclusive,
        vatRatePercent: input.vatRatePercent,
        subjectToWht: input.subjectToWht,
        whtRatePercent: input.subjectToWht ? input.whtRatePercent : null,
        dayOfMonth: input.dayOfMonth,
        startPeriod: input.startPeriod,
        endPeriod: input.endPeriod,
        isActive: input.isActive,
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, nameFull: true, nameShort: true } },
        category: {
    select: {
      id: true,
      account: true,
      accountingSection: true,
      groupName: true,
    },
  },
      },
    });
  });
}

/**
 * Edit a template.
 *
 * Months already confirmed are NOT revisited: the expenses they produced are
 * real bills someone approved, and a template is a starting point rather than a
 * source of truth about the past (Q5). Narrowing the window only changes what is
 * still due.
 */
export async function updateRecurringExpenseLogic(
  tenantId: string,
  input: UpdateRecurringExpenseInput
): Promise<RecurringExpenseRow> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.recurringExpense.findFirst({
      where: { id: input.id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new RecurringExpenseNotFoundError(input.id);

    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
    await assertRefBelongsToTenant(tx, tenantId, "supplier", input.supplierId);
    await assertRefBelongsToTenant(tx, tenantId, "category", input.categoryId);

    return tx.recurringExpense.update({
      where: { id: input.id },
      data: {
        branchId: input.branchId,
        supplierId: input.supplierId,
        categoryId: input.categoryId,
        description: input.description,
        defaultAmount: input.defaultAmount,
        isPriceVatInclusive: input.isPriceVatInclusive,
        vatRatePercent: input.vatRatePercent,
        subjectToWht: input.subjectToWht,
        whtRatePercent: input.subjectToWht ? input.whtRatePercent : null,
        dayOfMonth: input.dayOfMonth,
        startPeriod: input.startPeriod,
        endPeriod: input.endPeriod,
        isActive: input.isActive,
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, nameFull: true, nameShort: true } },
        category: {
    select: {
      id: true,
      account: true,
      accountingSection: true,
      groupName: true,
    },
  },
      },
    });
  });
}

/**
 * Retire a template. Soft delete — the bills it already produced keep pointing
 * at it, so the detail page can still say where a confirmed month came from.
 */
export async function deleteRecurringExpenseLogic(
  tenantId: string,
  input: DeleteRecurringExpenseInput
): Promise<RecurringExpense> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.recurringExpense.findFirst({
      where: { id: input.id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new RecurringExpenseNotFoundError(input.id);

    return tx.recurringExpense.update({
      where: { id: input.id },
      data: { deletedAt: new Date(), isActive: false },
    });
  });
}

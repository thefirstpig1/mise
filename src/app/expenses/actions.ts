"use server";

// ============================================================
// Mise — expense Server Actions (Sprint 3 Part 16 L4, ADR 0016)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here.
//
// Two things worth stating twice, because a form field for either would be a
// hole rather than a feature:
//
//   * **No amount is ever read from the form except what the user typed per
//     line.** The subtotal, the VAT, the total, the withholding and the net
//     payment are all derived server-side (Q3/Q6). A `total_amount` field would
//     let a stale tab tell `/cost` what the branch spent.
//   * **The fields a goods receipt owns are not sent back as editable.** The
//     server refuses them (`ExpenseSourceLockedError`) rather than silently
//     dropping the edit — a stale form should be told, not overruled.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  deleteExpenseInputSchema,
  deleteRecurringExpenseInputSchema,
  expenseInputSchema,
  recurringExpenseInputSchema,
  setExpensePaymentInputSchema,
  updateExpenseInputSchema,
  updateRecurringExpenseInputSchema,
  EXPENSE_FIELD_LABELS_TH,
  RECURRING_EXPENSE_FIELD_LABELS_TH,
} from "@/lib/validations/expense";
import {
  createExpenseLogic,
  createRecurringExpenseLogic,
  deleteExpenseLogic,
  deleteRecurringExpenseLogic,
  ExpenseNotFoundError,
  ExpenseSourceLockedError,
  ExpenseUnitMismatchError,
  RecurringExpenseConfirmError,
  RecurringExpenseNotFoundError,
  RecurringPeriodAlreadyConfirmedError,
  setExpensePaymentLogic,
  updateExpenseLogic,
  updateRecurringExpenseLogic,
} from "@/server/expense";
import { CrossTenantReferenceError } from "@/server/product";
import {
  toExpenseDetailView,
  toRecurringExpenseView,
  type ExpenseDetailView,
  type RecurringExpenseView,
} from "./_components/expense-view";

// --- Thai messages (the user-facing error paths) ---
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const NOT_FOUND_MESSAGE = "ไม่พบรายการค่าใช้จ่ายนี้";
const RECURRING_NOT_FOUND_MESSAGE = "ไม่พบรายการประจำนี้";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";

export type ExpenseActionState =
  | { ok: true; expenseId: string; detail?: ExpenseDetailView }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type RecurringExpenseActionState =
  | { ok: true; recurringId: string; template?: RecurringExpenseView }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

function toFieldErrors(
  error: ZodError,
  labels: Record<string, string>
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${labels[key] ?? key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/** Which field a locked-by-the-receipt edit belongs to, for the form to mark. */
const LOCKED_FIELD_MESSAGE: Record<string, string> = {
  branchId: "สาขามาจากใบรับของ แก้ที่นี่ไม่ได้",
  supplierId: "ผู้ขายมาจากใบรับของ แก้ที่นี่ไม่ได้",
  billDate: "วันที่มาจากใบรับของ แก้ที่นี่ไม่ได้",
  billNo: "เลขที่บิลมาจากใบรับของ แก้ที่นี่ไม่ได้",
  vatRatePercent: "อัตรา VAT มาจากใบรับของ แก้ที่นี่ไม่ได้",
  isPriceVatInclusive: "วิธีคิด VAT มาจากใบรับของ แก้ที่นี่ไม่ได้",
};

/**
 * The failure half of both action states — identical by design, so one mapper
 * serves the bill and the template.
 */
type ActionFailure = {
  ok: false;
  formError?: string;
  fieldErrors?: Record<string, string>;
};

/** Map a typed error → Thai; rethrow the rest. */
function toFormError(e: unknown): ActionFailure {
  const fail = (v: Omit<ActionFailure, "ok">): ActionFailure => ({ ok: false, ...v });

  if (e instanceof ExpenseNotFoundError) {
    return fail({ formError: NOT_FOUND_MESSAGE });
  }
  if (e instanceof RecurringExpenseNotFoundError) {
    return fail({ formError: RECURRING_NOT_FOUND_MESSAGE });
  }
  if (e instanceof ExpenseSourceLockedError) {
    // Deleting is refused for the same reason as editing, but there is no field
    // to hang it on: the bill exists because stock arrived, so the receipt is
    // where it gets undone (Q3.3).
    if (e.field === "delete") {
      return fail({
        formError:
          "รายการนี้มาจากใบรับของ ลบเดี่ยว ๆ ไม่ได้ — ให้ยกเลิกใบรับของแทน แล้วบิลจะถูกยกเลิกไปด้วย",
      });
    }
    return fail({
      fieldErrors: {
        [e.field]: LOCKED_FIELD_MESSAGE[e.field] ?? "ช่องนี้มาจากใบรับของ แก้ไม่ได้",
      },
    });
  }
  if (e instanceof ExpenseUnitMismatchError) {
    return fail({ fieldErrors: { productUnitId: UNIT_MISMATCH_MESSAGE } });
  }
  if (e instanceof RecurringPeriodAlreadyConfirmedError) {
    return fail({
      formError: `งวด ${e.period} ของรายการประจำนี้ถูกบันทึกไปแล้ว — เปิดบิลเดิมแทนการบันทึกซ้ำ`,
    });
  }
  if (e instanceof RecurringExpenseConfirmError) {
    const message =
      e.reason === "INACTIVE"
        ? "รายการประจำนี้ถูกปิดใช้งานแล้ว"
        : e.reason === "BRANCH"
          ? "สาขาไม่ตรงกับรายการประจำที่เลือก"
          : `งวด ${e.period} อยู่นอกช่วงที่รายการประจำนี้ใช้งาน`;
    return fail({ formError: message });
  }
  if (e instanceof CrossTenantReferenceError) {
    const field =
      e.kind === "branch"
        ? "branchId"
        : e.kind === "supplier"
          ? "supplierId"
          : e.kind === "category"
            ? "categoryId"
            : e.kind === "product"
              ? "productId"
              : e.kind === "department"
                ? "departmentId"
                : null;
    return field
      ? fail({ fieldErrors: { [field]: CROSS_TENANT_MESSAGE } })
      : fail({ formError: CROSS_TENANT_MESSAGE });
  }
  throw e; // unexpected → the error boundary
}

/**
 * Every surface a bill touches.
 *
 * `/cost` is in the list because spend is read from this table now (Q3/Q4) —
 * saving a bill changes the executive view, not just the list it was saved from.
 */
function revalidateExpenseViews(expenseId?: string): void {
  revalidatePath("/expenses");
  if (expenseId) revalidatePath(`/expenses/${expenseId}`);
  revalidatePath("/expenses/recurring");
  revalidatePath("/cost");
}

/**
 * Lines cross the form as parallel arrays zipped by index — the Part 8.5 fanout
 * pattern, used by every multi-row form since.
 *
 * A row with no amount typed is DROPPED rather than sent as zero: it is a row
 * someone added and thought better of, and a ฿0 line would otherwise sit on the
 * bill forever meaning nothing.
 */
function itemsFromFormData(formData: FormData) {
  const categoryIds = formData.getAll("item_category_id");
  const departmentIds = formData.getAll("item_department_id");
  const productIds = formData.getAll("item_product_id");
  const productUnitIds = formData.getAll("item_product_unit_id");
  const descriptions = formData.getAll("item_description");
  const qtys = formData.getAll("item_qty");
  const unitPrices = formData.getAll("item_unit_price");
  const lineTotals = formData.getAll("item_line_total");

  return categoryIds
    .map((categoryId, i) => ({
      categoryId,
      departmentId: departmentIds[i] ?? "",
      productId: productIds[i] ?? "",
      productUnitId: productUnitIds[i] ?? "",
      description: descriptions[i] ?? "",
      qty: qtys[i] ?? "",
      unitPrice: unitPrices[i] ?? "",
      lineTotal: lineTotals[i] ?? "",
    }))
    .filter(
      (item) => typeof item.lineTotal === "string" && item.lineTotal.trim() !== ""
    );
}

function expenseFromFormData(formData: FormData) {
  return {
    branchId: formData.get("branch_id"),
    supplierId: formData.get("supplier_id"),
    billDate: formData.get("bill_date"),
    billNo: formData.get("bill_no"),
    vatInvoiceNo: formData.get("vat_invoice_no"),
    vatRatePercent: formData.get("vat_rate_percent"),
    // An unchecked checkbox posts nothing at all, so absence is a real answer
    // here — "the prices I typed do NOT include VAT".
    isPriceVatInclusive: formData.get("is_price_vat_inclusive") === "on",
    subjectToWht: formData.get("subject_to_wht") === "on",
    whtRatePercent: formData.get("wht_rate_percent"),
    whtCertificateNo: formData.get("wht_certificate_no"),
    paymentMethod: formData.get("payment_method"),
    paymentStatus: formData.get("payment_status") ?? "UNPAID",
    paidAt: formData.get("paid_at"),
    recurringExpenseId: formData.get("recurring_expense_id"),
    period: formData.get("period"),
    notes: formData.get("notes"),
    items: itemsFromFormData(formData),
  };
}

// ------------------------------------------------------------
// The bill
// ------------------------------------------------------------

export async function createExpenseAction(
  _prevState: ExpenseActionState,
  formData: FormData
): Promise<ExpenseActionState> {
  const { tenantId, membership, assertBranch} = await requireTenant("expense:write");

  const parsed = expenseInputSchema.safeParse(expenseFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error, EXPENSE_FIELD_LABELS_TH) };
  }

  assertBranch(parsed.data.branchId);

  try {
    const expense = await createExpenseLogic(tenantId, parsed.data, membership.userId);
    revalidateExpenseViews(expense.id);
    return { ok: true, expenseId: expense.id, detail: toExpenseDetailView(expense) };
  } catch (e) {
    return toFormError(e);
  }
}

export async function updateExpenseAction(
  _prevState: ExpenseActionState,
  formData: FormData
): Promise<ExpenseActionState> {
  const { tenantId, assertBranch} = await requireTenant("expense:write");

  const parsed = updateExpenseInputSchema.safeParse({
    ...expenseFromFormData(formData),
    id: formData.get("id"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error, EXPENSE_FIELD_LABELS_TH) };
  }

  assertBranch(parsed.data.branchId);

  try {
    const expense = await updateExpenseLogic(tenantId, parsed.data);
    revalidateExpenseViews(expense.id);
    return { ok: true, expenseId: expense.id, detail: toExpenseDetailView(expense) };
  } catch (e) {
    return toFormError(e);
  }
}

/** Mark a bill paid or unpaid without opening the whole form. */
export async function setExpensePaymentAction(
  _prevState: ExpenseActionState,
  formData: FormData
): Promise<ExpenseActionState> {
  const { tenantId } = await requireTenant("expense:write");

  const parsed = setExpensePaymentInputSchema.safeParse({
    id: formData.get("id"),
    paymentStatus: formData.get("payment_status"),
    paidAt: formData.get("paid_at"),
    paymentMethod: formData.get("payment_method"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error, EXPENSE_FIELD_LABELS_TH) };
  }

  try {
    const expense = await setExpensePaymentLogic(tenantId, parsed.data);
    revalidateExpenseViews(expense.id);
    return { ok: true, expenseId: expense.id };
  } catch (e) {
    return toFormError(e);
  }
}

export async function deleteExpenseAction(
  _prevState: ExpenseActionState,
  formData: FormData
): Promise<ExpenseActionState> {
  const { tenantId } = await requireTenant("expense:write");

  const parsed = deleteExpenseInputSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error, EXPENSE_FIELD_LABELS_TH) };
  }

  try {
    const expense = await deleteExpenseLogic(tenantId, parsed.data);
    revalidateExpenseViews(expense.id);
    return { ok: true, expenseId: expense.id };
  } catch (e) {
    return toFormError(e);
  }
}

// ------------------------------------------------------------
// The recurring template
// ------------------------------------------------------------

function recurringFromFormData(formData: FormData) {
  return {
    branchId: formData.get("branch_id"),
    supplierId: formData.get("supplier_id"),
    categoryId: formData.get("category_id"),
    description: formData.get("description"),
    defaultAmount: formData.get("default_amount"),
    isPriceVatInclusive: formData.get("is_price_vat_inclusive") === "on",
    vatRatePercent: formData.get("vat_rate_percent"),
    subjectToWht: formData.get("subject_to_wht") === "on",
    whtRatePercent: formData.get("wht_rate_percent"),
    dayOfMonth: formData.get("day_of_month"),
    startPeriod: formData.get("start_period"),
    endPeriod: formData.get("end_period"),
    isActive: formData.get("is_active") === "on",
  };
}

export async function createRecurringExpenseAction(
  _prevState: RecurringExpenseActionState,
  formData: FormData
): Promise<RecurringExpenseActionState> {
  const { tenantId, assertBranch} = await requireTenant("expense:write");

  const parsed = recurringExpenseInputSchema.safeParse(recurringFromFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: toFieldErrors(parsed.error, RECURRING_EXPENSE_FIELD_LABELS_TH),
    };
  }

  if (parsed.data.branchId) assertBranch(parsed.data.branchId);

  try {
    const template = await createRecurringExpenseLogic(tenantId, parsed.data);
    revalidateExpenseViews();
    return {
      ok: true,
      recurringId: template.id,
      template: toRecurringExpenseView(template),
    };
  } catch (e) {
    return toFormError(e);
  }
}

export async function updateRecurringExpenseAction(
  _prevState: RecurringExpenseActionState,
  formData: FormData
): Promise<RecurringExpenseActionState> {
  const { tenantId, assertBranch} = await requireTenant("expense:write");

  const parsed = updateRecurringExpenseInputSchema.safeParse({
    ...recurringFromFormData(formData),
    id: formData.get("id"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: toFieldErrors(parsed.error, RECURRING_EXPENSE_FIELD_LABELS_TH),
    };
  }

  if (parsed.data.branchId) assertBranch(parsed.data.branchId);

  try {
    const template = await updateRecurringExpenseLogic(tenantId, parsed.data);
    revalidateExpenseViews();
    return {
      ok: true,
      recurringId: template.id,
      template: toRecurringExpenseView(template),
    };
  } catch (e) {
    return toFormError(e);
  }
}

/** Retire a template. The bills it already produced keep pointing at it. */
export async function deleteRecurringExpenseAction(
  _prevState: RecurringExpenseActionState,
  formData: FormData
): Promise<RecurringExpenseActionState> {
  const { tenantId } = await requireTenant("expense:write");

  const parsed = deleteRecurringExpenseInputSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: toFieldErrors(parsed.error, RECURRING_EXPENSE_FIELD_LABELS_TH),
    };
  }

  try {
    const template = await deleteRecurringExpenseLogic(tenantId, parsed.data);
    revalidateExpenseViews();
    return { ok: true, recurringId: template.id };
  } catch (e) {
    return toFormError(e);
  }
}

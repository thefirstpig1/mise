"use server";

// ============================================================
// Mise — Goods Receipt Server Actions (Sprint 2 Part 13 L4)
// ============================================================
// Thin "use server" wrappers around src/server/goods-receipt.ts, following the
// Sprint 1 / Part 10 / Part 11 shape:
//   1. requireTenant() — auth + discover tenantId,
//   2. build a raw object from FormData (snake_case names),
//   3. safeParse with the L2 schema → Thai field errors on failure,
//   4. call the *Logic fn and map the user-facing typed errors → Thai;
//      anything else rethrows to the error boundary.
//
// Three things specific to this slice:
//
//   - **Lines arrive as parallel arrays** zipped by index (the Part 8.5 fanout).
//   - **`submit_key` travels in a hidden field** and becomes the document id, so
//     a double POST is one receipt (ADR 0013 Consequence 4). It is minted by the
//     form, not here: an action that generated its own key would mint a fresh one
//     per POST and defeat the entire point.
//   - **Confirm and void return the post-write balances**, so the UI can show
//     where stock landed — and warn when a void drove something negative — with
//     no second round trip (ADR 0011 Q9).
//
// Per the 7a–11 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  closePurchaseOrderShortInputSchema,
  goodsReceiptInputSchema,
  voidGoodsReceiptInputSchema,
} from "@/lib/validations/goods-receipt";
import {
  confirmGoodsReceiptLogic,
  createGoodsReceiptLogic,
  deleteGoodsReceiptDraftLogic,
  GoodsReceiptNotEditableError,
  GoodsReceiptNotFoundError,
  GoodsReceiptNumberConflictError,
  GoodsReceiptPoMismatchError,
  GoodsReceiptTransitionError,
  GrAllocationSumMismatchError,
  getReceivablePurchaseOrderLogic,
  OverReceiptNoteRequiredError,
  PurchaseOrderNotReceivableError,
  ReceivedUnitMismatchError,
  updateGoodsReceiptLogic,
  voidGoodsReceiptLogic,
  type GoodsReceiptPostResult,
} from "@/server/goods-receipt";
import {
  closePurchaseOrderShortLogic,
  PurchaseOrderNotFoundError,
  PurchaseOrderTransitionError,
} from "@/server/purchase-order";
import { CrossTenantReferenceError } from "@/server/product";
import {
  MovementSourceConflictError,
  QtyRoundsToZeroError,
} from "@/server/stock-movement";
import {
  toReceivablePurchaseOrderView,
  type ReceivablePurchaseOrderView,
} from "./_components/goods-receipt-view";
import { RECEIVABLE_PO_STATUSES } from "@/lib/validations/goods-receipt";

/**
 * Outcome of the receipt form, for React 19 useActionState.
 *
 * Success carries the id so the form can navigate to the saved receipt, and the
 * number because it is the first thing the user looks for after saving.
 */
export type GoodsReceiptActionState =
  | { ok: true; id: string; grNumber: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** Confirm / void additionally report where stock ended up (ADR 0011 Q9). */
export type GoodsReceiptPostActionState =
  | {
      ok: true;
      id: string;
      grNumber: string;
      balances: { productId: string; productName: string; balance: string }[];
      negative: boolean;
    }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

// --- Thai messages (the user-facing error paths) ---
const NOT_FOUND_MESSAGE = "ไม่พบใบรับสินค้านี้";
const NOT_EDITABLE_MESSAGE =
  "ใบรับสินค้านี้บันทึกเข้าคลังแล้ว จึงแก้ไขไม่ได้ — หากผิด ให้ยกเลิกใบรับแล้วออกใบใหม่";
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนั้น";
const ALLOCATION_MESSAGE = "ยอดปันส่วนตามแผนกไม่ตรงกับจำนวนที่รับ";
const NUMBER_CONFLICT_MESSAGE =
  "มีการออกเลขใบรับสินค้าพร้อมกัน กรุณากดบันทึกอีกครั้ง";
const MOVEMENT_CONFLICT_MESSAGE =
  "มีการบันทึกรายการนี้พร้อมกัน กรุณากดยืนยันอีกครั้ง";
const PO_NOT_FOUND_MESSAGE = "ไม่พบใบสั่งซื้อนี้";

/** Why a receipt and its order disagree — each field has a different fix. */
function poMismatchMessage(e: GoodsReceiptPoMismatchError): string {
  switch (e.field) {
    case "branchId":
      return "สาขาไม่ตรงกับใบสั่งซื้อ";
    case "supplierId":
      return "ผู้ขายไม่ตรงกับใบสั่งซื้อ";
    case "receivedUnitId":
      return "ต้องรับด้วยหน่วยเดียวกับที่สั่ง — ใบสั่งซื้อกำหนดอัตราแปลงหน่วยไว้แล้ว";
    case "productId":
      return "วัตถุดิบไม่ตรงกับรายการในใบสั่งซื้อ";
    default:
      return "รายการนี้ไม่ได้อยู่ในใบสั่งซื้อที่เลือก";
  }
}

function transitionMessage(e: GoodsReceiptTransitionError): string {
  if (e.to === "CONFIRMED") {
    return e.from.startsWith("DRAFT (empty)")
      ? "ต้องมีอย่างน้อย 1 รายการก่อนจึงจะยืนยันรับของได้"
      : "ใบรับสินค้านี้ยืนยันไปแล้ว";
  }
  if (e.to === "VOIDED") {
    return e.from === "VOIDED"
      ? "ใบรับสินค้านี้ถูกยกเลิกไปแล้ว"
      : "ยกเลิกได้เฉพาะใบที่ยืนยันรับของแล้วเท่านั้น — ฉบับร่างให้กดทิ้งแทน";
  }
  return "สถานะของใบรับสินค้าไม่รองรับการทำรายการนี้";
}

/**
 * Map a user-facing typed error → Thai field/form error; rethrow the rest.
 *
 * `MovementSourceMismatchError` is deliberately NOT mapped: it means a replayed
 * confirm carried different numbers, which cannot happen through this action (the
 * lines are read from the stored row, not the request) and therefore signals a
 * bug rather than a mistake the user can fix.
 */
function toFormError(
  e: unknown
): { ok: false; formError?: string; fieldErrors?: Record<string, string> } {
  if (e instanceof GoodsReceiptNotFoundError) {
    return { ok: false, formError: NOT_FOUND_MESSAGE };
  }
  if (e instanceof GoodsReceiptNotEditableError) {
    return { ok: false, formError: NOT_EDITABLE_MESSAGE };
  }
  if (e instanceof GoodsReceiptTransitionError) {
    return { ok: false, formError: transitionMessage(e) };
  }
  if (e instanceof PurchaseOrderNotReceivableError) {
    return {
      ok: false,
      fieldErrors: {
        purchaseOrderId:
          e.status === "CANCELLED"
            ? "ใบสั่งซื้อนี้ถูกยกเลิกแล้ว รับของไม่ได้"
            : "ใบสั่งซื้อนี้ยังไม่ได้ส่งให้ผู้ขาย จึงยังรับของไม่ได้",
      },
    };
  }
  if (e instanceof GoodsReceiptPoMismatchError) {
    const field =
      e.field === "branchId" || e.field === "supplierId" ? e.field : "lines";
    return { ok: false, fieldErrors: { [field]: poMismatchMessage(e) } };
  }
  if (e instanceof OverReceiptNoteRequiredError) {
    return {
      ok: false,
      fieldErrors: {
        lines: `รายการที่ ${e.lineNo} รับเกินที่ค้างอยู่ (${e.outstanding}) — กรุณาระบุหมายเหตุว่าทำไมถึงรับเกิน`,
      },
    };
  }
  if (e instanceof ReceivedUnitMismatchError) {
    return { ok: false, fieldErrors: { lines: UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof GrAllocationSumMismatchError) {
    return { ok: false, fieldErrors: { lines: ALLOCATION_MESSAGE } };
  }
  if (e instanceof QtyRoundsToZeroError) {
    return {
      ok: false,
      fieldErrors: {
        lines: `จำนวนที่รับน้อยเกินไป — ${e.inputQty.toString()} ${e.inputUnitName} ปัดเป็น 0 ในหน่วยนับสต๊อก${e.baseUnitName ? ` (${e.baseUnitName})` : ""}`,
      },
    };
  }
  if (e instanceof CrossTenantReferenceError) {
    const field =
      e.kind === "supplier"
        ? "supplierId"
        : e.kind === "branch"
          ? "branchId"
          : null;
    return field
      ? { ok: false, fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { ok: false, formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof GoodsReceiptNumberConflictError) {
    return { ok: false, formError: NUMBER_CONFLICT_MESSAGE };
  }
  if (e instanceof MovementSourceConflictError) {
    return { ok: false, formError: MOVEMENT_CONFLICT_MESSAGE };
  }
  if (e instanceof PurchaseOrderNotFoundError) {
    return { ok: false, formError: PO_NOT_FOUND_MESSAGE };
  }
  if (e instanceof PurchaseOrderTransitionError) {
    return {
      ok: false,
      formError: "ปิดรับได้เฉพาะใบสั่งซื้อที่รับของมาแล้วบางส่วนเท่านั้น",
    };
  }
  throw e; // unexpected → let the error boundary handle it
}

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/**
 * Zip the parallel line arrays back into objects.
 *
 * A row whose product is blank is dropped here rather than failing zod: an empty
 * trailing row is what a "+ เพิ่มรายการ" button leaves behind. A row the user
 * cleared to zero is NOT dropped — zod rejects it, because "I received none of
 * this" is said by removing the line, not by typing 0.
 */
function linesFromFormData(formData: FormData): Record<string, unknown>[] {
  const productIds = formData.getAll("line_product_id");
  const poItemIds = formData.getAll("line_po_item_id");
  const unitIds = formData.getAll("line_received_unit_id");
  const qtys = formData.getAll("line_qty");
  const prices = formData.getAll("line_unit_price");
  const notes = formData.getAll("line_notes");

  return productIds
    .map((productId, i) => ({
      productId,
      purchaseOrderItemId: poItemIds[i] ?? null,
      receivedUnitId: unitIds[i],
      qtyReceivedActual: qtys[i],
      unitPriceActual: prices[i],
      notes: notes[i] ?? null,
    }))
    .filter((l) => String(l.productId ?? "").trim() !== "");
}

/** Map the receipt form's snake_case FormData onto the schema's camelCase shape. */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  return {
    submitKey: formData.get("submit_key"),
    branchId: formData.get("branch_id"),
    supplierId: formData.get("supplier_id"),
    purchaseOrderId: formData.get("purchase_order_id"),
    invoiceNo: formData.get("invoice_no"),
    // Part 16: the RATE is posted, never the amount — the server derives that
    // from these lines, which keeps the per-line VAT uplift the cost engine
    // applies identical to the header figure (ADR 0016 Q2).
    vatRatePercent: formData.get("vat_rate_percent"),
    receivedAt: formData.get("received_at"),
    notes: formData.get("notes"),
    lines: linesFromFormData(formData),
  };
}

/**
 * Revalidate every surface a receipt is rendered on.
 *
 * `/stock` and `/products` because a confirm moves the ledger; the purchase-order
 * views because `qty_received` and the order's status change underneath them.
 */
function revalidateGoodsReceiptViews(id?: string, purchaseOrderId?: string | null): void {
  revalidatePath("/goods-receipts");
  if (id) revalidatePath(`/goods-receipts/${id}`);
  revalidatePath("/purchase-orders");
  if (purchaseOrderId) revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath("/stock");
  revalidatePath("/stock/history");
}

/** Shape a confirm/void result for the client, including the Q9 negative flag. */
function toPostState(r: GoodsReceiptPostResult): GoodsReceiptPostActionState {
  const balances = r.postBalances.map((b) => ({
    productId: b.productId,
    productName: b.productName,
    balance: b.balance.toString(),
  }));
  return {
    ok: true,
    id: r.receipt.id,
    grNumber: r.receipt.grNumber,
    balances,
    negative: r.postBalances.some((b) => b.balance.lessThan(0)),
  };
}

/** Raise a new DRAFT receipt. */
export async function createGoodsReceiptAction(
  _prevState: GoodsReceiptActionState,
  formData: FormData
): Promise<GoodsReceiptActionState> {
  const { tenantId, membership } = await requireTenant();

  const parsed = goodsReceiptInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const gr = await createGoodsReceiptLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateGoodsReceiptViews(gr.id, gr.purchaseOrderId);
    return { ok: true, id: gr.id, grNumber: gr.grNumber };
  } catch (e) {
    return toFormError(e);
  }
}

/** Save changes to a DRAFT. The id travels in a hidden field. */
export async function updateGoodsReceiptAction(
  _prevState: GoodsReceiptActionState,
  formData: FormData
): Promise<GoodsReceiptActionState> {
  const { tenantId } = await requireTenant();

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, formError: NOT_FOUND_MESSAGE };

  const parsed = goodsReceiptInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const gr = await updateGoodsReceiptLogic(tenantId, id, parsed.data);
    revalidateGoodsReceiptViews(gr.id, gr.purchaseOrderId);
    return { ok: true, id: gr.id, grNumber: gr.grNumber };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * DRAFT → CONFIRMED: the moment stock moves.
 *
 * Takes the id directly rather than FormData — there is no form behind it, just a
 * button with a confirm dialog, and what it does can only be undone by a void.
 */
export async function confirmGoodsReceiptAction(
  id: string
): Promise<GoodsReceiptPostActionState> {
  const { tenantId, membership } = await requireTenant();
  try {
    const result = await confirmGoodsReceiptLogic(tenantId, id, membership.userId);
    revalidateGoodsReceiptViews(result.receipt.id, result.receipt.purchaseOrderId);
    return toPostState(result);
  } catch (e) {
    return toFormError(e);
  }
}

/** CONFIRMED → VOIDED, with a required reason (Q6). */
export async function voidGoodsReceiptAction(
  _prevState: GoodsReceiptPostActionState,
  formData: FormData
): Promise<GoodsReceiptPostActionState> {
  const { tenantId, membership } = await requireTenant();

  const parsed = voidGoodsReceiptInputSchema.safeParse({
    id: formData.get("id"),
    voidReason: formData.get("void_reason"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const result = await voidGoodsReceiptLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateGoodsReceiptViews(result.receipt.id, result.receipt.purchaseOrderId);
    return toPostState(result);
  } catch (e) {
    return toFormError(e);
  }
}

/** Discard a DRAFT (soft-delete). Refuses anything that has posted. */
export async function deleteGoodsReceiptDraftAction(
  id: string
): Promise<GoodsReceiptActionState> {
  const { tenantId } = await requireTenant();
  try {
    const gr = await deleteGoodsReceiptDraftLogic(tenantId, id);
    revalidateGoodsReceiptViews(undefined, gr.purchaseOrderId);
    return { ok: true, id: gr.id, grNumber: gr.grNumber };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * Declare a short-delivered order finished (Q8). Lives here rather than in the
 * purchase-orders actions because it is only ever reachable from the receiving
 * flow — the button appears once a delivery has arrived and stopped.
 */
export async function closePurchaseOrderShortAction(
  _prevState: GoodsReceiptActionState,
  formData: FormData
): Promise<GoodsReceiptActionState> {
  const { tenantId, membership } = await requireTenant();

  const parsed = closePurchaseOrderShortInputSchema.safeParse({
    id: formData.get("id"),
    closedShortReason: formData.get("closed_short_reason"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const po = await closePurchaseOrderShortLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateGoodsReceiptViews(undefined, po.id);
    return { ok: true, id: po.id, grNumber: po.poNumber };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * The order a receipt is about to be written against, for the form's prefill.
 *
 * A DRAFT / CANCELLED order comes back with `receivable: false` rather than an
 * error: the user picked something from a list, and telling them why it cannot be
 * received is more useful than refusing to render.
 */
export async function getReceivablePurchaseOrderAction(
  purchaseOrderId: string
): Promise<
  | { ok: true; data: ReceivablePurchaseOrderView | null }
  | { ok: false; formError: string }
> {
  const { tenantId } = await requireTenant();
  if (!purchaseOrderId) {
    return { ok: false, formError: PO_NOT_FOUND_MESSAGE };
  }

  const po = await getReceivablePurchaseOrderLogic(tenantId, purchaseOrderId);
  if (!po) return { ok: true, data: null };

  return {
    ok: true,
    data: toReceivablePurchaseOrderView(
      po,
      RECEIVABLE_PO_STATUSES.includes(po.status as never)
    ),
  };
}

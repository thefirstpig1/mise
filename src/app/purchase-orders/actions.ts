"use server";

// ============================================================
// Mise — Purchase Order Server Actions (Sprint 2 Part 11 L4)
// ============================================================
// Thin "use server" wrappers around src/server/purchase-order.ts, following the
// Sprint 1 / Part 10 shape:
//   1. requireTenant() — auth + discover tenantId,
//   2. build a raw object from FormData (snake_case names),
//   3. safeParse with the L2 schema → Thai field errors on failure,
//   4. call the *Logic fn and map the user-facing typed errors → Thai;
//      anything else rethrows to the error boundary.
//
// Two things specific to this slice:
//
//   - **Lines arrive as parallel arrays** (`line_product_id[]`, `line_qty[]`, …)
//     zipped by index, the Part 8.5 RestoreDialog pattern. FormData has no nested
//     structure, and a JSON blob in a hidden field would put the one thing the
//     server must validate outside the progressive-enhancement path.
//   - **Allocations are NOT read from FormData.** No UI can produce a split yet
//     (ADR 0012 Q2 — there is no way to create a second department), so the write
//     layer derives the single "Main" row. The schema and *Logic already accept a
//     split, so the day the UI grows one, only the form changes.
//
// Per the 7a–8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3a/L3b) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  cancelPurchaseOrderInputSchema,
  purchaseOrderInputSchema,
} from "@/lib/validations/purchase-order";
import {
  AllocationSumMismatchError,
  cancelPurchaseOrderLogic,
  createPurchaseOrderLogic,
  deletePurchaseOrderDraftLogic,
  MappingProvenanceMismatchError,
  OrderUnitMismatchError,
  PurchaseOrderNotEditableError,
  PurchaseOrderNotFoundError,
  PurchaseOrderNumberConflictError,
  PurchaseOrderTransitionError,
  resolveSupplierPriceLogic,
  sendPurchaseOrderLogic,
  updatePurchaseOrderLogic,
} from "@/server/purchase-order";
import { CrossTenantReferenceError } from "@/server/product";
import {
  toResolvedPriceView,
  type ResolvedPriceView,
} from "./_components/purchase-order-view";

/**
 * Outcome of the order form, for React 19 useActionState.
 *
 * Success carries the id so the form can navigate to the saved order, and the
 * number because it is the first thing the user looks for after saving.
 */
export type PurchaseOrderActionState =
  | { ok: true; id: string; poNumber: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

// --- Thai messages (the user-facing error paths) ---
const NOT_FOUND_MESSAGE = "ไม่พบใบสั่งซื้อนี้";
const NOT_EDITABLE_MESSAGE =
  "ใบสั่งซื้อนี้ส่งออกไปแล้ว จึงแก้ไขไม่ได้ — หากต้องการเปลี่ยน ให้ยกเลิกแล้วออกใบใหม่";
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนั้น";
const PROVENANCE_MESSAGE = "ราคาอ้างอิงไม่ตรงกับวัตถุดิบและผู้ขายในรายการนี้";
const ALLOCATION_MESSAGE = "ยอดปันส่วนตามแผนกไม่ตรงกับจำนวนที่สั่ง";
const NUMBER_CONFLICT_MESSAGE =
  "มีการออกเลขใบสั่งซื้อพร้อมกัน กรุณากดบันทึกอีกครั้ง";

/** Thai for each illegal transition, so the message says what actually happened. */
function transitionMessage(e: PurchaseOrderTransitionError): string {
  if (e.to === "SENT") {
    return e.from.startsWith("DRAFT (empty)")
      ? "ต้องมีอย่างน้อย 1 รายการก่อนจึงจะส่งได้"
      : "ใบสั่งซื้อนี้ถูกส่งไปแล้ว";
  }
  if (e.to === "CANCELLED") {
    return e.from === "CANCELLED"
      ? "ใบสั่งซื้อนี้ถูกยกเลิกไปแล้ว"
      : "ยกเลิกไม่ได้ — มีการรับของเข้าคลังแล้ว";
  }
  return "สถานะของใบสั่งซื้อไม่รองรับการทำรายการนี้";
}

/**
 * Map a user-facing typed error → Thai field/form error; rethrow the rest.
 *
 * NoDepartmentError is deliberately NOT mapped: every tenant gets a "Main"
 * department inside the same transaction as the tenant row (H.1), so hitting it
 * means the tenant is broken — a Thai form message would bury that.
 */
function toFormError(e: unknown): PurchaseOrderActionState {
  if (e instanceof PurchaseOrderNotFoundError) {
    return { ok: false, formError: NOT_FOUND_MESSAGE };
  }
  if (e instanceof PurchaseOrderNotEditableError) {
    return { ok: false, formError: NOT_EDITABLE_MESSAGE };
  }
  if (e instanceof PurchaseOrderTransitionError) {
    return { ok: false, formError: transitionMessage(e) };
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
  if (e instanceof OrderUnitMismatchError) {
    return { ok: false, fieldErrors: { lines: UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof MappingProvenanceMismatchError) {
    return { ok: false, fieldErrors: { lines: PROVENANCE_MESSAGE } };
  }
  if (e instanceof AllocationSumMismatchError) {
    return { ok: false, fieldErrors: { lines: ALLOCATION_MESSAGE } };
  }
  if (e instanceof PurchaseOrderNumberConflictError) {
    return { ok: false, formError: NUMBER_CONFLICT_MESSAGE };
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
 * Every array is indexed by row, so a row that the user removed in the browser
 * simply is not submitted — there are no holes to compact. A row whose product is
 * blank is dropped here rather than failing zod: an empty trailing row is what a
 * "+ เพิ่มรายการ" button leaves behind, not something the user typed wrong.
 */
function linesFromFormData(formData: FormData): Record<string, unknown>[] {
  const productIds = formData.getAll("line_product_id");
  const unitIds = formData.getAll("line_order_unit_id");
  const qtys = formData.getAll("line_qty");
  const prices = formData.getAll("line_unit_price");
  const mappingIds = formData.getAll("line_mapping_id");
  const notes = formData.getAll("line_notes");

  return productIds
    .map((productId, i) => ({
      productId,
      orderUnitId: unitIds[i],
      qtyOrdered: qtys[i],
      unitPrice: prices[i],
      supplierProductMappingId: mappingIds[i] ?? null,
      notes: notes[i] ?? null,
    }))
    .filter((l) => String(l.productId ?? "").trim() !== "");
}

/** Map the order form's snake_case FormData onto the schema's camelCase shape. */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  return {
    branchId: formData.get("branch_id"),
    supplierId: formData.get("supplier_id"),
    expectedDeliveryDate: formData.get("expected_delivery_date"),
    vatRatePercent: formData.get("vat_rate_percent"),
    notes: formData.get("notes"),
    lines: linesFromFormData(formData),
  };
}

/**
 * Revalidate every surface an order is rendered on.
 *
 * `/stock` is included because the stock page shows what is on order for a
 * product (`getOpenOrderQtyForProductLogic`) — sending or cancelling an order
 * changes that number without touching the ledger.
 */
function revalidatePurchaseOrderViews(id?: string): void {
  revalidatePath("/purchase-orders");
  if (id) revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/stock");
}

/** Raise a new DRAFT order. */
export async function createPurchaseOrderAction(
  _prevState: PurchaseOrderActionState,
  formData: FormData
): Promise<PurchaseOrderActionState> {
  const { tenantId, membership, assertBranch} = await requireTenant("purchase:write");

  const parsed = purchaseOrderInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  assertBranch(parsed.data.branchId);

  try {
    const po = await createPurchaseOrderLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidatePurchaseOrderViews(po.id);
    return { ok: true, id: po.id, poNumber: po.poNumber };
  } catch (e) {
    return toFormError(e);
  }
}

/** Save changes to a DRAFT. The id travels in a hidden field, like the mapping form. */
export async function updatePurchaseOrderAction(
  _prevState: PurchaseOrderActionState,
  formData: FormData
): Promise<PurchaseOrderActionState> {
  const { tenantId, assertBranch} = await requireTenant("purchase:write");

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, formError: NOT_FOUND_MESSAGE };

  const parsed = purchaseOrderInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  assertBranch(parsed.data.branchId);

  try {
    const po = await updatePurchaseOrderLogic(tenantId, id, parsed.data);
    revalidatePurchaseOrderViews(po.id);
    return { ok: true, id: po.id, poNumber: po.poNumber };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * DRAFT → SENT. Takes the id directly rather than FormData: there is no form
 * behind it, just a button with a confirm — and what it does is irreversible, so
 * the L5 view asks first.
 */
export async function sendPurchaseOrderAction(
  id: string
): Promise<PurchaseOrderActionState> {
  const { tenantId, membership } = await requireTenant("purchase:approve");
  try {
    const po = await sendPurchaseOrderLogic(tenantId, id, membership.userId);
    revalidatePurchaseOrderViews(po.id);
    return { ok: true, id: po.id, poNumber: po.poNumber };
  } catch (e) {
    return toFormError(e);
  }
}

/** Cancel a DRAFT or SENT order, with an optional reason. */
export async function cancelPurchaseOrderAction(
  _prevState: PurchaseOrderActionState,
  formData: FormData
): Promise<PurchaseOrderActionState> {
  const { tenantId, membership } = await requireTenant("purchase:approve");

  const parsed = cancelPurchaseOrderInputSchema.safeParse({
    id: formData.get("id"),
    cancelReason: formData.get("cancel_reason"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const po = await cancelPurchaseOrderLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidatePurchaseOrderViews(po.id);
    return { ok: true, id: po.id, poNumber: po.poNumber };
  } catch (e) {
    return toFormError(e);
  }
}

/** Discard a DRAFT (soft-delete). Refuses anything that was ever sent. */
export async function deletePurchaseOrderDraftAction(
  id: string
): Promise<PurchaseOrderActionState> {
  const { tenantId } = await requireTenant("purchase:write");
  try {
    const po = await deletePurchaseOrderDraftLogic(tenantId, id);
    revalidatePurchaseOrderViews();
    return { ok: true, id: po.id, poNumber: po.poNumber };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * Today's price for a (product, supplier, branch) — the form's autofill.
 *
 * Returns `{ ok: true, data: null }` when nothing is current: that is not an
 * error, it is the hand-typed-price path (Q5), and the form has to tell those
 * two cases apart to decide whether to show "ไม่มีราคาในระบบ".
 */
export async function resolveSupplierPriceAction(query: {
  productId: string;
  supplierId: string;
  branchId: string;
}): Promise<{ ok: true; data: ResolvedPriceView | null } | { ok: false; formError: string }> {
  const { tenantId } = await requireTenant("purchase:write");

  const { productId, supplierId, branchId } = query;
  if (!productId || !supplierId || !branchId) {
    return { ok: false, formError: "ข้อมูลไม่ครบสำหรับค้นหาราคา" };
  }

  const resolved = await resolveSupplierPriceLogic(
    tenantId,
    productId,
    supplierId,
    branchId
  );
  return { ok: true, data: resolved ? toResolvedPriceView(resolved) : null };
}

"use server";

// ============================================================
// Mise — transfer Server Actions (Sprint 3 Part 18 L4, ADR 0018)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here.
//
// Three things specific to this slice:
//
//   * **`submit_key` is READ from the form, never minted here** (the rule
//     goods-receipts/, stock/ and waste/ already follow). A server-minted key is
//     a fresh key on every retry, which is the double-POST this closes — and here
//     the duplicate would move real goods at TWO branches at once, with the two
//     errors equal and opposite so neither looks wrong on its own.
//   * **Revalidation covers BOTH branches, and always `/stock`** — this is the
//     first document whose write changes a page the writer is not looking at.
//     Someone at อารีย์ has a รอรับ box that must appear without them reloading
//     anything by hand (Q8).
//   * **`/cost` is NOT revalidated for a dispatch** and deliberately so: a
//     transfer is a move, not spend (ADR 0016 Consequence 2), and neither loss
//     column changes. A RECEIVE with a shortfall does move ส่วนต่าง/ปรับปรุง, so
//     that one revalidates it.
//
// Per the 7a-8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3b) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  dispatchTransferInputSchema,
  receiveTransferInputSchema,
  voidTransferInputSchema,
} from "@/lib/validations/transfer";
import {
  TransferAlreadyReceivedError,
  TransferAlreadyVoidedError,
  TransferLineMismatchError,
  TransferNotFoundError,
  TransferNotReceivableError,
  TransferNumberConflictError,
  TransferQtyExceedsSentError,
  TransferSameBranchError,
  dispatchTransferLogic,
  receiveTransferLogic,
  voidTransferLogic,
} from "@/server/transfer";
import {
  MovementSourceConflictError,
  QtyRoundsToZeroError,
  StockUnitMismatchError,
} from "@/server/stock-movement";
import { CrossTenantReferenceError } from "@/server/product";

// --- Thai messages (the user-facing error paths) ---
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";
const CONFLICT_MESSAGE = "ระบบกำลังบันทึกรายการนี้อยู่ กรุณาลองอีกครั้ง";
const NUMBER_CONFLICT_MESSAGE = "มีการออกเลขที่ใบโอนพร้อมกัน กรุณาลองอีกครั้ง";
const NOT_FOUND_MESSAGE = "ไม่พบใบโอนนี้";
const SAME_BRANCH_MESSAGE = "สาขาปลายทางต้องไม่ใช่สาขาเดียวกับต้นทาง";
const ALREADY_VOIDED_MESSAGE = "ใบโอนนี้ถูกยกเลิกไปแล้ว";
/**
 * Receiving twice. Says what to do instead, because the honest alternative is
 * not obvious: a posted document is corrected by voiding it, never overwritten
 * (ADR 0011 Q7).
 */
const ALREADY_RECEIVED_MESSAGE =
  "ใบโอนนี้ถูกกดรับไปแล้ว หากจำนวนที่บันทึกไว้ผิด ให้ยกเลิกใบนี้แล้วออกใบใหม่";
const NOT_RECEIVABLE_MESSAGE = "ใบโอนนี้ถูกยกเลิกแล้ว จึงกดรับไม่ได้";
const LINE_MISMATCH_MESSAGE =
  "รายการที่ส่งมาไม่ตรงกับใบโอนนี้ กรุณาโหลดหน้าใหม่แล้วกรอกอีกครั้ง";

export type DispatchTransferActionState =
  | { ok: true; transferId: string; tfNumber: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type TransferActionState =
  | { ok: true; transferId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

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
 * Map a user-facing typed error → Thai field/form error; rethrow the rest.
 *
 * Deliberately NOT mapped: `MovementSignMismatchError`,
 * `MovementSourceNotFoundError` and `MovementSourceMismatchError`. This module
 * writes its own sources and applies its own signs, so any of them firing means
 * the two legs disagree about where the goods are — and a polite Thai form
 * message would bury that where nobody looks.
 */
function toFormError(e: unknown): {
  formError?: string;
  fieldErrors?: Record<string, string>;
} {
  if (e instanceof CrossTenantReferenceError) {
    const field =
      e.kind === "product" ? "productId" : e.kind === "branch" ? "fromBranchId" : null;
    return field
      ? { fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof StockUnitMismatchError) {
    return { fieldErrors: { inputUnitId: UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof QtyRoundsToZeroError) {
    // Named units make the fix obvious: raise the quantity or pick a bigger unit.
    return {
      fieldErrors: {
        qtySent: `จำนวนน้อยเกินไป — ${e.inputQty.toString()} ${e.inputUnitName} ปัดเป็น 0${e.baseUnitName ? ` ${e.baseUnitName}` : ""}`,
      },
    };
  }
  if (e instanceof TransferSameBranchError) {
    return { fieldErrors: { toBranchId: SAME_BRANCH_MESSAGE } };
  }
  if (e instanceof TransferQtyExceedsSentError) {
    // Both numbers, because "too many" without the comparison is unactionable —
    // the receiver has to know what the document claims was put on the truck.
    return {
      fieldErrors: {
        qtyReceived: `รับได้ไม่เกินจำนวนที่ส่ง — ส่งมา ${e.qtySent.toString()} แต่กรอก ${e.qtyReceived.toString()}`,
      },
    };
  }
  if (e instanceof MovementSourceConflictError) {
    return { formError: CONFLICT_MESSAGE };
  }
  if (e instanceof TransferNumberConflictError) {
    return { formError: NUMBER_CONFLICT_MESSAGE };
  }
  if (e instanceof TransferNotFoundError) {
    return { formError: NOT_FOUND_MESSAGE };
  }
  if (e instanceof TransferAlreadyVoidedError) {
    return { formError: ALREADY_VOIDED_MESSAGE };
  }
  if (e instanceof TransferAlreadyReceivedError) {
    return { formError: ALREADY_RECEIVED_MESSAGE };
  }
  if (e instanceof TransferNotReceivableError) {
    return { formError: NOT_RECEIVABLE_MESSAGE };
  }
  if (e instanceof TransferLineMismatchError) {
    return { formError: LINE_MISMATCH_MESSAGE };
  }
  throw e; // unexpected → let the error boundary handle it
}

/**
 * Every surface a transfer changes — at BOTH ends.
 *
 * No earlier Part had to do this: a receipt, a count and a waste entry all change
 * pages belonging to the person who wrote them. A transfer changes the stock, the
 * par alerts and the incoming list of a branch whose staff did nothing, and the
 * รอรับ box (Q8) is worth nothing if it only appears after a manual reload.
 */
function revalidateTransferViews(productIds: string[]): void {
  revalidatePath("/transfers");
  revalidatePath("/stock");
  revalidatePath("/dashboard");
  revalidatePath("/stock-counts");
  for (const id of new Set(productIds)) revalidatePath(`/products/${id}`);
}

/** Send stock to another branch. Posts both ledger legs in one transaction. */
export async function dispatchTransferAction(
  _prevState: DispatchTransferActionState,
  formData: FormData
): Promise<DispatchTransferActionState> {
  const { tenantId, membership } = await requireTenant();

  // Lines arrive as parallel arrays — the shape a no-JS form posts, which is the
  // same reason goods-receipts/ reads them this way.
  const productIds = formData.getAll("line_product_id").map(String);
  const qtys = formData.getAll("line_qty_sent").map(String);
  const unitIds = formData.getAll("line_unit_id").map(String);
  const lineNotes = formData.getAll("line_notes").map(String);

  const parsed = dispatchTransferInputSchema.safeParse({
    submitKey: formData.get("submit_key"),
    fromBranchId: formData.get("from_branch_id"),
    toBranchId: formData.get("to_branch_id"),
    dispatchedAt: formData.get("dispatched_at"),
    dispatchedByName: formData.get("dispatched_by_name"),
    driverName: formData.get("driver_name"),
    driverConfirmed: formData.get("driver_confirmed"),
    notes: formData.get("notes"),
    lines: productIds.map((productId, i) => ({
      productId,
      qtySent: qtys[i],
      inputUnitId: unitIds[i],
      notes: lineNotes[i] ?? null,
    })),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const transfer = await dispatchTransferLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateTransferViews(parsed.data.lines.map((l) => l.productId));
    return { ok: true, transferId: transfer.id, tfNumber: transfer.tfNumber };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Confirm a delivery and post whatever never arrived.
 *
 * This is the one transfer action that DOES revalidate `/cost`: a shortfall is a
 * real loss and moves ส่วนต่าง/ปรับปรุง (ADR 0018 Consequence 2). A dispatch does
 * not, because a move is not spend.
 */
export async function receiveTransferAction(
  _prevState: TransferActionState,
  formData: FormData
): Promise<TransferActionState> {
  const { tenantId, membership } = await requireTenant();

  const itemIds = formData.getAll("line_item_id").map(String);
  const qtys = formData.getAll("line_qty_received").map(String);

  const parsed = receiveTransferInputSchema.safeParse({
    id: formData.get("id"),
    receivedByName: formData.get("received_by_name"),
    notes: formData.get("notes"),
    lines: itemIds.map((itemId, i) => ({ itemId, qtyReceived: qtys[i] })),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const transfer = await receiveTransferLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateTransferViews(transfer.items.map((i) => i.productId));
    revalidatePath("/cost");
    return { ok: true, transferId: transfer.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Void a transfer: append reversal lines and reverse both ends.
 *
 * **Not a transfer back.** If the goods really travelled back, the answer is a
 * new transfer in the opposite direction — the UI says so where someone would
 * otherwise reach for this button.
 */
export async function voidTransferAction(
  _prevState: TransferActionState,
  formData: FormData
): Promise<TransferActionState> {
  const { tenantId, membership } = await requireTenant();

  const parsed = voidTransferInputSchema.safeParse({
    id: formData.get("id"),
    voidReason: formData.get("void_reason"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const transfer = await voidTransferLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateTransferViews(transfer.items.map((i) => i.productId));
    // A void can undo a shortfall that was already counted as a loss, so the
    // executive view moves here even though the dispatch never touched it.
    revalidatePath("/cost");
    return { ok: true, transferId: transfer.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

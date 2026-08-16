"use server";

// ============================================================
// Mise — Stock ledger Server Actions (Sprint 2 Part 10 L4)
// ============================================================
// Thin "use server" wrappers around src/server/stock-movement.ts, following the
// Sprint 1 shape (products/, suppliers/, supplier-product-mappings/ actions):
//   1. requireTenant() — auth + discover tenantId,
//   2. build a raw object from FormData (snake_case names),
//   3. safeParse with the L2 schema → Thai field errors on failure,
//   4. call the *Logic fn and map the user-facing typed errors → Thai;
//      anything else rethrows to the error boundary (an unexpected error is a
//      bug, and swallowing it into a form message hides it).
//
// Two things are specific to this slice:
//
//   - `createdBy` comes from `membership.userId`, NOT `session.user.id`. Same
//     person, but the membership row is a real FK-valid app_user id by
//     construction — and stock_movement.created_by is the ledger's only audit
//     trail (Q7: no updatedAt, no deletedAt, nothing else to trace a row by).
//   - A negative post-balance is returned, never rejected (Q9). The action's
//     job is to report it; the L5 form owns the red warning + explicit confirm.
//
// Decimals are serialized to strings before returning (Pitfall #20) — see
// _components/stock-view.ts. Per the 7a–8.5 convention this glue layer has NO
// unit tests: coverage = zod (L2) + logic (L3a/L3b) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  createStockAdjustmentInputSchema,
  getStockBalanceQuerySchema,
  getStockMovementHistoryQuerySchema,
} from "@/lib/validations/stock-movement";
import {
  createStockAdjustmentLogic,
  getStockBalanceLogic,
  getStockMovementHistoryLogic,
  MovementSourceConflictError,
  QtyRoundsToZeroError,
  StockUnitMismatchError,
} from "@/server/stock-movement";
// CrossTenantReferenceError lives in product.ts — the single owner since Part 8
// L3b. Reused here rather than redeclared.
import { CrossTenantReferenceError } from "@/server/product";
import {
  toStockBalanceView,
  toStockMovementView,
  type StockBalanceView,
  type StockMovementView,
} from "./_components/stock-view";

/**
 * Outcome of the adjust form, for React 19 useActionState.
 *
 * Success carries the post-write balance so the form can show "ยอดคงเหลือใหม่"
 * without a second round trip — and `negative` so it can show the Q9 warning
 * state. The write already happened: `negative: true` is information, not a
 * rejection.
 */
export type StockAdjustmentActionState =
  | { ok: true; movementId: string; postBalance: string; negative: boolean }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

// --- Thai messages (the user-facing error paths) ---
/** A product/branch FK that isn't a live row of this tenant. */
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
/** inputUnitId points at a unit of some other product. */
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";
/** Concurrent writer won the (source_type, source_id) race — see ADR 0011 Q4. */
const CONFLICT_MESSAGE = "ระบบกำลังบันทึกรายการนี้อยู่ กรุณาลองอีกครั้ง";
/** A read action whose query didn't validate (never user-typed — a caller bug). */
const BAD_QUERY_MESSAGE = "เงื่อนไขการค้นหาไม่ถูกต้อง";

/**
 * Map the adjust form's snake_case FormData onto the schema's camelCase shape.
 *
 * `submit_key` is READ from the form and never minted here (the same rule
 * `goods-receipts/actions.ts` follows): a server-minted key is a fresh key on
 * every retry, which is precisely the double-POST bug this closes.
 */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  return {
    submitKey: formData.get("submit_key"),
    productId: formData.get("product_id"),
    branchId: formData.get("branch_id"),
    type: formData.get("type"),
    reason: formData.get("reason"),
    inputQty: formData.get("input_qty"),
    inputUnitId: formData.get("input_unit_id"),
    occurredAt: formData.get("occurred_at"),
    notes: formData.get("notes"),
  };
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
 * Map a user-facing typed error → Thai field/form error; rethrow the rest.
 *
 * Deliberately NOT mapped: MovementSignMismatchError, MovementSourceNotFoundError
 * and UnsupportedSourceTypeError. All three are unreachable from this action —
 * the adjustment writes its own source and derives the sign from `type` — so if
 * one ever fires it is a bug, and a Thai form message would bury it.
 */
function toFormError(e: unknown): StockAdjustmentActionState {
  if (e instanceof CrossTenantReferenceError) {
    const field =
      e.kind === "product" ? "productId" : e.kind === "branch" ? "branchId" : null;
    return field
      ? { ok: false, fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { ok: false, formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof StockUnitMismatchError) {
    return { ok: false, fieldErrors: { inputUnitId: UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof QtyRoundsToZeroError) {
    // Named units make the fix obvious ("0.001 mg → 0 kg"): the user has to
    // either raise the qty or pick a bigger unit, and the message says which.
    return {
      ok: false,
      fieldErrors: {
        inputQty: `จำนวนน้อยเกินไป — ${e.inputQty.toString()} ${e.inputUnitName} ปัดเป็น 0${e.baseUnitName ? ` ${e.baseUnitName}` : ""}`,
      },
    };
  }
  if (e instanceof MovementSourceConflictError) {
    return { ok: false, formError: CONFLICT_MESSAGE };
  }
  throw e; // unexpected → let the error boundary handle it
}

/**
 * Revalidate every surface a balance is rendered on.
 *
 * `/products/[id]` exists today (the Sprint 1 detail page, which L5 extends with
 * a stock section). `/stock` is created by L5b — revalidating a path with no
 * page yet is a no-op, and wiring it now means the write path is complete the
 * moment that page lands. `/reports` (Sprint 3) is deliberately NOT listed:
 * there is nothing to invalidate and a stale entry would outlive the reason
 * anyone added it.
 */
function revalidateStockViews(productId: string): void {
  revalidatePath("/stock");
  revalidatePath(`/products/${productId}`);
}

/** Record a manual stock adjustment (the only Part 10 producer of ledger rows). */
export async function createStockAdjustmentAction(
  _prevState: StockAdjustmentActionState,
  formData: FormData
): Promise<StockAdjustmentActionState> {
  const { tenantId, membership } = await requireTenant();

  const parsed = createStockAdjustmentInputSchema.safeParse(
    rawFromFormData(formData)
  );
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const { movement, postBalance } = await createStockAdjustmentLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateStockViews(parsed.data.productId);
    return {
      ok: true,
      movementId: movement.id,
      postBalance: postBalance.toString(),
      negative: postBalance.lessThan(0),
    };
  } catch (e) {
    return toFormError(e);
  }
}

/** Read result shared by the two read actions — a failure here is a caller bug. */
export type StockReadState<T> =
  | { ok: true; data: T }
  | { ok: false; formError: string };

/**
 * Current (or as-of) balance for one (product, branch).
 *
 * Called from the L5 adjust form to preview the post-write balance, so it takes
 * a plain object rather than FormData — there is no <form> behind it. The query
 * is still schema-parsed: it arrives from the client and reaches the DB.
 */
export async function getStockBalanceAction(
  query: unknown
): Promise<StockReadState<StockBalanceView>> {
  const { tenantId } = await requireTenant();

  const parsed = getStockBalanceQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, formError: BAD_QUERY_MESSAGE };

  const balance = await getStockBalanceLogic(tenantId, parsed.data);
  return { ok: true, data: toStockBalanceView(balance) };
}

/**
 * A page of ledger history, newest first. `nextCursor` is fed straight back as
 * `cursor` for the following page (null = last page).
 */
export async function getStockMovementHistoryAction(
  query: unknown
): Promise<
  StockReadState<{ rows: StockMovementView[]; nextCursor: string | null }>
> {
  const { tenantId } = await requireTenant();

  const parsed = getStockMovementHistoryQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, formError: BAD_QUERY_MESSAGE };

  const page = await getStockMovementHistoryLogic(tenantId, parsed.data);
  return {
    ok: true,
    data: {
      rows: page.rows.map(toStockMovementView),
      nextCursor: page.nextCursor,
    },
  };
}

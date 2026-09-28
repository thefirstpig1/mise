"use server";

// ============================================================
// Mise — stock count Server Actions (Sprint 3 Part 15 L4, ADR 0015 · ADR 0034)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here.
//
// Two things worth stating twice:
//
//  * **`qty_expected` is never read from the client.** It is the ledger's
//    answer, snapshotted server-side when a count is saved (ADR 0015 Q3).
//  * **Counting does not revalidate the sheet** (ADR 0034 Q7). Revalidating
//    re-rendered the whole page on every ยืนยัน — every product, and a FIFO
//    replay per counted line — measured at 1.2–2.2 s per press and growing with
//    the sheet. The row actions return the fresh sheet and the screen applies
//    it; other devices pick it up on their next poll. Only closing and voiding,
//    which move stock, revalidate the pages that show stock.
// ============================================================

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { hasCapability } from "@/lib/permissions/service";
import {
  closeStockCountInputSchema,
  editStockCountContributionInputSchema,
  openStockCountInputSchema,
  saveStockCountLineInputSchema,
  voidStockCountInputSchema,
  STOCK_COUNT_FIELD_LABELS_TH,
} from "@/lib/validations/stock-count";
import {
  closeStockCountLogic,
  CountLineTakenError,
  CountUnitMismatchError,
  deleteStockCountContributionLogic,
  deleteStockCountDraftLogic,
  deleteStockCountLineLogic,
  editStockCountContributionLogic,
  getStockCountByIdLogic,
  NotCountHostError,
  NotYourContributionError,
  openStockCountLogic,
  saveStockCountLineLogic,
  StockCountAlreadyOpenError,
  StockCountNotEditableError,
  StockCountNotFoundError,
  StockCountTransitionError,
  voidStockCountLogic,
  type CountActor,
} from "@/server/stock-count";
import { CrossTenantReferenceError } from "@/server/product";
import {
  toStockCountDetailView,
  type StockCountDetailView,
} from "./_components/stock-count-view";

// --- Thai messages (the user-facing error paths) ---
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const NOT_FOUND_MESSAGE = "ไม่พบใบนับสต๊อกนี้";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";
const NOT_EDITABLE_MESSAGE = "ใบนับนี้ปิดไปแล้ว แก้ไขไม่ได้";
const CLOSE_AGAIN_MESSAGE = "ใบนับนี้ปิดไปแล้ว";
const VOID_NOT_CLOSED_MESSAGE = "ยกเลิกได้เฉพาะใบที่ปิดแล้วเท่านั้น";
const NOT_HOST_MESSAGE =
  "เฉพาะผู้เปิดใบนับ เจ้าของร้าน ผู้จัดการ หรือหัวหน้าแผนกเท่านั้นที่ทำรายการนี้ได้";
const NOT_YOURS_MESSAGE = "แก้ไขได้เฉพาะจำนวนที่คุณนับเอง";
const TAKEN_MESSAGE =
  "มีคนนับรายการนี้ไปก่อนแล้ว — ถ้าคุณเจอของชิ้นนี้อีกที่ ให้กด “นับเพิ่มจากอีกที่”";

export type StockCountActionState =
  | { ok: true; countId: string; detail?: StockCountDetailView }
  | {
      ok: false;
      formError?: string;
      fieldErrors?: Record<string, string>;
      /**
       * Set when someone else counted the product first (ADR 0034 Q3). Carries
       * the fresh sheet so the row can turn green and name who beat them to it.
       */
      takenProductId?: string;
      detail?: StockCountDetailView;
    };

function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] =
      issue.message || `${STOCK_COUNT_FIELD_LABELS_TH[key] ?? key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/** Map a typed error → Thai; rethrow the rest. */
function toFormError(e: unknown): StockCountActionState {
  if (e instanceof StockCountNotFoundError) {
    return { ok: false, formError: NOT_FOUND_MESSAGE };
  }
  if (e instanceof StockCountNotEditableError) {
    return { ok: false, formError: NOT_EDITABLE_MESSAGE };
  }
  if (e instanceof StockCountTransitionError) {
    return {
      ok: false,
      formError: e.to === "VOIDED" ? VOID_NOT_CLOSED_MESSAGE : CLOSE_AGAIN_MESSAGE,
    };
  }
  if (e instanceof NotCountHostError) return { ok: false, formError: NOT_HOST_MESSAGE };
  if (e instanceof NotYourContributionError) return { ok: false, formError: NOT_YOURS_MESSAGE };
  if (e instanceof CountUnitMismatchError) {
    return { ok: false, fieldErrors: { entries: UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof CrossTenantReferenceError) {
    const field = e.kind === "branch" ? "branchId" : e.kind === "product" ? "productId" : null;
    return field
      ? { ok: false, fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { ok: false, formError: CROSS_TENANT_MESSAGE };
  }
  throw e; // unexpected → the error boundary
}

/** What closing or voiding moves: stock, its value, the branch summary. */
function revalidateStockViews(countId: string): void {
  revalidatePath("/stock-counts");
  revalidatePath(`/stock-counts/${countId}`);
  revalidatePath("/stock");
  revalidatePath("/cost");
}

/** Who is acting, and whether they may act for the host (ADR 0034 Q5). */
async function countActor(): Promise<{ tenantId: string; actor: CountActor }> {
  const { tenantId, membership, role } = await requireTenant("count:write");
  return {
    tenantId,
    actor: { userId: membership.userId, canCloseAny: hasCapability(role, "count:close") },
  };
}

// ------------------------------------------------------------
// Opening
// ------------------------------------------------------------

export async function openStockCountAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId, membership, assertBranch } = await requireTenant("count:write");

  const parsed = openStockCountInputSchema.safeParse({
    branchId: formData.get("branch_id"),
    countDate: formData.get("count_date"),
    // An unchecked checkbox posts nothing at all, so absence means "blind".
    showExpected: formData.get("show_expected") === "on",
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  assertBranch(parsed.data.branchId);

  let countId: string;
  try {
    const count = await openStockCountLogic(tenantId, parsed.data, membership.userId);
    countId = count.id;
  } catch (e) {
    // Kong (ADR 0034 Q5): a branch already counting is joined, not refused.
    if (e instanceof StockCountAlreadyOpenError) redirect(`/stock-counts/${e.existingId}`);
    return toFormError(e);
  }
  revalidatePath("/stock-counts");
  redirect(`/stock-counts/${countId}`);
}

// ------------------------------------------------------------
// Counting — called directly by each row, not through a <form>
// ------------------------------------------------------------

type EntryInput = { productUnitId: string; qtyInUnit: string | number };

/** ยืนยัน on a row: a first count (`new`) or more found elsewhere (`add`). */
export async function confirmCountAction(input: {
  stockCountId: string;
  productId: string;
  mode: "new" | "add";
  entries: EntryInput[];
  notes: string | null;
}): Promise<StockCountActionState> {
  const { tenantId, actor } = await countActor();
  const parsed = saveStockCountLineInputSchema.safeParse({
    ...input,
    // A box the person left blank is not a count of zero — drop it.
    entries: input.entries.filter((e) => String(e.qtyInUnit).trim() !== ""),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const count = await saveStockCountLineLogic(tenantId, parsed.data, actor.userId);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    if (e instanceof CountLineTakenError) {
      const fresh = await getStockCountByIdLogic(tenantId, input.stockCountId);
      return {
        ok: false,
        formError: TAKEN_MESSAGE,
        takenProductId: e.productId,
        detail: fresh ? toStockCountDetailView(fresh) : undefined,
      };
    }
    return toFormError(e);
  }
}

/** แก้ของฉัน — correct your own contribution. */
export async function editContributionAction(input: {
  stockCountId: string;
  contributionId: string;
  entries: EntryInput[];
  notes: string | null;
}): Promise<StockCountActionState> {
  const { tenantId, actor } = await countActor();
  const parsed = editStockCountContributionInputSchema.safeParse({
    ...input,
    entries: input.entries.filter((e) => String(e.qtyInUnit).trim() !== ""),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const count = await editStockCountContributionLogic(tenantId, parsed.data, actor.userId);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

/** Take back your own contribution. */
export async function deleteContributionAction(
  stockCountId: string,
  contributionId: string
): Promise<StockCountActionState> {
  const { tenantId, actor } = await countActor();
  try {
    const count = await deleteStockCountContributionLogic(
      tenantId,
      stockCountId,
      contributionId,
      actor.userId
    );
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

/** Remove a whole line, everyone's count with it — host or count:close only. */
export async function removeStockCountLineAction(
  stockCountId: string,
  itemId: string
): Promise<StockCountActionState> {
  const { tenantId, actor } = await countActor();
  try {
    const count = await deleteStockCountLineLogic(tenantId, stockCountId, itemId, actor);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * The poll every open device makes (ADR 0034 Q7). One read of the sheet with
 * its lines and contributions — no cost engine, no product list.
 */
export async function getCountSheetAction(
  stockCountId: string
): Promise<StockCountDetailView | null> {
  const { tenantId } = await requireTenant("count:write");
  const count = await getStockCountByIdLogic(tenantId, stockCountId);
  return count ? toStockCountDetailView(count) : null;
}

// ------------------------------------------------------------
// Closing, voiding, discarding
// ------------------------------------------------------------

export async function closeStockCountAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId, actor } = await countActor();

  const parsed = closeStockCountInputSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const count = await closeStockCountLogic(tenantId, parsed.data, actor);
    revalidateStockViews(count.id);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

export async function voidStockCountAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId, actor } = await countActor();

  const parsed = voidStockCountInputSchema.safeParse({
    id: formData.get("id"),
    voidReason: formData.get("void_reason"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const count = await voidStockCountLogic(tenantId, parsed.data, actor);
    revalidateStockViews(count.id);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

/** Discard a sheet nobody finished. A CLOSED count is voided, never hidden. */
export async function discardStockCountAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId, actor } = await countActor();
  const id = String(formData.get("id") ?? "");

  try {
    const count = await deleteStockCountDraftLogic(tenantId, id, actor);
    revalidatePath("/stock-counts");
    return { ok: true, countId: count.id };
  } catch (e) {
    return toFormError(e);
  }
}

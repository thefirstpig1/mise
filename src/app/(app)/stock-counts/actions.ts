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
import { z, type ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
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
  declareOpeningPricesLogic,
  getOpeningPricesLogic,
  OpeningPriceTargetError,
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
import { CostUnitMismatchError } from "@/server/cost-declaration";
import { declareStockCostInputSchema } from "@/lib/validations/stock-cost";
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
  const { tenantId, membership, can, reach } = await requireTenant("count:write");
  return {
    tenantId,
    actor: { userId: membership.userId, canCloseAny: can("count:close"), reach },
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
    const count = await saveStockCountLineLogic(tenantId, parsed.data, actor);
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
    const count = await editStockCountContributionLogic(tenantId, parsed.data, actor);
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
      actor
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

// ------------------------------------------------------------
// Closing, voiding, discarding
// ------------------------------------------------------------

export async function closeStockCountAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId, actor } = await countActor();
  const { can } = await requireTenant("count:write");

  // Rule PG4: prices typed on an opening count's close sheet. Only someone who
  // may see cost was shown that sheet (rule A1); for anyone else the server
  // fills in what it knows, exactly as the sheet would have.
  let prices: unknown = undefined;
  if (can("cost:view")) {
    try {
      const raw = formData.get("prices");
      prices = typeof raw === "string" && raw ? JSON.parse(raw) : undefined;
    } catch {
      return { ok: false, formError: "ราคาที่ใส่อ่านไม่ได้ — ลองกดปิดใบอีกครั้ง" };
    }
  } else {
    const id = String(formData.get("id") ?? "");
    const filled = /^[0-9a-f-]{36}$/i.test(id) ? await getOpeningPricesLogic(tenantId, id) : null;
    prices = filled?.filter((l) => l.unitId && l.unitCost !== null).map((l) => ({ productId: l.productId, unitId: l.unitId, unitCost: l.unitCost }));
  }

  const parsed = closeStockCountInputSchema.safeParse({ id: formData.get("id"), prices });
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

/**
 * Rule PG6 (Kong 2026-10-30): the prices the shop confirmed for opening stock
 * that was closed without one — usually the first receipt's, perhaps changed.
 * Declaring a cost is the /cost page's own gate (cost:view); the count's branch
 * must be in reach (rule A5).
 */
const openingPricesSchema = z.object({
  countId: z.string().uuid(),
  lines: z.array(declareStockCostInputSchema).min(1).max(500),
});

export async function declareOpeningPricesAction(input: unknown): Promise<{ ok: true; declared: number } | { ok: false; error: string }> {
  const { tenantId, membership, assertBranch } = await requireTenant("cost:view");
  const parsed = openingPricesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ราคาไม่ถูกต้อง" };
  const count = await getStockCountByIdLogic(tenantId, parsed.data.countId);
  if (!count) return { ok: false, error: "ไม่พบใบนับนี้" };
  assertBranch(count.branchId);
  try {
    const declared = await declareOpeningPricesLogic(
      tenantId,
      { countId: parsed.data.countId, lines: parsed.data.lines.map((l) => ({ movementId: l.movementId, unitId: l.unitId, unitCost: l.unitCost, note: l.note ?? "" })) },
      membership.userId
    );
    // Cost is derived on every read: a price changes every page that shows one.
    revalidatePath(`/stock-counts/${parsed.data.countId}`);
    revalidatePath("/cost");
    revalidatePath("/stock");
    revalidatePath("/dashboard");
    return { ok: true, declared };
  } catch (e) {
    if (e instanceof OpeningPriceTargetError) return { ok: false, error: "รายการนี้ไม่ใช่ยอดยกมาของใบนับนี้ — กรุณารีเฟรชหน้า" };
    if (e instanceof CostUnitMismatchError) return { ok: false, error: "หน่วยไม่ใช่หน่วยของสินค้านี้ — กรุณารีเฟรชหน้า" };
    console.error("[stock-counts] declare opening prices failed", e);
    return { ok: false, error: "บันทึกราคาไม่สำเร็จ ยังไม่มีอะไรเปลี่ยน — กรุณาลองใหม่" };
  }
}

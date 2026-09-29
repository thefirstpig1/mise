"use server";

// ============================================================
// Mise — purchase request Server Actions (Part 38 L4, ADR 0036)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error. No rule is decided
// here. Two gates, per ADR 0036 Q6:
//   purchase:request — add, edit/withdraw (the logic narrows to author/head),
//                      ready, talk, ask again, ask for a shortfall
//   purchase:approve — cut a round, "ไม่สั่ง"
// Reach is checked on the BRANCH every time (rule A5): from the input when it
// names one, from the line when it does not.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  addRequestLineInputSchema,
  cutRoundInputSchema,
  lineIdSchema,
  messageInputSchema,
  readyInputSchema,
  rejectInputSchema,
  reopenInputSchema,
  updateRequestLineInputSchema,
} from "@/lib/validations/purchase-request";
import {
  addRequestLineLogic,
  CutLineNotReadyError,
  cutRoundLogic,
  deleteRequestLineLogic,
  getRequestLineBranchLogic,
  getRequestMessagesLogic,
  KitchenNoteUnansweredError,
  postRequestMessageLogic,
  rejectRequestLineLogic,
  reopenRequestLineLogic,
  RequestLineNotEditableError,
  RequestLineNotFoundError,
  requestShortfallLogic,
  RequestUnitMismatchError,
  setDepartmentReadyLogic,
  updateRequestLineLogic,
  type DuplicateLine,
  type RequestViewer,
} from "@/server/purchase-request";
import { CrossTenantReferenceError } from "@/server/product";
import { RequestLineMismatchError } from "@/server/purchase-order";

export type RequestActionState = { ok: true } | { ok: false; formError: string; fieldErrors?: Record<string, string> };
export type AddLineActionState =
  | { ok: true; lineId: string }
  | { ok: false; formError: string; fieldErrors?: Record<string, string>; duplicates?: DuplicateLine[] };

const PATHS = ["/purchase-requests", "/purchase-requests/cut", "/purchase-orders", "/dashboard"] as const;
const refresh = () => PATHS.forEach((p) => revalidatePath(p));

function toFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const k = i.path.length ? String(i.path[0]) : "form";
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}

/** Typed refusals → Thai; anything else is a bug and rethrows. */
function thai(e: unknown): string {
  if (e instanceof RequestLineNotFoundError) return "ไม่พบรายการนี้ — อาจถูกลบไปแล้ว กรุณารีเฟรชหน้า";
  if (e instanceof RequestLineNotEditableError) {
    return e.reason === "not_waiting"
      ? "รายการนี้จัดซื้อรับไปดำเนินการแล้ว แก้ไม่ได้ — ถ้าต้องเปลี่ยน พิมพ์บอกจัดซื้อในช่องคุยของรายการนี้"
      : "รายการนี้เป็นของคนอื่น แก้ได้เฉพาะคนที่เพิ่ม หัวหน้าแผนก หรือฝ่ายจัดซื้อ";
  }
  if (e instanceof RequestUnitMismatchError) return "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";
  if (e instanceof KitchenNoteUnansweredError) return "รายการนี้มีหมายเหตุจากครัว — ตอบหมายเหตุก่อนเปลี่ยนผู้ขาย";
  if (e instanceof CutLineNotReadyError) {
    return e.reason === "no_supplier"
      ? "ยังมีรายการที่ไม่ได้เลือกผู้ขาย"
      : "มีรายการที่เปลี่ยนสถานะไปแล้ว (อาจมีคนตัดรอบไปก่อน) — กรุณารีเฟรชหน้าแล้วลองใหม่";
  }
  if (e instanceof CrossTenantReferenceError || e instanceof RequestLineMismatchError) return "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
  throw e;
}

const asViewer = (t: Awaited<ReturnType<typeof requireTenant>>): RequestViewer => ({
  userId: t.user.id!,
  role: t.role,
  canApprove: t.can("purchase:approve"),
  costAccess: t.costAccess,
});

// Each gate names its capability as a literal (test G3, ADR 0029): a reader
// sees what an action needs at the call, not through a variable.
async function viewer(need: "purchase:request" | "purchase:approve") {
  const t = need === "purchase:approve" ? await requireTenant("purchase:approve") : await requireTenant("purchase:request");
  return { t, v: asViewer(t) };
}

async function assertLineReach(t: Awaited<ReturnType<typeof requireTenant>>, lineId: string) {
  t.assertBranch(await getRequestLineBranchLogic(t.tenantId, lineId));
}

// ------------------------------------------------------------
// The kitchen
// ------------------------------------------------------------

export async function addRequestLineAction(raw: unknown): Promise<AddLineActionState> {
  const { t, v } = await viewer("purchase:request");
  const parsed = addRequestLineInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: "กรุณาตรวจข้อมูลอีกครั้ง", fieldErrors: toFieldErrors(parsed.error) };
  const i = parsed.data;
  t.assertBranch(i.branchId);
  try {
    const r = await addRequestLineLogic(
      t.tenantId,
      v,
      {
        branchId: i.branchId,
        productId: i.productId,
        qty: i.qty,
        unitId: i.unitId,
        departmentId: i.departmentId ?? null,
        supplierId: i.supplierId === "auto" ? undefined : i.supplierId,
        onHandQty: i.onHandQty,
        note: i.note,
      },
      { acknowledgeDuplicate: i.acknowledgeDuplicate }
    );
    if (!r.ok) return { ok: false, formError: "มีรายการนี้อยู่แล้ว", duplicates: r.duplicates };
    refresh();
    return { ok: true, lineId: r.lineId };
  } catch (e) {
    return { ok: false, formError: thai(e) };
  }
}

export async function updateRequestLineAction(raw: unknown): Promise<RequestActionState> {
  const { t, v } = await viewer("purchase:request");
  const parsed = updateRequestLineInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: "กรุณาตรวจข้อมูลอีกครั้ง", fieldErrors: toFieldErrors(parsed.error) };
  const { lineId, ...rest } = parsed.data;
  try {
    await assertLineReach(t, lineId);
    await updateRequestLineLogic(t.tenantId, v, lineId, rest);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: thai(e) };
  }
}

export async function deleteRequestLineAction(raw: unknown): Promise<RequestActionState> {
  const { t, v } = await viewer("purchase:request");
  const parsed = lineIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: "รายการไม่ถูกต้อง" };
  try {
    await assertLineReach(t, parsed.data.lineId);
    await deleteRequestLineLogic(t.tenantId, v, parsed.data.lineId);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: thai(e) };
  }
}

export async function setDepartmentReadyAction(
  raw: unknown
): Promise<{ ok: true; allReady: boolean } | { ok: false; formError: string }> {
  const { t, v } = await viewer("purchase:request");
  const parsed = readyInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง" };
  t.assertBranch(parsed.data.branchId);
  try {
    const r = await setDepartmentReadyLogic(t.tenantId, v, parsed.data);
    refresh();
    return { ok: true, allReady: r.allReady };
  } catch (e) {
    return { ok: false, formError: thai(e) };
  }
}

export async function postRequestMessageAction(raw: unknown): Promise<RequestActionState> {
  const { t, v } = await viewer("purchase:request");
  const parsed = messageInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: toFieldErrors(parsed.error).body ?? "ข้อความไม่ถูกต้อง" };
  try {
    await assertLineReach(t, parsed.data.lineId);
    await postRequestMessageLogic(t.tenantId, v, parsed.data.lineId, parsed.data.body);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: thai(e) };
  }
}

export type MessagesActionState =
  | { ok: true; messages: { id: string; body: string; at: string; author: { id: string; name: string } | null }[] }
  | { ok: false; formError: string };

export async function getRequestMessagesAction(raw: unknown): Promise<MessagesActionState> {
  const { t } = await viewer("purchase:request");
  const parsed = lineIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: "รายการไม่ถูกต้อง" };
  try {
    await assertLineReach(t, parsed.data.lineId);
    return { ok: true, messages: await getRequestMessagesLogic(t.tenantId, parsed.data.lineId) };
  } catch (e) {
    return { ok: false, formError: thai(e) };
  }
}

export async function reopenRequestLineAction(raw: unknown): Promise<RequestActionState> {
  const { t, v } = await viewer("purchase:request");
  const parsed = reopenInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง" };
  try {
    await assertLineReach(t, parsed.data.lineId);
    await reopenRequestLineLogic(t.tenantId, v, parsed.data.lineId, parsed.data.why);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: thai(e) };
  }
}

export async function requestShortfallAction(raw: unknown): Promise<RequestActionState> {
  const { t, v } = await viewer("purchase:request");
  const parsed = lineIdSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: "รายการไม่ถูกต้อง" };
  try {
    await assertLineReach(t, parsed.data.lineId);
    await requestShortfallLogic(t.tenantId, v, parsed.data.lineId);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: thai(e) };
  }
}

// ------------------------------------------------------------
// The purchaser
// ------------------------------------------------------------

export async function rejectRequestLineAction(raw: unknown): Promise<RequestActionState> {
  const { t, v } = await viewer("purchase:approve");
  const parsed = rejectInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: toFieldErrors(parsed.error).reason ?? "ข้อมูลไม่ถูกต้อง" };
  try {
    await assertLineReach(t, parsed.data.lineId);
    await rejectRequestLineLogic(t.tenantId, v, parsed.data.lineId, parsed.data.reason);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: thai(e) };
  }
}

export type CutActionState =
  | { ok: true; orders: { id: string; poNumber: string; supplierName: string; lines: number }[] }
  | { ok: false; formError: string; lineId?: string };

export async function cutRoundAction(raw: unknown): Promise<CutActionState> {
  const { t, v } = await viewer("purchase:approve");
  const parsed = cutRoundInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, formError: Object.values(toFieldErrors(parsed.error))[0] ?? "ข้อมูลไม่ถูกต้อง" };
  t.assertBranch(parsed.data.branchId);
  try {
    const r = await cutRoundLogic(t.tenantId, v, {
      branchId: parsed.data.branchId,
      picks: parsed.data.picks.map((p) => ({ ...p, mappingId: null })),
    });
    refresh();
    return { ok: true, orders: r.orders };
  } catch (e) {
    const lineId = e instanceof KitchenNoteUnansweredError || e instanceof CutLineNotReadyError ? e.lineId : undefined;
    return { ok: false, formError: thai(e), lineId };
  }
}

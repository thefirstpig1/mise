"use server";

// ปิดร้านประจำวัน — Server Actions (ADR 0042). Thin glue: requireTenant →
// zod → *Logic → Thai message. Filling the sheet needs sales:import (the same
// person who keys the till total, Q7); commenting and "จัดการแล้ว" need only
// reach to the branch.

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import { CrossTenantReferenceError } from "@/server/product";
import { SalesPulseLockedError } from "@/server/sales-pulse";
import {
  CustomerTypeLimitError,
  DailyCloseDisabledError,
  DailyCloseFutureDateError,
  DailyCloseLockedError,
  DailyCloseNotFoundError,
  PulseRequiredError,
  addCustomerTypeLogic,
  addDailyCommentLogic,
  branchOfCloseLogic,
  removeCustomerTypeLogic,
  resolveDailyIssueLogic,
  saveDailyCloseLogic,
  setDailyCloseEnabledLogic,
} from "@/server/daily-close";
import { addDailyCommentInputSchema, customerTypeNameSchema, saveDailyCloseInputSchema, MAX_CUSTOMER_TYPES } from "@/lib/validations/daily-close";

export type ClosingActionState = { ok: true } | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

function revalidateClosing(): void {
  revalidatePath("/closing");
  revalidatePath("/closing/day");
  revalidatePath("/dashboard");
  revalidatePath("/sales");
}

function toMessage(e: unknown): string {
  if (e instanceof PulseRequiredError) return "กรอกยอดรวมจาก POS ก่อนบันทึกปิดร้าน";
  if (e instanceof DailyCloseLockedError) return "เลยเวลาแก้แล้ว — ใบปิดร้านแก้ได้ถึงเที่ยงคืนของวันถัดไป · เขียนความเห็นต่อท้ายได้";
  if (e instanceof DailyCloseFutureDateError) return "ยังปิดร้านของวันที่ยังไม่ถึงไม่ได้";
  if (e instanceof DailyCloseDisabledError) return "ร้านยังไม่ได้เปิดใช้รายงานปิดร้าน — เปิดได้ที่ตั้งค่าร้าน";
  if (e instanceof SalesPulseLockedError) return "ไฟล์ยอดขายของวันนี้เข้ามาแล้ว ยอดในไฟล์เป็นหลักฐาน — ยอดรวมจาก POS จึงแก้ไม่ได้";
  if (e instanceof DailyCloseNotFoundError || e instanceof CrossTenantReferenceError) return "ไม่พบข้อมูลนี้ — ลองรีเฟรชหน้า";
  if (e instanceof CustomerTypeLimitError) return `ตั้งประเภทลูกค้าได้ไม่เกิน ${MAX_CUSTOMER_TYPES} ประเภท`;
  console.error("[closing] unexpected", e);
  return "บันทึกไม่สำเร็จ — ลองอีกครั้ง";
}

export async function saveDailyCloseAction(raw: unknown): Promise<ClosingActionState> {
  const { tenantId, user, assertBranch } = await requireTenant("sales:import");
  const parsed = saveDailyCloseInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0] ?? "form");
      if (!(k in fieldErrors)) fieldErrors[k] = i.message;
    }
    return { ok: false, fieldErrors };
  }
  assertBranch(parsed.data.branchId);
  try {
    await saveDailyCloseLogic(tenantId, user.id, parsed.data);
    revalidateClosing();
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: toMessage(e) };
  }
}

export async function addDailyCommentAction(dailyCloseId: string, body: string): Promise<ClosingActionState> {
  const { tenantId, user, assertBranch } = await requireTenant("any:member");
  const parsed = addDailyCommentInputSchema.safeParse({ dailyCloseId, body });
  if (!parsed.success) return { ok: false, formError: parsed.error.issues[0]?.message ?? "ความเห็นไม่ถูกต้อง" };
  try {
    const branchId = await branchOfCloseLogic(tenantId, { closeId: parsed.data.dailyCloseId });
    if (!branchId) throw new DailyCloseNotFoundError(parsed.data.dailyCloseId);
    assertBranch(branchId);
    await addDailyCommentLogic(tenantId, user.id, parsed.data);
    revalidateClosing();
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: toMessage(e) };
  }
}

export async function resolveDailyIssueAction(issueId: string): Promise<ClosingActionState> {
  const { tenantId, user, assertBranch } = await requireTenant("any:member");
  try {
    const branchId = await branchOfCloseLogic(tenantId, { issueId });
    if (!branchId) throw new DailyCloseNotFoundError(issueId);
    assertBranch(branchId);
    await resolveDailyIssueLogic(tenantId, user.id, issueId);
    revalidateClosing();
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: toMessage(e) };
  }
}

// ---- shop settings (settings:write) ----

export async function setDailyCloseEnabledAction(enabled: boolean): Promise<ClosingActionState> {
  const { tenantId } = await requireTenant("settings:write");
  try {
    await setDailyCloseEnabledLogic(tenantId, enabled);
    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: toMessage(e) };
  }
}

export async function addCustomerTypeAction(name: string): Promise<ClosingActionState> {
  const { tenantId } = await requireTenant("settings:write");
  const parsed = customerTypeNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, formError: parsed.error.issues[0]?.message };
  try {
    await addCustomerTypeLogic(tenantId, parsed.data);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: toMessage(e) };
  }
}

export async function removeCustomerTypeAction(id: string): Promise<ClosingActionState> {
  const { tenantId } = await requireTenant("settings:write");
  try {
    await removeCustomerTypeLogic(tenantId, id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, formError: toMessage(e) };
  }
}

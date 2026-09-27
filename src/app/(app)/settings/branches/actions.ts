"use server";

// ============================================================
// Mise — branch Server Actions (Part 35 L1)
// ============================================================
// Thin glue, like settings/members/actions.ts: requireTenant → zod → *Logic →
// a Thai sentence. `settings:write` because adding a branch changes what every
// consolidated figure covers — it belongs to whoever runs the business.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  BRANCH_FIELD_LABELS_TH,
  branchInputSchema,
  updateBranchInputSchema,
} from "@/lib/validations/branch";
import {
  BranchCodeTakenError,
  BranchNotFoundError,
  createBranchLogic,
  updateBranchLogic,
} from "@/server/branch";

export type SettingsActionState =
  | { ok: true; message: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

function toFieldErrors(error: ZodError, labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.errors) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message || `${labels[key] ?? key}ไม่ถูกต้อง`;
  }
  return out;
}

function refused(e: unknown): SettingsActionState {
  if (e instanceof BranchCodeTakenError) {
    return { ok: false, fieldErrors: { code: `รหัส ${e.code} มีสาขาอื่นใช้อยู่แล้ว` } };
  }
  if (e instanceof BranchNotFoundError) {
    return { ok: false, formError: "ไม่พบสาขานี้ อาจถูกลบไปแล้ว กรุณารีเฟรชหน้า" };
  }
  console.error("[branch] unexpected failure", e);
  return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
}

function refresh() {
  revalidatePath("/settings/branches");
  revalidatePath("/dashboard");
}

export async function createBranchAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const { tenantId } = await requireTenant("settings:write");
  const parsed = branchInputSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    address: formData.get("address"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error, BRANCH_FIELD_LABELS_TH) };
  try {
    const b = await createBranchLogic(tenantId, parsed.data);
    refresh();
    return { ok: true, message: `เพิ่ม ${b.name} แล้ว` };
  } catch (e) {
    return refused(e);
  }
}

export async function updateBranchAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const { tenantId } = await requireTenant("settings:write");
  const parsed = updateBranchInputSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    address: formData.get("address"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error, BRANCH_FIELD_LABELS_TH) };
  try {
    await updateBranchLogic(tenantId, parsed.data);
    refresh();
    return { ok: true, message: "บันทึกแล้ว" };
  } catch (e) {
    return refused(e);
  }
}

"use server";

// ============================================================
// Mise — department Server Actions (Part 35 L1)
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  DEPARTMENT_FIELD_LABELS_TH,
  departmentInputSchema,
  setDepartmentActiveInputSchema,
  updateDepartmentInputSchema,
} from "@/lib/validations/department";
import {
  DefaultDepartmentLockedError,
  DepartmentCodeTakenError,
  DepartmentNotFoundError,
  createDepartmentLogic,
  setDepartmentActiveLogic,
  updateDepartmentLogic,
} from "@/server/department";
import type { SettingsActionState } from "@/app/settings/branches/actions";

function toFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.errors) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message || `${DEPARTMENT_FIELD_LABELS_TH[key] ?? key}ไม่ถูกต้อง`;
  }
  return out;
}

function refused(e: unknown): SettingsActionState {
  if (e instanceof DepartmentCodeTakenError) {
    return { ok: false, fieldErrors: { code: `รหัส ${e.code} มีแผนกอื่นใช้อยู่แล้ว` } };
  }
  if (e instanceof DefaultDepartmentLockedError) {
    return {
      ok: false,
      formError:
        "ปิดแผนกนี้ไม่ได้ เพราะเป็นแผนกตั้งต้นที่ระบบใช้ลงรายการที่ไม่ได้ระบุแผนก — เปลี่ยนชื่อได้ แต่ปิดไม่ได้",
    };
  }
  if (e instanceof DepartmentNotFoundError) {
    return { ok: false, formError: "ไม่พบแผนกนี้ อาจถูกลบไปแล้ว กรุณารีเฟรชหน้า" };
  }
  console.error("[department] unexpected failure", e);
  return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
}

function refresh() {
  revalidatePath("/settings/departments");
  revalidatePath("/menus");
  revalidatePath("/cost/departments");
}

export async function createDepartmentAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const { tenantId } = await requireTenant("settings:write");
  const parsed = departmentInputSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  try {
    const d = await createDepartmentLogic(tenantId, parsed.data);
    refresh();
    return { ok: true, message: `เพิ่มแผนก ${d.name} แล้ว` };
  } catch (e) {
    return refused(e);
  }
}

export async function updateDepartmentAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const { tenantId } = await requireTenant("settings:write");
  const parsed = updateDepartmentInputSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  try {
    await updateDepartmentLogic(tenantId, parsed.data);
    refresh();
    return { ok: true, message: "บันทึกแล้ว" };
  } catch (e) {
    return refused(e);
  }
}

export async function setDepartmentActiveAction(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const { tenantId } = await requireTenant("settings:write");
  const parsed = setDepartmentActiveInputSchema.safeParse({
    id: formData.get("id"),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้า" };
  try {
    const d = await setDepartmentActiveLogic(tenantId, parsed.data);
    refresh();
    return { ok: true, message: d.isActive ? `เปิดใช้แผนก ${d.name} แล้ว` : `ปิดแผนก ${d.name} แล้ว` };
  } catch (e) {
    return refused(e);
  }
}

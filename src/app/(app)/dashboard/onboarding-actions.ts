"use server";

// เริ่มต้นใช้งาน (Kong 2026-10-28): hide or show the checklist for the person
// pressing — their own membership, never anybody else's.

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import { setOnboardingDismissedLogic } from "@/server/onboarding";

export async function setOnboardingDismissedAction(dismissed: boolean): Promise<{ ok: true } | { ok: false; formError: string }> {
  const { tenantId, membership } = await requireTenant("settings:write");
  try {
    await setOnboardingDismissedLogic(tenantId, membership.id, dismissed);
  } catch (e) {
    console.error("[onboarding] dismiss failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

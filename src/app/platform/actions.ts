"use server";

// ADR 0043 — the operator's writes. Each one checks the admin itself: a
// layout does not guard a server action, which is its own request.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { PlatformInputError, setShopPlanLogic } from "@/server/platform";

export type PlatformResult = { ok: true } | { ok: false; formError: string };

const planSchema = z.object({
  tenantId: z.string().uuid(),
  plan: z.enum(["trial", "standard"]),
  freeUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  note: z.string().max(300).nullable(),
});

export async function setShopPlanAction(input: unknown): Promise<PlatformResult> {
  const actor = await requirePlatformAdmin();
  const p = planSchema.safeParse(input);
  if (!p.success) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง" };
  try {
    await setShopPlanLogic(actor, p.data);
  } catch (e) {
    if (e instanceof PlatformInputError) return { ok: false, formError: e.message };
    console.error("[platform] set plan failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง" };
  }
  revalidatePath("/platform");
  revalidatePath("/platform/audit");
  return { ok: true };
}

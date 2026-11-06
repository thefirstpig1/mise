"use server";

// ADR 0045 Q12 — the person's own consent. Their own row only: the session's
// user id, never one from the browser. app_user carries no tenant, so this is
// the plain client, as Auth.js itself uses it.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/require-tenant";

export async function getMarketingConsentLogic(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { marketingOptInAt: true } });
  return u?.marketingOptInAt?.toISOString() ?? null;
}

export async function setMarketingConsentAction(input: unknown): Promise<{ ok: true } | { ok: false; formError: string }> {
  const { user } = await requireTenant("any:member");
  const p = z.object({ optIn: z.boolean() }).safeParse(input);
  if (!p.success || !user.id) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง" };
  try {
    await prisma.user.update({ where: { id: user.id }, data: { marketingOptInAt: p.data.optIn ? new Date() : null }, select: { id: true } });
  } catch (e) {
    console.error("[account] consent not saved", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  revalidatePath("/account");
  return { ok: true };
}

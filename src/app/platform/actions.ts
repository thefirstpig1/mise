"use server";

// ADR 0043 — the operator's writes. Each one checks the admin itself: a
// layout does not guard a server action, which is its own request.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { PlatformInputError, setShopPlanLogic, updatePlatformReportLogic } from "@/server/platform";
import { updateReportSchema } from "@/lib/problem-report";
import { notifyReportFixed } from "@/server/problem-report-notify";

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

export type ReportSaveResult = { ok: true; emailed: boolean } | { ok: false; formError: string };

/**
 * ADR 0044 — status, the answer to the reporter, the internal note. When the
 * status first becomes ขึ้นเว็บแล้ว the reporter gets a letter (Kong
 * 2026-11-03 "ได้เลยตามนั้น") — after the save, and a failed send never
 * fails the save.
 */
export async function updateReportAction(input: unknown): Promise<ReportSaveResult> {
  const actor = await requirePlatformAdmin();
  const p = updateReportSchema.safeParse(input);
  if (!p.success) return { ok: false, formError: p.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  let tell: Awaited<ReturnType<typeof updatePlatformReportLogic>>;
  try {
    tell = await updatePlatformReportLogic(actor, p.data);
  } catch (e) {
    console.error("[platform] report update failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง" };
  }
  if (!tell) return { ok: false, formError: "ไม่พบเรื่องนี้" };
  const emailed = tell.tellReporter ? (await notifyReportFixed(tell.tellReporter)) > 0 : false;
  revalidatePath("/platform/reports");
  revalidatePath("/platform/audit");
  return { ok: true, emailed };
}

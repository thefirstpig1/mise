"use server";

// ADR 0043 — the operator's writes. Each one checks the admin itself: a
// layout does not guard a server action, which is its own request.

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  PlatformInputError,
  changeUserEmailLogic,
  closeShopLogic,
  createAnnouncementLogic,
  markDataRequestDoneLogic,
  purgeShopLogic,
  recordDataRequestLogic,
  reopenShopLogic,
  setShopPlanLogic,
  stopAnnouncementLogic,
  updatePlatformReportLogic,
} from "@/server/platform";
import { announceSchema, changeEmailSchema, recordRequestSchema, shopConfirmSchema } from "@/lib/platform-requests";
import { notifyEmailChanged } from "@/server/platform-notify";
import { ANNOUNCEMENT_TAG } from "@/server/announcements";
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
  revalidatePath("/platform/shops");
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
  revalidatePath("/platform"); // ต้องทำ counts the reports nobody has opened
  return { ok: true, emailed };
}

// ============================================================
// ADR 0045 part B — every action checks the admin itself, refuses in Thai, and
// logs in English. The writes and their audit rows are in src/server/platform.ts.
// ============================================================

async function run(label: string, work: () => Promise<void>, paths: string[]): Promise<PlatformResult> {
  try {
    await work();
  } catch (e) {
    if (e instanceof PlatformInputError) return { ok: false, formError: e.message };
    console.error(`[platform] ${label} failed`, e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง" };
  }
  for (const p of [...paths, "/platform", "/platform/audit"]) revalidatePath(p);
  return { ok: true };
}

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";

export async function recordRequestAction(input: unknown): Promise<PlatformResult> {
  const actor = await requirePlatformAdmin();
  const p = recordRequestSchema.safeParse(input);
  if (!p.success) return { ok: false, formError: firstIssue(p.error) };
  return run("record request", () => recordDataRequestLogic(actor, p.data), ["/platform/requests"]);
}

export async function markRequestDoneAction(input: unknown): Promise<PlatformResult> {
  const actor = await requirePlatformAdmin();
  const p = z.object({ id: z.string().uuid(), done: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง" };
  return run("mark request", () => markDataRequestDoneLogic(actor, p.data.id, p.data.done), ["/platform/requests"]);
}

export async function closeShopAction(input: unknown): Promise<PlatformResult> {
  const actor = await requirePlatformAdmin();
  const p = shopConfirmSchema.safeParse(input);
  if (!p.success) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง" };
  return run("close shop", async () => void (await closeShopLogic(actor, p.data)), ["/platform/shops", "/platform/requests"]);
}

export async function reopenShopAction(input: unknown): Promise<PlatformResult> {
  const actor = await requirePlatformAdmin();
  const p = z.object({ tenantId: z.string().uuid() }).safeParse(input);
  if (!p.success) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง" };
  return run("reopen shop", () => reopenShopLogic(actor, p.data.tenantId), ["/platform/shops", "/platform/requests"]);
}

export type PurgeActionResult = { ok: true; message: string } | { ok: false; formError: string };

export async function purgeShopAction(input: unknown): Promise<PurgeActionResult> {
  const actor = await requirePlatformAdmin();
  const p = shopConfirmSchema.safeParse(input);
  if (!p.success) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง" };
  let message = "";
  const r = await run(
    "purge shop",
    async () => {
      const done = await purgeShopLogic(actor, p.data);
      message = `ลบข้อมูลร้าน ${done.name} แล้ว · ไฟล์ ${done.files} ไฟล์ · บัญชีที่ไม่อยู่ร้านไหนแล้ว ${done.usersRemoved} บัญชี`;
    },
    ["/platform/shops", "/platform/requests"]
  );
  return r.ok ? { ok: true, message } : r;
}

export type EmailActionResult = { ok: true; emailed: number } | { ok: false; formError: string };

export async function changeUserEmailAction(input: unknown): Promise<EmailActionResult> {
  const actor = await requirePlatformAdmin();
  const p = changeEmailSchema.safeParse(input);
  if (!p.success) return { ok: false, formError: firstIssue(p.error) };
  let change: Awaited<ReturnType<typeof changeUserEmailLogic>> | null = null;
  const r = await run("change email", async () => void (change = await changeUserEmailLogic(actor, p.data)), ["/platform/users", "/platform/shops"]);
  if (!r.ok || !change) return r.ok ? { ok: false, formError: "บันทึกไม่สำเร็จ" } : r;
  return { ok: true, emailed: await notifyEmailChanged(change) };
}

export async function createAnnouncementAction(input: unknown): Promise<PlatformResult> {
  const actor = await requirePlatformAdmin();
  const p = announceSchema.safeParse(input);
  if (!p.success) return { ok: false, formError: firstIssue(p.error) };
  const r = await run(
    "announce",
    () => createAnnouncementLogic(actor, { message: p.data.message, tone: p.data.tone, startsAt: new Date(p.data.startsAt), endsAt: new Date(p.data.endsAt) }),
    ["/platform/announcements"]
  );
  if (r.ok) revalidateTag(ANNOUNCEMENT_TAG);
  return r;
}

export async function stopAnnouncementAction(input: unknown): Promise<PlatformResult> {
  const actor = await requirePlatformAdmin();
  const p = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!p.success) return { ok: false, formError: "ข้อมูลไม่ถูกต้อง" };
  const r = await run("stop announcement", () => stopAnnouncementLogic(actor, p.data.id), ["/platform/announcements"]);
  if (r.ok) revalidateTag(ANNOUNCEMENT_TAG);
  return r;
}


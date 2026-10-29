"use server";

// ADR 0037 Q5–Q6 — the accountant's writes on staff claims. Never on your own
// claim (the logic refuses); always within branch reach.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { ClaimActionError, approveClaimLogic, endorseClaimLogic, refundClaimsLogic, voidRefundLogic } from "@/server/staff-advance";
import { FileNotAttachableError } from "@/server/stored-file";

export type BoardResult = { ok: true; message?: string } | { ok: false; formError: string };

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";

async function run(fn: () => Promise<string | void>): Promise<BoardResult> {
  try {
    const message = await fn();
    revalidatePath("/advances");
    revalidatePath("/my-advances");
    return { ok: true, message: message || undefined };
  } catch (e) {
    if (e instanceof ClaimActionError) return { ok: false, formError: e.message };
    if (e instanceof FileNotAttachableError) return { ok: false, formError: "สลิปแนบไม่ได้ กรุณาอัปโหลดใหม่" };
    console.error("[advances] action failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง" };
  }
}

export async function endorseClaimAction(input: unknown): Promise<BoardResult> {
  const { tenantId, user, reach } = await requireTenant("refund:pay");
  const p = z.object({ paymentId: z.string().uuid(), note: z.string().max(300).default("") }).safeParse(input);
  if (!p.success) return { ok: false, formError: firstIssue(p.error) };
  return run(() => endorseClaimLogic(tenantId, { userId: user.id!, reach }, p.data.paymentId, p.data.note));
}

/** Approval is the "commit the shop's money" permission (decision 3 of the plan). */
export async function approveClaimAction(input: unknown): Promise<BoardResult> {
  const { tenantId, user, reach } = await requireTenant("purchase:approve");
  const p = z.object({ paymentId: z.string().uuid() }).safeParse(input);
  if (!p.success) return { ok: false, formError: firstIssue(p.error) };
  return run(() => approveClaimLogic(tenantId, { userId: user.id!, reach }, p.data.paymentId));
}

const refundSchema = z
  .object({
    paymentIds: z.array(z.string().uuid()).min(1, "เลือกอย่างน้อย 1 บิล").max(200),
    method: z.enum(["TRANSFER", "CASH"]),
    refundedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ไม่ถูกต้อง"),
    note: z.string().trim().max(300).nullable().default(null),
    slipFileIds: z.array(z.string().uuid()).max(3).default([]),
  })
  .refine((v) => v.method !== "TRANSFER" || v.slipFileIds.length > 0, {
    message: "โอนคืนต้องแนบสลิป",
    path: ["slipFileIds"],
  });

export async function refundClaimsAction(input: unknown): Promise<BoardResult> {
  const { tenantId, user, reach } = await requireTenant("refund:pay");
  const p = refundSchema.safeParse(input);
  if (!p.success) return { ok: false, formError: firstIssue(p.error) };
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  // Today = now; an earlier day = noon Bangkok that day.
  const refundedAt = p.data.refundedOn === today ? new Date() : new Date(`${p.data.refundedOn}T05:00:00Z`);
  if (p.data.refundedOn > today) return { ok: false, formError: "วันที่คืนเงินต้องไม่เป็นอนาคต" };
  return run(async () => {
    const r = await refundClaimsLogic(tenantId, { userId: user.id!, reach }, { ...p.data, refundedAt });
    return `บันทึกการคืนเงิน ฿${r.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} แล้ว`;
  });
}

export async function voidRefundAction(input: unknown): Promise<BoardResult> {
  const { tenantId, user, reach } = await requireTenant("refund:pay");
  const p = z.object({ refundId: z.string().uuid(), reason: z.string().trim().min(1, "ต้องระบุเหตุผล").max(300) }).safeParse(input);
  if (!p.success) return { ok: false, formError: firstIssue(p.error) };
  return run(() => voidRefundLogic(tenantId, { userId: user.id!, reach }, p.data.refundId, p.data.reason));
}

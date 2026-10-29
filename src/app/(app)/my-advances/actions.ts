"use server";

// ADR 0037 Q5–Q6 — the staff member's writes: record what they bought, add a
// missing photo. Thin glue: requireTenant → zod → *Logic → Thai error.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { selfPurchaseInputSchema } from "@/lib/validations/staff-advance";
import { ClaimActionError, SelfPurchaseError, addClaimPhotosLogic, recordSelfPurchaseLogic } from "@/server/staff-advance";
import { FileNotAttachableError } from "@/server/stored-file";
import { CrossTenantReferenceError } from "@/server/product";
import { QtyRoundsToZeroError } from "@/server/stock-movement";
import { ReceivedUnitMismatchError } from "@/server/goods-receipt";

export type AdvanceResult = { ok: true } | { ok: false; formError: string };

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";

function advanceError(e: unknown): string | null {
  if (e instanceof SelfPurchaseError || e instanceof ClaimActionError) return e.message;
  if (e instanceof FileNotAttachableError) return "รูปบางรูปแนบไม่ได้ กรุณาถ่ายใหม่แล้วลองอีกครั้ง";
  if (e instanceof CrossTenantReferenceError) return "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
  if (e instanceof QtyRoundsToZeroError) return "จำนวนน้อยเกินไปจนปัดเป็น 0";
  if (e instanceof ReceivedUnitMismatchError) return "หน่วยที่เลือกไม่ใช่หน่วยของสินค้านี้";
  if (e instanceof z.ZodError) return firstIssue(e);
  return null;
}

function refresh() {
  revalidatePath("/my-advances");
  revalidatePath("/advances");
  revalidatePath("/expenses");
}

export async function recordSelfPurchaseAction(input: unknown): Promise<AdvanceResult> {
  const { tenantId, user, reach } = await requireTenant("purchase:self");
  const parsed = selfPurchaseInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: firstIssue(parsed.error) };
  try {
    await recordSelfPurchaseLogic(tenantId, { userId: user.id!, reach }, parsed.data);
  } catch (e) {
    const msg = advanceError(e);
    if (msg) return { ok: false, formError: msg };
    console.error("[advances] record failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง — กดซ้ำได้ ระบบไม่บันทึกซ้ำ" };
  }
  refresh();
  return { ok: true };
}

const addPhotosSchema = z.object({
  paymentId: z.string().uuid(),
  kind: z.enum(["BILL", "PAYMENT_SLIP"]),
  fileIds: z.array(z.string().uuid()).min(1).max(6),
});

/** The payer only — anyone else gets "ไม่พบรายการนี้". Any member: a person keeps their claims after a role change. */
export async function addClaimPhotosAction(input: unknown): Promise<AdvanceResult> {
  const { tenantId, user } = await requireTenant("any:member");
  const parsed = addPhotosSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: firstIssue(parsed.error) };
  try {
    await addClaimPhotosLogic(tenantId, user.id!, parsed.data);
  } catch (e) {
    const msg = advanceError(e);
    if (msg) return { ok: false, formError: msg };
    console.error("[advances] add photos failed", e);
    return { ok: false, formError: "แนบรูปไม่สำเร็จ กรุณาลองอีกครั้ง" };
  }
  refresh();
  return { ok: true };
}

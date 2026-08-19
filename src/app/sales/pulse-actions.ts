"use server";

// ============================================================
// Mise — daily pulse Server Actions (Sprint 4 Part 20a L4, ADR 0020)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here.
//
// The only thing worth saying about this file is the shape of one error message.
// When a pulse is locked, the reply is not "you cannot edit this" — that tells a
// cashier nothing they can act on. It shows both numbers and points at the file,
// because the honest reading of a locked pulse that disagrees with the detail is
// "one of these two is wrong, and it is probably not the till".
//
// Per the 7a-8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { recordSalesPulseInputSchema } from "@/lib/validations/sales-pulse";
import {
  BranchNotFoundError,
  SalesPulseLockedError,
  recordSalesPulseLogic,
} from "@/server/sales-pulse";

const BRANCH_NOT_FOUND_MESSAGE = "ไม่พบสาขานี้";

const baht = (v: { toNumber(): number } | null) =>
  v === null
    ? "—"
    : v.toNumber().toLocaleString("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

export type RecordPulseActionState =
  | { ok: true; branchId: string; amount: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/**
 * Everything a pulse changes.
 *
 * `/dashboard` because that is where it is read, and `/sales` because the daily
 * list shows it beside the detail. `/cost` is deliberately NOT here: a pulse is
 * not revenue (rule P27) and never enters a cost figure.
 */
function revalidatePulseViews(): void {
  revalidatePath("/dashboard");
  revalidatePath("/sales");
}

export async function recordSalesPulseAction(
  _prev: RecordPulseActionState | null,
  formData: FormData
): Promise<RecordPulseActionState> {
  const { tenantId, user } = await requireTenant();

  const parsed = recordSalesPulseInputSchema.safeParse({
    branchId: formData.get("branchId"),
    businessDate: formData.get("businessDate"),
    amount: formData.get("amount"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const result = await recordSalesPulseLogic(tenantId, user.id, parsed.data);
    revalidatePulseViews();
    return { ok: true, branchId: parsed.data.branchId, amount: result.amount.toString() };
  } catch (e) {
    if (e instanceof BranchNotFoundError) {
      return { ok: false, fieldErrors: { branchId: BRANCH_NOT_FOUND_MESSAGE } };
    }
    if (e instanceof SalesPulseLockedError) {
      // Both numbers, and what to do about them. "Locked" on its own would send a
      // cashier looking for a permission problem that does not exist.
      const same = e.pulseAmount !== null && e.pulseAmount.equals(e.detailAmount);
      return {
        ok: false,
        formError: same
          ? `วันนี้มีข้อมูลจากไฟล์ยอดขายแล้ว จึงแก้ยอดที่คีย์ไว้ไม่ได้ — และทั้งสองตัวตรงกันพอดี (฿${baht(e.detailAmount)})`
          : `วันนี้มีข้อมูลจากไฟล์ยอดขายแล้ว จึงแก้ยอดที่คีย์ไว้ไม่ได้ — ยอดที่คีย์ไว้ ฿${baht(e.pulseAmount)} · ไฟล์รวมได้ ฿${baht(e.detailAmount)} · ถ้าไฟล์ไม่ครบ ให้ export ใหม่แล้วนำเข้าทับ`,
      };
    }
    throw e; // unexpected → let the error boundary handle it
  }
}

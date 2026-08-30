"use server";

// ============================================================
// Mise — consumption Server Actions (Part 22 L4b, ADR 0022)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here; every refusal below was decided in L3 and is being translated.
//
// Two things specific to this slice:
//
//   * **The press is checked before it writes.** A press covering six days that
//     would replace two of them refuses ONCE, names both, and obeys on the
//     second identical POST (Q2b). Posting four and stopping at the fifth would
//     leave the shop half-done with no record of which half — the same argument
//     Q8 makes about copying a recipe onto branches that decided for themselves.
//   * **`submit_key` is READ from the form, never minted here** — the rule every
//     write in this project follows. A server-minted key is a fresh key on every
//     retry, and here a retry would consume the same days twice.
//
// Per the 7a–8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  postConsumptionInputSchema,
  CONSUMPTION_FIELD_LABELS_TH,
} from "@/lib/validations/consumption";
import {
  ConsumptionAlreadyPostedError,
  findLivePostedDaysLogic,
  postConsumptionForDayLogic,
} from "@/server/consumption-post";
import { getConsumptionDayStatusLogic } from "@/server/consumption-read";
import { CrossTenantReferenceError } from "@/server/product";
import { RecipeMethodMissingError } from "@/server/recipe-graph";
import {
  toConsumptionDayView,
  toConsumptionSkipView,
  toPostedDaySummaryView,
  type ConsumptionDayView,
  type PostedDayResultView,
  type PostedDaySummaryView,
} from "@/app/consumption/_components/consumption-view";

// ------------------------------------------------------------
// Thai messages
// ------------------------------------------------------------

const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";

/**
 * The walk refused mid-day. It should not be reachable — `computeConsumption`
 * catches this per dish and reports it as a skipped menu — so if it arrives here
 * something below has changed, and a stack trace on the screen is not the way to
 * find out.
 */
const METHOD_MISSING_MESSAGE =
  "มีของแปรรูปในสูตรที่ยังไม่ได้ระบุเปอร์เซ็นต์ผลผลิต จึงคำนวณต่อไม่ได้";

const UNEXPECTED_MESSAGE =
  "ตัดสต๊อกไม่สำเร็จ — รบกวนลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ";

// ------------------------------------------------------------
// Action state
// ------------------------------------------------------------

export type PostConsumptionActionState =
  | { ok: true; days: PostedDayResultView[] }
  | {
      ok: false;
      formError?: string;
      fieldErrors?: Record<string, string>;
      /**
       * Q2b's second pass: the days that already carry a posting, with what each
       * one covered. The screen lists them and re-submits with the
       * acknowledgement, which is what turns "we replaced it" into "you were
       * told what you were discarding and said yes".
       */
      needsAcknowledgement?: { days: PostedDaySummaryView[] };
    };

export const POST_CONSUMPTION_INIT: PostConsumptionActionState = {
  ok: false,
};

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] =
      issue.message ||
      `${CONSUMPTION_FIELD_LABELS_TH[key] ?? key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

function toFormError(e: unknown): { formError: string } {
  if (e instanceof CrossTenantReferenceError) {
    return { formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof RecipeMethodMissingError) {
    return { formError: METHOD_MISSING_MESSAGE };
  }
  if (e instanceof ConsumptionAlreadyPostedError) {
    // Reachable only if a second press lands between the pre-flight and the
    // write. Not a crash and not a lie: say what happened and let them press
    // again, which the acknowledgement will then carry.
    return {
      formError:
        "มีคนตัดสต๊อกวันนี้ไปพร้อมกัน — รบกวนรีเฟรชแล้วดูผลก่อนตัดซ้ำ",
    };
  }
  return { formError: UNEXPECTED_MESSAGE };
}

// ------------------------------------------------------------
// Write
// ------------------------------------------------------------

export async function postConsumptionAction(
  _prevState: PostConsumptionActionState,
  formData: FormData
): Promise<PostConsumptionActionState> {
  const { tenantId, membership, assertBranch} = await requireTenant("consumption:post");

  const parsed = postConsumptionInputSchema.safeParse({
    submitKey: formData.get("submit_key"),
    branchId: formData.get("branch_id"),
    businessDates: formData.getAll("business_date"),
    acknowledgeRepost: formData.get("acknowledge_repost") === "on",
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  assertBranch(parsed.data.branchId);
  const input = parsed.data;

  // --- ask before writing anything (Q2b) ---
  if (!input.acknowledgeRepost) {
    const already = await findLivePostedDaysLogic(
      tenantId,
      input.branchId,
      input.businessDates
    );
    if (already.length > 0) {
      return {
        ok: false,
        needsAcknowledgement: { days: already.map(toPostedDaySummaryView) },
      };
    }
  }

  try {
    const days: PostedDayResultView[] = [];
    for (const businessDate of input.businessDates) {
      // One transaction per day, deliberately. The days are independent, each is
      // idempotent on its own key, and a thirty-day press held open as a single
      // transaction would be the longest write in the system by an order of
      // magnitude — for no gain, since a day that failed can simply be pressed
      // again.
      const res = await postConsumptionForDayLogic(
        tenantId,
        { ...input, businessDate },
        membership.userId
      );
      const total = res.run.totalNetAmount;
      days.push({
        businessDate: businessDate.toISOString().slice(0, 10),
        businessDateLabel: new Intl.DateTimeFormat("th-TH", {
          timeZone: "Asia/Bangkok",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(businessDate),
        menusPosted: res.run.menusPosted,
        menusSkipped: res.run.menusSkipped,
        coveredNetAmount: res.run.coveredNetAmount.toString(),
        totalNetAmount: total.toString(),
        coveragePercent: total.isZero()
          ? null
          : Number(
              res.run.coveredNetAmount.div(total).mul(100).toFixed(1)
            ),
        replaced: res.voidedRunId !== null,
        skipped: res.demand.skipped.map((s) =>
          toConsumptionSkipView({
            menuId: s.menuId,
            menuName: s.menuName,
            qty: s.qty.toString(),
            netAmount: s.netAmount.toString(),
            reason: s.reason,
            detail: s.detail,
          })
        ),
      });
    }

    revalidateConsumptionViews();
    return { ok: true, days };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

export async function getConsumptionDaysAction(query: {
  branchId?: string;
  from: string;
  to: string;
}): Promise<ConsumptionDayView[]> {
  const { tenantId } = await requireTenant("consumption:post");
  const rows = await getConsumptionDayStatusLogic(tenantId, {
    branchId: query.branchId,
    from: new Date(`${query.from}T00:00:00.000Z`),
    to: new Date(`${query.to}T00:00:00.000Z`),
  });
  return rows.map(toConsumptionDayView);
}

/**
 * Posting changes stock, so it changes every page that reads stock — not just
 * this one. `/cost` is the point of the whole Part and would otherwise show
 * yesterday's gross profit until something else happened to invalidate it.
 */
function revalidateConsumptionViews(): void {
  revalidatePath("/consumption");
  revalidatePath("/sales");
  revalidatePath("/cost");
  revalidatePath("/stock");
  revalidatePath("/dashboard");
}

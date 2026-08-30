"use server";

// ============================================================
// Mise — menu merging Server Actions (Sprint 5 Part 25 L4, ADR 0026)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. Every refusal
// below was decided in L3a and is only being translated here.
//
// Four things specific to merging:
//
//   * **Two refusals are not failures.** `MergeAffectsPostedDaysError` and
//     `RevokeAffectsPostedDaysError` are the first half of a two-step somebody
//     completes — the same shape as publishing a draft over a live recipe (ADR
//     0025) and copying a recipe over branch recipes (ADR 0021 Q8). They are
//     carried as errors because they must INTERRUPT: an acknowledgement the
//     screen could skip is not an acknowledgement.
//   * **`MenuAlreadyMergedError` travels with the merge it collided with**, so
//     the screen can link to it. "This menu is already merged" without saying
//     into what leaves a person with nowhere to go; the thing they need is
//     usually to revoke that merge and point it somewhere else.
//   * **`submit_key` is read from the form, never minted here** — the rule the
//     recipe, lab, goods-receipt and waste actions already follow. A key minted
//     server-side is a fresh key on every retry, which is exactly the double
//     POST it exists to close.
//   * **Revoking has no `submit_key` and needs none.** A merge already revoked
//     has nothing left to change, so `revokeMergeLogic` returns it. Same
//     reasoning as `discardDraftAction`.
//
// What this file must NOT grow: an action that merges from a similarity score.
// ADR 0019 Q7 is unchanged and Part 25 is the Part most tempted to break it —
// ผัดกะเพราหมู and ผัดกะเพราไก่ score high and are different dishes, so a
// "merge all suggestions" button would split nothing and consume the wrong
// ingredient every service.
//
// Per the 7a–8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3a/L3b/L4 reads) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  MENU_MERGE_FIELD_LABELS_TH,
  mergeCandidatesQuerySchema,
  mergeMenusInputSchema,
  revokeMergeInputSchema,
} from "@/lib/validations/menu-merge";
import {
  MenuAlreadyMergedError,
  MenuMergeNotFoundError,
  MergeAffectsPostedDaysError,
  MergeChainError,
  RevokeAffectsPostedDaysError,
  mergeMenusLogic,
  revokeMergeLogic,
} from "@/server/menu-merge";
import { getMergeCandidatesLogic } from "@/server/menu-merge-read";
import { MenuNotFoundError } from "@/server/menu";
import {
  toMergeCandidateRowView,
  toMergeSubjectView,
  type MergeCandidateRowView,
  type MergeSubjectView,
} from "@/app/menus/_components/menu-merge-view";

// ------------------------------------------------------------
// Thai messages
// ------------------------------------------------------------

const MENU_NOT_FOUND_MESSAGE = "ไม่พบเมนูนี้ — รบกวนรีเฟรชแล้วเลือกใหม่";
const MERGE_NOT_FOUND_MESSAGE = "ไม่พบรายการรวมเมนูนี้ — อาจถูกยกเลิกไปแล้ว";

/**
 * The dish chosen as canonical is itself somebody's spelling.
 *
 * Both chain sentences name the way out, because "ทำไม่ได้" with no next step is
 * how a person ends up revoking the wrong merge to get past a message.
 */
const CHAIN_AS_WINNER_MESSAGE =
  "เมนูหลักที่เลือกถูกรวมเข้ากับเมนูอื่นอยู่แล้ว — เลือกเมนูหลักตัวจริง หรือยกเลิกการรวมเดิมก่อน";
const CHAIN_AS_LOSER_MESSAGE =
  "เมนูที่จะถูกรวมเป็นเมนูหลักของชื่ออื่นอยู่แล้ว — ถ้าต้องการสลับ ให้ยกเลิกการรวมเดิมก่อน";

const ALREADY_MERGED_MESSAGE =
  "เมนูนี้ถูกรวมเข้ากับเมนูอื่นอยู่แล้ว — ยกเลิกการรวมเดิมก่อนจึงจะรวมใหม่ได้";

const INVALID_MENU_MESSAGE = "รหัสเมนูไม่ถูกต้อง";

/** Thai for a day count, so the two acknowledgement sentences read the same. */
const days = (n: number) => `${n} วัน`;

// ------------------------------------------------------------
// Action state
// ------------------------------------------------------------

/**
 * The second pass a refusal asks for.
 *
 * `kind` is carried rather than inferred from which action returned it: the
 * merge screen and the revoke button post to different actions today, and a
 * screen that guessed from context would send the wrong acknowledgement the day
 * they share a component.
 */
export type MergeAcknowledgement =
  | {
      kind: "backdate";
      postedDayCount: number;
      /** ISO date — the oldest day this merge would change if it were posted
       *  again. The screen names it; a count with no date is not a warning a
       *  person can check. */
      earliestBusinessDate: string;
    }
  | { kind: "revokePosted"; postedDayCount: number };

export type MenuMergeActionState =
  | { ok: true; mergeId: string }
  | {
      ok: false;
      formError?: string;
      fieldErrors?: Record<string, string>;
      needsAcknowledgement?: MergeAcknowledgement;
      /** Set by `MenuAlreadyMergedError` so the screen can link to the merge in
       *  the way. */
      existingMerge?: { id: string; winningMenuId: string };
    };

export type MergeCandidatesState =
  | { ok: true; subject: MergeSubjectView; candidates: MergeCandidateRowView[] }
  | { ok: false; error: string };

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    if (key in fieldErrors) continue;
    const label = MENU_MERGE_FIELD_LABELS_TH[key] ?? key;
    fieldErrors[key] = issue.message || `${label}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/** Map a typed error → Thai field/form error; rethrow the rest. */
function toFormError(e: unknown): {
  formError?: string;
  fieldErrors?: Record<string, string>;
  needsAcknowledgement?: MergeAcknowledgement;
  existingMerge?: { id: string; winningMenuId: string };
} {
  if (e instanceof MenuNotFoundError) {
    return { formError: MENU_NOT_FOUND_MESSAGE };
  }
  if (e instanceof MenuMergeNotFoundError) {
    return { formError: MERGE_NOT_FOUND_MESSAGE };
  }
  if (e instanceof MergeChainError) {
    return e.role === "winner"
      ? { fieldErrors: { winningMenuId: CHAIN_AS_WINNER_MESSAGE } }
      : { fieldErrors: { losingMenuId: CHAIN_AS_LOSER_MESSAGE } };
  }
  if (e instanceof MenuAlreadyMergedError) {
    return {
      fieldErrors: { losingMenuId: ALREADY_MERGED_MESSAGE },
      existingMerge: {
        id: e.existingMergeId,
        winningMenuId: e.existingWinningMenuId,
      },
    };
  }
  if (e instanceof MergeAffectsPostedDaysError) {
    const earliest = e.earliestBusinessDate.toISOString().slice(0, 10);
    return {
      formError:
        `วันที่มีผลย้อนไปถึงวันที่ตัดสต๊อกไปแล้ว ${days(e.postedDayCount)} ` +
        `(เก่าที่สุด ${earliest}) — ยอดของวันเหล่านั้นจะยังเท่าเดิมจนกว่าจะยกเลิก` +
        "การตัดสต๊อกแล้วโพสต์ใหม่ ถ้าเข้าใจแล้วกดยืนยันอีกครั้ง",
      needsAcknowledgement: {
        kind: "backdate",
        postedDayCount: e.postedDayCount,
        earliestBusinessDate: earliest,
      },
    };
  }
  if (e instanceof RevokeAffectsPostedDaysError) {
    return {
      formError:
        `มี ${days(e.postedDayCount)} ที่ตัดสต๊อกไปแล้วขณะที่ยังรวมกันอยู่ — ` +
        "การยกเลิกจะไม่คืนยอดเหล่านั้นให้เอง ถ้าต้องการให้ตรงต้องยกเลิกการตัด" +
        "สต๊อกของวันนั้นแล้วโพสต์ใหม่ ถ้าเข้าใจแล้วกดยืนยันอีกครั้ง",
      needsAcknowledgement: {
        kind: "revokePosted",
        postedDayCount: e.postedDayCount,
      },
    };
  }
  throw e; // unexpected → let the error boundary handle it
}

/**
 * Every surface a merge moves.
 *
 * All of them, on both actions, because Q5's asymmetry is about the LEDGER and
 * not about caches: reporting folds retroactively and always, so the moment this
 * row exists, revenue per menu, coverage and the cost screens all answer
 * differently — including for months nobody has touched. Listing them per-action
 * would mean deciding, twice, which reads a fold can reach, and the cost of a
 * stale figure is higher than the cost of one extra revalidation.
 */
function revalidateMergeViews(): void {
  revalidatePath("/menus");
  revalidatePath("/menus/merges");
  revalidatePath("/menus/coverage");
  revalidatePath("/menus/lab");
  revalidatePath("/sales");
  revalidatePath("/consumption");
  revalidatePath("/cost");
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------

/**
 * Declare that one menu is another's spelling of the same dish.
 *
 * Writes one row and moves nothing (Q1) — no `sales_line` is repointed, no
 * recipe is touched, and the losing menu stays alive and goes on collecting
 * sales tomorrow. The screen says so in `MERGE_KEEPS_LOSER_HINT_TH`, which is
 * not decoration: a shop that reads "รวมเมนู" as "ยุบเหลือรายการเดียว" will go
 * looking for the row that vanished.
 */
export async function mergeMenusAction(
  _prevState: MenuMergeActionState,
  formData: FormData
): Promise<MenuMergeActionState> {
  const { tenantId, membership } = await requireTenant("master:write");

  const parsed = mergeMenusInputSchema.safeParse({
    submitKey: formData.get("submit_key"),
    losingMenuId: formData.get("losing_menu_id"),
    winningMenuId: formData.get("winning_menu_id"),
    effectiveFrom: formData.get("effective_from"),
    acknowledgeBackdate: formData.get("acknowledge_backdate"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const merge = await mergeMenusLogic(tenantId, parsed.data, membership.userId);
    revalidateMergeViews();
    return { ok: true, mergeId: merge.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Stop treating one menu as another's spelling.
 *
 * Sets `revokedAt`/`revokedBy`; the row is never deleted, so what the reports
 * said last month stays explainable. It does NOT undo movements posted while the
 * merge stood — the ledger is append-only — which is why the first attempt
 * refuses where such days exist and the second carries `acknowledge_posted`.
 */
export async function revokeMergeAction(
  _prevState: MenuMergeActionState,
  formData: FormData
): Promise<MenuMergeActionState> {
  const { tenantId, membership } = await requireTenant("master:write");

  const parsed = revokeMergeInputSchema.safeParse({
    mergeId: formData.get("merge_id"),
    acknowledgePosted: formData.get("acknowledge_posted"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const merge = await revokeMergeLogic(tenantId, parsed.data, membership.userId);
    revalidateMergeViews();
    return { ok: true, mergeId: merge.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * "What else might this dish be?" — reads only, writes nothing, and folds
 * nothing.
 *
 * No `revalidatePath`: nothing changed. A read that invalidates caches is a read
 * that will one day be blamed for a write.
 *
 * The result carries, per row, whether it may be the loser and whether it may be
 * the winner. `mergeMenusLogic` refuses the same two cases anyway; this is so
 * the screen can grey a row out instead of letting somebody pick it and be told
 * afterwards.
 */
export async function getMergeCandidatesAction(
  menuId: string,
  limit?: number
): Promise<MergeCandidatesState> {
  const { tenantId } = await requireTenant("master:write");

  const parsed = mergeCandidatesQuerySchema.safeParse({ menuId, limit });
  if (!parsed.success) {
    return { ok: false, error: INVALID_MENU_MESSAGE };
  }

  try {
    const result = await getMergeCandidatesLogic(tenantId, parsed.data);
    return {
      ok: true,
      subject: toMergeSubjectView(result.subject),
      candidates: result.candidates.map(toMergeCandidateRowView),
    };
  } catch (e) {
    if (e instanceof MenuNotFoundError) {
      return { ok: false, error: MENU_NOT_FOUND_MESSAGE };
    }
    throw e;
  }
}

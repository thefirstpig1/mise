"use client";

// Sprint 5 Part 25 L5 — un-merging (ADR 0026 Consequence 4).
//
// THE REFUSAL IS THE FEATURE, and it is a different refusal from the one on the
// merge form. Revoking is instant and complete for REPORTS — every screen stops
// folding the moment the row is revoked. It is not instant and not complete for
// STOCK: movements posted while the merge stood are in an append-only ledger and
// stay there. Nothing on screen would look wrong afterwards, which is exactly
// why the person has to be told before rather than after.
//
// So the first press refuses and names how many days deducted through the
// winner's recipe; the second carries `acknowledge_posted`. Where no such day
// exists there is nothing to warn about and the first press goes through — a
// warning that fires every time is a warning nobody reads.
//
// No `submit_key`: a merge already revoked has nothing left to change, so the
// server returns it. Same reasoning as discarding a draft.

import { useActionState } from "react";
import {
  REVOKE_KEEPS_MOVEMENTS_HINT_TH,
} from "@/lib/validations/menu-merge";
import {
  revokeMergeAction,
  type MenuMergeActionState,
} from "@/app/menus/merges/actions";

export default function RevokeMergeButton({
  mergeId,
  loserLabel,
  winnerLabel,
}: {
  mergeId: string;
  loserLabel: string;
  winnerLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(revokeMergeAction, {
    ok: false,
  } as MenuMergeActionState);

  const needsAck = state.ok ? undefined : state.needsAcknowledgement;
  const postedAck =
    needsAck !== undefined && needsAck.kind === "revokePosted" ? needsAck : undefined;
  const formError = state.ok ? undefined : state.formError;

  if (state.ok) {
    return (
      <p className="text-xs text-emerald-700">
        ยกเลิกแล้ว — “{loserLabel}” ไม่ถูกนับเป็น “{winnerLabel}” อีกต่อไป
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="merge_id" value={mergeId} />
      {postedAck ? (
        <input type="hidden" name="acknowledge_posted" value="on" />
      ) : null}

      {formError ? (
        <div
          className={`rounded-lg border p-2 text-xs ${
            needsAck
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <p>{formError}</p>
          {postedAck ? (
            <p className="mt-1">{REVOKE_KEEPS_MOVEMENTS_HINT_TH}</p>
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
      >
        {isPending
          ? "กำลังยกเลิก…"
          : postedAck
            ? "เข้าใจแล้ว — ยกเลิกการรวม"
            : "ยกเลิกการรวม"}
      </button>
    </form>
  );
}

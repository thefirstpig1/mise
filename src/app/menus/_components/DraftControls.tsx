"use client";

// Sprint 5 Part 24 L5b — the two buttons that end a draft's life.
//
// PUBLISH refuses once when the dish already has a live central recipe, and the
// refusal is the feature. From the moment it succeeds, every plate consumes
// against the new recipe — while yesterday stays costed against yesterday's, so
// NOTHING ON SCREEN LOOKS DIFFERENT TOMORROW. That is exactly why the person has
// to be told which recipe stops applying before it happens rather than after.
// The second press carries `acknowledge_replace`, which is what turns "the dish
// silently changed" into "you were told and said yes".
//
// DISCARD is not delete: the row never was a recipe. The MISE menu a "new dish"
// draft created stays behind on purpose (ADR 0025 Consequence 3) — it carries no
// sales, so it cannot move revenue, coverage or consumption, and it is what Part
// 25 reconciles if the dish later turns up in a POS export.

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  discardDraftAction,
  publishDraftAction,
  type DraftActionState,
} from "@/app/menus/lab/actions";

export default function DraftControls({
  recipeId,
  menuName,
  /** Non-null when publishing takes over a recipe that is already live. */
  liveRecipeId,
}: {
  recipeId: string;
  menuName: string;
  liveRecipeId: string | null;
}) {
  const router = useRouter();
  const [state, formAction, isPublishing] = useActionState(publishDraftAction, {
    ok: false,
  } as DraftActionState);
  const [discarding, startDiscard] = useTransition();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  // The server's refusal, not a guess made here: the screen only ever shows the
  // acknowledgement once the write has actually been stopped by it.
  const needsAck = !state.ok && state.needsAcknowledgement !== undefined;
  const replacedId = state.ok
    ? null
    : (state.needsAcknowledgement?.liveRecipeId ?? liveRecipeId);

  if (state.ok) {
    return (
      <div className="rounded-xl border border-good-border bg-good-bg p-5 text-sm text-good">
        <p className="font-medium">เผยแพร่แล้ว — {menuName} มีสูตรใช้งานจริงแล้ว</p>
        <p className="mt-1">
          ตั้งแต่วันนี้เป็นต้นไป ยอดขายของเมนูนี้จะตัดสต๊อกตามสูตรนี้
          ส่วนยอดของวันก่อนหน้ายังคิดด้วยสูตรเดิม
        </p>
        <a
          href={`/recipes/${state.draft.id}`}
          className="mt-2 inline-block underline"
        >
          ไปที่หน้าสูตรอาหาร →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div>
        <h3 className="text-sm font-semibold">เผยแพร่สูตรนี้</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          เผยแพร่แล้วสูตรนี้จะถูกใช้ตัดสต๊อกตามยอดขายตั้งแต่วันนี้เป็นต้นไป
          {liveRecipeId !== null
            ? " และจะใช้แทนสูตรกลางเดิมของเมนูนี้"
            : null}
        </p>
      </div>

      {state.formError ? (
        <div
          className={`rounded-lg border p-3 text-sm ${
            needsAck
              ? "border-warn-border bg-warn-bg text-warn"
              : "border-bad-border bg-bad-bg text-bad"
          }`}
        >
          <p>{state.formError}</p>
          {needsAck && replacedId !== null ? (
            <a
              href={`/recipes/${replacedId}`}
              className="mt-1 inline-block underline"
            >
              ดูสูตรเดิมที่กำลังจะถูกแทนที่ →
            </a>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="recipe_id" value={recipeId} />
        {/* Only after the server has refused once. A checkbox that is there from
            the start is a checkbox people tick without reading. */}
        {needsAck ? (
          <input type="hidden" name="acknowledge_replace" value="on" />
        ) : null}
        <button
          type="submit"
          disabled={isPublishing}
          className="btn"
        >
          {isPublishing
            ? "กำลังเผยแพร่…"
            : needsAck
              ? "เข้าใจแล้ว — เผยแพร่ทับสูตรเดิม"
              : "เผยแพร่สูตรนี้"}
        </button>
      </form>

      <div className="border-t border-border pt-4">
        {discardError ? (
          <p className="mb-2 text-xs text-bad">{discardError}</p>
        ) : null}
        {confirmDiscard ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              ทิ้งร่างนี้? สิ่งที่พิมพ์ไว้จะหายไป
            </span>
            <button
              type="button"
              disabled={discarding}
              onClick={() =>
                startDiscard(async () => {
                  const result = await discardDraftAction(recipeId);
                  if (result.ok) router.push("/menus/lab");
                  else setDiscardError(result.error);
                })
              }
              className="rounded-lg border border-bad-border px-3 py-1.5 text-xs text-bad hover:bg-bad-bg disabled:opacity-50"
            >
              {discarding ? "กำลังทิ้ง…" : "ทิ้งร่าง"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="text-xs text-muted-foreground underline"
            >
              ยกเลิก
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDiscard(true)}
            className="text-xs text-muted-foreground underline"
          >
            ทิ้งร่างนี้
          </button>
        )}
      </div>
    </div>
  );
}

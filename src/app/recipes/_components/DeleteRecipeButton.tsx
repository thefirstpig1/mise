"use client";

// Sprint 5 Part 21 L5c — delete a recipe.
//
// It deletes the whole LINE, every version of it, not the version on screen —
// that is what `deleteRecipeLogic` does, and a button that said otherwise would
// be describing a different action from the one it fires.
//
// The ledger is untouched either way: Part 21 writes nothing to it, so this
// removes an instruction, never a movement. What it DOES remove is the answer
// Part 22 needs for the days that line covered, which is what the confirm says.
//
// Part 25 (ADR 0026 Consequence 3) added the SECOND press. A menu merged into
// this dish borrows this recipe when it has none of its own, so deleting stops
// its stock deduction too — and that menu is filed under a different spelling,
// which is exactly why nobody would think to look for it. The server refuses the
// first attempt and names them; the button shows the names and the next press
// carries the acknowledgement.
//
// THE ACKNOWLEDGEMENT IS NEVER PRE-SENT. It is armed only by a refusal that has
// already happened, so the names have been on screen before it can be true — an
// acknowledgement the screen could skip is not an acknowledgement.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRecipeAction } from "@/app/recipes/actions";

export default function DeleteRecipeButton({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mergedMenuNames, setMergedMenuNames] = useState<string[] | null>(null);

  const armed = mergedMenuNames !== null;

  function run() {
    if (
      !window.confirm(
        armed
          ? `ยืนยันลบ — ${mergedMenuNames.join(", ")} จะขายต่อไปโดยไม่ตัดสต๊อก`
          : "ลบสูตรนี้ทั้งหมด รวมทุกเวอร์ชันในประวัติ?\n\nยอดขายของวันที่ผ่านมาจะไม่มีสูตรให้คิดต้นทุนอีกต่อไป"
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteRecipeAction(recipeId, armed);
      if (res.ok) {
        router.push("/recipes");
        router.refresh();
      } else {
        setError(res.error);
        // Arm only on the refusal that carries names; any other error leaves the
        // button exactly as unarmed as it was.
        if (res.needsAcknowledgement) {
          setMergedMenuNames(res.needsAcknowledgement.mergedMenuNames);
        }
      }
    });
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="rounded-lg border border-bad-border px-3 py-2 text-sm text-bad hover:bg-bad-bg disabled:opacity-50"
      >
        {isPending ? "กำลังลบ…" : armed ? "ยืนยันลบสูตรนี้" : "ลบสูตรนี้"}
      </button>
      {error ? (
        <p className="mt-1 whitespace-pre-line text-xs text-bad">{error}</p>
      ) : null}
    </div>
  );
}

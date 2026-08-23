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

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRecipeAction } from "@/app/recipes/actions";

export default function DeleteRecipeButton({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (
      !window.confirm(
        "ลบสูตรนี้ทั้งหมด รวมทุกเวอร์ชันในประวัติ?\n\nยอดขายของวันที่ผ่านมาจะไม่มีสูตรให้คิดต้นทุนอีกต่อไป"
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteRecipeAction(recipeId);
      if (res.ok) {
        router.push("/recipes");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? "กำลังลบ…" : "ลบสูตรนี้"}
      </button>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

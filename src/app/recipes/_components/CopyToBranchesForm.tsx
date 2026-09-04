"use client";

// Sprint 5 Part 21 L5c — give named branches their own copy (ADR 0021 Q8).
//
// THE FIRST REFUSAL IS THE FEATURE. Copying onto a branch that already keeps its
// own recipe would discard a decision that branch made — the exact failure Q8
// exists to prevent, arriving through the door Q8 opened. So the action refuses
// once, names the branches, and only a second submit carrying the acknowledgement
// writes. Nothing about that is a nuisance to be smoothed away: it is the only
// moment anybody is told whose recipe is about to disappear.
//
// The tick box is deliberately NOT pre-checked and NOT remembered — a branch list
// that changed between the two passes has to be read again.
//
// `submit_key` rotates after a success: the next copy is its own document.

import { useActionState, useState } from "react";
import type { RecipeActionState } from "@/app/recipes/actions";

export type CopyBranchOption = { id: string; name: string; alreadyOwn: boolean };

function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function CopyToBranchesForm({
  action,
  sourceRecipeId,
  branches,
}: {
  action: (
    prev: RecipeActionState,
    fd: FormData
  ) => Promise<RecipeActionState>;
  sourceRecipeId: string;
  branches: CopyBranchOption[];
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as RecipeActionState);

  const [submitKey, setSubmitKey] = useState(newSubmitKey);
  const [selected, setSelected] = useState<string[]>([]);
  const [handled, setHandled] = useState(false);

  const succeeded = state.ok === true;
  if (succeeded && !handled) {
    setHandled(true);
    setSubmitKey(newSubmitKey());
    setSelected([]);
  }
  if (!succeeded && handled) setHandled(false);

  const needsAck = state.ok ? undefined : state.needsAcknowledgement;
  const formError = state.ok ? undefined : state.formError;

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  if (branches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        ร้านนี้มีสาขาเดียว จึงยังไม่ต้องแยกสูตรรายสาขา
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="submit_key" value={submitKey} />
      <input type="hidden" name="source_recipe_id" value={sourceRecipeId} />

      <p className="text-sm text-muted-foreground">
        สาขาที่เลือกจะได้สูตรนี้ไปเป็น <strong>สูตรของตัวเอง</strong>{" "}
        และจะไม่ตามสูตรกลางอีกต่อไป — แก้สูตรกลางทีหลังจะไม่ไปถึงสาขาเหล่านี้
      </p>

      <div className="flex flex-wrap gap-3">
        {branches.map((b) => (
          <label key={b.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="branch_id"
              value={b.id}
              checked={selected.includes(b.id)}
              onChange={() => toggle(b.id)}
              className="h-4 w-4"
            />
            {b.name}
            {b.alreadyOwn ? (
              <span className="rounded border border-warn-border bg-warn-bg px-1.5 py-0.5 text-[10px] text-warn">
                มีสูตรของตัวเองอยู่แล้ว
              </span>
            ) : null}
          </label>
        ))}
      </div>

      {formError ? (
        <p className="text-sm text-bad">{formError}</p>
      ) : null}

      {needsAck ? (
        <div className="space-y-2 rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">
          <p className="font-medium">
            สาขาต่อไปนี้มีสูตรของตัวเองอยู่แล้ว และจะถูกทับ:
          </p>
          <ul className="list-inside list-disc">
            {needsAck.branchNames.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="acknowledge_overwrite"
              className="h-4 w-4"
            />
            เข้าใจแล้ว ทับสูตรเดิมของสาขาเหล่านี้
          </label>
          <p className="text-xs">
            สูตรเดิมของสาขายังอยู่ในประวัติ ไม่ได้หายไปจากระบบ
          </p>
        </div>
      ) : null}

      {succeeded ? (
        <p className="text-sm text-good">คัดลอกให้สาขาที่เลือกแล้ว</p>
      ) : null}

      <button
        type="submit"
        disabled={isPending || selected.length === 0}
        className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
      >
        {isPending ? "กำลังคัดลอก…" : "คัดลอกไปยังสาขาที่เลือก"}
      </button>
    </form>
  );
}

"use client";

// Sprint 4 Part 19 L5 — add a menu category by hand.
//
// Most categories arrive on their own, mirrored from whatever the POS file
// called them (ADR 0019 Q9). This form is for the other direction: a shop that
// wants to group dishes its own way, or that has no POS category column at all.

import { useActionState } from "react";
import { createMenuCategoryAction, type MenuCategoryActionState } from "@/app/menus/actions";

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

export default function NewCategoryForm() {
  const [state, action, pending] = useActionState<MenuCategoryActionState | null, FormData>(
    createMenuCategoryAction,
    null
  );

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-sm">
        ชื่อหมวด
        <input name="name" className={`${inputClass} mt-1 block`} placeholder="เช่น ของหวาน" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? "กำลังเพิ่ม…" : "เพิ่ม"}
      </button>
      {state?.ok === false && (
        <p className="w-full text-xs text-destructive">
          {state.formError ?? Object.values(state.fieldErrors ?? {})[0]}
        </p>
      )}
      {state?.ok && <p className="w-full text-xs text-primary">เพิ่มหมวดแล้ว</p>}
    </form>
  );
}

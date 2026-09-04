"use client";

// Sprint 4 Part 19 L5 — register a POS (ADR 0019 Q2).
//
// Three fields and NO credentials. There is nothing to connect to: no Thai SME
// can enable a POS API for itself, so this entry exists to say which branch a
// file belongs to and to give that POS's menu codes a namespace of their own.

import { useActionState } from "react";
import {
  createPosIntegrationAction,
  type PosIntegrationActionState,
} from "@/app/sales/actions";
import { POS_TYPE_VALUES } from "@/lib/validations/sales-import";


const POS_TYPE_LABELS: Record<string, string> = {
  FOODSTORY: "FoodStory",
  WONGNAI: "Wongnai POS",
  OCHA: "Ocha",
  STOREHUB: "StoreHub",
  LOYVERSE: "Loyverse",
  CUSTOM: "อื่น ๆ / ไม่ระบุ",
};

export default function NewPosForm({
  branches,
}: {
  branches: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<PosIntegrationActionState | null, FormData>(
    createPosIntegrationAction,
    null
  );

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <label className="block text-sm">
        สาขา
        <select name="branchId" className={"input w-full mt-1"}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        ยี่ห้อ POS
        <select name="posType" className={"input w-full mt-1"}>
          {POS_TYPE_VALUES.map((t) => (
            <option key={t} value={t}>
              {POS_TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        ชื่อเรียก
        <input name="name" className={"input w-full mt-1"} placeholder="เช่น เครื่องหน้าร้าน" />
      </label>
      {state?.ok === false && (
        <p className="text-xs text-bad">
          {state.formError ?? Object.values(state.fieldErrors ?? {})[0]}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </button>
    </form>
  );
}

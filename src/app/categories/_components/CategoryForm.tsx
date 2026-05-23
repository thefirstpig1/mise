"use client";

// Sprint 1 Part 6, Step 6.4 — shared create + edit form.
// Driven by React 19 useActionState against the "use server" actions.
// Input `name=` attributes are snake_case to match rawFromFormData in
// src/app/categories/actions.ts; fieldErrors keys are camelCase schema names.
// No serializer needed: Category has no Decimal field (Pitfall #20 N/A).

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Category } from "@prisma/client";
import type { CategoryActionState } from "@/app/categories/actions";
import {
  ACCOUNT_VALUES,
  ACCOUNT_LABELS_TH,
  CATEGORY_FIELD_LABELS_TH,
} from "@/lib/validations/category";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

export default function CategoryForm({
  action,
  initial,
  submitLabel,
}: {
  action: (
    prev: CategoryActionState,
    fd: FormData
  ) => Promise<CategoryActionState>;
  initial?: Category;
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as CategoryActionState
  );

  useEffect(() => {
    if (state.ok) router.push("/categories");
  }, [state, router]);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const L = CATEGORY_FIELD_LABELS_TH;
  const err = (key: string) => fieldErrors?.[key];

  return (
    <form action={formAction} className="space-y-6">
      {formError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {formError}
        </div>
      )}

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <label htmlFor="account" className="mb-1 block text-sm font-medium">
            {L.account}
            <span className="text-red-600"> *</span>
          </label>
          <select
            id="account"
            name="account"
            defaultValue={initial?.account ?? ""}
            className={inputClass}
          >
            <option value="" disabled>
              — เลือกประเภทบัญชี —
            </option>
            {ACCOUNT_VALUES.map((a) => (
              <option key={a} value={a}>
                {ACCOUNT_LABELS_TH[a]}
              </option>
            ))}
          </select>
          {err("account") && (
            <p className="mt-1 text-sm text-red-600">{err("account")}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="accounting_section"
            className="mb-1 block text-sm font-medium"
          >
            {L.accountingSection}
            <span className="text-red-600"> *</span>
          </label>
          <input
            id="accounting_section"
            name="accounting_section"
            type="text"
            defaultValue={initial?.accountingSection ?? ""}
            placeholder="เช่น Food, Beverage, Utilities"
            className={inputClass}
          />
          {err("accountingSection") && (
            <p className="mt-1 text-sm text-red-600">
              {err("accountingSection")}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="group_name" className="mb-1 block text-sm font-medium">
            {L.groupName}
            <span className="text-red-600"> *</span>
          </label>
          <input
            id="group_name"
            name="group_name"
            type="text"
            defaultValue={initial?.groupName ?? ""}
            placeholder="เช่น Meat, Coffee, Electricity"
            className={inputClass}
          />
          {err("groupName") && (
            <p className="mt-1 text-sm text-red-600">{err("groupName")}</p>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-6 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : submitLabel}
        </button>
        <a
          href="/categories"
          className="rounded-lg border border-border px-6 py-2 text-sm hover:bg-muted/40"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}

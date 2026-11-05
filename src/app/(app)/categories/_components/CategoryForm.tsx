"use client";

// Sprint 1 Part 6, Step 6.4 — shared create + edit form.
// Driven by React 19 useActionState against the "use server" actions.
// Input `name=` attributes are snake_case to match rawFromFormData in
// src/app/categories/actions.ts; fieldErrors keys are camelCase schema names.
// No serializer needed: Category has no Decimal field (Pitfall #20 N/A).
//
// Queue item 9 (Kong 2026-11-04, "เอาตามแนะนำทั้งหมด"): a popup over the list,
// as branches, departments and people already were — the form used to be a
// page of its own. The account is two cards that say what each side MEANS,
// the examples are Thai like the shop's own categories, and the sections the
// chosen account already has sit under the field to tap, so "อาหาร" is not
// typed a second time as "อาหาร " and split into two sections.

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Category } from "@prisma/client";
import { createCategory, updateCategory, type CategoryActionState } from "@/app/(app)/categories/actions";
import { ACCOUNT_VALUES, CATEGORY_FIELD_LABELS_TH, type Account } from "@/lib/validations/category";
import { useKeepForm } from "@/lib/keep-form";
import SettingsModal from "@/app/(app)/settings/_components/SettingsModal";
import DeleteCategoryButton from "./DeleteCategoryButton";

/** What each account means to the shop, in the shop's words — the list's boxes say the same. */
export const ACCOUNT_BOX: Record<Account, { title: string; code: string; hint: string }> = {
  COGS: {
    title: "ต้นทุนขาย",
    code: "COGS",
    hint: "ของที่ซื้อมาทำอาหารและเครื่องดื่ม นับเป็นต้นทุนอาหาร",
  },
  OpEx: {
    title: "ค่าใช้จ่ายดำเนินงาน",
    code: "OpEx",
    hint: "ค่าใช้จ่ายในการเปิดร้าน เช่น ค่าเช่า ค่าไฟ ค่าแรง ไม่นับเป็นต้นทุนอาหาร",
  },
};

const INIT: CategoryActionState = { ok: false };

export default function CategoryDialog({
  initial,
  sectionsByAccount,
  onClose,
  onRestored,
}: {
  /** null = a new category. */
  initial: Category | null;
  /** The sections each account already has, to tap instead of typing. */
  sectionsByAccount: Record<Account, string[]>;
  onClose: () => void;
  /** Typing a deleted category's name brought it back — the list says so. */
  onRestored?: (label: string) => void;
}) {
  const router = useRouter();
  const action = useMemo(() => (initial ? updateCategory.bind(null, initial.id) : createCategory), [initial]);
  const [state, formAction, isPending] = useActionState(action, INIT);
  const formActionKeep = useKeepForm(formAction, state);
  const [account, setAccount] = useState<Account | "">((initial?.account as Account) ?? "");
  const [section, setSection] = useState(initial?.accountingSection ?? "");

  useEffect(() => {
    if (!state.ok) return;
    if (state.restored && state.label) onRestored?.(state.label);
    onClose();
    router.refresh();
  }, [state, onClose, onRestored, router]);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const L = CATEGORY_FIELD_LABELS_TH;
  const err = (key: string) => fieldErrors?.[key];
  const picks = account ? sectionsByAccount[account] : [];

  return (
    <SettingsModal
      title={initial ? "แก้ไขหมวดบัญชี" : "เพิ่มหมวดบัญชี"}
      sub={initial ? `${initial.accountingSection} · ${initial.groupName}` : "กลุ่มใหม่จะขึ้นในกล่องของประเภทที่เลือก"}
      onClose={onClose}
    >
      <form {...formActionKeep} className="space-y-4">
        {formError && <p className="rounded-xl border border-bad-border bg-bad-bg px-3.5 py-2.5 text-sm text-bad">{formError}</p>}

        <fieldset>
          <legend className="mb-1.5 label">{L.account}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ACCOUNT_VALUES.map((a) => (
              <label
                key={a}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border px-3.5 py-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:ring-1 has-[:checked]:ring-primary"
              >
                <input
                  type="radio"
                  name="account"
                  value={a}
                  defaultChecked={initial?.account === a}
                  onChange={() => setAccount(a)}
                  className="mt-1 h-[18px] w-[18px] shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className="font-semibold">{ACCOUNT_BOX[a].title}</span>
                  <span className="ml-1.5 text-xs text-muted-subtle">{ACCOUNT_BOX[a].code}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{ACCOUNT_BOX[a].hint}</span>
                </span>
              </label>
            ))}
          </div>
          {err("account") && <p className="mt-1 text-sm text-bad">{err("account")}</p>}
        </fieldset>

        <div>
          <label htmlFor="accounting_section" className="mb-1 label">
            {L.accountingSection}
          </label>
          <input
            id="accounting_section"
            name="accounting_section"
            type="text"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="เช่น อาหาร เครื่องดื่ม บรรจุภัณฑ์"
            className="input w-full"
          />
          {picks.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>หมวดที่มีอยู่:</span>
              {picks.map((p) => (
                <button key={p} type="button" onClick={() => setSection(p)} className={`pill ${section.trim() === p ? "is-on" : ""}`}>
                  {p}
                </button>
              ))}
            </div>
          )}
          {err("accountingSection") && <p className="mt-1 text-sm text-bad">{err("accountingSection")}</p>}
        </div>

        <div>
          <label htmlFor="group_name" className="mb-1 label">
            {L.groupName}
          </label>
          <input
            id="group_name"
            name="group_name"
            type="text"
            defaultValue={initial?.groupName ?? ""}
            placeholder="เช่น เนื้อสัตว์ กาแฟและชา ภาชนะใช้ครั้งเดียว"
            className="input w-full"
          />
          {err("groupName") && <p className="mt-1 text-sm text-bad">{err("groupName")}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          {initial ? (
            <DeleteCategoryButton
              id={initial.id}
              onDone={() => {
                onClose();
                router.refresh();
              }}
            />
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              ยกเลิก
            </button>
            <button type="submit" disabled={isPending} className="btn h-11 px-5">
              {isPending ? "กำลังบันทึก…" : initial ? "บันทึก" : "เพิ่มหมวดบัญชี"}
            </button>
          </span>
        </div>
      </form>
    </SettingsModal>
  );
}

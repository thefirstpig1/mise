"use client";

// Sprint 4 Part 19 L5 — one editable menu row (ADR 0019 Q7, Q8, Q16).
//
// The row exists to answer a stub: give the dish a name the shop recognises, a
// category, and (when departments are on) the department that earns its revenue.
// Saving clears the รอตรวจ flag, because somebody has now looked at it — which
// is the entire meaning of the flag.
//
// What this component deliberately cannot do is merge, and Part 25 did not
// change that — it answered it. The "จับคู่ชื่อ" control still creates an ALIAS,
// which applies from the next import onwards and touches no history. Merging is
// its own screen because it is its own decision, and because a row that could be
// merged away by a control sitting next to "แก้ไข" would be merged away by
// accident.
//
// What this row DOES carry since Part 25 (ADR 0026 Q6) is the nesting: the
// spellings folded into this dish are collapsed beneath it — "+2 ชื่อที่รวมแล้ว",
// expandable, and not editable from here. Hiding them entirely would take rows
// that still collect money every day out of sight; showing them as ordinary rows
// would give back the duplicate the shop just merged away.

import { useActionState, useState, useTransition } from "react";
import {
  confirmMenuAliasAction,
  getMenuSuggestionsAction,
  updateMenuAction,
  type MenuActionState,
  type MenuAliasActionState,
} from "@/app/menus/actions";
import type { MenuRowView, MenuSuggestionRowView } from "./menu-view";
import {
  mergedSpellingsLabel,
  type MergeMenuView,
} from "./menu-merge-view";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none";
const buttonClass =
  "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50";
const linkClass = "text-xs text-primary hover:underline";

export type CategoryOption = { id: string; name: string };
export type DepartmentOption = { id: string; name: string };

export default function MenuRowEditor({
  menu,
  categories,
  departments,
  departmentsEnabled,
  posIntegrationId,
  spellings = [],
  mergedIntoLabel = null,
}: {
  menu: MenuRowView;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  departmentsEnabled: boolean;
  posIntegrationId: string | null;
  /** The other spellings of this dish, collapsed beneath it (Q6). */
  spellings?: MergeMenuView[];
  /** Set when THIS row is a spelling whose dish is not on screen — under a
   *  filter or a search that excluded it. It is still a live row taking sales,
   *  so it is shown, labelled, rather than nested into nothing. */
  mergedIntoLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [spellingsOpen, setSpellingsOpen] = useState(false);
  const [state, action, saving] = useActionState<MenuActionState | null, FormData>(
    updateMenuAction,
    null
  );
  const [aliasState, aliasAction, aliasSaving] = useActionState<MenuAliasActionState | null, FormData>(
    confirmMenuAliasAction,
    null
  );
  const [suggestions, setSuggestions] = useState<MenuSuggestionRowView[] | null>(null);
  const [looking, startLooking] = useTransition();

  const findSimilar = () => {
    startLooking(async () => {
      const result = await getMenuSuggestionsAction(menu.posMenuName ?? menu.name);
      setSuggestions(result.ok ? result.suggestions : []);
    });
  };

  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-medium">{menu.name}</span>
          {menu.isPosStub && (
            <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs">รอตรวจ</span>
          )}
          {menu.posName && (
            <span className="ml-2 text-xs text-muted-foreground">{menu.posName}</span>
          )}
        </div>
        <div className="flex items-baseline gap-3">
          <a href={`/menus/merges?menu=${menu.id}`} className={linkClass}>
            รวมเมนู
          </a>
          <button type="button" onClick={() => setOpen((v) => !v)} className={linkClass}>
            {open ? "ปิด" : "แก้ไข"}
          </button>
        </div>
      </div>

      {menu.todoLabel && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {menu.todoLabel}
          {menu.consequenceLabel && <span> — {menu.consequenceLabel}</span>}
        </p>
      )}

      {mergedIntoLabel !== null && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          นับรวมเป็น “{mergedIntoLabel}” — รายการนี้ยังรับยอดขายใหม่ตามปกติ
        </p>
      )}

      {spellings.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setSpellingsOpen((v) => !v)}
            className={linkClass}
          >
            {spellingsOpen ? "ซ่อนชื่อที่รวมแล้ว" : mergedSpellingsLabel(spellings.length)}
          </button>
          {spellingsOpen && (
            <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-3">
              {spellings.map((s) => (
                <li key={s.id} className="text-xs text-muted-foreground">
                  {s.label} · {s.originLabel}
                </li>
              ))}
            </ul>
          )}
          {spellingsOpen && (
            <p className="mt-1 pl-3 text-xs text-muted-foreground">
              ชื่อเหล่านี้ยังอยู่ในระบบและยังรับยอดขายใหม่ทุกวัน — แก้หรือยกเลิกการรวมได้ที่{" "}
              <a href="/menus/merges" className="underline">
                หน้ารวมเมนู
              </a>
            </p>
          )}
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-4 rounded-lg border border-border bg-background p-3">
          <form action={action} className="space-y-3">
            <input type="hidden" name="menuId" value={menu.id} />
            <label className="block text-xs">
              ชื่อเมนู
              <input name="name" defaultValue={menu.name} className={`${inputClass} mt-1`} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs">
                หมวดเมนู
                <select
                  name="menuCategoryId"
                  defaultValue={menu.menuCategoryId ?? ""}
                  className={`${inputClass} mt-1`}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {departmentsEnabled && (
                <label className="block text-xs">
                  แผนกที่รับรายได้
                  <select
                    name="primaryDepartmentId"
                    defaultValue={menu.primaryDepartmentId ?? ""}
                    className={`${inputClass} mt-1`}
                  >
                    <option value="">— ไม่ระบุ —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!departmentsEnabled && (
                <input type="hidden" name="primaryDepartmentId" value={menu.primaryDepartmentId ?? ""} />
              )}
            </div>

            {state?.ok === false && (
              <div className="space-y-1 text-xs text-destructive">
                {state.formError && <p>{state.formError}</p>}
                {state.fieldErrors &&
                  Object.entries(state.fieldErrors).map(([k, v]) => <p key={k}>{v}</p>)}
              </div>
            )}
            {state?.ok && <p className="text-xs text-primary">บันทึกแล้ว</p>}

            <button type="submit" disabled={saving} className={buttonClass}>
              {saving ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </form>

          {/* ---------- alias ---------- */}
          {posIntegrationId && menu.posMenuName && (
            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium">ชื่อนี้เป็นเมนูเดิมที่มีอยู่แล้วหรือเปล่า</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                ระบบจะจำว่า “{menu.posMenuName}” หมายถึงเมนูที่เลือก —{" "}
                <strong>มีผลกับไฟล์ที่นำเข้าครั้งถัดไป</strong> ยอดขายที่บันทึกไปแล้วยังอยู่ที่เมนูนี้
              </p>

              {suggestions === null ? (
                <button type="button" onClick={findSimilar} disabled={looking} className={`${linkClass} mt-2`}>
                  {looking ? "กำลังค้นหา…" : "หาเมนูใกล้เคียง"}
                </button>
              ) : suggestions.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">ไม่พบเมนูใกล้เคียง</p>
              ) : (
                <form action={aliasAction} className="mt-2 space-y-2">
                  <input type="hidden" name="posIntegrationId" value={posIntegrationId} />
                  <input type="hidden" name="rawName" value={menu.posMenuName} />
                  <select name="menuId" className={inputClass} defaultValue="">
                    <option value="" disabled>
                      — เลือกเมนูที่ใช่ —
                    </option>
                    {suggestions
                      .filter((s) => s.id !== menu.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} · {s.badge}
                        </option>
                      ))}
                  </select>
                  {aliasState?.ok === false && (
                    <p className="text-xs text-destructive">
                      {aliasState.formError ??
                        Object.values(aliasState.fieldErrors ?? {})[0] ??
                        "จับคู่ไม่สำเร็จ"}
                    </p>
                  )}
                  {aliasState?.ok && <p className="text-xs text-primary">จำไว้แล้ว</p>}
                  <button type="submit" disabled={aliasSaving} className={buttonClass}>
                    {aliasSaving ? "กำลังบันทึก…" : "จำชื่อนี้ไว้"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

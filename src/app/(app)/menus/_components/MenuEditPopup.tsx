"use client";

// One dish, opened from its row on /menus (UI run-through 2026-10-02).
//
// This was MenuRowEditor: the same controls lived inline under a row, behind
// three small links on EVERY row ("รวมเมนู · เลิกขาย · แก้ไข"). The rules the
// row was built on are unchanged — only the frame moved into a popup, so the
// list reads as a list and the whole row opens the dish (mise-ui-review §1, §4).
//
// Carried over unchanged, and why each one matters:
//   - Sprint 4 Part 19: saving name / category / department clears the รอตรวจ
//     flag, because somebody has now looked at it.
//   - Merging is NOT done here (ADR 0026): "จับคู่ชื่อ" creates an ALIAS that
//     applies from the next import onward and touches no history. Merging is its
//     own screen because it is its own decision.
//   - ADR 0027: เลิกขาย and ลบ are not two grades of one act. เลิกขาย is always
//     offered and reversible; ลบ goes to the server, which refuses where deleting
//     would break something and names what is in the way. A menu carrying its
//     own recipe is refused ONCE with the count, and only then can it be
//     confirmed — now as a second press inside the popup instead of the
//     browser's own confirm() box.
//   - ADR 0026 Q6: the spellings folded into this dish are listed, not editable.
//
// Permissions: the list is readable by any member; changing a dish needs
// master:write (name, category, alias, เลิกขาย) and deleting needs recipe:write,
// exactly as the actions check. Somebody without them gets the facts and no
// buttons that would only be refused.

import { useActionState, useState, useTransition } from "react";
import {
  confirmMenuAliasAction,
  getMenuSuggestionsAction,
  updateMenuAction,
  type MenuActionState,
  type MenuAliasActionState,
} from "@/app/(app)/menus/actions";
import {
  deleteMenuAction,
  setMenuActiveAction,
  type MenuLifecycleActionState,
} from "@/app/(app)/menus/lifecycle-actions";
import { RETIRE_MEANS_TH, RETIRE_NOT_IN_POS_TH } from "@/lib/validations/menu-lifecycle";
import type { MenuRowView, MenuSuggestionRowView } from "./menu-view";
import { orStale } from "@/lib/stale-tab";
import type { MergeMenuView } from "./menu-merge-view";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";

export type CategoryOption = { id: string; name: string };
export type DepartmentOption = { id: string; name: string };

/** What the list knows about a dish beyond its row (menu-list-facts.ts). */
export type MenuFactView = {
  qty: number;
  net: number;
  recipeId: string | null;
  hasDraft: boolean;
};

const baht = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;

export default function MenuEditPopup({
  menu,
  fact,
  factDays,
  categories,
  departments,
  departmentsEnabled,
  posIntegrationId,
  spellings,
  mergedIntoLabel,
  canEdit,
  canDelete,
  canRecipe,
  onClose,
}: {
  menu: MenuRowView;
  fact: MenuFactView | null;
  factDays: number;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  departmentsEnabled: boolean;
  posIntegrationId: string | null;
  spellings: MergeMenuView[];
  mergedIntoLabel: string | null;
  canEdit: boolean;
  canDelete: boolean;
  canRecipe: boolean;
  onClose: () => void;
}) {
  const [state, action, saving] = useActionState<MenuActionState | null, FormData>(updateMenuAction, null);
  const [aliasState, aliasAction, aliasSaving] = useActionState<MenuAliasActionState | null, FormData>(
    confirmMenuAliasAction,
    null
  );
  const [suggestions, setSuggestions] = useState<MenuSuggestionRowView[] | null>(null);
  const [looking, startLooking] = useTransition();

  const [lifecycle, setLifecycle] = useState<MenuLifecycleActionState | null>(null);
  const [busy, startLifecycle] = useTransition();
  /** First press on ลบ only asks; the second one sends. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** Armed only by a refusal that has already named the recipe (ADR 0027 Q4). */
  const [recipeCount, setRecipeCount] = useState<number | null>(null);
  const armed = recipeCount !== null;

  const toggleActive = () => {
    setLifecycle(null);
    startLifecycle(async () => {
      setLifecycle(await orStale(setMenuActiveAction(menu.id, menu.isRetired)));
    });
  };

  const remove = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setLifecycle(null);
    startLifecycle(async () => {
      const res = await orStale(deleteMenuAction(menu.id, armed));
      setLifecycle(res);
      if (res.ok) {
        onClose();
        return;
      }
      if (res.needsAcknowledgement) setRecipeCount(res.needsAcknowledgement.recipeCount);
      else setConfirmingDelete(false);
    });
  };

  const findSimilar = () => {
    startLooking(async () => {
      const result = await orStale(getMenuSuggestionsAction(menu.posMenuName ?? menu.name));
      setSuggestions(result.ok ? result.suggestions : []);
    });
  };

  const avgPrice = fact && fact.qty > 0 ? fact.net / fact.qty : null;

  return (
    <ModalShell narrow onClose={onClose} labelledBy="menu-popup-title">
      <div className="space-y-5">
        <div className="pr-10">
          <div>
            <h3 id="menu-popup-title" className="text-lg font-semibold">
              {menu.name}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[menu.menuCategoryName ?? "ไม่มีหมวด", menu.posName].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {menu.isPosStub && <span className="badge whitespace-nowrap">รอตรวจ</span>}
              {menu.isRetired && <span className="badge whitespace-nowrap">เลิกขายแล้ว</span>}
            </div>
          </div>
        </div>

        {/* ---------- the facts ---------- */}
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-sunk p-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">ขายได้ {factDays} วัน</p>
            <p className="tabular-nums font-medium">{fact && fact.qty > 0 ? `${fact.qty.toLocaleString("th-TH")} จาน` : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">ราคาขายเฉลี่ย</p>
            <p className="tabular-nums font-medium">{avgPrice === null ? "—" : baht(avgPrice)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">สูตร</p>
            {fact?.recipeId ? (
              <a href={`/recipes/${fact.recipeId}`} className="font-medium text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid">
                ดูสูตร
              </a>
            ) : canRecipe && !menu.isRetired ? (
              <a href={`/recipes/new?menu=${menu.id}`} className="font-medium text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid">
                เขียนสูตร
              </a>
            ) : (
              <p className="font-medium">ยังไม่มี</p>
            )}
            {fact?.hasDraft ? <p className="text-xs text-muted-foreground">มีร่างใน “ทดลองเมนู”</p> : null}
          </div>
        </div>
        {menu.todoLabel && (
          <p className="text-sm text-warn">
            {menu.todoLabel}
            {menu.consequenceLabel && <span> — {menu.consequenceLabel}</span>}
          </p>
        )}
        {menu.lastSoldLabel !== null && (
          // ADR 0027 Q3: a FACT, not an inference — if this date is recent, the
          // POS never got the message, and the reader draws that conclusion.
          <p className="text-sm text-muted-foreground">{menu.lastSoldLabel}</p>
        )}
        {mergedIntoLabel !== null && (
          <p className="text-sm text-muted-foreground">
            นับรวมเป็น “{mergedIntoLabel}” — รายการนี้ยังรับยอดขายใหม่ตามปกติ
          </p>
        )}

        {spellings.length > 0 && (
          <div>
            <p className="text-sm font-medium">ชื่ออื่นที่รวมเข้ากับเมนูนี้แล้ว</p>
            <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-3">
              {spellings.map((s) => (
                <li key={s.id} className="text-sm text-muted-foreground">
                  {s.label} · {s.originLabel}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              ชื่อเหล่านี้ยังรับยอดขายใหม่ทุกวัน — แก้หรือยกเลิกการรวมได้ที่{" "}
              <a href="/menus/merges" className="underline">
                หน้ารวมเมนู
              </a>
            </p>
          </div>
        )}

        {/* ---------- edit ---------- */}
        {canEdit && (
          <form action={action} className="space-y-3 border-t border-border pt-4">
            <input type="hidden" name="menuId" value={menu.id} />
            <label className="block text-sm">
              ชื่อเมนู
              <input name="name" defaultValue={menu.name} className="input mt-1 w-full" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                หมวดเมนู
                <select name="menuCategoryId" defaultValue={menu.menuCategoryId ?? ""} className="input mt-1 w-full">
                  <option value="">— ไม่ระบุ —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {departmentsEnabled ? (
                <label className="block text-sm">
                  แผนกที่รับรายได้
                  <select
                    name="primaryDepartmentId"
                    defaultValue={menu.primaryDepartmentId ?? ""}
                    className="input mt-1 w-full"
                  >
                    <option value="">— ไม่ระบุ —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="primaryDepartmentId" value={menu.primaryDepartmentId ?? ""} />
              )}
            </div>
            {state?.ok === false && (
              <div className="space-y-1 text-sm text-bad">
                {state.formError && <p>{state.formError}</p>}
                {state.fieldErrors && Object.entries(state.fieldErrors).map(([k, v]) => <p key={k}>{v}</p>)}
              </div>
            )}
            {state?.ok && <p className="text-sm text-good">บันทึกแล้ว</p>}
            <button type="submit" disabled={saving} className="btn">
              {saving ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </form>
        )}

        {/* ---------- alias (ADR 0019 Q8) ---------- */}
        {canEdit && posIntegrationId && menu.posMenuName && (
          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium">ชื่อนี้เป็นเมนูเดิมที่มีอยู่แล้วหรือเปล่า</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ระบบจะจำว่า “{menu.posMenuName}” หมายถึงเมนูที่เลือก —{" "}
              <strong>มีผลกับไฟล์ที่นำเข้าครั้งถัดไป</strong> ยอดขายที่บันทึกไปแล้วยังอยู่ที่เมนูนี้
            </p>
            {suggestions === null ? (
              <button type="button" onClick={findSimilar} disabled={looking} className="mt-2 text-sm text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid">
                {looking ? "กำลังค้นหา…" : "หาเมนูใกล้เคียง"}
              </button>
            ) : suggestions.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">ไม่พบเมนูใกล้เคียง</p>
            ) : (
              <form action={aliasAction} className="mt-2 space-y-2">
                <input type="hidden" name="posIntegrationId" value={posIntegrationId} />
                <input type="hidden" name="rawName" value={menu.posMenuName} />
                <select name="menuId" className="input w-full" defaultValue="">
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
                  <p className="text-sm text-bad">
                    {aliasState.formError ?? Object.values(aliasState.fieldErrors ?? {})[0] ?? "จับคู่ไม่สำเร็จ"}
                  </p>
                )}
                {aliasState?.ok && <p className="text-sm text-good">จำไว้แล้ว</p>}
                <button type="submit" disabled={aliasSaving} className="btn">
                  {aliasSaving ? "กำลังบันทึก…" : "จำชื่อนี้ไว้"}
                </button>
              </form>
            )}
          </div>
        )}

        {/* ---------- what happens to the dish ---------- */}
        {(canEdit || canDelete) && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <a href={`/menus/merges?menu=${menu.id}`} className="rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-muted">
                  รวมกับเมนูอื่น
                </a>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={toggleActive}
                  disabled={busy}
                  className="rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {menu.isRetired ? "กลับมาขาย" : "เลิกขาย"}
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="rounded-lg border border-bad-border px-3 py-1.5 text-sm text-bad hover:bg-bad-bg disabled:opacity-50"
                >
                  {!confirmingDelete ? "ลบเมนู" : armed ? `ยืนยันลบ พร้อมสูตร ${recipeCount} รายการ` : "ยืนยันลบเมนู"}
                </button>
              )}
              {confirmingDelete && !busy && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setRecipeCount(null);
                  }}
                  className="px-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  ยกเลิก
                </button>
              )}
            </div>
            {/* Said up front, because the honest answer to "can I delete this?"
                is usually no — and เลิกขาย is what the person actually wants. */}
            <p className="text-xs text-muted-foreground">
              {RETIRE_MEANS_TH} · {RETIRE_NOT_IN_POS_TH}
            </p>
            {confirmingDelete && (
              <p className="text-sm text-bad">
                {armed
                  ? `เมนูนี้มีสูตรของตัวเอง ${recipeCount} รายการ ซึ่งจะถูกลบไปด้วย — กดยืนยันอีกครั้งถ้าต้องการลบจริง`
                  : `ลบ “${menu.name}” ออกจากระบบ? กดยืนยันอีกครั้ง`}
              </p>
            )}
            {lifecycle !== null && !lifecycle.ok && <p className="text-sm text-bad">{lifecycle.error}</p>}
            {lifecycle?.ok && <p className="text-sm text-good">{menu.isRetired ? "เลิกขายแล้ว" : "กลับมาขายแล้ว"}</p>}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

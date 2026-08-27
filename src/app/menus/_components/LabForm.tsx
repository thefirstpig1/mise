"use client";

// Sprint 5 Part 24 L5b — Menu Lab: the one screen where nothing has happened yet.
//
// Every other number in Mise comes from something that already happened. Here a
// person is asking about a dish nobody has cooked, so the screen is arranged
// around four things:
//
//  1. **THE COST IS LIVE, AND IT IS THE SAME COST.** Every edit re-asks the
//     server, debounced, with `new FormData(form)` — the very rows Save would
//     write. The figure comes back from the engine that prices every saved
//     recipe (L3d splices a virtual root into the real graph), so the lab and
//     the recipe page cannot drift. The arithmetic is never done in the browser:
//     a Decimal cannot cross the boundary (Pitfall #20) and a ratio recomputed
//     from a rounded string is a second answer waiting to disagree.
//  2. **ราคาที่ตั้งใจ, NEVER ราคา** (Q2). It is what somebody was considering
//     while designing. If the dish already sells, the screen says so and the
//     sold price is THE price — this one only sits beside it.
//  3. **THE BRANCH IS NAMED, ALWAYS.** Cost needs a branch (ADR 0014 Q9). When
//     nobody picks one the server picks the branch with the freshest purchases
//     and says which — a two-branch shop buying pork at two prices has two right
//     answers, and the screen must not hide which one it is showing.
//  4. EVERY ROW POSTS ALL FIVE INPUTS, including the empty one — the action
//     reads parallel arrays, so a menu row omitting the product input would
//     shift every row below it by one. Same rule as RecipeForm.

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftActionState } from "@/app/menus/lab/actions";
import { getLabWhatIfAction } from "@/app/menus/lab/actions";
import {
  findDeletedMenuByNameAction,
  restoreMenuAction,
} from "@/app/menus/lifecycle-actions";
import { RESTORE_OFFER_TH } from "@/lib/validations/menu-lifecycle";
import type {
  DraftView,
  LabWhatIfView,
} from "@/app/menus/_components/menu-lab-view";
import RecipeCostPanel from "@/app/recipes/_components/RecipeCostPanel";
import { MAX_INGREDIENTS } from "@/lib/validations/recipe";
import {
  PLANNED_PRICE_HINT_TH,
  PLANNED_PRICE_LABEL_TH,
  PLANNED_PRICE_VS_SOLD_HINT_TH,
} from "@/lib/validations/menu-lab";

export type LabProductOption = {
  id: string;
  name: string;
  units: { id: string; unitName: string; isBase: boolean }[];
};

export type LabMenuOption = { id: string; name: string; hasRecipe: boolean };
export type LabCategoryOption = { id: string; name: string };
export type LabBranchOption = { id: string; name: string };

type LineDraft = {
  key: number;
  kind: "product" | "menu";
  productId: string;
  componentMenuId: string;
  qty: string;
  productUnitId: string;
  notes: string;
};

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "block text-sm font-medium";

/** How long after the last keystroke the server is asked what this costs. */
const WHATIF_DEBOUNCE_MS = 600;

function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let nextKey = 1;
const blankLine = (): LineDraft => ({
  key: nextKey++,
  kind: "product",
  productId: "",
  componentMenuId: "",
  qty: "",
  productUnitId: "",
  notes: "",
});

export default function LabForm({
  action,
  mode,
  products,
  menus,
  categories,
  branches,
  initial,
  initialMenuName,
  initialMenuHasSales,
}: {
  action: (prev: DraftActionState, fd: FormData) => Promise<DraftActionState>;
  mode: "create" | "edit";
  products: LabProductOption[];
  menus: LabMenuOption[];
  categories: LabCategoryOption[];
  branches: LabBranchOption[];
  initial: DraftView | null;
  /** Edit mode: the dish this draft is about. The target cannot move. */
  initialMenuName: string | null;
  /** Q2: the dish sells, so ราคาที่ตั้งใจ is a comparison, not the price. */
  initialMenuHasSales: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as DraftActionState);

  const [submitKey, setSubmitKey] = useState(newSubmitKey);
  // Which half of Q3 this is: a dish that exists, or one that does not.
  const [targetKind, setTargetKind] = useState<"existing" | "new">(
    initial === null ? "new" : "existing"
  );
  const [menuId, setMenuId] = useState(initial?.menuId ?? "");
  const [newMenuName, setNewMenuName] = useState("");

  // ADR 0027 Q6/Q7 — the restore door, and the ONLY one. Typing the name of a
  // dish that was deleted offers it back with the recipe that died alongside
  // it, rather than making somebody rebuild twenty ingredient lines.
  //
  // The import never offers this: Part 19's rule is that money lands in full
  // immediately and a file never stops to ask a question.
  const [restorable, setRestorable] = useState<
    { id: string; name: string; recipeCount: number } | null
  >(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    const name = newMenuName.trim();
    if (targetKind !== "new" || name === "") {
      setRestorable(null);
      return;
    }
    // Debounced, because this fires as somebody types a dish name. Exact match
    // only — a trigram score may SUGGEST (ADR 0019 Q7) and this arms a button
    // that brings a recipe back, so it has to be the dish.
    let live = true;
    const t = setTimeout(async () => {
      const res = await findDeletedMenuByNameAction(name);
      if (live) setRestorable(res.ok ? res.found : null);
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [newMenuName, targetKind]);
  const [menuCategoryId, setMenuCategoryId] = useState("");
  const [servings, setServings] = useState(initial?.servings ?? "1");
  const [plannedPrice, setPlannedPrice] = useState(initial?.plannedPrice ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [branchId, setBranchId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    initial === null || initial.ingredients.length === 0
      ? [blankLine()]
      : initial.ingredients.map((i) => ({
          key: nextKey++,
          kind: i.componentMenuId !== null ? ("menu" as const) : ("product" as const),
          productId: i.productId ?? "",
          componentMenuId: i.componentMenuId ?? "",
          qty: i.qty,
          productUnitId: i.productUnitId ?? "",
          notes: i.notes ?? "",
        }))
  );

  const [whatIf, setWhatIf] = useState<LabWhatIfView | null>(null);
  const [whatIfError, setWhatIfError] = useState<string | null>(null);
  const [costing, setCosting] = useState(false);

  const succeeded = state.ok === true;
  const [handled, setHandled] = useState<string | null>(null);
  if (succeeded && state.ok && handled !== state.draft.id) {
    setHandled(state.draft.id);
    setSubmitKey(newSubmitKey());
    if (mode === "create") router.push(`/menus/lab/${state.draft.id}`);
  }

  const fieldErrors = state.ok ? undefined : state.fieldErrors;
  const formError = state.ok ? undefined : state.formError;

  const unitsOf = useMemo(() => {
    const map = new Map<string, LabProductOption["units"]>();
    for (const p of products) map.set(p.id, p.units);
    return map;
  }, [products]);

  const setLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // --- the live cost ------------------------------------------------------
  // Keyed on everything the price depends on. `lines` is stringified rather
  // than watched by reference, or every re-render would re-ask the database.
  const costKey = JSON.stringify({
    branchId,
    servings,
    plannedPrice,
    lines: lines.map((l) => [l.kind, l.productId, l.componentMenuId, l.qty, l.productUnitId]),
  });

  useEffect(() => {
    const form = formRef.current;
    if (form === null) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCosting(true);
      const result = await getLabWhatIfAction(new FormData(form));
      if (cancelled) return;
      setCosting(false);
      if (result.ok) {
        setWhatIf(result.whatIf);
        setWhatIfError(null);
      } else {
        // A half-typed row is not an error worth shouting about — the panel
        // keeps the last good figure and says it is stale. A refusal the
        // SERVER made (no branch at all, for instance) is shown in full.
        setWhatIfError(
          result.formError ??
            "ยังคิดต้นทุนไม่ได้ — กรอกวัตถุดิบและจำนวนให้ครบก่อน"
        );
      }
    }, WHATIF_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [costKey]);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <form
        ref={formRef}
        id="lab-form"
        action={formAction}
        className="space-y-6 lg:col-span-3"
      >
        <input type="hidden" name="submit_key" value={submitKey} />

        {/* Q3: an existing dish, or one that does not exist yet. Saving the
            second kind creates a MISE menu — never a recipe with no target. */}
        {mode === "edit" ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">กำลังร่างสูตรของ</p>
            <p className="text-lg font-semibold">{initialMenuName}</p>
            <input type="hidden" name="menu_id" value={menuId} />
            <p className="mt-1 text-xs text-muted-foreground">
              ร่างนี้ผูกกับเมนูนี้ตลอด — ถ้าคิดถึงเมนูอื่น ให้เริ่มร่างใหม่
            </p>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={targetKind === "new"}
                  onChange={() => setTargetKind("new")}
                />
                เมนูใหม่ที่ยังไม่มีในร้าน
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={targetKind === "existing"}
                  onChange={() => setTargetKind("existing")}
                />
                เมนูที่ขายอยู่แล้ว
              </label>
            </div>

            {targetKind === "new" ? (
              <>
                <input type="hidden" name="menu_id" value="" />
                <div>
                  <label className={labelClass} htmlFor="new_menu_name">
                    ชื่อเมนูใหม่
                  </label>
                  <input
                    id="new_menu_name"
                    name="new_menu_name"
                    value={newMenuName}
                    onChange={(e) => setNewMenuName(e.target.value)}
                    placeholder="เช่น ข้าวผัดปูไข่เค็ม"
                    className={`${inputClass} mt-1`}
                  />
                  {fieldErrors?.newMenuName ? (
                    <p className="mt-1 text-xs text-red-600">
                      {fieldErrors.newMenuName}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    บันทึกแล้วระบบจะสร้างเมนูนี้ให้ — ยังไม่มีการขายและไม่กระทบสต๊อก
                    จนกว่าจะเผยแพร่สูตร
                  </p>
                  {restorable !== null ? (
                    <div className="mt-2 rounded-lg border border-border bg-card p-2">
                      <p className="text-xs">
                        {RESTORE_OFFER_TH}
                        {restorable.recipeCount > 0
                          ? ` (สูตร ${restorable.recipeCount} รายการ)`
                          : " (ไม่มีสูตรติดมาด้วย)"}
                      </p>
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={async () => {
                          setRestoring(true);
                          setRestoreError(null);
                          const res = await restoreMenuAction(restorable.id);
                          setRestoring(false);
                          if (res.ok) {
                            // The dish exists again, so this is no longer the
                            // "create one" half of Q3 — switch the form to it,
                            // rather than leaving a name that would make a
                            // second menu for the same food.
                            setTargetKind("existing");
                            setMenuId(res.menuId);
                            setNewMenuName("");
                            setRestorable(null);
                          } else {
                            setRestoreError(res.error);
                          }
                        }}
                        className="mt-1 rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {restoring ? "กำลังกู้คืน…" : "กู้คืนเมนูเดิม"}
                      </button>
                      {restoreError !== null ? (
                        <p className="mt-1 text-xs text-red-600">{restoreError}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className={labelClass} htmlFor="menu_category_id">
                    หมวด (ไม่บังคับ)
                  </label>
                  <select
                    id="menu_category_id"
                    name="menu_category_id"
                    value={menuCategoryId}
                    onChange={(e) => setMenuCategoryId(e.target.value)}
                    className={`${inputClass} mt-1`}
                  >
                    <option value="">— ไม่ระบุ —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors?.menuCategoryId ? (
                    <p className="mt-1 text-xs text-red-600">
                      {fieldErrors.menuCategoryId}
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <input type="hidden" name="new_menu_name" value="" />
                <input type="hidden" name="menu_category_id" value="" />
                <div>
                  <label className={labelClass} htmlFor="menu_id">
                    เมนู
                  </label>
                  <select
                    id="menu_id"
                    name="menu_id"
                    value={menuId}
                    onChange={(e) => setMenuId(e.target.value)}
                    className={`${inputClass} mt-1`}
                  >
                    <option value="">— เลือกเมนู —</option>
                    {menus.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.hasRecipe ? " · มีสูตรอยู่แล้ว" : ""}
                      </option>
                    ))}
                  </select>
                  {fieldErrors?.menuId ? (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.menuId}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    เมนูที่มีสูตรอยู่แล้วก็ร่างได้ — สูตรเดิมยังใช้งานตามปกติ
                    จนกว่าจะกดเผยแพร่
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {formError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {formError}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="servings">
              สูตรนี้ทำได้กี่จาน
            </label>
            <input
              id="servings"
              name="servings"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              inputMode="decimal"
              className={`${inputClass} mt-1`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              ใส่ตามที่ทำจริง — ผัดทีละ 4 จานก็ใส่ 4 ระบบจะหารให้เอง
            </p>
            {fieldErrors?.servings ? (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.servings}</p>
            ) : null}
          </div>

          <div>
            <label className={labelClass} htmlFor="planned_price">
              {PLANNED_PRICE_LABEL_TH}
            </label>
            <input
              id="planned_price"
              name="planned_price"
              value={plannedPrice}
              onChange={(e) => setPlannedPrice(e.target.value)}
              inputMode="decimal"
              placeholder="เช่น 189"
              className={`${inputClass} mt-1`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {initialMenuHasSales
                ? PLANNED_PRICE_VS_SOLD_HINT_TH
                : PLANNED_PRICE_HINT_TH}
            </p>
            {fieldErrors?.plannedPrice ? (
              <p className="mt-1 text-xs text-red-600">
                {fieldErrors.plannedPrice}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">วัตถุดิบ</h3>
            <span className="text-xs text-muted-foreground">
              {lines.length}/{MAX_INGREDIENTS} บรรทัด
            </span>
          </div>

          {fieldErrors?.ingredients ? (
            <p className="text-xs text-red-600">{fieldErrors.ingredients}</p>
          ) : null}

          <div className="space-y-3">
            {lines.map((line, i) => {
              const units = unitsOf.get(line.productId) ?? [];
              const rowError =
                fieldErrors?.[`ingredients.${i}.productId`] ??
                fieldErrors?.[`ingredients.${i}.componentMenuId`] ??
                fieldErrors?.[`ingredients.${i}.qty`] ??
                fieldErrors?.[`ingredients.${i}.productUnitId`];
              return (
                <div
                  key={line.key}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="grid gap-2 sm:grid-cols-12">
                    <select
                      value={line.kind}
                      onChange={(e) =>
                        setLine(line.key, {
                          kind: e.target.value === "menu" ? "menu" : "product",
                          productId: "",
                          componentMenuId: "",
                          productUnitId: "",
                        })
                      }
                      className={`${inputClass} sm:col-span-2`}
                      aria-label="ชนิดของส่วนประกอบ"
                    >
                      <option value="product">วัตถุดิบ</option>
                      <option value="menu">เมนู</option>
                    </select>

                    {/* Both inputs are ALWAYS posted — see note 4 in the header. */}
                    {line.kind === "product" ? (
                      <>
                        <select
                          name="ingredient_product_id"
                          value={line.productId}
                          onChange={(e) =>
                            setLine(line.key, {
                              productId: e.target.value,
                              productUnitId:
                                unitsOf.get(e.target.value)?.[0]?.id ?? "",
                            })
                          }
                          className={`${inputClass} sm:col-span-4`}
                          aria-label="วัตถุดิบ"
                        >
                          <option value="">— เลือกวัตถุดิบ —</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="hidden"
                          name="ingredient_component_menu_id"
                          value=""
                        />
                      </>
                    ) : (
                      <>
                        <input
                          type="hidden"
                          name="ingredient_product_id"
                          value=""
                        />
                        <select
                          name="ingredient_component_menu_id"
                          value={line.componentMenuId}
                          onChange={(e) =>
                            setLine(line.key, { componentMenuId: e.target.value })
                          }
                          className={`${inputClass} sm:col-span-4`}
                          aria-label="เมนูที่เป็นส่วนประกอบ"
                        >
                          <option value="">— เลือกเมนู —</option>
                          {menus
                            .filter((m) => m.id !== menuId)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                        </select>
                      </>
                    )}

                    <input
                      name="ingredient_qty"
                      value={line.qty}
                      onChange={(e) => setLine(line.key, { qty: e.target.value })}
                      inputMode="decimal"
                      placeholder="จำนวน"
                      className={`${inputClass} sm:col-span-2`}
                      aria-label="จำนวน"
                    />

                    {line.kind === "product" ? (
                      <select
                        name="ingredient_product_unit_id"
                        value={line.productUnitId}
                        onChange={(e) =>
                          setLine(line.key, { productUnitId: e.target.value })
                        }
                        className={`${inputClass} sm:col-span-2`}
                        aria-label="หน่วย"
                      >
                        <option value="">— หน่วย —</option>
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.unitName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        {/* A component menu counts DISHES, not a weight. */}
                        <input
                          type="hidden"
                          name="ingredient_product_unit_id"
                          value=""
                        />
                        <span className="self-center text-xs text-muted-foreground sm:col-span-2">
                          จาน
                        </span>
                      </>
                    )}

                    <div className="flex items-center justify-end sm:col-span-2">
                      <button
                        type="button"
                        onClick={() =>
                          setLines((prev) =>
                            prev.length === 1
                              ? [blankLine()]
                              : prev.filter((l) => l.key !== line.key)
                          )
                        }
                        className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                      >
                        ลบ
                      </button>
                    </div>
                  </div>

                  <input
                    name="ingredient_notes"
                    value={line.notes}
                    onChange={(e) => setLine(line.key, { notes: e.target.value })}
                    placeholder="หมายเหตุของบรรทัดนี้ (ไม่บังคับ)"
                    className={`${inputClass} mt-2`}
                    aria-label="หมายเหตุของวัตถุดิบ"
                  />

                  {rowError ? (
                    <p className="mt-1 text-xs text-red-600">{rowError}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={lines.length >= MAX_INGREDIENTS}
            onClick={() => setLines((prev) => [...prev, blankLine()])}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            + เพิ่มวัตถุดิบ
          </button>
        </div>

        <div>
          <label className={labelClass} htmlFor="notes">
            หมายเหตุ
          </label>
          <input
            id="notes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="เช่น ลองลดกะทิลง แล้วเพิ่มพริกแกง"
            className={`${inputClass} mt-1`}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isPending
              ? "กำลังบันทึก…"
              : mode === "create"
                ? "บันทึกร่าง"
                : "บันทึกการแก้ไข"}
          </button>
          {succeeded && mode === "edit" ? (
            <span className="text-sm text-emerald-700">บันทึกแล้ว</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            ร่างยังไม่ตัดสต๊อกและยังไม่คิดต้นทุนขายจนกว่าจะกดเผยแพร่
          </span>
        </div>
      </form>

      {/* The answer to the question the screen exists for. */}
      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <label className={labelClass} htmlFor="branch_id">
            คิดต้นทุนที่สาขา
          </label>
          <select
            id="branch_id"
            name="branch_id"
            // Outside the <form> on screen, INSIDE it as far as the browser is
            // concerned: `new FormData(form)` collects elements associated by
            // this attribute, so the branch travels with the rows it prices.
            form="lab-form"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className={`${inputClass} mt-1`}
          >
            <option value="">— สาขาที่ข้อมูลใหม่ที่สุด —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {/* ADR 0014 Q9: the figure is always ABOUT a branch. When the server
              chose it, the screen says so rather than letting the number look
              like it belongs to the whole shop. */}
          {whatIf !== null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {whatIf.branchWasDefaulted
                ? `กำลังคิดจากราคาซื้อของสาขา ${whatIf.branchName} (ข้อมูลใหม่ที่สุด) — สาขาอื่นซื้อของคนละราคาก็ได้ตัวเลขคนละตัว`
                : `กำลังคิดจากราคาซื้อของสาขา ${whatIf.branchName}`}
            </p>
          ) : null}
        </div>

        {whatIf !== null && whatIf.plannedPrice !== null ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">
              ถ้าขายจานละ {whatIf.plannedPrice} บาท
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums">
              {whatIf.foodCostPercent}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                % ต้นทุนวัตถุดิบ
              </span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              เหลือกำไรขั้นต้นจานละ{" "}
              <strong className="tabular-nums">
                {whatIf.grossProfitPerServing}
              </strong>{" "}
              บาท
            </p>
            {/* The caveat travels with the number, never under a fold: a 22%
                food cost over half-unpriced ingredients is not a 22% food cost. */}
            <p className="mt-3 text-xs text-muted-foreground">
              ตัวเลขนี้เชื่อถือได้ระดับ{" "}
              <strong>{whatIf.cost.confidenceLabel}</strong> —{" "}
              {whatIf.cost.confidenceHint}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            ใส่ {PLANNED_PRICE_LABEL_TH} เพื่อดูว่าเหลือกำไรเท่าไร
          </div>
        )}

        {whatIfError !== null ? (
          <p className="text-xs text-amber-700">{whatIfError}</p>
        ) : null}
        {costing ? (
          <p className="text-xs text-muted-foreground">กำลังคิดต้นทุน…</p>
        ) : null}

        {whatIf !== null ? (
          <RecipeCostPanel
            cost={whatIf.cost}
            branchName={whatIf.branchName}
            asOfLabel={whatIf.asOfLabel}
            isPreppedOutput={false}
          />
        ) : null}
      </div>
    </div>
  );
}

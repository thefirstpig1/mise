"use client";

// Sprint 5 Part 21 L5c — write down what a dish is made of (ADR 0021).
//
// What shapes this screen is that saving it MOVES NO STOCK and yet decides every
// consumption figure Part 22 will post. Nothing here is urgent and everything
// here is load-bearing later, so the form is arranged to make the quiet things
// visible:
//
//  1. `submit_key` is minted HERE and becomes the recipe row's id (Part 13.5).
//     It rotates after a successful CREATE — the next dish is its own document —
//     and after a successful EDIT, because a held key would make the second edit
//     of the afternoon read as a replay and silently write nothing.
//  2. **`effectiveFrom` is not asked for.** Saving stamps today (Q4). The field
//     appears only behind "แก้ย้อนหลัง", because a date box on every save invites
//     a date on every save, and rule R8 says the date belongs where it changes an
//     answer.
//  3. EVERY ROW POSTS ALL FIVE INPUTS, including the empty one. The action reads
//     `getAll("ingredient_product_id")` and `getAll("ingredient_component_menu_id")`
//     as parallel arrays; a menu row that omitted the product input would shift
//     every row below it by one.
//  4. A recipe makes ONE thing for its whole life. The target is shown, never
//     edited — `RecipeTargetImmutableError` says the same from the server, and a
//     picker that offers a change the server refuses is a lie on screen.

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RecipeActionState } from "@/app/recipes/actions";
import type { RecipeView } from "@/app/recipes/_components/recipe-view";
import { MAX_INGREDIENTS } from "@/lib/validations/recipe";
import { MAX_BACKDATE_DAYS } from "@/lib/validations/stock-movement";

export type RecipeProductOption = {
  id: string;
  name: string;
  units: { id: string; unitName: string; isBase: boolean }[];
};

export type RecipeMenuOption = { id: string; name: string };

export type RecipeTargetInfo = {
  kind: "menu" | "product";
  id: string;
  name: string;
};

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

/** A fresh `submit_key` — the id the server will give the `recipe` row. */
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

export default function RecipeForm({
  action,
  mode,
  target,
  products,
  menus,
  initial,
  todayBangkok,
}: {
  action: (
    prev: RecipeActionState,
    fd: FormData
  ) => Promise<RecipeActionState>;
  mode: "create" | "edit";
  target: RecipeTargetInfo;
  products: RecipeProductOption[];
  /** Component menus — a set menu is an ordinary recipe one level up (Q3). */
  menus: RecipeMenuOption[];
  initial: RecipeView | null;
  todayBangkok: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as RecipeActionState);

  const [submitKey, setSubmitKey] = useState(newSubmitKey);
  const [servings, setServings] = useState(initial?.servings ?? "1");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [backdating, setBackdating] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(todayBangkok);
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

  // A create that succeeded has somewhere to go; an edit is already there.
  const succeeded = state.ok === true;
  const [handled, setHandled] = useState<string | null>(null);
  if (succeeded && state.ok && handled !== state.recipe.id) {
    setHandled(state.recipe.id);
    setSubmitKey(newSubmitKey());
    if (mode === "create") router.push(`/recipes/${state.recipe.id}`);
  }

  const fieldErrors = state.ok ? undefined : state.fieldErrors;
  const formError = state.ok ? undefined : state.formError;

  const unitsOf = useMemo(() => {
    const map = new Map<string, RecipeProductOption["units"]>();
    for (const p of products) map.set(p.id, p.units);
    return map;
  }, [products]);

  const setLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l))
    );

  const minEffectiveFrom = (() => {
    const d = new Date(`${todayBangkok}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - MAX_BACKDATE_DAYS);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="submit_key" value={submitKey} />
      {target.kind === "menu" ? (
        <input type="hidden" name="menu_id" value={target.id} />
      ) : (
        <input type="hidden" name="output_product_id" value={target.id} />
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs text-muted-foreground">
          {target.kind === "menu" ? "สูตรของเมนู" : "สูตรผลิตของแปรรูป"}
        </p>
        <p className="text-lg font-semibold">{target.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          หนึ่งสูตรทำได้อย่างเดียวตลอดอายุของมัน — ถ้าต้องการสูตรของอีกรายการ
          ให้สร้างสูตรใหม่
        </p>
      </div>

      {formError ? (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {formError}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="servings">
            {target.kind === "menu" ? "สูตรนี้ทำได้กี่จาน" : "สูตรนี้ได้ของกี่หน่วย"}
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
            <p className="mt-1 text-xs text-bad">{fieldErrors.servings}</p>
          ) : null}
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
            placeholder="เช่น ผัดไฟแรง ใส่พริกท้ายสุด"
            className={`${inputClass} mt-1`}
          />
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
          <p className="text-xs text-bad">{fieldErrors.ingredients}</p>
        ) : null}

        <div className="space-y-3">
          {lines.map((line, i) => {
            const units = unitsOf.get(line.productId) ?? [];
            const rowError =
              fieldErrors?.[`ingredients.${i}.productId`] ??
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

                  {/* Both inputs are ALWAYS posted — see note 3 in the header. */}
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
                      <input type="hidden" name="ingredient_product_id" value="" />
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
                          .filter((m) => m.id !== target.id)
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
                      {/* A component menu counts DISHES, not a weight — the
                          schema refuses a unit on it outright. */}
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
                  <p className="mt-1 text-xs text-bad">{rowError}</p>
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

      {/* Q4 / rule R8: the date is not asked for on a normal save. */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={backdating}
            onChange={(e) => setBackdating(e.target.checked)}
            className="h-4 w-4"
          />
          แก้ย้อนหลัง — สูตรนี้เปลี่ยนไปตั้งแต่วันก่อนหน้า
        </label>
        {backdating ? (
          <div className="mt-3">
            <input
              type="date"
              name="effective_from"
              value={effectiveFrom}
              min={minEffectiveFrom}
              max={todayBangkok}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              ยอดขายที่นำเข้าย้อนหลังจะถูกคิดด้วยสูตรที่ใช้อยู่ ณ วันนั้น
              ไม่ใช่สูตรวันนี้
            </p>
            {fieldErrors?.effectiveFrom ? (
              <p className="mt-1 text-xs text-bad">
                {fieldErrors.effectiveFrom}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            ไม่ติ๊ก = สูตรนี้มีผลตั้งแต่วันนี้เป็นต้นไป
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก…" : mode === "create" ? "บันทึกสูตร" : "บันทึกการแก้ไข"}
        </button>
        {succeeded && mode === "edit" ? (
          <span className="text-sm text-emerald-700">บันทึกแล้ว</span>
        ) : null}
      </div>
    </form>
  );
}

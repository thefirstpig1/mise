// Sprint 5 Part 21 L5d — /recipes/substitute: change an ingredient everywhere.
//
// Two steps, and the first one is the point. Picking what replaces what does NOT
// write anything: it produces a plan that says which recipes would move, grouped
// central-then-branch, with the quantity blank wherever it cannot honestly carry
// over. Part 19's import preview, Q8's copy button and Q13's delete refusal are
// the same shape, and the reason is always that the alternative is a silent edit
// somebody discovers in a cost figure three weeks later.
//
// The replacement can be a MENU as well as a product (Q3): a dish that used to be
// made from scratch can become "one portion of the standard sauce".
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getProductsLogic } from "@/server/product";
import { getMenusLogic } from "@/server/menu";
import { getSubstitutionPlanLogic } from "@/server/recipe-read";
import { substituteIngredientAction } from "../actions";
import { toSubstitutionPlanView } from "../_components/recipe-view";
import SubstitutionForm, {
  type ReplacementUnit,
} from "../_components/SubstitutionForm";

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

export default async function SubstitutePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const sp = await searchParams;

  const [products, menus] = await Promise.all([
    getProductsLogic(tenantId),
    getMenusLogic(tenantId, { stubsOnly: false, includeRetired: false }),
  ]);

  const productOptions = [...products].sort((a, b) =>
    a.name.localeCompare(b.name, "th")
  );
  const menuOptions = [...menus].sort((a, b) =>
    a.name.localeCompare(b.name, "th")
  );

  // `to` carries its kind in the value ("p:<id>" / "m:<id>") so one select can
  // offer both, which is how the choice actually reads to a cook.
  const toKind = sp.to?.startsWith("m:") ? "menu" : "product";
  const toId = sp.to?.slice(2);
  const fromProduct = productOptions.find((p) => p.id === sp.from) ?? null;
  const toProduct =
    toKind === "product" ? (productOptions.find((p) => p.id === toId) ?? null) : null;
  const toMenu =
    toKind === "menu" ? (menuOptions.find((m) => m.id === toId) ?? null) : null;

  const ready = fromProduct !== null && (toProduct !== null || toMenu !== null);

  const plan = ready
    ? toSubstitutionPlanView(
        await getSubstitutionPlanLogic(tenantId, {
          fromProductId: fromProduct.id,
          toProductId: toProduct?.id ?? null,
          toComponentMenuId: toMenu?.id ?? null,
        })
      )
    : null;

  const units: ReplacementUnit[] =
    toProduct === null
      ? []
      : toProduct.productUnits
          .map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase }))
          .sort((a, b) => Number(b.isBase) - Number(a.isBase));

  return (
    <div className="space-y-8">
      <div>
        <a
          href="/recipes"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← กลับรายการสูตร
        </a>
        <h2 className="mt-1 text-xl font-bold">เปลี่ยนวัตถุดิบในหลายสูตรพร้อมกัน</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          เลิกใช้ของตัวหนึ่งแล้วเปลี่ยนไปใช้อีกตัว — ระบบจะบอกก่อนว่าจะไปโดนสูตรไหนบ้าง
          แล้วค่อยเลือกว่าจะแก้อันไหนจริง ๆ
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-5"
      >
        <div>
          <label className="block text-sm font-medium" htmlFor="from">
            เปลี่ยนจาก
          </label>
          <select
            id="from"
            name="from"
            defaultValue={sp.from ?? ""}
            className={`${inputClass} mt-1`}
          >
            <option value="">— เลือกวัตถุดิบเดิม —</option>
            {productOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="to">
            เปลี่ยนเป็น
          </label>
          <select
            id="to"
            name="to"
            defaultValue={sp.to ?? ""}
            className={`${inputClass} mt-1`}
          >
            <option value="">— เลือกของใหม่ —</option>
            <optgroup label="วัตถุดิบ">
              {productOptions.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="เมนู (ใช้เป็นส่วนประกอบ)">
              {menuOptions.map((m) => (
                <option key={m.id} value={`m:${m.id}`}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <button
          type="submit"
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          ดูว่าจะโดนสูตรไหนบ้าง
        </button>
      </form>

      {!ready ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          เลือกของเดิมและของใหม่ก่อน แล้วระบบจะแสดงรายการสูตรที่ได้รับผลกระทบ
          — ยังไม่มีอะไรถูกแก้จนกว่าจะกดยืนยัน
        </div>
      ) : plan === null ? null : (
        <SubstitutionForm
          action={substituteIngredientAction}
          fromProductId={fromProduct.id}
          fromLabel={plan.fromLabel}
          toLabel={plan.toLabel}
          toProductId={toProduct?.id ?? null}
          toComponentMenuId={toMenu?.id ?? null}
          units={units}
          central={plan.central}
          branch={plan.branch}
          todayBangkok={computeBangkokToday().toISOString().slice(0, 10)}
        />
      )}
    </div>
  );
}

// /recipes/substitute — change an ingredient everywhere (Part 21 L5d), redesigned
// 2026-10-28 (Kong: "โอเค" · mockup 7VQiTBsoiaQc56GdiD8f6v).
//
// Two steps, and the first one is the point. Picking what replaces what does NOT
// write anything: it produces a plan that says which recipes would move, grouped
// central-then-branch, with the quantity blank wherever it cannot honestly carry
// over (Q15). The plan lists only the version each dish follows TODAY (fix
// b4adb99) — a past version listed beside it showed the dish twice and, ticked,
// rebuilt today's recipe from old ingredients.
//
// What the redesign adds is the question an owner asks first: what does this do
// to the cost of a plate? Each row is priced from the freshest branch's price
// book — the same book จัดการเมนู uses — and only for someone who may see cost
// (ADR 0029 Q12). A row whose recipe is not the one that branch follows (another
// branch's own recipe) shows no figure rather than a wrong one.
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getProductsLogic } from "@/server/product";
import { getMenusLogic } from "@/server/menu";
import { getIngredientUseCountsLogic, getSubstitutionPlanLogic } from "@/server/recipe-read";
import { getMenuPriceBookLogic } from "@/server/menu-manager";
import { freshestCostBranch } from "@/server/menu-lab-read";
import { getMenuListFactsLogic, MENU_FACT_DAYS } from "@/server/menu-list-facts";
import { substituteIngredientAction } from "../actions";
import { toSubstitutionPlanView } from "../_components/recipe-view";
import SubstitutionForm, { type ReplacementUnit, type SubstitutionCosts } from "../_components/SubstitutionForm";
import SubstitutePickers from "../_components/SubstitutePickers";

export default async function SubstitutePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { tenantId, reach, costAccess } = await requireTenant("recipe:write");
  const sp = await searchParams;

  const [products, menus, useCounts] = await Promise.all([
    getProductsLogic(tenantId),
    getMenusLogic(tenantId, { stubsOnly: false, includeRetired: false }),
    getIngredientUseCountsLogic(tenantId),
  ]);

  const byName = <T extends { name: string }>(xs: T[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name, "th"));
  const productOptions = byName(products);
  const menuOptions = byName(menus);

  // `to` carries its kind in the value ("p:<id>" / "m:<id>") so one picker can
  // offer both, which is how the choice actually reads to a cook (Q3).
  const toKind = sp.to?.startsWith("m:") ? "menu" : "product";
  const toId = sp.to?.slice(2);
  const fromProduct = productOptions.find((p) => p.id === sp.from) ?? null;
  const toProduct = toKind === "product" ? (productOptions.find((p) => p.id === toId) ?? null) : null;
  const toMenu = toKind === "menu" ? (menuOptions.find((m) => m.id === toId) ?? null) : null;
  const ready = fromProduct !== null && (toProduct !== null || toMenu !== null);

  const pick = (p: (typeof productOptions)[number], id = p.id) => ({
    id,
    name: p.name,
    sku: p.sku,
    imageUrl: p.imageUrl,
    section: p.category?.accountingSection ?? null,
    group: p.category?.groupName ?? null,
    baseUnitName: p.productUnits.find((u) => u.isBase)?.unitName ?? null,
  });

  const [plan, costs] = ready
    ? await Promise.all([
        getSubstitutionPlanLogic(tenantId, {
          fromProductId: fromProduct.id,
          toProductId: toProduct?.id ?? null,
          toComponentMenuId: toMenu?.id ?? null,
        }).then(toSubstitutionPlanView),
        costAccess === null
          ? Promise.resolve(null)
          : freshestCostBranch(tenantId, reach)
              .then(async (branch): Promise<SubstitutionCosts> => {
                const [book, facts] = await Promise.all([
                  getMenuPriceBookLogic(tenantId, branch.id, costAccess),
                  getMenuListFactsLogic(tenantId, reach),
                ]);
                return {
                  branchName: branch.name,
                  factDays: MENU_FACT_DAYS,
                  fromPrice: book.products[fromProduct.id] ?? null,
                  // A menu replacement is priced per serving of that dish.
                  toPrice: toProduct ? (book.products[toProduct.id] ?? null) : (book.menus[toMenu!.id]?.costPerServing ?? null),
                  dishes: Object.fromEntries(
                    Object.entries(book.menus).map(([menuId, m]) => [
                      menuId,
                      { recipeId: m.recipeId, perPlate: m.costPerServing, sold: facts.facts.get(menuId)?.qty ?? 0 },
                    ])
                  ),
                };
              })
              .catch(() => null),
      ])
    : [null, null];

  const units: ReplacementUnit[] =
    toProduct === null
      ? []
      : toProduct.productUnits
          .map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase, ratio: Number(u.toBaseRatio) }))
          .sort((a, b) => Number(b.isBase) - Number(a.isBase));

  return (
    <div className="space-y-6">
      <div>
        <a href="/menus" className="text-sm text-muted-foreground hover:underline">
          ‹ จัดการเมนู
        </a>
        <h2 className="mt-1 text-2xl font-semibold">เปลี่ยนวัตถุดิบในหลายสูตร</h2>
        <p className="mt-1 max-w-[66ch] text-sm text-muted-foreground">
          เช่น เลิกซื้อกุ้งขาวแล้วใช้กุ้งแกะแทน · เลือกได้ว่าจะเปลี่ยนเมนูไหน · เมนูที่เปลี่ยนจะได้สูตรเวอร์ชันใหม่ วันก่อนหน้ายังคิดด้วยสูตรเดิม
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <SubstitutePickers
          initialFrom={fromProduct?.id ?? ""}
          initialTo={sp.to ?? ""}
          from={productOptions
            .filter((p) => (useCounts[p.id] ?? 0) > 0)
            .map((p) => ({ ...pick(p), detail: `ใช้ใน ${useCounts[p.id]} สูตร` }))}
          to={[
            ...productOptions.map((p) => ({ ...pick(p, `p:${p.id}`), detail: useCounts[p.id] ? `ใช้ใน ${useCounts[p.id]} สูตร` : "ยังไม่อยู่ในสูตรไหน" })),
            ...menuOptions.map((m) => ({
              id: `m:${m.id}`,
              name: m.name,
              sku: m.posMenuId ?? "",
              imageUrl: null,
              section: "เมนู (ใช้เป็นส่วนประกอบ)",
              group: null,
              baseUnitName: "จาน",
            })),
          ]}
        />
      </section>

      {!ready || plan === null ? (
        <div className="rounded-2xl border border-dashed border-border-strong p-6 text-sm text-muted-foreground">
          เลือกวัตถุดิบเดิมและของที่จะใช้แทน แล้วระบบจะแสดงสูตรที่ใช้อยู่ — ยังไม่มีอะไรถูกแก้จนกว่าจะกดยืนยัน
        </div>
      ) : (
        <SubstitutionForm
          key={`${fromProduct.id}|${sp.to}`}
          action={substituteIngredientAction}
          fromProductId={fromProduct.id}
          fromLabel={plan.fromLabel}
          toLabel={plan.toLabel}
          toProductId={toProduct?.id ?? null}
          toComponentMenuId={toMenu?.id ?? null}
          units={units}
          central={plan.central}
          branch={plan.branch}
          costs={costs}
          todayBangkok={computeBangkokToday().toISOString().slice(0, 10)}
        />
      )}
    </div>
  );
}

// Sprint 5 Part 21 L5c — /recipes/[id]: one recipe, what it costs, who follows it.
//
// The page addresses a VERSION, not a line. A history row links straight here, so
// resolving the id back to "whatever is current" would answer a different
// question than the one the link asked.
//
// Rule R8 is enforced HERE rather than in the serializer: `effectiveFrom` is on
// every row that comes back, and this page prints it only in the history block
// and on the "not the current version" banner — the two places where it changes
// an answer. On a current recipe "มีผลตั้งแต่ 15 พ.ย. 2569" still sitting there in
// 2575 tells a reader nothing they can act on.
//
// `params` and `searchParams` are PROMISES in Next 15 — the plain-object
// signature type-checks under `pnpm tsc` and fails `pnpm build`.

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getProductsLogic } from "@/server/product";
import { getMenusLogic } from "@/server/menu";
import { getRecipeCostLogic } from "@/server/recipe-cost";
import {
  getRecipeBranchComparisonLogic,
  getRecipeByIdLogic,
  getRecipeHistoryLogic,
} from "@/server/recipe-read";
import { copyRecipeToBranchesAction, updateRecipeAction } from "../actions";
import {
  toBranchComparisonView,
  toRecipeCostView,
  toRecipeVersionView,
  toRecipeView,
} from "../_components/recipe-view";
import RecipeForm, {
  type RecipeMenuOption,
  type RecipeProductOption,
} from "../_components/RecipeForm";
import RecipeCostPanel from "../_components/RecipeCostPanel";
import CopyToBranchesForm, {
  type CopyBranchOption,
} from "../_components/CopyToBranchesForm";
import DeleteRecipeButton from "../_components/DeleteRecipeButton";

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenantId, reach} = await requireTenant("any:member");
  const { id } = await params;
  const sp = await searchParams;

  const [recipe, branches] = await Promise.all([
    getRecipeByIdLogic(tenantId, id),
    getBranchesLogic(tenantId, reach),
  ]);
  if (recipe === null) notFound();
  if (branches.length === 0) notFound();

  // A branch recipe is priced at one of ITS OWN branches by default; a central
  // one at the first branch. Either way the figure carries the branch name.
  const ownBranchIds = branches
    .filter((b) => recipe.branchNames.includes(b.name))
    .map((b) => b.id);
  const defaultBranchId = ownBranchIds[0] ?? branches[0].id;
  const branchId =
    branches.find((b) => b.id === sp.branch)?.id ?? defaultBranchId;
  const branchName = branches.find((b) => b.id === branchId)!.name;

  const asOf = computeBangkokToday();
  const target =
    recipe.targetKind === "menu"
      ? ({ kind: "menu", id: recipe.menuId as string } as const)
      : ({ kind: "product", id: recipe.outputProductId as string } as const);

  const [cost, history, comparison, products, menus] = await Promise.all([
    getRecipeCostLogic(tenantId, { recipeId: recipe.id, branchId, asOf }),
    getRecipeHistoryLogic(tenantId, recipe.lineId, asOf),
    getRecipeBranchComparisonLogic(tenantId, { target, asOf }, reach),
    getProductsLogic(tenantId),
    getMenusLogic(tenantId, { stubsOnly: false, includeRetired: false }),
  ]);

  const view = toRecipeView(recipe);
  const costView = cost === null ? null : toRecipeCostView(cost);
  const versions = history.map(toRecipeVersionView);
  const comparisonView =
    comparison === null ? null : toBranchComparisonView(comparison);
  const current = versions.find((v) => v.isCurrent);
  const isCurrent = current?.recipeId === recipe.id;

  const productOptions: RecipeProductOption[] = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      units: p.productUnits
        .map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase }))
        .sort((a, b) => Number(b.isBase) - Number(a.isBase)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  const menuOptions: RecipeMenuOption[] = menus
    .map((m) => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  // Which branches have ALREADY decided for themselves, for any line of this
  // dish — the list the copy form marks, and the reason its first pass refuses.
  const alreadyOwnNames = new Set(
    (comparisonView?.groups ?? []).flatMap((g) => g.branchNames)
  );
  const copyBranches: CopyBranchOption[] = branches
    .filter((b) => !recipe.branchNames.includes(b.name))
    .map((b) => ({
      id: b.id,
      name: b.name,
      alreadyOwn: alreadyOwnNames.has(b.name),
    }));

  const isBranchRecipe = recipe.branchNames.length > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a
            href="/recipes"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← กลับรายการสูตร
          </a>
          <h2 className="mt-1 text-xl font-bold">{recipe.targetName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isBranchRecipe
              ? `สูตรเฉพาะของ ${recipe.branchNames.join(" · ")}`
              : "สูตรกลาง — ทุกสาขาที่ไม่ได้แยกสูตรใช้สูตรนี้"}
          </p>
        </div>
        <DeleteRecipeButton recipeId={recipe.id} />
      </div>

      {/* Rule R8's second permitted place: the date is the whole reason this
          banner exists — it says the version on screen is not today's. */}
      {recipe.isSuperseded ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>เวอร์ชันนี้ถูกแก้ทิ้งไปแล้ว</strong> — มีคนแก้เพราะกรอกผิด
          ไม่ใช่เพราะสูตรเปลี่ยน จึงไม่ได้ใช้กับวันไหนเลย
          {current ? (
            <>
              {" · "}
              <a href={`/recipes/${current.recipeId}`} className="underline">
                ดูเวอร์ชันที่ใช้อยู่
              </a>
            </>
          ) : null}
        </div>
      ) : !isCurrent ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          กำลังดูเวอร์ชันที่มีผลตั้งแต่{" "}
          <strong>{view.effectiveFromLabel}</strong> ซึ่งไม่ใช่เวอร์ชันที่ใช้อยู่ตอนนี้
          {current ? (
            <>
              {" · "}
              <a href={`/recipes/${current.recipeId}`} className="underline">
                ไปยังเวอร์ชันปัจจุบัน
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          <RecipeForm
            action={updateRecipeAction.bind(null, recipe.id)}
            mode="edit"
            target={{
              kind: recipe.targetKind,
              id: target.id,
              name: recipe.targetName,
            }}
            products={productOptions}
            menus={menuOptions}
            initial={view}
            todayBangkok={asOf.toISOString().slice(0, 10)}
          />
        </section>

        <aside className="space-y-6">
          <div>
            <form method="get" className="mb-3 flex items-center gap-2">
              <label className="text-xs text-muted-foreground">
                คิดต้นทุนที่สาขา
              </label>
              <select
                name="branch"
                defaultValue={branchId}
                className="rounded-lg border border-border bg-background px-2 py-1 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg border border-border px-2 py-1 text-sm hover:bg-muted"
              >
                ดู
              </button>
            </form>

            <RecipeCostPanel
              cost={costView}
              branchName={branchName}
              asOfLabel={BANGKOK_DATE.format(asOf)}
              isPreppedOutput={recipe.targetKind === "product"}
            />
          </div>
        </aside>
      </div>

      {/* Q9 — group by recipe, count the branches. */}
      {comparisonView !== null && comparisonView.groups.length > 1 ? (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">เมนูนี้แต่ละสาขาทำไม่เหมือนกัน</h3>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[32rem]">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    สูตร
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    สาขาที่ใช้
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    วัตถุดิบ
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    ต้นทุน/จาน (บาท)
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonView.groups.map((g) => (
                  <tr
                    key={g.recipeId}
                    className={`border-t border-border ${
                      g.recipeId === recipe.id ? "bg-muted/30" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-sm">
                      <a
                        href={`/recipes/${g.recipeId}`}
                        className="text-primary hover:underline"
                      >
                        {g.isCentral ? "สูตรกลาง" : `สูตรของ ${g.branchNames[0]}`}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">
                      {g.isCentral
                        ? `${g.branchCount} สาขาที่ตามสูตรกลาง`
                        : g.branchNames.join(" · ")}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-muted-foreground">
                      {g.ingredientCount}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">
                      {g.costPerServing === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {g.costPerServing}
                          {/* Rule R4: the branch the figure was priced at, said
                              out loud. Without it the reader blames the recipe
                              for a difference the prices caused. */}
                          <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                            ราคาที่ {g.pricedAtBranchName}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {comparisonView.groups.some(
            (g) => g.isCentral && g.branchCount === 0
          ) ? (
            <p className="text-xs text-muted-foreground">
              ทุกสาขาแยกสูตรของตัวเองไปหมดแล้ว สูตรกลางจึงไม่มีสาขาไหนใช้อยู่
              และไม่มีราคาของสาขาไหนให้คิด
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h3 className="text-lg font-semibold">แยกสูตรให้สาขา</h3>
        <CopyToBranchesForm
          action={copyRecipeToBranchesAction}
          sourceRecipeId={recipe.id}
          branches={copyBranches}
        />
      </section>

      {/* Rule R8's home: here the date IS the content. */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold">ประวัติการแก้สูตร</h3>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[28rem]">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  มีผลตั้งแต่
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                  วัตถุดิบ
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  สถานะ
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  บันทึกเมื่อ
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.recipeId} className="border-t border-border">
                  <td className="px-3 py-2 text-sm">
                    <a
                      href={`/recipes/${v.recipeId}`}
                      className={`hover:underline ${
                        v.isSuperseded
                          ? "text-muted-foreground line-through"
                          : "text-primary"
                      }`}
                    >
                      {v.effectiveFromLabel}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-right text-sm tabular-nums text-muted-foreground">
                    {v.ingredientCount}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {v.isSuperseded ? (
                      <span className="text-xs text-muted-foreground">
                        แก้ทิ้ง (กรอกผิด)
                      </span>
                    ) : v.isCurrent ? (
                      <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-800">
                        ใช้อยู่ตอนนี้
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        ใช้กับวันก่อนหน้า
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-muted-foreground">
                    {v.createdAtLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          เวอร์ชันเก่ายังใช้กับวันที่มันครอบคลุมอยู่ — ยอดขายที่นำเข้าย้อนหลัง
          จะถูกคิดด้วยสูตรที่ใช้ ณ วันนั้น ไม่ใช่สูตรวันนี้
        </p>
      </section>

      {recipe.targetKind === "product" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>ยังนับสต๊อกของแปรรูปไม่ได้</strong> — ระบบยังไม่มีการบันทึกการผลิต
          ที่จะเพิ่มยอดของแปรรูปเข้าคลัง ยอดคงเหลือจึงมีแต่ลดลง
          ถ้าไปนับสต๊อกตัวนี้ ระบบจะรายงานว่า “ของเกิน” ทุกครั้ง
        </div>
      ) : null}
    </div>
  );
}

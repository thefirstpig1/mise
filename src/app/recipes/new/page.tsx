// Sprint 5 Part 21 L5c — /recipes/new: write the first version of a recipe.
//
// The target arrives in the URL (`?menu=` or `?product=`) because every route in
// is a row on /recipes that already named the dish. There is no picker: a recipe
// makes ONE thing for its whole life (`RecipeTargetImmutableError`), so offering
// a choice here and refusing to change it later would be two different stories.
//
// A NEW RECIPE IS ALWAYS CENTRAL (Q8). Giving a branch its own is a separate,
// deliberate act on the recipe's own page, and it is the moment that branch stops
// following central.
//
// `searchParams` is a PROMISE in Next 15.

import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getProductsLogic } from "@/server/product";
import { getMenusLogic } from "@/server/menu";
import { createRecipeAction } from "../actions";
import RecipeForm, {
  type RecipeMenuOption,
  type RecipeProductOption,
  type RecipeTargetInfo,
} from "../_components/RecipeForm";

export default async function NewRecipePage({
  searchParams,
}: {
  searchParams: Promise<{ menu?: string; product?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const sp = await searchParams;

  if (!sp.menu && !sp.product) notFound();

  const target = await withTenantContext(tenantId, async (tx) => {
    if (sp.menu) {
      const m = await tx.menu.findFirst({
        where: { id: sp.menu, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      return m === null
        ? null
        : ({ kind: "menu", id: m.id, name: m.name } satisfies RecipeTargetInfo);
    }
    const p = await tx.product.findFirst({
      where: { id: sp.product, tenantId, deletedAt: null },
      select: { id: true, name: true, type: true },
    });
    // Q1: only a PREPPED product is MADE. A raw ingredient is bought, and
    // offering it a production recipe would invite one.
    if (p === null || p.type !== "PREPPED") return null;
    return { kind: "product", id: p.id, name: p.name } satisfies RecipeTargetInfo;
  });

  if (target === null) notFound();

  // Already written? Editing the existing one is what the person meant — a
  // second central recipe for the same dish is refused by the server anyway.
  const existing = await withTenantContext(tenantId, (tx) =>
    tx.recipe.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        supersededAt: null,
        ...(target.kind === "menu"
          ? { menuId: target.id }
          : { outputProductId: target.id }),
        branches: { none: {} },
      },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    })
  );
  if (existing !== null) redirect(`/recipes/${existing.id}`);

  const [products, menus] = await Promise.all([
    getProductsLogic(tenantId),
    getMenusLogic(tenantId, { stubsOnly: false }),
  ]);

  const productOptions: RecipeProductOption[] = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      units: p.productUnits
        .map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase }))
        // Base unit first — the unit stock is kept in.
        .sort((a, b) => Number(b.isBase) - Number(a.isBase)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  const menuOptions: RecipeMenuOption[] = menus
    .map((m) => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  return (
    <div className="space-y-6">
      <a href="/recipes" className="text-sm text-muted-foreground hover:underline">
        ← กลับรายการสูตร
      </a>

      <div>
        <h2 className="text-xl font-bold">เขียนสูตรใหม่</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          สูตรนี้จะเป็น <strong>สูตรกลาง</strong> ที่ทุกสาขาใช้ร่วมกัน
          ถ้าสาขาไหนทำไม่เหมือน ค่อยคัดลอกไปแก้เฉพาะสาขานั้นทีหลัง
        </p>
      </div>

      <RecipeForm
        action={createRecipeAction}
        mode="create"
        target={target}
        products={productOptions}
        menus={menuOptions}
        initial={null}
        todayBangkok={computeBangkokToday().toISOString().slice(0, 10)}
      />
    </div>
  );
}

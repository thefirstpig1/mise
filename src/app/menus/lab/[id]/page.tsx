// Sprint 5 Part 24 L5b — /menus/lab/[id]: one draft, its live cost, and the two
// buttons that end it.
//
// The address is the DRAFT's recipe id. A published recipe reached through this
// URL is sent to `/recipes/[id]` rather than 404'd: it is the same row, it just
// stopped being a what-if, and the page that owns it is the recipe page. That
// also covers the tab somebody left open across a publish.
//
// `params` is a PROMISE in Next 15 — the plain-object signature type-checks
// under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix).

import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { withTenantContext } from "@/lib/db";
import { updateDraftAction } from "../actions";
import { loadLabOptions } from "../options";
import { getDraftsLogic } from "@/server/menu-lab-read";
import { toDraftView } from "../../_components/menu-lab-view";
import LabForm from "../../_components/LabForm";
import DraftControls from "../../_components/DraftControls";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { id } = await params;

  const row = await withTenantContext(tenantId, (tx) =>
    tx.recipe.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { ingredients: true },
    })
  );
  if (row === null) notFound();
  if (!row.isDraft) redirect(`/recipes/${row.id}`);

  const menu =
    row.menuId === null
      ? null
      : await withTenantContext(tenantId, (tx) =>
          tx.menu.findFirst({
            where: { id: row.menuId as string, tenantId },
            select: { id: true, name: true },
          })
        );

  const [options, drafts] = await Promise.all([
    loadLabOptions(tenantId),
    getDraftsLogic(tenantId),
  ]);
  // The list read already answers both questions this page needs about the
  // draft — what publishing would displace, and whether the dish sells — so
  // asking them a second way here would be a second answer to maintain.
  const listRow = drafts.find((d) => d.recipeId === row.id);

  const draft = toDraftView(row);

  return (
    <div className="space-y-6">
      <a
        href="/menus/lab"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← กลับหน้าทดลองเมนู
      </a>

      <div>
        <h2 className="text-xl font-bold">{menu?.name ?? "ร่างสูตร"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ร่างนี้ยังไม่ถูกใช้ตัดสต๊อกและไม่ถูกใช้คิดกำไรขั้นต้น
          แก้กี่ครั้งก็ได้ ระบบไม่เก็บเป็นประวัติเวอร์ชัน
        </p>
      </div>

      <LabForm
        action={updateDraftAction.bind(null, row.id)}
        mode="edit"
        products={options.products}
        menus={options.menus}
        categories={options.categories}
        branches={options.branches}
        initial={draft}
        initialMenuName={menu?.name ?? null}
        initialMenuHasSales={listRow?.hasSales ?? false}
      />

      <DraftControls
        recipeId={row.id}
        menuName={menu?.name ?? ""}
        liveRecipeId={listRow?.liveRecipeId ?? null}
      />
    </div>
  );
}

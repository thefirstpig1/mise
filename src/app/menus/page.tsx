// Sprint 4 Part 19 L5 — /menus: the dishes, and the queue of ones nobody has
// looked at yet (ADR 0019 Q8).
//
// Server Component. `?stubs=true` filters to the queue, and the import screen
// links straight into it after a commit that created any — a queue nobody sees
// is a queue nobody works.
//
// The page says what an unidentified dish costs, in concrete terms rather than
// as a warning symbol: its revenue sits in no category, so it is invisible on
// the category chart; and with departments on it belongs to no department, so it
// sits outside the /cost matrix. Both are recoverable at any time, which is why
// nothing about the import blocked on them.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature
// type-checks under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix).

import { requireTenant } from "@/lib/require-tenant";
import {
  getMenuCategoriesLogic,
  getMenusLogic,
  getPosIntegrationsLogic,
} from "@/server/menu";
import { getMenusQuerySchema } from "@/lib/validations/sales-import";
import { withTenantContext } from "@/lib/db";
import { getMenuMergesLogic } from "@/server/menu-merge-read";
import { toMenuRowView } from "./_components/menu-view";
import {
  groupMergesByWinner,
  toMenuMergeRowView,
} from "./_components/menu-merge-view";
import MenuRowEditor, {
  type CategoryOption,
  type DepartmentOption,
} from "./_components/MenuRowEditor";
import NewCategoryForm from "./_components/NewCategoryForm";

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

export default async function MenusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId, membership } = await requireTenant();
  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const parsed = getMenusQuerySchema.safeParse({
    posIntegrationId: one("pos"),
    menuCategoryId: one("category"),
    stubsOnly: one("stubs"),
    includeRetired: one("retired"),
    search: one("q"),
  });
  const query = parsed.success
    ? parsed.data
    : {
        posIntegrationId: undefined,
        menuCategoryId: undefined,
        stubsOnly: false,
        includeRetired: false,
        search: undefined,
      };

  const departmentsEnabled = membership.tenant.enableDepartments;

  const [menus, categories, integrations, departments, merges] = await Promise.all([
    getMenusLogic(tenantId, query),
    getMenuCategoriesLogic(tenantId),
    getPosIntegrationsLogic(tenantId),
    withTenantContext(tenantId, (tx) =>
      tx.department.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { name: "asc" },
      })
    ),
    // NOT a fold. This screen shows both rows — a merge nobody can see is a
    // merge nobody can undo (Q6) — it only NESTS one under the other.
    getMenuMergesLogic(tenantId, { winningMenuId: undefined, includeRevoked: false }),
  ]);

  const mergeRows = merges.map(toMenuMergeRowView);
  const spellingsByWinner = groupMergesByWinner(mergeRows);
  const onScreen = new Set(menus.map((m) => m.id));

  // A losing row is collapsed under its winner ONLY when the winner is also on
  // screen. Under a filter or a search that excluded the winner it stays an
  // ordinary row, labelled — because it is a row that still collects money every
  // day, and a row like that must never simply disappear.
  const nestedUnder = new Map<string, string>();
  for (const m of mergeRows) {
    if (onScreen.has(m.winner.id)) nestedUnder.set(m.loser.id, m.winner.id);
  }
  const winnerLabelOf = new Map(mergeRows.map((m) => [m.loser.id, m.winner.label]));

  const rows = menus
    .filter((m) => !nestedUnder.has(m.id))
    .map((m) => toMenuRowView(m, departmentsEnabled));
  const stubCount = rows.filter((r) => r.isPosStub).length;

  const categoryOptions: CategoryOption[] = categories.map((c) => ({ id: c.id, name: c.name }));
  const departmentOptions: DepartmentOption[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
  }));
  const defaultIntegrationId = integrations[0]?.id ?? null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">เมนู</h2>
        <div className="flex items-baseline gap-4">
          <a href="/menus/merges" className="text-sm text-primary hover:underline">
            รวมเมนูที่ซ้ำ
          </a>
          <a href="/sales" className="text-sm text-primary hover:underline">
            ดูยอดขาย →
          </a>
        </div>
      </div>

      {stubCount > 0 && !query.stubsOnly && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
          มีเมนูรอตรวจ {stubCount} รายการ —{" "}
          <a href="/menus?stubs=true" className="text-primary underline">
            ดูเฉพาะรายการที่ต้องตรวจ
          </a>
        </div>
      )}

      {/* ---------- filters ---------- */}
      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="text-sm">
          ค้นหา
          <input name="q" defaultValue={one("q") ?? ""} placeholder="ชื่อหรือรหัสเมนู" className={`${inputClass} mt-1 block`} />
        </label>
        <label className="text-sm">
          หมวด
          <select name="category" defaultValue={one("category") ?? ""} className={`${inputClass} mt-1 block`}>
            <option value="">ทุกหมวด</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="stubs" value="true" defaultChecked={query.stubsOnly} />
          เฉพาะเมนูรอตรวจ
        </label>
        <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm">
          ดู
        </button>
      </form>

      {/* ---------- new category ---------- */}
      <details className="rounded-lg border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">เพิ่มหมวดเมนู</summary>
        <NewCategoryForm />
      </details>

      {/* ---------- list ---------- */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm">
          <p className="font-medium">
            {query.stubsOnly ? "ไม่มีเมนูรอตรวจ" : "ยังไม่มีเมนูในระบบ"}
          </p>
          <p className="mt-2 text-muted-foreground">
            เมนูเกิดขึ้นเองเมื่อนำเข้ายอดขาย — ไม่ต้องพิมพ์รายการเมนูเข้าไปก่อน
          </p>
          <a href="/sales/import" className="mt-4 inline-block text-sm text-primary underline">
            นำเข้ายอดขาย
          </a>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((m) => (
            <MenuRowEditor
              key={m.id}
              menu={m}
              categories={categoryOptions}
              departments={departmentOptions}
              departmentsEnabled={departmentsEnabled}
              posIntegrationId={defaultIntegrationId}
              spellings={(spellingsByWinner.get(m.id) ?? []).map((x) => x.loser)}
              mergedIntoLabel={winnerLabelOf.get(m.id) ?? null}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

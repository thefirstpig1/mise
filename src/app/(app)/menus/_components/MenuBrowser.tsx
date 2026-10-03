"use client";

// /menus as a catalog (UI run-through 2026-10-02), the same shape /products took
// on 2026-09-28: tap a category chip, tap a status chip, type to search — every
// one answers at once with no "ดู" button and no reload, because the whole list
// is already on the page (a shop has hundreds of dishes, not tens of thousands).
//
// Each row now says what an owner opens a menu screen to find out — how many
// sold in the last 30 days, at what average price, and whether it has a recipe
// (menu-list-facts.ts) — and the WHOLE row opens the dish in a popup
// (MenuEditPopup) instead of three small links repeated on every row.
//
// Kept from the old list, deliberately:
//   - a spelling merged into a dish on screen is NESTED under it ("+N ชื่อที่
//     รวมแล้ว"), never hidden — it still collects sales every day (ADR 0026 Q6);
//     one whose dish is filtered out stays an ordinary row, labelled;
//   - retired dishes are off by default but one tap away (ADR 0027 Q2);
//   - the รอตรวจ queue is a filter the import screen links straight into.

import { useMemo, useState } from "react";
import type { MenuRowView } from "./menu-view";
import type { MergeMenuView } from "./menu-merge-view";
import { mergedSpellingsLabel } from "./menu-merge-view";
import MenuEditPopup, { type CategoryOption, type DepartmentOption, type MenuFactView } from "./MenuEditPopup";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import NewCategoryForm from "./NewCategoryForm";
import EmptyState from "@/components/ui/EmptyState";
import ActionLink from "@/components/ui/ActionLink";

type Status = "selling" | "review" | "retired" | "all";
type Sort = "name" | "sold";

const NO_CATEGORY = "ไม่มีหมวด";
const STATUS_LABEL: Record<Status, string> = {
  selling: "ขายอยู่",
  review: "รอตรวจ",
  retired: "เลิกขายแล้ว",
  all: "ทั้งหมด",
};

const chip = (active: boolean) =>
  `whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors ${
    active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"
  }`;
const baht = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;

export default function MenuBrowser({
  rows,
  facts,
  factDays,
  spellingsByWinner,
  winnerOf,
  categories,
  departments,
  departmentsEnabled,
  posIntegrationId,
  initialStatus,
  canEdit,
  canDelete,
  canRecipe,
}: {
  rows: MenuRowView[];
  facts: Record<string, MenuFactView>;
  factDays: number;
  spellingsByWinner: Record<string, MergeMenuView[]>;
  winnerOf: Record<string, { id: string; label: string }>;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  departmentsEnabled: boolean;
  posIntegrationId: string | null;
  initialStatus: Status;
  canEdit: boolean;
  canDelete: boolean;
  canRecipe: boolean;
}) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);

  const stubCount = rows.filter((r) => r.isPosStub && !r.isRetired).length;

  const byStatus = useMemo(
    () =>
      rows.filter((r) =>
        status === "all"
          ? true
          : status === "retired"
            ? r.isRetired
            : status === "review"
              ? r.isPosStub && !r.isRetired
              : !r.isRetired
      ),
    [rows, status]
  );

  // Chips come from what exists, so an empty category is never a dead button.
  const categoryChips = useMemo(() => {
    const names = [...new Set(byStatus.map((r) => r.menuCategoryName ?? NO_CATEGORY))];
    return [...names.filter((n) => n !== NO_CATEGORY).sort((a, b) => a.localeCompare(b, "th")), ...names.filter((n) => n === NO_CATEGORY)];
  }, [byStatus]);

  const term = search.trim().toLowerCase();
  const matching = byStatus
    .filter((r) => (category === null ? true : (r.menuCategoryName ?? NO_CATEGORY) === category))
    .filter((r) =>
      term === "" ? true : [r.name, r.posMenuName ?? "", r.posMenuCode ?? ""].join(" ").toLowerCase().includes(term)
    )
    .sort((a, b) =>
      sort === "sold" ? (facts[b.id]?.qty ?? 0) - (facts[a.id]?.qty ?? 0) || a.name.localeCompare(b.name, "th") : 0
    );
  // A spelling folds under its dish only while the dish itself is shown.
  const matchingIds = new Set(matching.map((r) => r.id));
  const shown = matching.filter((r) => !(winnerOf[r.id] && matchingIds.has(winnerOf[r.id].id)));
  const mergedIntoLabel = (id: string) => (winnerOf[id] && !matchingIds.has(winnerOf[id].id) ? winnerOf[id].label : null);

  const opened = openId === null ? null : (rows.find((r) => r.id === openId) ?? null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">เมนู</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            เมนูเกิดขึ้นเองเมื่อนำเข้ายอดขาย กดที่เมนูเพื่อแก้ชื่อ หมวด หรือเลิกขาย
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionLink href="/menus/coverage">เมนูที่ยังไม่มีสูตร</ActionLink>
          <ActionLink href="/menus/lab">ทดลองเมนู</ActionLink>
          <ActionLink href="/menus/merges">รวมเมนูที่ซ้ำ</ActionLink>
        </div>
      </div>

      {stubCount > 0 && status !== "review" && (
        <button
          type="button"
          onClick={() => setStatus("review")}
          className="block w-full rounded-lg border border-warn-border bg-warn-bg p-3 text-left text-sm text-warn hover:brightness-95"
        >
          มีเมนูใหม่จากไฟล์ที่ยังไม่ได้ตรวจ {stubCount} รายการ — กดเพื่อดูเฉพาะรายการเหล่านี้
        </button>
      )}

      {rows.length === 0 ? (
        <EmptyState art="start">
          <p className="font-medium">ยังไม่มีเมนูในระบบ</p>
          <p className="mt-2 text-muted-foreground">เมนูเกิดขึ้นเองเมื่อนำเข้ายอดขาย — ไม่ต้องพิมพ์รายการเมนูเข้าไปก่อน</p>
          <a href="/sales/import" className="mt-4 inline-block text-sm text-primary underline">
            นำเข้ายอดขาย
          </a>
        </EmptyState>
      ) : (
        <>
          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="สถานะ">
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <button key={s} type="button" className={chip(status === s)} onClick={() => setStatus(s)}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="หมวดเมนู">
              <button type="button" className={chip(category === null)} onClick={() => setCategory(null)}>
                ทุกหมวด
              </button>
              {categoryChips.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={chip(category === c)}
                  onClick={() => setCategory(category === c ? null : c)}
                >
                  {c}
                </button>
              ))}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setAddingCategory(true)}
                  className="whitespace-nowrap rounded-full border border-dashed border-border-strong px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
                >
                  + เพิ่มหมวด
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อหรือรหัสเมนู"
                className="input min-w-0 flex-1"
              />
              <div className="flex items-center gap-1 text-sm">
                <span className="text-muted-foreground">เรียงตาม</span>
                <button type="button" className={chip(sort === "name")} onClick={() => setSort("name")}>
                  ชื่อ
                </button>
                <button type="button" className={chip(sort === "sold")} onClick={() => setSort("sold")}>
                  ขายดี
                </button>
              </div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            แสดง {shown.length} เมนู · ยอดขายและราคาเฉลี่ยคิดจาก {factDays} วันล่าสุด ไม่รวม VAT และ service charge
          </p>

          {shown.length === 0 ? (
            <EmptyState art="none">ไม่พบเมนูที่ตรงกับตัวกรอง</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunk text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">เมนู</th>
                    <th className="px-4 py-2 text-right font-medium">ขาย {factDays} วัน</th>
                    <th className="px-4 py-2 text-right font-medium">ราคาเฉลี่ย</th>
                    <th className="px-4 py-2 font-medium">สูตร</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((r) => {
                    const f = facts[r.id];
                    const spellings = spellingsByWinner[r.id] ?? [];
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setOpenId(r.id)}
                        className="cursor-pointer align-top hover:bg-muted/50"
                      >
                        <td className="px-4 py-2.5">
                          <span className="font-medium">{r.name}</span>
                          <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                            {r.isPosStub && !r.isRetired && <span className="badge whitespace-nowrap">รอตรวจ</span>}
                            {r.isRetired && <span className="badge whitespace-nowrap">เลิกขายแล้ว</span>}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            {r.menuCategoryName ?? NO_CATEGORY}
                            {spellings.length > 0 ? ` · ${mergedSpellingsLabel(spellings.length)}` : ""}
                            {mergedIntoLabel(r.id) ? ` · นับรวมเป็น “${mergedIntoLabel(r.id)}”` : ""}
                            {r.lastSoldLabel ? ` · ${r.lastSoldLabel}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {f && f.qty > 0 ? f.qty.toLocaleString("th-TH") : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {f && f.qty > 0 ? baht(f.net / f.qty) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {f?.recipeId ? (
                            <span className="whitespace-nowrap text-good">มีสูตร</span>
                          ) : f?.hasDraft ? (
                            <span className="whitespace-nowrap text-warn">มีร่าง</span>
                          ) : (
                            <span className="whitespace-nowrap text-muted-subtle">ยังไม่มี</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {opened && (
        <MenuEditPopup
          key={opened.id}
          menu={opened}
          fact={facts[opened.id] ?? null}
          factDays={factDays}
          categories={categories}
          departments={departments}
          departmentsEnabled={departmentsEnabled}
          posIntegrationId={posIntegrationId}
          spellings={spellingsByWinner[opened.id] ?? []}
          mergedIntoLabel={mergedIntoLabel(opened.id)}
          canEdit={canEdit}
          canDelete={canDelete}
          canRecipe={canRecipe}
          onClose={() => setOpenId(null)}
        />
      )}

      {addingCategory && (
        <ModalShell narrow onClose={() => setAddingCategory(false)} labelledBy="new-menu-category">
          <div className="pr-10">
            <h3 id="new-menu-category" className="text-lg font-semibold">
              เพิ่มหมวดเมนู
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              ส่วนใหญ่หมวดจะมาเองจากไฟล์ POS ใช้ช่องนี้เมื่ออยากจัดกลุ่มเมนูเอง
            </p>
            <NewCategoryForm />
          </div>
        </ModalShell>
      )}
    </div>
  );
}

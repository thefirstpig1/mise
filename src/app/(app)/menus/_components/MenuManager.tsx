"use client";

// "จัดการเมนู" — the list half (Kong, 2026-10-04; mockup
// https://claude.ai/artifact/NquaaTFahRgeSmPsyzxor5). Everything on the page is
// already loaded, so every filter, chip and keystroke answers at once; only the
// branch picker goes back to the server, because cost is per branch.
//
// Kept from the old /menus: the รอตรวจ banner and queue, retired dishes one tap
// away, merged spellings nested under their dish (ADR 0026 Q6), + เพิ่มหมวด,
// sort by name or by what sells.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { rankBySearch, hasQuery, highlightRuns, STRONG_MATCH, type SearchField } from "@/lib/smart-search";
import type { MenuRowView } from "./menu-view";
import type { MergeMenuView } from "./menu-merge-view";
import { mergedSpellingsLabel } from "./menu-merge-view";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import NewCategoryForm from "./NewCategoryForm";
import EmptyState from "@/components/ui/EmptyState";
import ActionLink from "@/components/ui/ActionLink";
import MenuSheet from "./MenuSheet";
import { Portal } from "./sheet-parts";
import { ingredientOptions, menuSheet, priceBook } from "./prefetch";
import { baht, confidenceTh } from "./manager-format";
import type { IngredientOption, PriceBook, StandardUnit } from "@/server/menu-manager";

export type ManagerRow = MenuRowView & {
  qty: number;
  net: number;
  hasDraft: boolean;
  /** The recipe that applies at the chosen branch today. */
  recipeId: string | null;
  /** That recipe is the branch's own, not central. */
  recipeOwn: boolean;
  tone: string;
};

export type Perm = { editMenu: boolean; deleteMenu: boolean; recipe: boolean; recipeShared: boolean; yield: boolean };
export type Option = { id: string; name: string };

type Status = "all" | "none" | "review" | "retired" | "every";
type Sort = "sold" | "name";
const NO_CATEGORY = "ไม่มีหมวด";
const STATUS: { key: Status; label: string }[] = [
  { key: "all", label: "ขายอยู่" },
  { key: "none", label: "ยังไม่มีสูตร" },
  { key: "review", label: "รอตรวจ" },
  { key: "retired", label: "เลิกขายแล้ว" },
  { key: "every", label: "ทั้งหมด" },
];

const chip = (on: boolean) =>
  `whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors ${
    on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"
  }`;

function Marked({ text, marks }: { text: string; marks: readonly number[] }) {
  return (
    <>
      {highlightRuns(text, marks).map((r, i) =>
        r.hit ? (
          <mark key={i} className="rounded-sm bg-highlight px-px text-inherit">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        )
      )}
    </>
  );
}

export default function MenuManager(props: {
  rows: ManagerRow[];
  factDays: number;
  spellingsByWinner: Record<string, MergeMenuView[]>;
  winnerOf: Record<string, { id: string; label: string }>;
  categories: Option[];
  departments: Option[];
  departmentsEnabled: boolean;
  posIntegrationId: string | null;
  branches: Option[];
  branch: Option | null;
  today: string;
  initialStatus: Status;
  initialMenuId: string | null;
  costHidden: boolean;
  perm: Perm;
}) {
  const { rows, factDays, spellingsByWinner, winnerOf, branch, costHidden, perm } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(props.initialStatus);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("sold");
  const [openId, setOpenId] = useState<string | null>(
    props.initialMenuId && rows.some((r) => r.id === props.initialMenuId) ? props.initialMenuId : null
  );
  const [addingCategory, setAddingCategory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Prices load AFTER the list has painted, once per branch, and are kept —
  // switching back to a branch already seen costs nothing (mise-ui-review §5b).
  const [books, setBooks] = useState<Record<string, PriceBook>>({});
  const [bookTick, setBookTick] = useState(0);
  const book = branch ? (books[branch.id] ?? null) : null;
  const branchId = branch?.id ?? null;
  const haveBook = branchId !== null && branchId in books;
  // Keyed by branch, so a late answer for a branch no longer on screen is
  // simply kept for when it comes back — no "is this still current" flag, which
  // React's dev double-run of effects turned into a dropped answer.
  const asking = useRef(new Set<string>());
  useEffect(() => {
    if (costHidden || branchId === null || haveBook || asking.current.has(branchId)) return;
    asking.current.add(branchId);
    void priceBook(branchId).then((r) => {
      asking.current.delete(branchId);
      if (r.ok) setBooks((b) => ({ ...b, [branchId]: r.book }));
    });
  }, [branchId, haveBook, costHidden, bookTick]);
  const pricesLoading = !costHidden && branch !== null && book === null;
  const costOf = (id: string) => book?.menus[id] ?? null;

  // The adder's list: one fetch the first time any sheet needs it.
  const [options, setOptions] = useState<IngredientOption[] | null>(null);
  const [standards, setStandards] = useState<StandardUnit[]>([]);
  const optionsAsked = useRef(false);
  const needOptions = () => {
    if (optionsAsked.current || !perm.recipe) return;
    optionsAsked.current = true;
    void ingredientOptions().then((r) => {
      if (!r.ok) return void (optionsAsked.current = false);
      setOptions(r.options);
      setStandards(r.standards);
    });
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ?menu= in the address so a sheet can be linked and survives a refresh.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (openId) url.searchParams.set("menu", openId);
      else url.searchParams.delete("menu");
      window.history.replaceState(null, "", url);
    } catch {
      /* the address bar is a convenience */
    }
  }, [openId]);

  const selling = rows.filter((r) => !r.isRetired);
  const noRecipe = selling.filter((r) => r.recipeId === null);
  const stubCount = selling.filter((r) => r.isPosStub).length;

  const stats = useMemo(() => {
    const total = selling.reduce((s, r) => s + r.net, 0);
    const covered = selling.filter((r) => r.recipeId !== null).reduce((s, r) => s + r.net, 0);
    const costed = selling.filter((r) => costOf(r.id)?.costPerServing != null && r.qty > 0);
    const cost = costed.reduce((s, r) => s + costOf(r.id)!.costPerServing! * r.qty, 0);
    const netCosted = costed.reduce((s, r) => s + r.net, 0);
    return {
      total,
      covered,
      coverage: total > 0 ? (covered / total) * 100 : null,
      foodCost: netCosted > 0 ? (cost / netCosted) * 100 : null,
      costedCount: costed.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selling, book]);

  const byStatus = rows.filter((r) =>
    status === "every"
      ? true
      : status === "retired"
        ? r.isRetired
        : status === "review"
          ? r.isPosStub && !r.isRetired
          : status === "none"
            ? !r.isRetired && r.recipeId === null
            : !r.isRetired
  );
  const categoryChips = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of byStatus) seen.set(r.menuCategoryName ?? NO_CATEGORY, r.tone);
    return [...seen].sort(([a], [b]) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b, "th")));
  }, [byStatus]);

  const filtered = byStatus
    .filter((r) => category === null || (r.menuCategoryName ?? NO_CATEGORY) === category)
    .sort((a, b) =>
      sort === "name" && status !== "none"
        ? a.name.localeCompare(b.name, "th")
        : b.net - a.net || a.name.localeCompare(b.name, "th")
    );

  const fields: SearchField<ManagerRow>[] = [
    { get: (r) => r.name, kind: "name" },
    { get: (r) => r.posMenuCode, kind: "code" },
    { get: (r) => r.menuCategoryName, kind: "category" },
    { get: (r) => r.posMenuName, kind: "name" },
  ];
  const searching = hasQuery(query);
  const ranked = searching
    ? rankBySearch(filtered, query, fields)
    : filtered.map((item, index) => ({ item, index, score: 0, field: null as number | null, marks: [] as number[], why: null }));

  // A spelling folds under its dish only while the dish itself is on screen.
  const shownIds = new Set(ranked.map((r) => r.item.id));
  const visible = ranked.filter((r) => !(winnerOf[r.item.id] && shownIds.has(winnerOf[r.item.id].id)));
  const mergedIntoLabel = (id: string) => (winnerOf[id] && !shownIds.has(winnerOf[id].id) ? winnerOf[id].label : null);

  const opened = openId === null ? null : (rows.find((r) => r.id === openId) ?? null);

  const pickBranch = (id: string) =>
    startTransition(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("branch", id);
      router.push(`${url.pathname}${url.search}` as Route, { scroll: false });
    });

  const count = (s: Status) =>
    s === "all" ? selling.length : s === "none" ? noRecipe.length : s === "review" ? stubCount : s === "retired" ? rows.length - selling.length : rows.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">จัดการเมนู</h2>
          <p className="mt-1 text-sm text-muted-foreground">ทุกเมนูที่ร้านขาย พร้อมสูตรและต้นทุน กดที่แถวเพื่อดูและแก้ไขได้ในที่เดียว</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {perm.recipe && <ActionLink href="/menus/lab/new">+ ทดลองเมนูใหม่</ActionLink>}
          {perm.editMenu && <ActionLink href="/menus/merges">รวมเมนูที่ซ้ำ</ActionLink>}
          {perm.recipeShared && <ActionLink href="/recipes/substitute">เปลี่ยนวัตถุดิบในหลายสูตร</ActionLink>}
        </div>
      </div>

      {!costHidden && branch && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>ต้นทุนคิดที่</span>
          {props.branches.length > 1 ? (
            <select
              value={branch.id}
              onChange={(e) => pickBranch(e.target.value)}
              className="rounded-full border border-border-strong bg-surface px-3 py-1 text-sm text-foreground"
              aria-label="สาขาที่ใช้คิดต้นทุน"
            >
              {props.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-medium text-foreground">{branch.name}</span>
          )}
          <span>· ราคาวัตถุดิบ ณ วันนี้ · แต่ละสาขาซื้อของคนละราคา ต้นทุนจึงไม่เท่ากัน</span>
          {pending && <span className="text-primary">กำลังคำนวณ…</span>}
        </div>
      )}

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
          <div className={`grid gap-3 ${costHidden ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-xs text-muted-subtle">เมนูที่ขายอยู่</p>
              <p className="font-display text-2xl font-semibold tabular-nums">{selling.length}</p>
              <p className="text-xs text-muted-foreground">{noRecipe.length} เมนูยังไม่มีสูตร</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-xs text-muted-subtle">มีสูตรแล้ว คิดเป็นยอดขาย {factDays} วัน</p>
              <p className="font-display text-2xl font-semibold tabular-nums">{stats.coverage === null ? "—" : `${stats.coverage.toFixed(0)}%`}</p>
              {stats.coverage !== null && (
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${stats.coverage}%` }} />
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {stats.coverage === null ? "ยังไม่มียอดขายในช่วงนี้" : `${baht(stats.total - stats.covered)} ยังคิดต้นทุนไม่ได้${branch ? ` (ที่${branch.name})` : ""}`}
              </p>
            </div>
            {!costHidden && (
              <div className="rounded-xl border border-border bg-surface p-3">
                <p className="text-xs text-muted-subtle">ต้นทุนวัตถุดิบ เทียบยอดขาย</p>
                <p className="font-display text-2xl font-semibold tabular-nums">
                  {pricesLoading ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-muted align-middle" /> : stats.foodCost === null ? "—" : `${stats.foodCost.toFixed(1)}%`}
                </p>
                <p className="text-xs text-muted-foreground">
                  คิดจาก {stats.costedCount} เมนูที่มีสูตร{branch ? ` · ${branch.name}` : ""}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาชื่อ รหัส หรือหมวด"
                aria-label="ค้นหาเมนู"
                className="input min-w-0 flex-1 basis-60"
              />
              <div className="flex items-center gap-1 text-sm">
                <span className="text-muted-foreground">เรียงตาม</span>
                <button type="button" className={chip(sort === "sold")} onClick={() => setSort("sold")}>
                  ขายดี
                </button>
                <button type="button" className={chip(sort === "name")} onClick={() => setSort("name")}>
                  ชื่อ
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="สถานะ">
              {STATUS.map((s) => (
                <button key={s.key} type="button" className={chip(status === s.key)} onClick={() => setStatus(s.key)}>
                  {s.label}
                  <span className="ml-1 tabular-nums opacity-70">{count(s.key)}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="หมวดเมนู">
              <button type="button" className={chip(category === null)} onClick={() => setCategory(null)}>
                ทุกหมวด
              </button>
              {categoryChips.map(([name, tone]) => (
                <button key={name} type="button" className={chip(category === name)} onClick={() => setCategory(category === name ? null : name)}>
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: tone }} />
                  {name}
                </button>
              ))}
              {perm.editMenu && (
                <button
                  type="button"
                  onClick={() => setAddingCategory(true)}
                  className="whitespace-nowrap rounded-full border border-dashed border-border-strong px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
                >
                  + เพิ่มหมวด
                </button>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            แสดง {visible.length} เมนู · ยอดขายและราคาเฉลี่ย {factDays} วันล่าสุด ไม่รวม VAT และ service charge
            {status === "none" && " · เรียงตามยอดขาย เขียนสูตรเมนูบนสุดก่อนจะคุ้มที่สุด"}
          </p>

          {visible.length === 0 ? (
            <EmptyState art="none">ไม่พบเมนูที่ตรงกับตัวกรอง</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunk text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">เมนู</th>
                    <th className="px-4 py-2 text-right font-medium">ขาย {factDays} วัน</th>
                    <th className="px-4 py-2 text-right font-medium">ราคาเฉลี่ย</th>
                    {!costHidden && <th className="px-4 py-2 text-right font-medium">ต้นทุนต่อจาน</th>}
                    {!costHidden && <th className="px-4 py-2 font-medium">ต้นทุน % ของราคา</th>}
                    <th className="px-4 py-2 font-medium">สูตร</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((r, i) => {
                    const m = r.item;
                    const weak = searching && r.score < STRONG_MATCH;
                    const firstWeak = weak && (i === 0 || visible[i - 1].score >= STRONG_MATCH);
                    const avg = m.qty > 0 ? m.net / m.qty : null;
                    const mc = costOf(m.id);
                    const pct = avg && mc?.costPerServing != null ? (mc.costPerServing / avg) * 100 : null;
                    const spellings = spellingsByWinner[m.id] ?? [];
                    const mark = (text: string | null, f: number) =>
                      text === null ? null : searching && r.field === f ? <Marked text={text} marks={r.marks} /> : text;
                    return [
                      firstWeak ? (
                        <tr key={`sep-${m.id}`}>
                          <td colSpan={costHidden ? 4 : 6} className="bg-background px-4 py-1 text-[11px] text-muted-subtle">
                            เมนูอื่น
                          </td>
                        </tr>
                      ) : null,
                      <tr
                        key={m.id}
                        onClick={() => setOpenId(m.id)}
                        // Start the sheet's read once the pointer RESTS on a row
                        // (not on every row it crosses); the click finds it ready.
                        onPointerEnter={() => {
                          clearTimeout(hoverTimer.current);
                          hoverTimer.current = setTimeout(() => branch && void menuSheet(m.id, branch.id), 150);
                        }}
                        onPointerLeave={() => clearTimeout(hoverTimer.current)}
                        className={`cursor-pointer align-top transition-colors hover:bg-muted/50 ${openId === m.id ? "bg-highlight" : ""} ${weak ? "opacity-45" : ""}`}
                      >
                        <td className="px-4 py-2.5">
                          <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: m.tone }} />
                          <span className="font-medium">{mark(m.name, 0)}</span>
                          {m.posMenuCode && <span className="ml-1.5 text-xs tabular-nums text-muted-subtle">{mark(m.posMenuCode, 1)}</span>}
                          <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                            {m.isPosStub && !m.isRetired && <span className="badge whitespace-nowrap">รอตรวจ</span>}
                            {m.isRetired && <span className="badge whitespace-nowrap">เลิกขายแล้ว</span>}
                          </span>
                          <p className="ml-4 text-xs text-muted-foreground">
                            {mark(m.menuCategoryName, 2) ?? NO_CATEGORY}
                            {spellings.length > 0 ? ` · ${mergedSpellingsLabel(spellings.length)}` : ""}
                            {mergedIntoLabel(m.id) ? ` · นับรวมเป็น “${mergedIntoLabel(m.id)}”` : ""}
                            {searching && r.field === 3 && m.posMenuName ? <> · POS: <Marked text={m.posMenuName} marks={r.marks} /></> : null}
                            {m.lastSoldLabel ? ` · ${m.lastSoldLabel}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {m.qty > 0 ? (
                            <>
                              {m.qty.toLocaleString("th-TH")} จาน
                              <span className="block text-xs text-muted-subtle">{baht(m.net)}</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{avg === null ? "—" : baht(avg)}</td>
                        {!costHidden && (
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {pricesLoading && m.recipeId ? (
                              <span className="inline-block h-4 w-14 animate-pulse rounded bg-muted align-middle" />
                            ) : mc?.costPerServing == null ? (
                              <span className="text-muted-subtle">—</span>
                            ) : (
                              <>
                                {baht(mc.costPerServing, 2)}
                                {mc.confidence && mc.confidence !== "HIGH" && (
                                  <span className="block text-xs text-warn">ความมั่นใจ{confidenceTh(mc.confidence)}</span>
                                )}
                              </>
                            )}
                          </td>
                        )}
                        {!costHidden && (
                          <td className="px-4 py-2.5 tabular-nums">
                            {pricesLoading && m.recipeId ? (
                              <span className="inline-block h-4 w-20 animate-pulse rounded bg-muted align-middle" />
                            ) : pct === null ? (
                              <span className="text-muted-subtle">{!m.recipeId ? "ไม่มีสูตร" : m.qty === 0 ? "ยังไม่มียอดขาย" : "—"}</span>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <i className="inline-block h-1.5 rounded-full bg-border-strong" style={{ width: Math.min(pct, 80) * 0.9 }} />
                                {pct.toFixed(1)}%
                              </span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-2.5">
                          {m.recipeId ? (
                            <span className="whitespace-nowrap text-good">{m.recipeOwn ? "สูตรของสาขา" : "มีสูตร"}</span>
                          ) : m.hasDraft ? (
                            <span className="whitespace-nowrap text-warn">มีร่าง</span>
                          ) : (
                            <span className="whitespace-nowrap text-warn">ยังไม่มี</span>
                          )}
                        </td>
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {opened && branch && (
        <MenuSheet
          key={`${opened.id}-${branch.id}`}
          menu={opened}
          factDays={factDays}
          branch={branch}
          branches={props.branches}
          today={props.today}
          categories={props.categories}
          departments={props.departments}
          departmentsEnabled={props.departmentsEnabled}
          posIntegrationId={props.posIntegrationId}
          spellings={spellingsByWinner[opened.id] ?? []}
          mergedIntoLabel={mergedIntoLabel(opened.id)}
          costHidden={costHidden}
          perm={perm}
          book={book}
          options={options}
          standards={standards}
          needOptions={needOptions}
          onClose={() => setOpenId(null)}
          onSaved={() => {
            // A saved recipe moves its own price and every set that uses it.
            router.refresh();
            // A central recipe moves every branch's prices, so every book goes.
            setBooks({});
            setBookTick((t) => t + 1);
          }}
          onToast={setToast}
        />
      )}

      {toast && (
        <Portal>
          <div role="status" className="fixed bottom-6 left-1/2 z-[80] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-card">
            {toast}
          </div>
        </Portal>
      )}

      {addingCategory && (
        <ModalShell narrow onClose={() => setAddingCategory(false)} labelledBy="new-menu-category">
          <div className="pr-10">
            <h3 id="new-menu-category" className="text-lg font-semibold">
              เพิ่มหมวดเมนู
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">ส่วนใหญ่หมวดจะมาเองจากไฟล์ POS ใช้ช่องนี้เมื่ออยากจัดกลุ่มเมนูเอง</p>
            <NewCategoryForm />
          </div>
        </ModalShell>
      )}
    </div>
  );
}

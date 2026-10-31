"use client";

// "จัดการเมนู" — the list half (Kong, 2026-10-04; mockup
// https://claude.ai/artifact/NquaaTFahRgeSmPsyzxor5). Everything on the page is
// already loaded, so every filter, chip and keystroke answers at once; only the
// branch picker goes back to the server, because cost is per branch.
//
// Review round 2 (Kong 2026-10-29, mockup SKFJowadTVtzKV4Qc2gjWC, "โอเค"):
// the menus are GROUPED BY CATEGORY, each group's head a subtotal row lined up
// with the columns (sales · food cost % weighted by sales against the target ·
// profit); food cost % carries the dish's target, with what it is over by;
// profit per plate and over 30 days are columns; the toolbar stays on screen;
// search answers as you type without the input ever waiting on the list
// (useDeferredValue) and, like every search in the app, hides nothing: what
// resembles the query rises to the top (Kong 2026-10-29, "ใช้กฎที่ไม่ซ่อนอะไร").
//
// Kept from the old /menus: the รอตรวจ banner and queue, retired dishes one tap
// away, merged spellings nested under their dish (ADR 0026 Q6), + เพิ่มหมวด.

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { rankBySearch, hasQuery, highlightRuns, STRONG_MATCH, type SearchField } from "@/lib/smart-search";
import type { MenuRowView } from "./menu-view";
import type { MergeMenuView } from "./menu-merge-view";
import { mergedSpellingsLabel } from "./menu-merge-view";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import NewCategoryForm from "./NewCategoryForm";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import Stat, { StatGrid } from "@/components/ui/Stat";
import MenuSheet from "./MenuSheet";
import { Portal } from "./sheet-parts";
import { ingredientOptions, menuSheet, priceBook } from "./prefetch";
import { atLeastTh, atMostTh, baht } from "./manager-format";
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
  /** This dish's own food-cost target in % of its price; null = the shop's. */
  targetPct: number | null;
  /** First business day with a live sale (YYYY-MM-DD), or null — offered as a first recipe's start. */
  firstSaleDate: string | null;
};

export type Perm = { editMenu: boolean; deleteMenu: boolean; recipe: boolean; recipeShared: boolean; yield: boolean; /** Sees the sales block in the sheet. */ sales?: boolean };
export type Option = { id: string; name: string };

type Status = "all" | "none" | "write" | "over" | "trial" | "review" | "retired" | "every";
type Sort = "sold" | "profit" | "over" | "name";
type Mode = "cat" | "flat";
const NO_CATEGORY = "ไม่มีหมวด";
const STATUS_TH: Record<Status, string> = {
  all: "ขายอยู่",
  none: "ยังไม่มีสูตร",
  write: "ต้องเขียนสูตร",
  over: "เกินเป้า",
  trial: "กำลังทดลอง",
  review: "รอตรวจ",
  retired: "เลิกขายแล้ว",
  every: "ทั้งหมด",
};
/** The cost bar runs 0–80% of the price; the target sits on it as a tick. */
const BAR_MAX = 80;

function Marked({ text, marks }: { text: string; marks: readonly number[] }) {
  return (
    <>
      {highlightRuns(text, marks).map((r, i) =>
        r.hit ? (
          <mark key={i} className="rounded-sm bg-wash px-px font-semibold text-inherit">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        )
      )}
    </>
  );
}

/** Food cost % on a 0–80% bar, the target as a tick; over the target turns it red. */
function CostBar({ pct, target, over }: { pct: number; target: number; over: boolean }) {
  return (
    <span className="relative inline-block h-2 w-24 flex-none rounded-full bg-muted" aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (pct / BAR_MAX) * 100)}%`, background: over ? "#DD8A74" : "#AEB784" }} />
      <span className="absolute -top-[3px] h-3.5 w-0.5 rounded-sm bg-primary" style={{ left: `${Math.min(100, (target / BAR_MAX) * 100)}%` }} />
    </span>
  );
}

/** Under the matches while searching: everything else, still here. */
function OtherLine() {
  return <div className="border-b border-border bg-background px-4 py-1 text-[11px] text-muted-subtle">เมนูอื่น</div>;
}

const pct1 = (v: number) => `${v.toFixed(1)}%`;
const pctTarget = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;

export default function MenuManager(props: {
  rows: ManagerRow[];
  factDays: number;
  /** The days those figures cover — the latest 30 with sales, e.g. "28 ส.ค. 69 – 26 ก.ย. 69". */
  factRange: string;
  /** No-recipe dishes that look like another branch's copy of a dish with one. */
  dupOf: Record<string, { id: string; name: string; code: string | null }>;
  /** The shop's food-cost target, % of price. */
  shopTargetPct: number;
  spellingsByWinner: Record<string, MergeMenuView[]>;
  winnerOf: Record<string, { id: string; label: string }>;
  categories: Option[];
  departments: Option[];
  departmentsEnabled: boolean;
  posIntegrationId: string | null;
  branches: Option[];
  branch: Option | null;
  /** The server's price book for `branch`, still computing when the page arrives. */
  initialBook: { branchId: string; book: Promise<PriceBook | null> } | null;
  today: string;
  initialStatus: "all" | "none" | "review" | "retired";
  initialMenuId: string | null;
  costHidden: boolean;
  perm: Perm;
}) {
  const { rows, factDays, spellingsByWinner, winnerOf, branch, costHidden, perm, dupOf, shopTargetPct } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(props.initialStatus);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The input shows every keystroke at once; the list follows a beat later if
  // it has to — typing never waits on 500 rows re-rendering.
  const deferredQuery = useDeferredValue(query);
  const [sort, setSort] = useState<Sort>("sold");
  const [mode, setMode] = useState<Mode>("cat");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(
    props.initialMenuId && rows.some((r) => r.id === props.initialMenuId) ? props.initialMenuId : null
  );
  const [addingCategory, setAddingCategory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // The phone's app bar and the toolbar, measured, so sticky heads sit under them.
  const [appBarH, setAppBarH] = useState(0);
  const [toolbarH, setToolbarH] = useState(0);

  // Prices come once per branch and are kept — switching back to a branch
  // already seen costs nothing (mise-ui-review §5b). The server STARTS the
  // book with the page (`initialBook`, Kong 2026-10-22); /api/menus is the
  // fallback when that promise is missing, used up or failed.
  const [books, setBooks] = useState<Record<string, PriceBook>>({});
  const [bookTick, setBookTick] = useState(0);
  const usedServerBooks = useRef(new WeakSet<Promise<PriceBook | null>>());
  // After a save the page refreshes and the server starts a fresh book; asking
  // /api/menus as well would compute it twice.
  const awaitingServerBook = useRef(false);
  const book = branch ? (books[branch.id] ?? null) : null;
  const branchId = branch?.id ?? null;
  const haveBook = branchId !== null && branchId in books;
  // Keyed by branch, so a late answer for a branch no longer on screen is
  // simply kept for when it comes back — no "is this still current" flag, which
  // React's dev double-run of effects turned into a dropped answer.
  const asking = useRef(new Set<string>());
  const serverBook = props.initialBook;
  useEffect(() => {
    if (costHidden || branchId === null || haveBook || asking.current.has(branchId)) return;
    const fromApi = () => {
      asking.current.add(branchId);
      void priceBook(branchId).then((r) => {
        asking.current.delete(branchId);
        if (r.ok) setBooks((b) => ({ ...b, [branchId]: r.book }));
      });
    };
    if (serverBook && serverBook.branchId === branchId && !usedServerBooks.current.has(serverBook.book)) {
      usedServerBooks.current.add(serverBook.book);
      awaitingServerBook.current = false;
      asking.current.add(branchId);
      void serverBook.book.then((b) => {
        asking.current.delete(branchId);
        if (b) setBooks((all) => ({ ...all, [branchId]: b }));
        else fromApi();
      });
      return;
    }
    if (awaitingServerBook.current) return;
    fromApi();
  }, [branchId, haveBook, costHidden, bookTick, serverBook]);
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

  // "/" jumps to the search box from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Sticky offsets, measured rather than guessed (fonts and wrapping move them).
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("[data-appbar]");
    const tb = toolbarRef.current;
    const measure = () => {
      setAppBarH(bar && getComputedStyle(bar).display !== "none" ? bar.offsetHeight : 0);
      setToolbarH(tb?.offsetHeight ?? 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (bar) ro.observe(bar);
    if (tb) ro.observe(tb);
    return () => ro.disconnect();
  }, [rows.length]);

  const typeQuery = (v: string) => setQuery(v);

  // ---- numbers per dish ----
  const facts = useMemo(() => {
    const out = new Map<string, { avg: number | null; cost: number | null; low: boolean; pct: number | null; target: number; over: boolean; overBy: number | null; profitPlate: number | null; profit30: number | null }>();
    for (const r of rows) {
      const avg = r.qty > 0 ? r.net / r.qty : null;
      const mc = book?.menus[r.id] ?? null;
      const cost = mc?.costPerServing ?? null;
      const pct = avg && cost != null ? (cost / avg) * 100 : null;
      const target = r.targetPct ?? shopTargetPct;
      const over = pct !== null && pct > target + 1e-9;
      out.set(r.id, {
        avg,
        cost,
        // Rule RC-LB: a dish with an unpriced ingredient is a floor on cost and a ceiling on profit.
        low: mc?.confidence === "LOW",
        pct,
        target,
        over,
        overBy: pct === null ? null : pct - target,
        profitPlate: avg !== null && cost != null ? avg - cost : null,
        profit30: cost != null && r.qty > 0 ? r.net - r.qty * cost : null,
      });
    }
    return out;
  }, [rows, book, shopTargetPct]);
  const fx = (id: string) => facts.get(id)!;

  // Kong 2026-10-22: a dish that exists only as a lab draft — made in the lab
  // (no POS code), no recipe, nothing sold — is not on sale yet, so it is
  // "กำลังทดลอง", counted apart from ขายอยู่ and ยังไม่มีสูตร until it is published.
  const isTrial = (r: ManagerRow) => !r.isRetired && r.recipeId === null && r.hasDraft && !r.posMenuCode && r.qty === 0;
  const trial = rows.filter(isTrial);
  const selling = rows.filter((r) => !r.isRetired && !isTrial(r));
  const noRecipe = selling.filter((r) => r.recipeId === null);
  const dupCount = noRecipe.filter((r) => dupOf[r.id]).length;
  const toWrite = noRecipe.length - dupCount;
  const stubCount = selling.filter((r) => r.isPosStub).length;
  const costedSelling = selling.filter((r) => fx(r.id).pct !== null);
  const overSelling = costedSelling.filter((r) => fx(r.id).over);

  const stats = useMemo(() => {
    const total = selling.reduce((s, r) => s + r.net, 0);
    const covered = selling.filter((r) => r.recipeId !== null).reduce((s, r) => s + r.net, 0);
    const cost = costedSelling.reduce((s, r) => s + fx(r.id).cost! * r.qty, 0);
    const netCosted = costedSelling.reduce((s, r) => s + r.net, 0);
    // The target the whole menu is held to: each dish's own, weighted by what it sold.
    const target = netCosted > 0 ? costedSelling.reduce((s, r) => s + fx(r.id).target * r.net, 0) / netCosted : shopTargetPct;
    return {
      total,
      covered,
      coverage: total > 0 ? (covered / total) * 100 : null,
      foodCost: netCosted > 0 ? (cost / netCosted) * 100 : null,
      target,
      ownTargets: costedSelling.some((r) => r.targetPct !== null),
      lowCount: costedSelling.filter((r) => fx(r.id).low).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selling, facts]);

  const inStatus = (r: ManagerRow, s: Status = status) =>
    s === "every"
      ? true
      : s === "retired"
        ? r.isRetired
        : s === "review"
          ? r.isPosStub && !r.isRetired
          : s === "trial"
            ? isTrial(r)
            : s === "none"
              ? !r.isRetired && r.recipeId === null && !isTrial(r)
              : s === "write"
                ? !r.isRetired && r.recipeId === null && !isTrial(r) && !dupOf[r.id]
                : s === "over"
                  ? !r.isRetired && !isTrial(r) && fx(r.id).over
                  : !r.isRetired && !isTrial(r);
  const byStatus = rows.filter((r) => inStatus(r));
  const catOf = (r: ManagerRow) => r.menuCategoryName ?? NO_CATEGORY;
  const categoryChips = useMemo(() => {
    const seen = new Map<string, { tone: string; count: number }>();
    for (const r of byStatus) {
      const c = seen.get(catOf(r));
      seen.set(catOf(r), { tone: r.tone, count: (c?.count ?? 0) + 1 });
    }
    return [...seen].sort(([a], [b]) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b, "th")));
  }, [byStatus]);

  // Sort inside a list: what costs nothing to know comes last.
  const bySort = (a: ManagerRow, b: ManagerRow) => {
    if (sort === "name") return a.name.localeCompare(b.name, "th");
    if (sort === "profit" && !costHidden) {
      const pa = fx(a.id).profit30, pb = fx(b.id).profit30;
      if (pa !== pb) return pb === null ? -1 : pa === null ? 1 : pb - pa;
    }
    if (sort === "over" && !costHidden) {
      const oa = fx(a.id).overBy, ob = fx(b.id).overBy;
      if (oa !== ob) return ob === null ? -1 : oa === null ? 1 : ob - oa;
    }
    return b.net - a.net || a.name.localeCompare(b.name, "th");
  };
  const scoped = byStatus.filter((r) => category === null || catOf(r) === category);

  const fields: SearchField<ManagerRow>[] = [
    { get: (r) => r.name, kind: "name" },
    { get: (r) => r.posMenuCode, kind: "code" },
    { get: (r) => r.menuCategoryName, kind: "category" },
    { get: (r) => r.posMenuName, kind: "name" },
  ];
  const searching = hasQuery(deferredQuery);
  type Hit = { item: ManagerRow; score: number; field: number | null; marks: number[] };
  // The app-wide rule (smart-search.ts; Kong 2026-10-29: "ใช้กฎที่ไม่ซ่อนอะไร
  // แหละถูกแล้ว … แค่ sort ให้ตัวที่คล้ายขึ้นมาอยู่บนสุด"): typing hides nothing.
  // What resembles the query rises to the top; the rest stays, below a line.
  const ranked: Hit[] = searching
    ? rankBySearch(scoped, deferredQuery, fields).map((r) => ({ item: r.item, score: r.score, field: r.field, marks: [...r.marks] }))
    : scoped.map((item) => ({ item, score: 0, field: null, marks: [] }));
  const rankOrder = (a: Hit, b: Hit) => (searching ? b.score - a.score : 0) || bySort(a.item, b.item);

  // A spelling folds under its dish only while the dish itself is on screen.
  const shownIds = new Set(ranked.map((r) => r.item.id));
  const visible = ranked.filter((r) => !(winnerOf[r.item.id] && shownIds.has(winnerOf[r.item.id].id)));
  const mergedIntoLabel = (id: string) => (winnerOf[id] && !shownIds.has(winnerOf[id].id) ? winnerOf[id].label : null);

  // ---- groups: one per category, its head a subtotal over the status scope ----
  const groups = useMemo(() => {
    if (mode === "flat") return [];
    const base = byStatus.filter((r) => category === null || catOf(r) === category);
    const totalNet = selling.reduce((s, r) => s + r.net, 0);
    const names = [...new Set(base.map(catOf))];
    const list = names.map((name) => {
      const all = base.filter((r) => catOf(r) === name);
      const costed = all.filter((r) => fx(r.id).pct !== null);
      const costedNet = costed.reduce((s, r) => s + r.net, 0);
      const net = all.reduce((s, r) => s + r.net, 0);
      return {
        name,
        tone: all[0]?.tone ?? "#AEB784",
        count: all.length,
        withoutRecipe: all.filter((r) => r.recipeId === null).length,
        net,
        share: totalNet > 0 ? (net / totalNet) * 100 : null,
        pct: costedNet > 0 ? (costed.reduce((s, r) => s + fx(r.id).cost! * r.qty, 0) / costedNet) * 100 : null,
        target: costedNet > 0 ? costed.reduce((s, r) => s + fx(r.id).target * r.net, 0) / costedNet : shopTargetPct,
        low: costed.some((r) => fx(r.id).low),
        profit: costed.length > 0 ? costed.reduce((s, r) => s + fx(r.id).profit30!, 0) : null,
        overCount: costed.filter((r) => fx(r.id).over).length,
      };
    });
    const order =
      sort === "name"
        ? (a: (typeof list)[number], b: (typeof list)[number]) => (a.name === NO_CATEGORY ? 1 : b.name === NO_CATEGORY ? -1 : a.name.localeCompare(b.name, "th"))
        : sort === "profit" && !costHidden
          ? (a: (typeof list)[number], b: (typeof list)[number]) => (b.profit ?? -1e15) - (a.profit ?? -1e15)
          : sort === "over" && !costHidden
            ? (a: (typeof list)[number], b: (typeof list)[number]) => b.overCount - a.overCount || (b.pct ?? 0) - (a.pct ?? 0)
            : (a: (typeof list)[number], b: (typeof list)[number]) => b.net - a.net;
    return list.sort(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byStatus, category, mode, sort, facts]);

  const opened = openId === null ? null : (rows.find((r) => r.id === openId) ?? null);

  const pickBranch = (id: string) =>
    startTransition(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("branch", id);
      router.push(`${url.pathname}${url.search}` as Route, { scroll: false });
    });

  const count = (s: Status) => rows.filter((r) => inStatus(r, s)).length;
  const statusPills: Status[] = (["all", "none", "over", "trial", "review", "retired", "every"] as Status[]).filter(
    (s) => s === status || s === "all" || s === "every" || (s === "over" ? !costHidden && !pricesLoading && count(s) > 0 : count(s) > 0)
  );
  if (status === "write" && !statusPills.includes("write")) statusPills.splice(2, 0, "write");

  const cols = costHidden
    ? "md:grid-cols-[minmax(0,3fr)_1fr_0.9fr_1.2fr]"
    : "md:grid-cols-[minmax(0,2.3fr)_1fr_0.8fr_0.9fr_1.9fr_0.9fr_1fr]";

  const pulse = (w: string) => <span className={`inline-block h-4 ${w} animate-pulse rounded bg-muted align-middle`} />;

  // What the no-recipe dishes say in place of their numbers.
  const noRecipeNote = (m: ManagerRow): ReactNode => {
    const dup = dupOf[m.id];
    if (dup)
      return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <span className="chip chip-warn">น่าจะซ้ำ</span>
          <span>
            เมนูเดียวกับ {dup.name}
            {dup.code ? ` (${dup.code})` : ""} ที่มีสูตรแล้ว
          </span>
          {perm.editMenu && (
            <a href="/menus/merges" onClick={(e) => e.stopPropagation()} className="font-semibold text-primary underline underline-offset-2">
              รวมเมนู
            </a>
          )}
        </span>
      );
    if (isTrial(m)) return <span className="chip">กำลังทดลอง</span>;
    if (m.hasDraft) return <span className="text-[13px] text-warn">มีร่างในทดลองเมนู</span>;
    return (
      <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <span className="max-md:hidden">ยังไม่มีสูตร — คิดต้นทุนและกำไรไม่ได้</span>
        {/* The row opens the sheet, where the recipe is written — this only says so. */}
        <span className="whitespace-nowrap rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-xs text-primary group-hover:border-primary">+ เขียนสูตร</span>
      </span>
    );
  };

  const renderRow = (h: Hit, showCategory: boolean) => {
    const m = h.item;
    const f = fx(m.id);
    const weak = searching && h.score > 0 && h.score < STRONG_MATCH;
    const other = searching && h.score === 0;
    const spellings = spellingsByWinner[m.id] ?? [];
    const mark = (text: string | null, field: number) =>
      text === null ? null : searching && h.field === field ? <Marked text={text} marks={h.marks} /> : text;
    const meta = [
      showCategory || (searching && h.field === 2) ? mark(m.menuCategoryName, 2) ?? NO_CATEGORY : null,
      spellings.length > 0 ? mergedSpellingsLabel(spellings.length) : null,
      mergedIntoLabel(m.id) ? `นับรวมเป็น “${mergedIntoLabel(m.id)}”` : null,
      searching && h.field === 3 && m.posMenuName ? (
        <>
          POS: <Marked text={m.posMenuName} marks={h.marks} />
        </>
      ) : null,
      m.lastSoldLabel,
    ].filter((x) => x !== null && x !== "");
    const loading = pricesLoading && m.recipeId !== null;
    const has = f.cost !== null;
    const name = (
      <span className="min-w-0">
        <span className="font-semibold">{mark(m.name, 0)}</span>
        {m.posMenuCode && <span className="ml-1.5 text-xs tabular-nums text-muted-subtle">{mark(m.posMenuCode, 1)}</span>}
        {weak && <span className="chip ml-1.5 align-middle">ใกล้เคียง</span>}
        {m.isPosStub && !m.isRetired && <span className="chip ml-1.5 align-middle">รอตรวจ</span>}
        {m.isRetired && <span className="chip ml-1.5 align-middle">เลิกขายแล้ว</span>}
        {m.recipeOwn && <span className="chip ml-1.5 align-middle">สูตรของสาขา</span>}
        {meta.length > 0 && (
          <span className="block text-xs text-muted-foreground">
            {meta.map((x, i) => (
              <span key={i}>
                {i > 0 && " · "}
                {x}
              </span>
            ))}
          </span>
        )}
      </span>
    );
    const sold = m.qty > 0 ? `${m.qty.toLocaleString("th-TH")} จาน` : "—";
    return (
      <div
        key={m.id}
        role="button"
        tabIndex={0}
        onClick={() => setOpenId(m.id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(m.id))}
        // Start the sheet's read once the pointer RESTS on a row (not on every
        // row it crosses); the click finds it ready.
        onPointerEnter={() => {
          clearTimeout(hoverTimer.current);
          hoverTimer.current = setTimeout(() => branch && void menuSheet(m.id, branch.id), 150);
        }}
        onPointerLeave={() => clearTimeout(hoverTimer.current)}
        className={`group cursor-pointer border-b border-border px-4 py-2.5 transition-colors last:border-b-0 hover:bg-surface-sunk focus-visible:bg-surface-sunk focus-visible:outline-none ${openId === m.id ? "bg-highlight" : m.recipeId === null ? "bg-[#FFFEFA]" : ""} ${other ? "opacity-50 hover:opacity-100" : ""}`}
      >
        {/* Desktop: the columns. */}
        <div className={`hidden items-center gap-x-3.5 md:grid ${cols}`}>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: m.tone }} />
            {name}
          </span>
          <span className="text-right tabular-nums">
            {sold}
            {m.qty > 0 && <span className="block text-xs text-muted-subtle">{baht(m.net)}</span>}
          </span>
          <span className="text-right tabular-nums">{f.avg === null ? "—" : baht(f.avg)}</span>
          {costHidden ? (
            <span className="text-sm">{m.recipeId ? <span className="text-good">{m.recipeOwn ? "สูตรของสาขา" : "มีสูตร"}</span> : noRecipeNote(m)}</span>
          ) : m.recipeId === null ? (
            <span className="col-span-4">{noRecipeNote(m)}</span>
          ) : loading ? (
            <>
              <span className="text-right">{pulse("w-14")}</span>
              <span>{pulse("w-28")}</span>
              <span className="text-right">{pulse("w-12")}</span>
              <span className="text-right">{pulse("w-16")}</span>
            </>
          ) : (
            <>
              <span className="text-right tabular-nums">{has ? atLeastTh(f.low, baht(f.cost!, 2)) : "—"}</span>
              <span className="flex min-w-0 items-center gap-2">
                {f.pct === null ? (
                  <span className="text-sm text-muted-subtle">{m.qty === 0 ? "ยังไม่มียอดขาย" : "—"}</span>
                ) : (
                  <>
                    <CostBar pct={f.pct} target={f.target} over={f.over} />
                    <span className="w-12 flex-none text-right font-medium tabular-nums">{atLeastTh(f.low, pct1(f.pct))}</span>
                    {f.over && <span className="chip chip-bad">เกิน {f.overBy!.toFixed(1)} จุด</span>}
                  </>
                )}
              </span>
              <span className="text-right tabular-nums">{f.profitPlate === null ? "—" : atMostTh(f.low, baht(f.profitPlate, 2))}</span>
              <span className="text-right font-semibold tabular-nums">{f.profit30 === null ? "—" : atMostTh(f.low, baht(f.profit30))}</span>
            </>
          )}
        </div>
        {/* Phone: two lines — the dish and its profit, then what it sold and costs. */}
        <div className="space-y-1 md:hidden">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: m.tone }} />
              {name}
            </span>
            {!costHidden && m.recipeId !== null && (
              <span className="flex-none whitespace-nowrap font-display font-semibold tabular-nums">
                {loading ? pulse("w-14") : f.profit30 === null ? "—" : <><span className="font-sans text-xs font-normal text-muted-foreground">กำไร</span> {atMostTh(f.low, baht(f.profit30))}</>}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-[13px] text-muted-foreground">
            {m.recipeId === null ? (
              <>
                <span className="tabular-nums">{sold}{f.avg !== null && ` · ${baht(f.avg)}`}</span>
                {noRecipeNote(m)}
              </>
            ) : (
              <>
                <span className="tabular-nums">
                  {sold}
                  {f.avg !== null && ` · ${baht(f.avg)}`}
                  {!costHidden && !loading && f.pct !== null && ` · ต้นทุน ${atLeastTh(f.low, pct1(f.pct))}`}
                </span>
                {!costHidden && !loading && f.over && <span className="chip chip-bad">เกิน {f.overBy!.toFixed(1)} จุด</span>}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const hitsByCat = new Map<string, Hit[]>();
  for (const h of visible) {
    const k = catOf(h.item);
    hitsByCat.set(k, [...(hitsByCat.get(k) ?? []), h]);
  }
  const matchCount = searching ? visible.filter((h) => h.score > 0).length : visible.length;
  const bestIn = (name: string) => Math.max(0, ...(hitsByCat.get(name) ?? []).map((h) => h.score));
  // While searching, the categories holding the closest matches come first.
  const shownGroups = groups.filter((g) => hitsByCat.has(g.name)).sort((a, b) => (searching ? bestIn(b.name) - bestIn(a.name) : 0));
  const allClosed = groups.length > 0 && groups.every((g) => closed.has(g.name));
  const elsewhere = searching && matchCount === 0 ? rankBySearch(rows.filter((r) => !scoped.includes(r)), deferredQuery, fields).filter((r) => r.score > 0).length : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="จัดการเมนู"
        description="ทุกเมนูที่ร้านขาย พร้อมสูตร ต้นทุน และกำไร · กดที่แถวเพื่อดูและแก้ไขได้ในที่เดียว"
        actions={
          <>
            {perm.editMenu && (
              <a href="/menus/merges" className="btn-secondary">
                รวมเมนูที่ซ้ำ
              </a>
            )}
            {perm.recipeShared && (
              <a href="/recipes/substitute" className="btn-secondary">
                เปลี่ยนวัตถุดิบในหลายสูตร
              </a>
            )}
            {perm.recipe && (
              <a href="/menus/import" className="btn-secondary">
                นำเข้าสูตรจากไฟล์
              </a>
            )}
            {perm.recipe && (
              <a href="/menus/lab/new" className="btn">
                + ทดลองเมนูใหม่
              </a>
            )}
          </>
        }
      />

      {!costHidden && branch && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
          <span>ต้นทุนคิดที่</span>
          {props.branches.length > 1 ? (
            <div className="seg" role="group" aria-label="สาขาที่ใช้คิดต้นทุน">
              {props.branches.map((b) => (
                <button key={b.id} type="button" onClick={() => b.id !== branch.id && pickBranch(b.id)} className={`seg-item ${b.id === branch.id ? "is-on" : ""}`}>
                  {b.name}
                </button>
              ))}
            </div>
          ) : (
            <span className="font-medium text-foreground">{branch.name}</span>
          )}
          <span>ราคาวัตถุดิบ ณ วันนี้ · แต่ละสาขาซื้อของคนละราคา ต้นทุนจึงไม่เท่ากัน</span>
          {pending && <span className="text-primary">กำลังคำนวณ…</span>}
        </div>
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
          {/* ---------------- ภาพรวม ---------------- */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">ภาพรวม {factDays} วัน</h2>
              <span className="text-xs text-muted-subtle">
                {props.factRange}
                {!costHidden && branch ? ` · ต้นทุนที่${branch.name}` : ""}
              </span>
            </div>

            {/* B3 (Kong 2026-10-24) / round 2 (2026-10-29): one line, and the real
                next step — merge the copies first, then only the rest need a recipe. */}
            {noRecipe.length > 0 && status !== "none" && status !== "write" && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-2xl border border-warn-border bg-warn-bg px-4 py-3">
                <p className="min-w-0 flex-[1_1_420px] text-sm">
                  <b>{noRecipe.length} เมนูขายอยู่แต่ยังไม่มีสูตร</b>
                  {dupCount > 0 ? (
                    <>
                      {" "}
                      — {dupCount} ในนั้นน่าจะเป็นเมนูเดียวกับเมนูที่มีสูตรแล้ว (จากอีกสาขา) รวมเมนูก่อน แล้วเหลือเขียนสูตรจริง <b>{toWrite} เมนู</b>
                    </>
                  ) : (
                    " — ยังคิดต้นทุนไม่ได้และยังไม่ถูกตัดสต๊อก"
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  {dupCount > 0 && perm.editMenu && (
                    <a href="/menus/merges" className="btn-secondary btn-sm">
                      รวมเมนูที่ซ้ำ ({dupCount})
                    </a>
                  )}
                  {toWrite > 0 && (
                    <button type="button" onClick={() => setStatus("write")} className="btn-secondary btn-sm">
                      ดู {toWrite} เมนูที่ต้องเขียนสูตร
                    </button>
                  )}
                </div>
              </div>
            )}

            {stubCount > 0 && status !== "review" && (
              <button
                type="button"
                onClick={() => setStatus("review")}
                className="block w-full rounded-2xl border border-warn-border bg-warn-bg px-4 py-3 text-left text-sm text-warn transition-colors hover:brightness-95"
              >
                มีเมนูใหม่จากไฟล์ที่ยังไม่ได้ตรวจ {stubCount} รายการ — กดเพื่อดูเฉพาะรายการเหล่านี้
              </button>
            )}

            <StatGrid className={costHidden ? "lg:grid-cols-2" : ""}>
              <Stat
                label="เมนูที่ขายอยู่"
                value={selling.length}
                sub={
                  <>
                    มีสูตร {selling.length - noRecipe.length} · ยังไม่มีสูตร {noRecipe.length}
                    {trial.length > 0 && (
                      <>
                        {" · "}
                        <button type="button" onClick={() => setStatus("trial")} className="text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid">
                          {trial.length} กำลังทดลอง
                        </button>
                      </>
                    )}
                  </>
                }
              />
              <Stat
                label={`มีสูตรแล้ว คิดเป็นยอดขาย ${factDays} วัน`}
                value={stats.coverage === null ? "—" : `${stats.coverage.toFixed(0)}%`}
                sub={
                  stats.coverage === null ? (
                    "ยังไม่มียอดขายในช่วงนี้"
                  ) : (
                    <>
                      <span className="mb-1 mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${stats.coverage}%` }} />
                      </span>
                      {baht(stats.total - stats.covered)} ยังคิดต้นทุนไม่ได้
                    </>
                  )
                }
              />
              {!costHidden && (
                <Stat
                  label="ต้นทุนตามสูตร เทียบยอดขาย"
                  tone={stats.foodCost !== null && stats.foodCost > stats.target ? "bad" : undefined}
                  value={pricesLoading ? pulse("w-20") : stats.foodCost === null ? "—" : atLeastTh(stats.lowCount > 0, pct1(stats.foodCost))}
                  sub={
                    pricesLoading
                      ? "กำลังคำนวณ…"
                      : stats.foodCost === null
                        ? "ยังไม่มีเมนูที่มีสูตรและมียอดขาย"
                        : `เป้า${stats.ownTargets ? " (ถ่วงตามยอดขาย)" : "ร้าน"} ${pctTarget(stats.target)}${stats.foodCost > stats.target ? ` · เกิน ${(stats.foodCost - stats.target).toFixed(1)} จุด` : ""} · คิดจาก ${costedSelling.length} เมนูที่มีสูตร${stats.lowCount > 0 ? ` · ${stats.lowCount} เมนูราคาวัตถุดิบยังไม่ครบ` : ""}`
                  }
                />
              )}
              {!costHidden && (
                <Stat
                  label="เกินเป้าต้นทุน"
                  tone={overSelling.length > 0 ? "bad" : "good"}
                  value={pricesLoading ? pulse("w-16") : `${overSelling.length} เมนู`}
                  sub={pricesLoading ? "กำลังคำนวณ…" : overSelling.length > 0 ? `จาก ${costedSelling.length} เมนูที่มีสูตร · กดเพื่อดูเฉพาะเมนูเหล่านี้` : `ทุกเมนูที่มีสูตรอยู่ในเป้า`}
                  pressed={status === "over"}
                  onClick={
                    pricesLoading || overSelling.length === 0
                      ? undefined
                      : () => {
                          setStatus(status === "over" ? "all" : "over");
                          if (status !== "over") setSort("over");
                          toolbarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }
                  }
                />
              )}
            </StatGrid>
          </section>

          {/* ---------------- เมนูทั้งหมด ---------------- */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">เมนูทั้งหมด</h2>
              {mode === "cat" && groups.length > 1 && (
                <span className="text-xs text-muted-subtle">
                  กดหัวหมวดเพื่อย่อ/ขยาย ·{" "}
                  <button type="button" onClick={() => setClosed(allClosed ? new Set() : new Set(groups.map((g) => g.name)))} className="font-medium text-primary underline underline-offset-2">
                    {allClosed ? "ขยายทุกหมวด" : "ย่อทุกหมวด"}
                  </button>
                </span>
              )}
            </div>

            {/* The toolbar stays on screen while the list scrolls under it. */}
            <div
              ref={toolbarRef}
              style={{ top: appBarH }}
              className="sticky z-20 -mx-1 space-y-2.5 rounded-2xl border border-border bg-surface px-3 pt-3 shadow-[0_10px_24px_-18px_rgba(38,40,17,.45)] sm:mx-0 sm:px-4"
            >
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                <label className="relative min-w-0 flex-[1_1_300px]">
                  <span className="sr-only">ค้นหาเมนู</span>
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-subtle">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => typeQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && typeQuery("")}
                    placeholder="ค้นหาเมนู · ชื่อ รหัส POS หรือหมวด"
                    autoComplete="off"
                    className="input w-full pl-10 pr-12 [&::-webkit-search-cancel-button]:hidden"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    {query ? (
                      <button type="button" onClick={() => (typeQuery(""), searchRef.current?.focus())} aria-label="ล้างคำค้น" className="grid h-6 w-6 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground">
                        ×
                      </button>
                    ) : (
                      <kbd className="hidden rounded-md border border-b-2 border-border-strong bg-surface-sunk px-1.5 text-xs text-muted-subtle sm:inline">/</kbd>
                    )}
                  </span>
                </label>
                {/* Phone: both switches on one row that scrolls sideways. */}
                <div className="-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-2 overflow-x-auto px-3 sm:mx-0 sm:w-auto sm:gap-2.5 sm:overflow-visible sm:px-0">
                <span className="hidden text-[13px] text-muted-foreground sm:inline">แสดง</span>
                <div className="seg flex-none flex-nowrap" role="group" aria-label="แสดงแบบ">
                  <button type="button" onClick={() => setMode("cat")} className={`seg-item ${mode === "cat" ? "is-on" : ""}`}>
                    ตามหมวด
                  </button>
                  <button type="button" onClick={() => setMode("flat")} className={`seg-item ${mode === "flat" ? "is-on" : ""}`}>
                    รวมทุกหมวด
                  </button>
                </div>
                <span className="hidden text-[13px] text-muted-foreground sm:inline">เรียง</span>
                <div className="seg flex-none flex-nowrap" role="group" aria-label="เรียงตาม">
                  <button type="button" onClick={() => setSort("sold")} className={`seg-item ${sort === "sold" ? "is-on" : ""}`}>
                    ขายดี
                  </button>
                  {!costHidden && (
                    <button type="button" onClick={() => setSort("profit")} className={`seg-item ${sort === "profit" ? "is-on" : ""}`}>
                      กำไรรวม
                    </button>
                  )}
                  {!costHidden && (
                    <button type="button" onClick={() => setSort("over")} className={`seg-item ${sort === "over" ? "is-on" : ""}`}>
                      เกินเป้ามากสุด
                    </button>
                  )}
                  <button type="button" onClick={() => setSort("name")} className={`seg-item ${sort === "name" ? "is-on" : ""}`}>
                    ชื่อ
                  </button>
                </div>
                </div>
              </div>
              {/* Phone: one row that scrolls sideways, so the bar stays short. */}
              <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-3 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                <div className="flex flex-none gap-1.5 sm:flex-wrap" role="group" aria-label="สถานะ">
                  {statusPills.map((s) => (
                    <button key={s} type="button" className={`pill flex-none gap-1.5 ${status === s ? "is-on" : ""}`} onClick={() => setStatus(s === status && s !== "all" ? "all" : s)}>
                      {STATUS_TH[s]}
                      <span className={`tabular-nums ${status === s ? "text-wash" : "text-muted-subtle"}`}>{count(s)}</span>
                    </button>
                  ))}
                </div>
                <span aria-hidden="true" className="mx-1 w-px flex-none self-stretch bg-border" />
                <div className="flex flex-none gap-1.5 sm:flex-wrap" role="group" aria-label="หมวดเมนู">
                  <button type="button" className={`pill flex-none gap-1.5 ${category === null ? "is-on" : ""}`} onClick={() => setCategory(null)}>
                    ทุกหมวด
                  </button>
                  {categoryChips.map(([name, c]) => (
                    <button key={name} type="button" className={`pill flex-none gap-1.5 ${category === name ? "is-on" : ""}`} onClick={() => setCategory(category === name ? null : name)}>
                      <span className="h-2 w-2 rounded-full" style={{ background: c.tone }} />
                      {name}
                      <span className={`tabular-nums ${category === name ? "text-wash" : "text-muted-subtle"}`}>{c.count}</span>
                    </button>
                  ))}
                  {perm.editMenu && (
                    <button type="button" onClick={() => setAddingCategory(true)} className="pill flex-none border-dashed bg-transparent text-muted-foreground">
                      + เพิ่มหมวด
                    </button>
                  )}
                </div>
              </div>
              <div className={`-mx-3 hidden gap-x-3.5 rounded-b-2xl border-t border-border bg-surface-sunk px-4 py-2 text-xs font-medium text-muted-subtle sm:-mx-4 md:grid ${cols}`}>
                <span>เมนู</span>
                <span className="text-right">ขาย {factDays} วัน</span>
                <span className="text-right">ราคาเฉลี่ย</span>
                {costHidden ? (
                  <span>สูตร</span>
                ) : (
                  <>
                    <span className="text-right">ต้นทุน/จาน</span>
                    <span>ต้นทุน % ของราคา · เส้น = เป้า</span>
                    <span className="text-right">กำไร/จาน</span>
                    <span className="text-right">กำไร {factDays} วัน</span>
                  </>
                )}
              </div>
            </div>

            <p className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[13px] text-muted-foreground" aria-live="polite">
              {searching ? (
                <>
                  {matchCount > 0 ? (
                    <span>
                      ตรงกับ “{deferredQuery.trim()}” <b className="text-foreground">{matchCount} เมนู</b>
                      {mode === "cat" && (
                        <>
                          {" "}
                          ใน <b className="text-foreground">{shownGroups.filter((g) => bestIn(g.name) > 0).length} หมวด</b>
                        </>
                      )}{" "}
                      — ขึ้นไปอยู่บนสุด เมนูอื่นยังอยู่ด้านล่าง
                    </span>
                  ) : (
                    <span>
                      ไม่มีเมนูที่ตรงกับ “{deferredQuery.trim()}” · ลองพิมพ์ให้สั้นลง หรือค้นด้วยรหัส POS เช่น A01
                      {elsewhere > 0 && (
                        <>
                          {" "}
                          · มี {elsewhere} เมนูที่ตรงแต่อยู่นอกตัวกรอง{" "}
                          <button type="button" onClick={() => (setStatus("every"), setCategory(null))} className="font-medium text-primary underline underline-offset-2">
                            ดูทุกสถานะและทุกหมวด
                          </button>
                        </>
                      )}
                    </span>
                  )}
                  <span className="text-xs text-muted-subtle">ตรงตัวขึ้นก่อน · “ใกล้เคียง” = ตัวอักษรครบแต่ไม่ติดกัน · กด Esc เพื่อล้าง</span>
                </>
              ) : (
                <span>
                  แสดง {visible.length} เมนู ({STATUS_TH[status]}
                  {category ? ` · ${category}` : ""}){mode === "cat" && shownGroups.length > 0 ? ` ใน ${shownGroups.length} หมวด` : ""}
                  {status === "write" && " · เรียงตามยอดขาย เขียนสูตรเมนูบนสุดก่อนจะคุ้มที่สุด"}
                </span>
              )}
            </p>

            <div className="space-y-3">
              {visible.length === 0 ? (
                <div className="flex flex-col items-center gap-2.5 rounded-[18px] border border-border/70 bg-surface shadow-card px-5 py-9 text-center text-sm text-muted-foreground">
                  <p className="font-display text-base font-semibold text-foreground">ไม่มีเมนูตรงกับตัวกรอง</p>
                  <button type="button" onClick={() => (setStatus("every"), setCategory(null))} className="btn-secondary btn-sm">
                    ดูทุกสถานะและทุกหมวด
                  </button>
                </div>
              ) : mode === "flat" ? (
                <div className="overflow-hidden rounded-[18px] border border-border/70 bg-surface shadow-card">
                  {[...visible].sort(rankOrder).map((h, i, all) => (
                    <Fragment key={h.item.id}>
                      {searching && h.score === 0 && i > 0 && all[i - 1].score > 0 && <OtherLine />}
                      {renderRow(h, true)}
                    </Fragment>
                  ))}
                </div>
              ) : (
                shownGroups.map((g) => {
                  const hits = hitsByCat.get(g.name)!;
                  // While searching: this category's matches first, the rest below a line.
                  const matched = searching ? hits.filter((h) => h.score > 0).sort(rankOrder) : [];
                  const rest = searching ? hits.filter((h) => h.score === 0) : hits;
                  const isClosed = closed.has(g.name) && !(searching && matched.length > 0);
                  const withRecipe = rest.filter((h) => h.item.recipeId !== null).sort(rankOrder);
                  const without = rest.filter((h) => h.item.recipeId === null).sort(rankOrder);
                  const toggle = () =>
                    setClosed((s) => {
                      const n = new Set(s);
                      if (n.has(g.name)) n.delete(g.name);
                      else n.add(g.name);
                      return n;
                    });
                  const over = g.pct !== null && g.pct > g.target + 1e-9;
                  const metaLine = searching
                    ? matched.length > 0
                      ? `ตรง ${matched.length} จาก ${hits.length} เมนู`
                      : `${hits.length} เมนู · ไม่มีเมนูที่ตรง`
                    : hits.length !== g.count
                      ? `${hits.length} จาก ${g.count} เมนู`
                      : `${g.count} เมนู${g.withoutRecipe ? ` · ไม่มีสูตร ${g.withoutRecipe}` : ""}`;
                  return (
                    <section key={g.name} className="rounded-[18px] border border-border/70 bg-surface shadow-card">
                      <button
                        type="button"
                        onClick={toggle}
                        aria-expanded={!isClosed}
                        style={{ top: appBarH + toolbarH }}
                        className={`z-10 w-full rounded-t-2xl bg-gradient-to-b from-[#FBF8EC] to-[#F6F1DE] px-4 py-3 text-left transition-colors hover:to-[#F1EAD0] max-md:sticky ${isClosed ? "rounded-b-2xl" : "border-b border-border"}`}
                      >
                        <span className={`grid items-center gap-x-3.5 ${cols.replace(/md:/g, "md:")} grid-cols-[minmax(0,1fr)_auto]`}>
                          <span className="flex min-w-0 items-center gap-2.5">
                            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`flex-none text-muted-subtle transition-transform ${isClosed ? "-rotate-90" : ""}`}>
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: g.tone }} />
                            <span className="min-w-0">
                              <span className="block font-display text-base font-semibold leading-tight">{g.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {metaLine}
                                {!costHidden && g.overCount > 0 && <span className="text-bad"> · เกินเป้า {g.overCount}</span>}
                              </span>
                            </span>
                          </span>
                          {/* Phone: the group's profit alone. */}
                          <span className="text-right font-display font-semibold tabular-nums md:hidden">
                            {costHidden ? baht(g.net) : g.profit === null ? "—" : <><span className="font-sans text-xs font-normal text-muted-foreground">กำไร</span> {atMostTh(g.low, baht(g.profit))}</>}
                          </span>
                          <span className="hidden text-right font-display font-semibold tabular-nums md:block">
                            {baht(g.net)}
                            {g.share !== null && <span className="block font-sans text-xs font-normal text-muted-subtle">{g.share.toFixed(0)}% ของยอดขายร้าน</span>}
                          </span>
                          <span className="hidden md:block" />
                          {costHidden ? (
                            <span className="hidden md:block" />
                          ) : (
                            <>
                              <span className="hidden md:block" />
                              <span className="hidden min-w-0 items-center gap-2 md:flex">
                                {pricesLoading ? (
                                  pulse("w-28")
                                ) : g.pct === null ? (
                                  <span className="text-sm text-muted-subtle">ยังคิดไม่ได้</span>
                                ) : (
                                  <>
                                    <CostBar pct={g.pct} target={g.target} over={over} />
                                    <span className="w-12 flex-none text-right font-display font-semibold tabular-nums">{atLeastTh(g.low, pct1(g.pct))}</span>
                                    {over && <span className="chip chip-bad">เกิน {(g.pct - g.target).toFixed(1)} จุด</span>}
                                  </>
                                )}
                              </span>
                              <span className="hidden md:block" />
                              <span className="hidden text-right font-display font-semibold tabular-nums md:block">
                                {pricesLoading ? pulse("w-16") : g.profit === null ? "—" : atMostTh(g.low, baht(g.profit))}
                                <span className="block font-sans text-xs font-normal text-muted-subtle">กำไรของหมวด</span>
                              </span>
                            </>
                          )}
                        </span>
                      </button>
                      {!isClosed && (
                        <div className="overflow-hidden rounded-b-2xl">
                          {matched.map((h) => renderRow(h, false))}
                          {matched.length > 0 && rest.length > 0 && <OtherLine />}
                          {withRecipe.map((h) => renderRow(h, false))}
                          {without.length > 0 && (
                            <>
                              <div className="border-b border-border bg-[#FCFAF2] px-4 py-1.5 text-xs font-medium text-muted-subtle">
                                ยังไม่มีสูตร · {without.length} เมนู — คิดต้นทุนและกำไรไม่ได้
                              </div>
                              {without.map((h) => renderRow(h, false))}
                            </>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </div>

            <p className="text-xs text-muted-subtle">
              ยอดขายและราคาเฉลี่ย {factDays} วันล่าสุดที่มีข้อมูล ({props.factRange}) หลังส่วนลด ไม่รวม VAT และ service charge
              {!costHidden && (
                <>
                  {" "}
                  · กำไร = ราคาเฉลี่ย − ต้นทุนตามสูตร (ราคาวัตถุดิบวันนี้{branch ? ` ที่${branch.name}` : ""}) · หัวหมวด: ต้นทุน % ถ่วงตามยอดขายของเมนูที่มีสูตร และกำไรรวมของเมนูเหล่านั้น · เส้นในแถบ = เป้าของเมนู (ไม่ได้ตั้งใช้เป้าร้าน {pctTarget(shopTargetPct)})
                </>
              )}
            </p>
          </section>
        </>
      )}

      {opened && branch && (
        <MenuSheet
          key={`${opened.id}-${branch.id}`}
          menu={opened}
          factDays={factDays}
          factRange={props.factRange}
          branch={branch}
          branches={props.branches}
          today={props.today}
          categories={props.categories}
          departments={props.departments}
          departmentsEnabled={props.departmentsEnabled}
          posIntegrationId={props.posIntegrationId}
          spellings={spellingsByWinner[opened.id] ?? []}
          mergedIntoLabel={mergedIntoLabel(opened.id)}
          shopTargetPct={shopTargetPct}
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
            // A central recipe moves every branch's prices, so every book goes;
            // the refresh brings this branch's new one from the server.
            awaitingServerBook.current = true;
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

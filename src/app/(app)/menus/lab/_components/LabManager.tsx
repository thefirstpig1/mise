"use client";

// ทดลองเมนู — the drafts and the sheet that opens over them (Kong 2026-10-04;
// redesigned 2026-10-22, mockup PiWpnuu2kXAGAL9yCDNYtw: "พื้นที่ว่างใส่อะไรได้
// ใส่"). Three figures on top, each draft a card (photo, where the plate's money
// goes, where the draft is on its way, food cost against the target), the
// best-selling dishes that still have no recipe as a place to start, and the
// four steps a draft takes (ADR 0041). The whole card opens the draft.
// Money comes from the default branch's price book, which the SERVER starts
// with the page (`initialBook`) — never ฿0 while it comes.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { IngredientOption, LabDraft, PriceBook, StandardUnit } from "@/server/menu-manager";
import EmptyState from "@/components/ui/EmptyState";
import { ingredientOptions, priceBook } from "../../_components/prefetch";
import { atLeastTh, baht, thDate } from "../../_components/manager-format";
import { CostMix, lineCost } from "../../_components/recipe-editor";
import { PhotoSlot, Portal } from "../../_components/sheet-parts";
import LabSheet, { readTarget } from "./LabSheet";
import { orStale } from "@/lib/stale-tab";
import { publishDraftsAction, type PublishDraftsState } from "../actions";

export type LabMenu = {
  id: string;
  name: string;
  posCode: string | null;
  category: string | null;
  /** Plates and revenue over the last `factDays` days. */
  qty: number;
  net: number;
  hasRecipe: boolean;
  /** Probably another branch's copy of this dish, which has a recipe — merge, do not draft. */
  dupOf: { id: string; name: string; code: string | null } | null;
};
export type Option = { id: string; name: string };

/** Cost of one plate from the price book; `missing` = lines nobody has bought. */
export function bookCost(lines: { kind: string; productId: string | null; componentMenuId: string | null; qty: number; toBaseRatio: number }[], servings: number, book: PriceBook | null) {
  if (book === null) return null;
  let sum = 0;
  let missing = 0;
  for (const l of lines) {
    const p = l.kind === "menu" ? (book.menus[l.componentMenuId ?? ""]?.costPerServing ?? null) : (book.products[l.productId ?? ""] ?? null);
    if (p === null) missing++;
    else sum += l.qty * l.toBaseRatio * p;
  }
  return { perPlate: sum / (servings || 1), missing };
}

export default function LabManager(props: {
  drafts: LabDraft[];
  menus: LabMenu[];
  factDays: number;
  categories: Option[];
  branches: Option[];
  defaultBranchId: string | null;
  /** The server's price book for `defaultBranchId`, still computing when the page arrives. */
  initialBook: { branchId: string; book: Promise<PriceBook | null> } | null;
  today: string;
  costHidden: boolean;
  /** Applies a draft to every branch (recipe:write + reach over all of them). */
  canPublish: boolean;
  /** Endorses, edits anyone's draft, applies at a branch in reach (ADR 0041). */
  canWrite: boolean;
  /** May merge menus (master:write with shared reach). */
  canMerge: boolean;
  viewerId: string;
  openDraftId: string | null;
  openNew: boolean;
  /** From the menu sheet's "ลองราคาในทดลองเมนู": a draft for this dish. */
  openMenuId: string | null;
  /** With `openMenuId`: the target that sheet was holding the dish to. */
  openTargetPct: number | null;
  /** The first day of sales the shop imported — the day imported recipes usually start. */
  firstSalesDay: string | null;
  /** The oldest day a recipe may start (the ledger's backdate window). */
  earliestDay: string;
}) {
  const { costHidden } = props;
  // Drafts published from this screen leave the list at once — not when the
  // page's refresh happens to land (a second press, the replace confirmation,
  // was seen to leave its dish on screen until a reload).
  const [gone, setGone] = useState<Set<string>>(new Set());
  // Memoised: effects below key on `drafts`, and a fresh array every render loops them.
  const drafts = useMemo(() => props.drafts.filter((d) => !gone.has(d.recipeId)), [props.drafts, gone]);
  const router = useRouter();
  const [open, setOpen] = useState<{ id: string | null; n: number; menuId?: string } | null>(
    props.openDraftId && drafts.some((d) => d.recipeId === props.openDraftId)
      ? { id: props.openDraftId, n: 0 }
      : props.openMenuId && props.menus.some((m) => m.id === props.openMenuId)
        ? // A draft already open for this dish is the one to continue.
          (() => {
            const d = drafts.find((x) => x.menuId === props.openMenuId);
            return d ? { id: d.recipeId, n: 0 } : { id: null, n: 0, menuId: props.openMenuId! };
          })()
        : props.openNew
          ? { id: null, n: 0 }
          : null
  );
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- price books, one per branch, loaded once ----
  const [books, setBooks] = useState<Record<string, PriceBook>>({});
  const asked = useRef(new Set<string>());
  const usedServerBook = useRef(false);
  const needBook = (branchId: string | null) => {
    if (!branchId || costHidden || asked.current.has(branchId)) return;
    asked.current.add(branchId);
    const fromApi = () =>
      void priceBook(branchId).then((r) => {
        if (r.ok) setBooks((b) => ({ ...b, [branchId]: r.book }));
        else asked.current.delete(branchId);
      });
    // The server started this branch's book with the page (Kong 2026-10-22).
    const server = props.initialBook;
    if (server && server.branchId === branchId && !usedServerBook.current) {
      usedServerBook.current = true;
      return void server.book.then((b) => (b ? setBooks((all) => ({ ...all, [branchId]: b })) : fromApi()));
    }
    fromApi();
  };
  useEffect(() => needBook(props.defaultBranchId), []); // eslint-disable-line react-hooks/exhaustive-deps
  const dropBooks = () => {
    asked.current.clear();
    setBooks({});
  };
  const listBook = props.defaultBranchId ? (books[props.defaultBranchId] ?? null) : null;
  const branchName = props.branches.find((b) => b.id === props.defaultBranchId)?.name ?? "";

  // ---- the adder's list, on first need ----
  const [options, setOptions] = useState<IngredientOption[] | null>(null);
  const [standards, setStandards] = useState<StandardUnit[]>([]);
  const optionsAsked = useRef(false);
  const needOptions = () => {
    if (optionsAsked.current) return;
    optionsAsked.current = true;
    void ingredientOptions().then((r) => {
      if (!r.ok) return void (optionsAsked.current = false);
      setOptions(r.options);
      setStandards(r.standards);
    });
  };

  // A sheet opened from the address (?draft= / ?new=1) needs the list too.
  useEffect(() => {
    if (open) needOptions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the address on what is open, so a refresh or a shared link lands there.
  const setAddress = (id: string | null, isNew: boolean) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("draft");
    url.searchParams.delete("new");
    if (id) url.searchParams.set("draft", id);
    else if (isNew) url.searchParams.set("new", "1");
    window.history.replaceState(null, "", url);
  };
  const openDraft = (id: string | null, menuId?: string) => {
    needOptions();
    setOpen({ id, n: Date.now(), menuId });
    setAddress(id, id === null);
  };
  const close = () => {
    setOpen(null);
    setAddress(null, false);
  };

  const waiting = drafts.filter((d) => waitsFor(d, props)).length;

  // ---- use several drafts at once, from a chosen day (Kong 2026-10-30) ----
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fromDay, setFromDay] = useState(props.today);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<Extract<PublishDraftsState, { ok: true }> | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const togglePick = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const publishPicked = async (ids: string[], acknowledgeReplace: boolean) => {
    setPublishing(true);
    setPublishError(null);
    const res = await orStale(publishDraftsAction({ recipeIds: ids, effectiveFrom: fromDay, acknowledgeReplace }));
    setPublishing(false);
    if (!res.ok) return setPublishError(res.formError);
    setPublished((prev) =>
      // A second press (the replace confirmation) adds to what the first did.
      prev && acknowledgeReplace
        ? { ok: true, postedDays: Math.max(prev.postedDays, res.postedDays), results: [...prev.results.filter((r) => !ids.includes(r.recipeId)), ...res.results] }
        : res
    );
    setGone((g) => new Set([...g, ...res.results.filter((r) => r.outcome === "PUBLISHED").map((r) => r.recipeId)]));
    setPicked(new Set(res.results.filter((r) => r.outcome === "NEEDS_ACK").map((r) => r.recipeId)));
    if (!res.results.some((r) => r.outcome === "NEEDS_ACK")) setPicking(false);
    router.refresh();
  };
  const salesStart = props.firstSalesDay && props.firstSalesDay < props.today ? (props.firstSalesDay < props.earliestDay ? props.earliestDay : props.firstSalesDay) : null;

  // Each draft's target %, kept per viewer by the sheet; read after mount so
  // the server's first paint and the browser's agree.
  const [targets, setTargets] = useState<Record<string, number>>({});
  useEffect(() => setTargets(Object.fromEntries(drafts.map((d) => [d.recipeId, readTarget(d.recipeId)]))), [drafts]);

  // Dishes on sale with no recipe, best sellers first, minus any already being drafted.
  const drafted = new Set(drafts.map((d) => d.menuId));
  const unrecipied = props.menus.filter((m) => !m.hasRecipe && m.qty > 0);
  // Round 2, F: the copies go to "merge", never to "draft a recipe".
  const starts = unrecipied.filter((m) => !drafted.has(m.id) && !m.dupOf).sort((a, b) => b.net - a.net).slice(0, 6);
  const copies = unrecipied.filter((m) => m.dupOf).sort((a, b) => b.net - a.net);
  const toWrite = unrecipied.length - copies.length;
  const unrecipiedNet = unrecipied.reduce((s, m) => s + m.net, 0);
  const mine = drafts.filter((d) => d.authorId === props.viewerId).length;
  const submitted = drafts.filter((d) => d.draftStatus === "SUBMITTED").length;
  const endorsed = drafts.filter((d) => d.draftStatus === "ENDORSED").length;

  const openRow = open?.id ? (drafts.find((d) => d.recipeId === open.id) ?? null) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">ทดลองเมนู</h2>
          <p className="mt-1 text-sm text-muted-foreground">ลองคิดสูตรและราคาก่อนขายจริง ร่างยังไม่ตัดสต๊อกและยังไม่ถูกใช้คิดต้นทุนขาย จนกว่าจะกด “นำไปใช้จริง”</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/menus" className="btn-secondary btn-sm">
            จัดการเมนู
          </a>
          <button type="button" onClick={() => openDraft(null)} className="btn whitespace-nowrap">
            + ร่างสูตรใหม่
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[18px] border border-border/70 bg-surface shadow-card p-3">
          <p className="text-xs text-muted-subtle">ร่างที่กำลังคิด</p>
          <p className="font-display text-2xl font-semibold tabular-nums">{drafts.length}</p>
          <p className="text-xs text-muted-foreground">
            ของคุณ {mine} · รอรับรอง {submitted} · รับรองแล้ว {endorsed}
          </p>
        </div>
        <div className={`rounded-xl border p-3 ${waiting > 0 ? "border-warn-border bg-warn-bg" : "border-border bg-surface"}`}>
          <p className="text-xs text-muted-subtle">รอคุณลงมือ</p>
          <p className="font-display text-2xl font-semibold tabular-nums">{waiting}</p>
          <p className="text-xs text-muted-foreground">
            {waiting > 0 ? (props.canPublish ? "รับรองหรือนำไปใช้จริง" : "ตรวจแล้วรับรอง หรือนำไปใช้จริงที่สาขาของคุณ") : "ไม่มีร่างที่รอคุณรับรองหรือนำไปใช้"}
          </p>
        </div>
        <a href="/menus?filter=none" className="rounded-[18px] border border-border/70 bg-surface shadow-card p-3 transition-colors hover:border-border-strong">
          <p className="text-xs text-muted-subtle">ขายอยู่แต่ยังไม่มีสูตร</p>
          <p className="font-display text-2xl font-semibold tabular-nums">{unrecipied.length} เมนู</p>
          <p className="text-xs text-muted-foreground">
            {unrecipied.length > 0
              ? `ขายไป ${baht(unrecipiedNet)} ใน ${props.factDays} วัน ที่ยังคิดต้นทุนไม่ได้${copies.length > 0 ? ` · ${copies.length} น่าจะซ้ำกับเมนูที่มีสูตรแล้ว` : ""}`
              : "ทุกเมนูที่ขายอยู่มีสูตรแล้ว"}
          </p>
        </a>
      </div>

      {/* Outside the drafts list: when the last draft is used, the list goes and this stays. */}
      {published && <PublishSummary state={published} fromDay={fromDay} />}

      {drafts.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">ร่างที่กำลังคิด</h3>
            <span className="flex flex-wrap items-baseline gap-3">
              {!costHidden && branchName && <span className="text-xs text-muted-subtle">ต้นทุนคิดที่{branchName} ณ วันนี้ · เปิดร่างเพื่อเปลี่ยนสาขา</span>}
              {props.canPublish && (
                <button
                  type="button"
                  onClick={() => {
                    setPicking((v) => !v);
                    setPicked(new Set());
                    setPublished(null);
                  }}
                  className="btn-secondary btn-sm"
                >
                  {picking ? "ยกเลิกการเลือก" : "เลือกหลายร่างเพื่อนำไปใช้จริง"}
                </button>
              )}
            </span>
          </div>
          <div className="space-y-2">
            {drafts.map((d) => {
              const c = bookCost(d.lines, d.servings, listBook);
              const pct = c && c.missing === 0 && d.plannedPrice ? (c.perPlate / d.plannedPrice) * 100 : null;
              const isNew = d.menuIsMise && !d.hasSales;
              const target = targets[d.recipeId] ?? 30;
              const mix =
                c && c.missing === 0
                  ? d.lines.map((l) => ({
                      label: l.label,
                      cost:
                        lineCost(
                          { kind: l.kind, productId: l.productId, componentMenuId: l.componentMenuId, qty: String(l.qty), ratio: l.kind === "menu" ? 1 : l.toBaseRatio } as Parameters<typeof lineCost>[0],
                          listBook
                        ) ?? 0,
                    }))
                  : null;
              return (
                // A div, not a <button>: the card holds blocks (the photo, the bar).
                <div
                  key={d.recipeId}
                  role={picking ? "checkbox" : "button"}
                  aria-checked={picking ? picked.has(d.recipeId) : undefined}
                  tabIndex={0}
                  onClick={() => (picking ? togglePick(d.recipeId) : openDraft(d.recipeId))}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), picking ? togglePick(d.recipeId) : openDraft(d.recipeId))}
                  className={`grid w-full cursor-pointer grid-cols-1 gap-4 rounded-2xl border bg-surface p-3.5 text-left transition-all hover:border-border-strong hover:shadow-card sm:items-center ${
                    picking ? "sm:grid-cols-[28px_112px_minmax(0,1fr)_220px]" : "sm:grid-cols-[112px_minmax(0,1fr)_220px]"
                  } ${picking && picked.has(d.recipeId) ? "border-primary ring-1 ring-primary" : "border-border"}`}
                >
                  {picking && (
                    <span
                      aria-hidden="true"
                      className={`grid h-6 w-6 place-items-center rounded-md border text-sm font-bold ${picked.has(d.recipeId) ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface"}`}
                    >
                      {picked.has(d.recipeId) ? "✓" : ""}
                    </span>
                  )}
                  <PhotoSlot label="รูปเมนู" className="hidden aspect-[4/3] w-[112px] sm:grid" />
                  <div className="min-w-0 space-y-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg font-semibold">{d.menuName}</span>
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${isNew ? "bg-good-bg text-good" : "bg-warn-bg text-warn"}`}>{isNew ? "เมนูใหม่" : "แก้สูตรเมนูที่ขายอยู่"}</span>
                      <StatusChip status={d.draftStatus} />
                    </span>
                    <span className="block text-xs text-muted-subtle">
                      ร่างโดย {d.authorId === props.viewerId ? "คุณ" : d.authorName}
                      {d.endorsedByName ? ` · รับรองโดย ${d.endorsedByName}` : ""} · {d.lines.length} วัตถุดิบ · ทำครั้งละ {d.servings.toLocaleString("th-TH")} จาน · แก้ล่าสุด {thDate(d.updatedAt.slice(0, 10))}
                    </span>
                    {!costHidden && mix && <CostMix items={mix} size="sm" />}
                    <DraftSteps status={d.draftStatus} />
                  </div>
                  {!costHidden && (
                    <span className="grid gap-1 text-xs text-muted-foreground">
                      {c === null ? (
                        <span className="inline-block h-14 w-full animate-pulse rounded-lg bg-muted" />
                      ) : d.lines.length === 0 ? (
                        <span>ยังไม่มีวัตถุดิบ</span>
                      ) : (
                        <>
                          <span className="flex items-baseline justify-between gap-2">
                            <span>
                              ต้นทุน {atLeastTh(c.missing > 0, baht(c.perPlate, 2))}
                              {d.plannedPrice ? ` · ราคา ${baht(d.plannedPrice)}` : ""}
                            </span>
                            <b className="font-display text-base text-foreground tabular-nums">{pct === null ? "—" : `${pct.toFixed(1)}%`}</b>
                          </span>
                          {pct !== null && (
                            <>
                              <span className="relative h-2 rounded-full bg-muted">
                                <span className="absolute inset-y-0 left-0 origin-left animate-grow-x rounded-full" style={{ width: `${Math.min(100, pct * 2)}%`, background: pct > target + 0.05 ? "linear-gradient(90deg,#E8A76F,#C0692B)" : "linear-gradient(90deg,#9DAA55,#5E6B14)" }} />
                                <span className="absolute -inset-y-1 w-0.5 rounded bg-[#C0692B]" style={{ left: `${Math.min(100, target * 2)}%` }} />
                              </span>
                              <span className="flex justify-between">
                                <span>เป้า {target}%</span>
                                <span>กำไร {baht(d.plannedPrice! - c.perPlate, 2)}/จาน</span>
                              </span>
                            </>
                          )}
                          {c.missing > 0 && <span className="text-warn">ขาดราคา {c.missing} รายการ · ต้นทุนจริงสูงกว่านี้</span>}
                          {pct === null && c.missing === 0 && <span>ยังไม่ได้ตั้งราคาที่ตั้งใจ</span>}
                        </>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {picking && (
            <div className="sticky bottom-0 z-10 grid gap-2 rounded-2xl border border-border-strong bg-surface/95 p-3 shadow-card backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <b className="font-semibold">เลือก {picked.size} ร่าง</b>
                  <button
                    type="button"
                    onClick={() => setPicked(picked.size === drafts.length ? new Set() : new Set(drafts.map((d) => d.recipeId)))}
                    className="text-[13px] underline decoration-dotted underline-offset-4 hover:text-warn"
                  >
                    {picked.size === drafts.length ? "ไม่เลือกเลย" : "เลือกทั้งหมด"}
                  </button>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-1.5">
                    มีผลตั้งแต่
                    <input
                      type="date"
                      value={fromDay}
                      min={props.earliestDay}
                      max={props.today}
                      onChange={(e) => e.target.value && setFromDay(e.target.value)}
                      className="input h-9 w-[150px] py-1"
                    />
                  </label>
                  {salesStart && (
                    <button type="button" onClick={() => setFromDay(salesStart)} className={`pill ${fromDay === salesStart ? "is-on" : ""}`}>
                      {salesStart === props.firstSalesDay ? `วันแรกของยอดขาย (${thDate(salesStart)})` : `ย้อนได้สุด (${thDate(salesStart)})`}
                    </button>
                  )}
                  <button type="button" onClick={() => setFromDay(props.today)} className={`pill ${fromDay === props.today ? "is-on" : ""}`}>
                    วันนี้
                  </button>
                  <button type="button" className="btn btn-sm" disabled={publishing || picked.size === 0} onClick={() => publishPicked([...picked], false)}>
                    {publishing ? "กำลังนำไปใช้…" : `นำไปใช้จริง ${picked.size} เมนู`}
                  </button>
                </span>
              </div>
              <p className="text-[12.5px] text-muted-foreground">
                สูตรจะมีผลตั้งแต่วันที่เลือก ยอดขายก่อนหน้านั้นยังคิดด้วยสูตรเดิม (หรือไม่มีสูตร) · ย้อนหลังได้ไม่เกิน 90 วัน
                {salesStart && salesStart !== props.firstSalesDay ? " · ยอดขายที่เก่ากว่านั้นไม่ได้ถูกตัดสต๊อกอยู่แล้ว" : ""}
              </p>
              {published && published.results.some((r) => r.outcome === "NEEDS_ACK") && (
                <div className="grid gap-2 rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
                  <span>
                    {published.results.filter((r) => r.outcome === "NEEDS_ACK").length} เมนูมีสูตรที่ใช้อยู่แล้ว:{" "}
                    {published.results
                      .filter((r) => r.outcome === "NEEDS_ACK")
                      .map((r) => r.menuName)
                      .join(", ")}{" "}
                    — นำไปใช้จะแทนสูตรเดิมตั้งแต่วันที่เลือก ยอดของวันก่อนหน้ายังคิดด้วยสูตรเดิม
                  </span>
                  <button type="button" className="btn btn-sm justify-self-start" disabled={publishing} onClick={() => publishPicked(published.results.filter((r) => r.outcome === "NEEDS_ACK").map((r) => r.recipeId), true)}>
                    ยืนยันแทนสูตรเดิม {published.results.filter((r) => r.outcome === "NEEDS_ACK").length} เมนู
                  </button>
                </div>
              )}
              {publishError && <p role="alert" className="text-[13px] text-bad">{publishError}</p>}
            </div>
          )}
        </section>
      )}

      {starts.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">
              เริ่มจากเมนูที่ขายอยู่แต่ยังไม่มีสูตร{copies.length > 0 ? ` · ต้องเขียนจริง ${toWrite} เมนู` : ""}
            </h3>
            <span className="text-xs text-muted-subtle">เรียงตามยอดขาย {props.factDays} วัน · เขียนตัวบนสุดก่อนคุ้มที่สุด</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {starts.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => openDraft(null, m.id)}
                className="group grid gap-2 rounded-[18px] border border-border/70 bg-surface shadow-card p-3 text-left transition-colors hover:border-border-strong"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <b className="font-medium">{m.name}</b>
                  {m.posCode && <span className="text-xs tabular-nums text-muted-subtle">{m.posCode}</span>}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full origin-left animate-grow-x rounded-full" style={{ width: `${(m.net / starts[0].net) * 100}%`, background: "linear-gradient(90deg,#9DAA55,#5E6B14)" }} />
                </span>
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {m.qty.toLocaleString("th-TH")} จาน · {baht(m.net)}
                  </span>
                  <span className="whitespace-nowrap rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-primary group-hover:border-primary">+ ร่างสูตร</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {copies.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">น่าจะเป็นเมนูเดียวกับเมนูที่มีสูตรแล้ว · {copies.length} เมนู</h3>
            <span className="text-xs text-muted-subtle">รวมเมนูแทนการเขียนสูตรใหม่ · รวมแล้วตัดสต๊อกด้วยสูตรของเมนูหลัก</span>
          </div>
          <div className="overflow-hidden rounded-[18px] border border-border/70 bg-surface shadow-card">
            {copies.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-[1_1_220px]">
                  <b className="font-semibold">{m.name}</b>
                  {m.posCode && <span className="ml-1.5 text-xs tabular-nums text-muted-subtle">{m.posCode}</span>}
                  <span className="block text-xs text-muted-foreground">ยังไม่มีสูตร</span>
                </span>
                <span aria-hidden="true" className="text-muted-subtle max-sm:hidden">→</span>
                <span className="min-w-0 flex-[1_1_220px]">
                  <span className="text-xs text-muted-foreground sm:hidden">เมนูเดียวกับ </span>
                  <b className="font-semibold">{m.dupOf!.name}</b>
                  {m.dupOf!.code && <span className="ml-1.5 text-xs tabular-nums text-muted-subtle">{m.dupOf!.code}</span>}
                  <span className="block text-xs text-muted-foreground">มีสูตรแล้ว</span>
                </span>
                <span className="text-right text-xs tabular-nums text-muted-subtle max-sm:hidden">
                  ขาย {props.factDays} วัน
                  <span className="block">{baht(m.net)}</span>
                </span>
                {props.canMerge && (
                  <a href="/menus/merges" className="btn-secondary btn-sm">
                    รวมเมนู
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {drafts.length === 0 && starts.length === 0 && (
        <EmptyState art="start">
          <p className="text-sm text-muted-foreground">ยังไม่มีร่างสูตร · กด “ร่างสูตรใหม่” เพื่อลองคิดต้นทุนและราคาของจานที่ยังไม่ได้ขาย หรือลองแก้สูตรของเมนูที่ขายอยู่</p>
        </EmptyState>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">ร่างหนึ่งเดินทางอย่างไร</h3>
          <span className="text-xs text-muted-subtle">ใครกดอะไรได้ ขึ้นกับสิทธิ์ของแต่ละคน</span>
        </div>
        <ol className="grid gap-2 sm:grid-cols-4">
          {[
            ["ร่าง", "ใส่วัตถุดิบ ลองราคา บันทึกได้เรื่อย ๆ ยังไม่ตัดสต๊อก"],
            ["ส่งให้รับรอง", "คนครัวส่งให้ผู้จัดการดู"],
            ["รับรองแล้ว", "ผู้จัดการเห็นด้วย รอคนที่ดูแลทุกสาขา"],
            ["นำไปใช้จริง", "สูตรเริ่มตัดสต๊อกและคิดต้นทุนขายตั้งแต่วันที่ใช้"],
          ].map(([t, s], i) => (
            <li key={t} className="rounded-xl bg-surface-sunk px-3 py-2.5 text-xs text-muted-foreground">
              <span className="font-display font-bold text-[#C0692B]">{i + 1}</span>
              <b className="block font-display text-sm font-semibold text-foreground">{t}</b>
              {s}
            </li>
          ))}
        </ol>
      </section>

      {open && (
        <LabSheet
          key={open.n}
          draft={openRow}
          startMenuId={open.id ? null : (open.menuId ?? null)}
          startTargetPct={!open.id && open.menuId && open.menuId === props.openMenuId ? props.openTargetPct : null}
          menus={props.menus}
          factDays={props.factDays}
          categories={props.categories}
          branches={props.branches}
          defaultBranchId={props.defaultBranchId}
          today={props.today}
          costHidden={costHidden}
          canPublish={props.canPublish}
          canWrite={props.canWrite}
          viewerId={props.viewerId}
          books={books}
          needBook={needBook}
          options={options}
          standards={standards}
          onClose={close}
          onToast={setToast}
          onSaved={(id) => {
            dropBooks();
            needBook(props.defaultBranchId);
            setOpen((o) => (o ? { ...o, id } : o));
            setAddress(id, false);
            router.refresh();
          }}
          onGone={() => {
            close();
            router.refresh();
          }}
          onPublished={(menuId) => {
            close();
            router.push(`/menus?menu=${menuId}` as Route);
          }}
        />
      )}

      {toast && (
        <Portal>
          <div role="status" className="fixed bottom-6 left-1/2 z-[80] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground shadow-card">
            {toast}
          </div>
        </Portal>
      )}
    </div>
  );
}

/** ADR 0041 — the four steps of a draft, the current one in clay. */
const STEPS = ["ร่าง", "ส่งให้รับรอง", "รับรองแล้ว", "นำไปใช้จริง"];
export function DraftSteps({ status }: { status: LabDraft["draftStatus"] }) {
  const at = status === "ENDORSED" ? 2 : status === "SUBMITTED" ? 1 : 0;
  return (
    <span className="flex items-center text-[11px] text-muted-subtle" aria-label={`ขั้นของร่าง: ${STEPS[at]}`}>
      {STEPS.map((t, i) => (
        <span key={t} className="flex min-w-0 flex-1 items-center last:flex-none">
          <span className={`flex items-center gap-1.5 whitespace-nowrap ${i === at ? "font-semibold text-foreground" : ""}`}>
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] ${i < at ? "border-primary bg-primary" : i === at ? "border-[#C0692B] bg-[#C0692B] shadow-[0_0_0_3px_rgb(192_105_43/0.18)]" : "border-border-strong bg-surface"}`}
            />
            {t}
          </span>
          {i < STEPS.length - 1 && <span className="mx-1.5 h-px min-w-3 flex-1 bg-border-strong" />}
        </span>
      ))}
    </span>
  );
}

/** ADR 0041 — where a draft is on its way to the kitchen. */
export const STATUS_TH: Record<LabDraft["draftStatus"], string> = { DRAFT: "ร่าง", SUBMITTED: "รอรับรอง", ENDORSED: "รับรองแล้ว" };

export function StatusChip({ status }: { status: LabDraft["draftStatus"] }) {
  if (status === "DRAFT") return null;
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${status === "ENDORSED" ? "bg-good-bg text-good" : "border border-warn-border text-warn"}`}>
      {STATUS_TH[status]}
    </span>
  );
}

/**
 * A draft waits for this viewer when they can move it forward: a manager for
 * a proposed draft someone else wrote; whoever applies to every branch also
 * for an endorsed one.
 */
export function waitsFor(d: LabDraft, v: { canWrite: boolean; canPublish: boolean; viewerId: string }): boolean {
  if (!v.canWrite || d.authorId === v.viewerId) return false;
  return d.draftStatus === "SUBMITTED" || (d.draftStatus === "ENDORSED" && v.canPublish);
}

/** What the last "นำไปใช้จริง" did, dish by dish — nothing is reported as done that was not. */
function PublishSummary({ state, fromDay }: { state: Extract<PublishDraftsState, { ok: true }>; fromDay: string }) {
  const done = state.results.filter((r) => r.outcome === "PUBLISHED");
  const later = state.results.filter((r) => r.outcome === "LIVE_IS_LATER");
  const failed = state.results.filter((r) => r.outcome === "FAILED");
  if (done.length === 0 && later.length === 0 && failed.length === 0) return null;
  return (
    <div className="grid gap-1.5 rounded-[18px] border border-border/70 bg-surface shadow-card p-3 text-sm">
      {done.length > 0 && (
        <p>
          <b className="font-semibold text-good">นำไปใช้จริงแล้ว {done.length} เมนู</b> มีผลตั้งแต่ {thDate(fromDay)}: {done.map((r) => r.menuName).join(", ")}
        </p>
      )}
      {later.map((r) => (
        <p key={r.recipeId} className="text-warn">
          {r.menuName}: มีสูตรที่ใช้อยู่ตั้งแต่ {thDate(r.detail ?? "")} — เลือกวันนั้นหรือหลังจากนั้น
        </p>
      ))}
      {failed.map((r) => (
        <p key={r.recipeId} className="text-bad">
          {r.menuName}: {r.detail}
        </p>
      ))}
      {state.postedDays > 0 && (
        <p className="text-muted-foreground">
          มี {state.postedDays} วันตั้งแต่ {thDate(fromDay)} ที่ตัดสต๊อกไปแล้วโดยยังไม่มีสูตรเหล่านี้ —{" "}
          <a href="/consumption" className="underline decoration-dotted underline-offset-4 hover:text-foreground">
            ตัดสต๊อกใหม่ได้ที่หน้าตัดสต๊อกตามยอดขาย
          </a>
        </p>
      )}
    </div>
  );
}

"use client";

// สินค้า/วัตถุดิบ (Kong 2026-10-21, mockup https://claude.ai/artifact/AJiZcD1N3HUJAz6wkkVeSf):
// a dense table by default — on hand, days left, cost per unit, the last
// purchase and how many dishes use it — or big-picture cards for finding things
// by eye. The whole row opens a sheet where everything is edited.
//
// Paints from the catalogue alone; the branch's figures (GET /api/products) and
// its price book (GET /api/menus?what=book) arrive after paint, once per
// branch, and money never shows ฿0 while it comes (mise-ui-review §5c).
//
// Red = below par, yellow = near par (rules PAR-1/PAR-2, src/lib/par-alert.ts):
// on the filter chips as a LINE-style count, on the row, on the card's picture.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProductView } from "./product-view";
import type { ProductListFacts } from "@/server/product-list";
import type { IngredientOption, PriceBook, StandardUnit } from "@/server/menu-manager";
import type { Option, Perm } from "@/app/(app)/menus/_components/MenuManager";
import { ingredientOptions, priceBook, dropPrefetched } from "@/app/(app)/menus/_components/prefetch";
import { baht, qtyFmt, thDate, unitTh } from "@/app/(app)/menus/_components/manager-format";
import { Portal } from "@/app/(app)/menus/_components/sheet-parts";
import { rankBySearch, hasQuery, STRONG_MATCH, type SearchField } from "@/lib/smart-search";
import EmptyState from "@/components/ui/EmptyState";
import ProductThumb from "@/components/ui/ProductThumb";
import ProductSheet from "./ProductSheet";
import ParDocsPopup from "./ParDocsPopup";
import { PAR_RED } from "@/lib/par-alert";

type Status = "active" | "raw" | "prepped" | "low" | "near" | "inactive" | "all";
type View = "table" | "cards";
const VIEW_KEY = "kitkrua.products.view2";
const NO_CATEGORY = "ไม่มีหมวด";
const sectionOf = (p: ProductView) => p.category?.accountingSection ?? NO_CATEGORY;

const chip = (on: boolean, small = false) =>
  `relative whitespace-nowrap rounded-full border transition-colors ${small ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"} ${
    on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"
  }`;

/** LINE-style count floating over a chip's top-right corner. */
function Dot({ n, tone }: { n: number; tone: "red" | "yellow" }) {
  if (n <= 0) return null;
  return (
    <span
      className={`pointer-events-none absolute -right-2 -top-2 inline-grid h-[18px] min-w-[18px] animate-pop-in place-items-center rounded-full border-2 border-surface px-1 text-[11px] font-bold leading-none tabular-nums shadow-sm ${
        tone === "red" ? "bg-[#E5484D] text-white" : "bg-[#F5C542] text-[#3A2E05]"
      }`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

async function readList(branchId: string): Promise<ProductListFacts | null> {
  try {
    const r = await fetch(`/api/products?what=list&branch=${branchId}`, { cache: "no-store" });
    if (r.redirected || !r.headers.get("content-type")?.includes("json")) return null;
    const j = await r.json();
    return j.ok ? j.list : null;
  } catch {
    return null;
  }
}

export default function ProductsManager(props: {
  products: ProductView[];
  branches: Option[];
  defaultBranchId: string | null;
  today: string;
  costHidden: boolean;
  perm: Perm;
  canEditInfo: boolean;
  canEditPar: boolean;
  initialProductId: string | null;
  initialStatus: Status;
}) {
  const { products, branches, costHidden } = props;
  const router = useRouter();
  const [status, setStatus] = useState<Status>(props.initialStatus);
  const [section, setSection] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("table");
  const [branchId, setBranchId] = useState(props.defaultBranchId ?? branches[0]?.id ?? "");
  const [openId, setOpenId] = useState<string | null>(props.initialProductId);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "table" || v === "cards") setView(v);
    } catch {
      /* table it is */
    }
  }, []);
  const chooseView = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered */
    }
  };

  // ---- per-branch figures and prices, loaded after paint, once per branch ----
  const [lists, setLists] = useState<Record<string, ProductListFacts>>({});
  const [books, setBooks] = useState<Record<string, PriceBook>>({});
  const asked = useRef(new Set<string>());
  const load = (id: string, fresh = false) => {
    if (!id || (!fresh && asked.current.has(id))) return;
    asked.current.add(id);
    void readList(id).then((l) => (l ? setLists((x) => ({ ...x, [id]: l })) : asked.current.delete(id)));
    if (!costHidden) void priceBook(id).then((r) => r.ok && setBooks((x) => ({ ...x, [id]: r.book })));
  };
  useEffect(() => load(branchId), [branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = lists[branchId] ?? null;
  const book = books[branchId] ?? null;

  // ---- the recipe editor's lists, for a prepped item's production recipe ----
  const [options, setOptions] = useState<IngredientOption[] | null>(null);
  const [standards, setStandards] = useState<StandardUnit[]>([]);
  const optionsAsked = useRef(false);
  const needOptions = () => {
    if (optionsAsked.current || !props.perm.recipeShared) return;
    optionsAsked.current = true;
    void ingredientOptions().then((r) => {
      if (!r.ok) return void (optionsAsked.current = false);
      setOptions(r.options);
      setStandards(r.standards);
    });
  };

  // ---- the address follows what is open ----
  const setAddress = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("product", id);
    else url.searchParams.delete("product");
    window.history.replaceState(null, "", url);
  };
  const open = (id: string) => {
    needOptions();
    setOpenId(id);
    setAddress(id);
  };
  useEffect(() => {
    if (openId) needOptions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- filtering ----
  const factOf = (p: ProductView) => list?.facts[p.id] ?? null;
  const active = products.filter((p) => p.isActive);
  // Rule PAR-3: the counts are what still needs a hand.
  const kindOf = (p: ProductView) => factOf(p)?.state?.kind ?? null;
  const lowCount = list ? active.filter((p) => { const k = kindOf(p); return k !== null && PAR_RED.has(k); }).length : 0;
  const nearCount = list ? active.filter((p) => kindOf(p) === "near").length : 0;
  const [docsFor, setDocsFor] = useState<ProductView | null>(null);
  const byStatus = products.filter((p) => {
    const a = factOf(p)?.alert?.level;
    switch (status) {
      case "active":
        return p.isActive;
      case "raw":
        return p.isActive && p.type !== "PREPPED";
      case "prepped":
        return p.isActive && p.type === "PREPPED";
      case "low":
        return p.isActive && a === "LOW";
      case "near":
        return p.isActive && (kindOf(p) === "near" || kindOf(p) === "near-covered");
      case "inactive":
        return !p.isActive;
      default:
        return true;
    }
  });
  const sections = useMemo(() => {
    const s = [...new Set(products.map(sectionOf))].sort((a, b) => a.localeCompare(b, "th"));
    return [...s.filter((x) => x !== NO_CATEGORY), ...s.filter((x) => x === NO_CATEGORY)];
  }, [products]);
  const inSection = byStatus.filter((p) => !section || sectionOf(p) === section);
  const fields: SearchField<ProductView>[] = [
    { get: (p) => p.name, kind: "name" },
    { get: (p) => p.sku, kind: "code" },
    { get: (p) => p.category?.groupName ?? null, kind: "category" },
  ];
  const rows: { p: ProductView; weak: boolean }[] = hasQuery(q)
    ? rankBySearch(inSection, q, fields).map((r) => ({ p: r.item, weak: r.score < STRONG_MATCH }))
    : [...inSection].sort((a, b) => a.name.localeCompare(b.name, "th")).map((p) => ({ p, weak: false }));

  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";
  const openProduct = openId ? (products.find((p) => p.id === openId) ?? null) : null;

  // ---- cells ----
  const base = (p: ProductView) => unitTh(p.baseUnitName);
  const buyUnit = (p: ProductView) => p.units.find((u) => u.isDefaultBuyUnit && !u.isBase)?.unitName ?? null;
  const pulse = <span className="inline-block h-3.5 w-14 animate-pulse rounded bg-muted align-middle" />;
  const alertLine = (p: ProductView) => {
    const f = factOf(p);
    if (!f?.alert || f.par === null) return null;
    const k = f.state?.kind;
    if (k === "ordered" || k === "requested" || k === "near-covered") {
      return <span className="block text-xs text-muted-subtle">ขั้นต่ำ {qtyFmt(f.par, p.baseUnitName)} · กำลังมา {qtyFmt(f.state!.coming, p.baseUnitName)}</span>;
    }
    if (f.alert.level === "LOW") return <span className="block text-xs text-bad">ขั้นต่ำ {qtyFmt(f.par, p.baseUnitName)}</span>;
    const d = f.alert.daysToPar;
    return (
      <span className="block text-xs text-warn">
        {d === null ? "เหลือไม่ถึง 20% เหนือขั้นต่ำ" : d === 0 ? "ถึงขั้นต่ำวันนี้" : `ถึงขั้นต่ำในอีก ~${d} วัน`} ({qtyFmt(f.par, p.baseUnitName)})
      </span>
    );
  };
  // One chip per row saying what was done about it; the ones with › open the documents.
  const alertBadge = (p: ProductView) => {
    const st = factOf(p)?.state;
    if (!st) return null;
    const docsBtn = (tone: "red" | "neutral", label: string) => (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDocsFor(p);
        }}
        className={`ml-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] hover:underline ${
          tone === "red" ? "border-bad-border bg-bad-bg text-bad" : "border-border-strong bg-primary-soft text-muted-foreground"
        }`}
        title="ดูใบที่เกี่ยวข้อง"
      >
        {label} <span aria-hidden>›</span>
      </button>
    );
    switch (st.kind) {
      case "need":
        return <span className="ml-1.5 whitespace-nowrap rounded-full bg-bad-bg px-2 py-0.5 text-[11px] text-bad">ต่ำกว่าขั้นต่ำ · ยังไม่ได้สั่ง</span>;
      case "near":
        return <span className="ml-1.5 whitespace-nowrap rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-[11px] text-warn">ใกล้ขั้นต่ำ</span>;
      case "short":
        return docsBtn("red", "สั่งแล้วแต่ยังไม่พอ");
      case "overdue":
        return docsBtn("red", `ตามของ · เลยนัด ${st.lateDays} วัน`);
      case "stale-request":
        return docsBtn("red", `ขอซื้อไว้ ${st.requestLateDays + 3} วัน ยังไม่มีใครสั่ง`);
      case "ordered":
        return docsBtn("neutral", "สั่งแล้ว รอของ");
      case "requested":
        return docsBtn("neutral", "ขอซื้อแล้ว รอสั่ง");
      case "near-covered":
        return docsBtn("neutral", "ใกล้ขั้นต่ำ · สั่งแล้ว");
    }
  };
  const stockCell = (p: ProductView) => {
    if (list === null) return pulse;
    if (p.type === "PREPPED") return <span className="text-xs text-muted-subtle">ยังไม่มีการบันทึกการผลิต</span>;
    const f = factOf(p);
    if (!f) return <span className="text-xs text-muted-subtle">—</span>;
    return (
      <>
        <span className="tabular-nums">{qtyFmt(f.onHand, p.baseUnitName)}</span>
        {f.daysLeft !== null && <span className="block text-xs text-muted-subtle">พออีก {f.daysLeft.toLocaleString("th-TH")} วัน</span>}
        {alertLine(p)}
      </>
    );
  };
  const costCell = (p: ProductView) => {
    if (book === null) return pulse;
    const c = book.products[p.id];
    return c === undefined ? <span className="text-xs text-muted-subtle">ยังไม่เคยซื้อที่สาขานี้</span> : (
      <>
        <span className="tabular-nums">{baht(c, 2)}</span>
        <span className="text-xs text-muted-subtle">/{base(p)}</span>
      </>
    );
  };
  const lastCell = (p: ProductView) => {
    if (list === null) return pulse;
    const r = list.last[p.id];
    if (!r) return <span className="text-xs text-muted-subtle">{p.type === "PREPPED" ? "ทำเอง" : "—"}</span>;
    return (
      <>
        <span className="tabular-nums">{baht(r.price, 2)}</span>
        <span className="text-xs text-muted-subtle">/{unitTh(r.packUnit)}</span>
        <span className="block text-xs text-muted-subtle">
          {r.supplier} · {thDate(r.date)}
        </span>
      </>
    );
  };
  const usedCell = (p: ProductView) => {
    if (list === null) return pulse;
    const n = list.usedIn[p.id] ?? 0;
    return n ? (
      <>
        <span className="tabular-nums">{n}</span> <span className="text-xs text-muted-subtle">สูตร</span>
      </>
    ) : (
      <span className="text-xs text-muted-subtle">—</span>
    );
  };
  const kindBadges = (p: ProductView) => (
    <>
      {p.type === "PREPPED" && <span className="ml-1.5 whitespace-nowrap rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-[11px] text-warn">ของแปรรูป</span>}
      {!p.isActive && <span className="ml-1.5 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">ปิดใช้งาน</span>}
    </>
  );

  const STATUS: { key: Status; label: string; n?: number; tone?: "red" | "yellow" }[] = [
    { key: "active", label: "ที่ใช้งานอยู่" },
    { key: "raw", label: "วัตถุดิบ" },
    { key: "prepped", label: "ของแปรรูป" },
    { key: "low", label: "ต่ำกว่าขั้นต่ำ", n: lowCount, tone: "red" },
    { key: "near", label: "ใกล้ขั้นต่ำ", n: nearCount, tone: "yellow" },
    { key: "inactive", label: "ปิดใช้งาน" },
    { key: "all", label: "ทั้งหมด" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">สินค้า/วัตถุดิบ</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {active.length} รายการที่ใช้งาน · ของแปรรูป {active.filter((p) => p.type === "PREPPED").length}
            {list ? ` · ต่ำกว่าขั้นต่ำ ${lowCount} · ใกล้ขั้นต่ำ ${nearCount}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 1 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              คงเหลือและต้นทุนของ
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-full border border-border-strong bg-surface px-3 py-1 text-sm text-foreground">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {props.canEditInfo && (
            <Link href="/products/new" className="btn">
              + เพิ่มสินค้า
            </Link>
          )}
        </div>
      </div>

      {products.length === 0 ? (
        <EmptyState art="start">ยังไม่มีสินค้า — กด “เพิ่มสินค้า” เพื่อเริ่มต้น</EmptyState>
      ) : (
        <>
          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap gap-2.5" role="group" aria-label="ตัวกรอง">
              {STATUS.map((s) => (
                <button key={s.key} type="button" className={chip(status === s.key)} onClick={() => setStatus(s.key)}>
                  {s.label}
                  {s.n !== undefined && s.tone && <Dot n={s.n} tone={s.tone} />}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="หมวด">
              <button type="button" className={chip(section === null, true)} onClick={() => setSection(null)}>
                ทุกหมวด
              </button>
              {sections.map((s) => (
                <button key={s} type="button" className={chip(section === s, true)} onClick={() => setSection(section === s ? null : s)}>
                  {s}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อหรือรหัส เช่น กุ้ง, 07" aria-label="ค้นหาสินค้า" className="input min-w-[200px] flex-1" />
              <div className="flex gap-1" role="group" aria-label="มุมมอง">
                <button type="button" className={chip(view === "table", true)} onClick={() => chooseView("table")}>
                  ตาราง
                </button>
                <button type="button" className={chip(view === "cards", true)} onClick={() => chooseView("cards")}>
                  การ์ด
                </button>
              </div>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState art="none">{hasQuery(q) ? `ไม่พบสินค้าที่ตรงกับ “${q}”` : "ไม่มีสินค้าในตัวกรองนี้"}</EmptyState>
          ) : view === "table" ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-border text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">สินค้า</th>
                    <th className="px-3 py-2 text-right font-medium">คงเหลือ</th>
                    {!costHidden && <th className="px-3 py-2 text-right font-medium">ต้นทุนต่อหน่วย</th>}
                    {!costHidden && <th className="px-3 py-2 text-right font-medium">ซื้อล่าสุด</th>}
                    <th className="px-3 py-2 text-right font-medium">ใช้ใน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(({ p, weak }) => (
                    <tr key={p.id} className={`cursor-pointer hover:bg-muted/50 ${weak ? "opacity-50" : ""}`} onClick={() => open(p.id)}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-start gap-2.5">
                          <ProductThumb imageUrl={p.imageUrl} name={p.name} className="h-10 w-10 shrink-0 rounded-lg" />
                          <div className="min-w-0">
                            <span className="font-medium">{p.name}</span>
                            {kindBadges(p)}
                            {alertBadge(p)}
                            <span className="block text-xs text-muted-subtle">
                              {p.sku} · {p.category?.groupName ?? NO_CATEGORY}
                              {buyUnit(p) ? ` · ซื้อเป็น ${buyUnit(p)}` : ""}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right align-top">{stockCell(p)}</td>
                      {!costHidden && <td className="px-3 py-2.5 text-right align-top">{costCell(p)}</td>}
                      {!costHidden && <td className="px-3 py-2.5 text-right align-top">{lastCell(p)}</td>}
                      <td className="px-3 py-2.5 text-right align-top">{usedCell(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
              {rows.map(({ p, weak }) => {
                const f = factOf(p);
                const k = f?.state?.kind ?? null;
                const a = k !== null && PAR_RED.has(k) ? "LOW" : k === "near" ? "NEAR" : null;
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => open(p.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(p.id))}
                    className={`flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-surface text-left transition hover:-translate-y-px hover:shadow-card ${weak ? "opacity-50" : ""}`}
                  >
                    <div className="relative w-full border-b border-border">
                      <ProductThumb imageUrl={p.imageUrl} name={p.name} className="aspect-[4/3] w-full" />
                      <span className="absolute left-2 top-2 flex flex-wrap gap-1">
                        {p.type === "PREPPED" && <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-[11px] text-warn">ของแปรรูป</span>}
                        {!p.isActive && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">ปิดใช้งาน</span>}
                      </span>
                      {p.type !== "PREPPED" && f && (
                        <span
                          className={`absolute bottom-2 right-2 max-w-[calc(100%-16px)] whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs tabular-nums ${
                            a === "LOW" ? "border-[#E5484D] bg-[#E5484D] text-white" : a === "NEAR" ? "border-[#F5C542] bg-[#F5C542] text-[#3A2E05]" : "border-border bg-surface"
                          }`}
                        >
                          เหลือ {qtyFmt(f.onHand, p.baseUnitName)}
                        </span>
                      )}
                    </div>
                    <div className="grid gap-0.5 px-3 pb-3 pt-2.5">
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-xs text-muted-subtle">
                        {p.sku} · {p.category?.groupName ?? NO_CATEGORY}
                      </span>
                      {k && <span className="-ml-1.5">{alertBadge(p)}</span>}
                      {!costHidden && (
                        <span className="mt-1 flex flex-wrap justify-between gap-x-2 text-xs">
                          <span className="text-muted-subtle">ต้นทุน</span>
                          <span className="ml-auto tabular-nums">{book === null ? "…" : book.products[p.id] === undefined ? "—" : `${baht(book.products[p.id], 2)}/${base(p)}`}</span>
                        </span>
                      )}
                      <span className="flex flex-wrap justify-between gap-x-2 text-xs">
                        <span className="text-muted-subtle">{p.type === "PREPPED" ? "ทำเอง" : f?.daysLeft != null ? "พออีก" : "ใช้ใน"}</span>
                        <span className="ml-auto tabular-nums">
                          {p.type === "PREPPED" ? (p.parent ? `จาก ${p.parent.name}` : "สูตรผลิต") : f?.daysLeft != null ? `${f.daysLeft} วัน` : list ? `${list.usedIn[p.id] ?? 0} สูตร` : "…"}
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-muted-subtle">
            แสดง {rows.length} รายการ · คงเหลือ{costHidden ? "" : "และต้นทุน"}ของ{branchName} ·{" "}
            {list ? (list.postedThrough ? `ตัดสต๊อกตามยอดขายถึง ${thDate(list.postedThrough)}` : "ยังไม่มีการตัดสต๊อกตามยอดขาย ยอดคงเหลือจึงลดเฉพาะตอนนับ/ปรับ") : "กำลังโหลด…"} ·{" "}
            {list ? (list.warningDays > 0 ? `เหลือง = จะถึงขั้นต่ำภายใน ${list.warningDays} วัน (ตั้งที่ตั้งค่าร้าน)` : "ไม่เตือนล่วงหน้า (ตั้งที่ตั้งค่าร้าน)") : ""}
          </p>
        </>
      )}

      {openProduct && (
        <ProductSheet
          key={openProduct.id}
          product={openProduct}
          branch={{ id: branchId, name: branchName }}
          branches={branches}
          today={props.today}
          costHidden={costHidden}
          perm={props.perm}
          canEditInfo={props.canEditInfo}
          canEditPar={props.canEditPar}
          book={book}
          options={options}
          standards={standards}
          onClose={() => {
            setOpenId(null);
            setAddress(null);
          }}
          onToast={setToast}
          onSaved={() => {
            dropPrefetched();
            asked.current.clear();
            setBooks({});
            setLists({});
            load(branchId, true);
            router.refresh();
            // the sidebar's red/yellow counts (Sidebar.tsx listens)
            window.dispatchEvent(new Event("kitkrua:nav-badges"));
          }}
          onDeleted={() => {
            setOpenId(null);
            setAddress(null);
            router.refresh();
          }}
        />
      )}

      {docsFor && factOf(docsFor)?.state && factOf(docsFor)?.par != null && (
        <ParDocsPopup
          productId={docsFor.id}
          productName={docsFor.name}
          branchId={branchId}
          branchName={branchName}
          state={factOf(docsFor)!.state!}
          onHand={factOf(docsFor)!.onHand}
          par={factOf(docsFor)!.par!}
          baseUnitName={docsFor.baseUnitName}
          onClose={() => setDocsFor(null)}
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

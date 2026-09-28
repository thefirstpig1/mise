"use client";

// Kong (2026-09-28) — the product list, made to look like a catalog.
//
// Replaces the four-level expand/collapse tree (account → section → group →
// product), which put every product in a plain text row with a count beside
// every heading. Now:
//  - Filtering is by TAPPING a category: a section chip, then that section's
//    group chips underneath. No counts on the chips (Kong asked for the same on
//    /categories); one sentence says how many are shown.
//  - Every product has a picture slot (ProductThumb) so photos slot in when
//    Feature 5 lands, and the page already looks finished without them.
//  - Cards by default, a compact list for long catalogs — the choice is
//    remembered in this browser only (a per-viewer convenience, so
//    localStorage; it degrades to cards when storage is unavailable).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ProductView } from "./product-view";
import EmptyState from "@/components/ui/EmptyState";
import ProductThumb from "@/components/ui/ProductThumb";
import { RowChevron } from "@/components/ui/ActionLink";

type View = "grid" | "list";
type Status = "active" | "inactive" | "all";

const NO_CATEGORY = "ไม่มีหมวด";
const VIEW_KEY = "kitkrua.products.view";

const chip = (active: boolean, small = false) =>
  `rounded-full border transition-colors ${small ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"} ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border-strong bg-surface hover:bg-muted"
  }`;

const sectionOf = (p: ProductView) => p.category?.accountingSection ?? NO_CATEGORY;

/** "กก. · ซื้อเป็น กระสอบ 15 กก." — the two units a shop thinks in. */
function unitsLine(p: ProductView): string {
  const buy = p.units.find((u) => u.isDefaultBuyUnit && !u.isBase);
  return [p.baseUnitName, buy ? `ซื้อเป็น ${buy.unitName}` : null].filter(Boolean).join(" · ");
}

function Badges({ p }: { p: ProductView }) {
  return (
    <>
      {p.type === "PREPPED" && (
        <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs text-warn">แปรรูป</span>
      )}
      {!p.isActive && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">ปิดใช้งาน</span>
      )}
    </>
  );
}

export default function ProductBrowser({ products }: { products: ProductView[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [section, setSection] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [view, setView] = useState<View>("grid");

  // Read after mount so the server render and the first client render agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {
      /* storage blocked — cards it is */
    }
  }, []);
  const chooseView = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered, still switched */
    }
  };

  const byStatus = useMemo(
    () =>
      products.filter((p) => (status === "all" ? true : status === "active" ? p.isActive : !p.isActive)),
    [products, status]
  );

  // Chips come from what exists, in the server's order (account → section →
  // group), so an empty category never shows up as a dead button.
  const sections = useMemo(() => {
    const s = [...new Set(byStatus.map(sectionOf))];
    return [...s.filter((x) => x !== NO_CATEGORY), ...s.filter((x) => x === NO_CATEGORY)];
  }, [byStatus]);
  const groups = useMemo(
    () =>
      section && section !== NO_CATEGORY
        ? [...new Set(byStatus.filter((p) => sectionOf(p) === section).map((p) => p.category!.groupName))]
        : [],
    [byStatus, section]
  );

  const term = search.trim().toLowerCase();
  const shown = byStatus.filter((p) => {
    if (section && sectionOf(p) !== section) return false;
    if (group && p.category?.groupName !== group) return false;
    if (!term) return true;
    return [p.name, p.nameEn ?? "", p.sku, p.category?.accountingSection ?? "", p.category?.groupName ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  const pickSection = (s: string | null) => {
    setSection(s);
    setGroup(null);
  };
  const filtered = section !== null || group !== null || term !== "" || status !== "active";
  const clear = () => {
    pickSection(null);
    setSearch("");
    setStatus("active");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold">สินค้า/วัตถุดิบ</h2>
        <Link href="/products/new" className="btn">
          + เพิ่มสินค้า
        </Link>
      </div>

      {products.length === 0 ? (
        <EmptyState art="start">ยังไม่มีสินค้า — กด &quot;เพิ่มสินค้า&quot; เพื่อเริ่มต้น</EmptyState>
      ) : (
        <>
          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="หมวดหมู่">
              <button type="button" className={chip(section === null)} onClick={() => pickSection(null)}>
                ทั้งหมด
              </button>
              {sections.map((s) => (
                <button key={s} type="button" className={chip(section === s)} onClick={() => pickSection(s)}>
                  {s}
                </button>
              ))}
            </div>
            {groups.length > 1 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-3" role="group" aria-label="หมวดย่อย">
                <button type="button" className={chip(group === null, true)} onClick={() => setGroup(null)}>
                  ทุกหมวดย่อยใน{section}
                </button>
                {groups.map((g) => (
                  <button key={g} type="button" className={chip(group === g, true)} onClick={() => setGroup(g)}>
                    {g}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อหรือรหัสสินค้า"
                className="input w-full"
              />
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Status)}
                  aria-label="สถานะสินค้า"
                  className="input"
                >
                  <option value="active">ที่ใช้งานอยู่</option>
                  <option value="inactive">ที่ปิดใช้งาน</option>
                  <option value="all">ทุกสถานะ</option>
                </select>
                <div className="flex rounded-lg border border-border-strong p-0.5" role="group" aria-label="รูปแบบการแสดง">
                  {(
                    [
                      ["grid", "การ์ด", "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],
                      ["list", "รายการ", "M4 6h16M4 12h16M4 18h16"],
                    ] as const
                  ).map(([v, label, d]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => chooseView(v)}
                      aria-pressed={view === v}
                      title={`แสดงแบบ${label}`}
                      className={`rounded-md p-1.5 ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d={d} strokeLinejoin="round" strokeLinecap="round" />
                      </svg>
                      <span className="sr-only">แสดงแบบ{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              แสดง {shown.length.toLocaleString("th-TH")} จาก {products.length.toLocaleString("th-TH")} รายการ
            </span>
            {filtered && (
              <button type="button" onClick={clear} className="text-primary hover:underline">
                ล้างตัวกรอง
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <EmptyState art="none">ไม่พบสินค้าที่ตรงกับตัวกรอง</EmptyState>
          ) : view === "grid" ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/products/${p.id}`}
                    className={`group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition hover:border-primary-line hover:shadow-md ${p.isActive ? "" : "opacity-70"}`}
                  >
                    <div className="relative">
                      <ProductThumb imageUrl={p.imageUrl} name={p.name} className="aspect-[3/2] w-full rounded-none" />
                      <div className="absolute left-2 top-2 flex gap-1">
                        <Badges p={p} />
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <p className="line-clamp-2 font-medium leading-snug group-hover:text-primary">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.category?.groupName ?? NO_CATEGORY}</p>
                      <p className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                        <span className="truncate">{unitsLine(p)}</span>
                        <span className="shrink-0 tabular-nums">{p.sku}</span>
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {shown.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/products/${p.id}`}
                    className={`group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 ${p.isActive ? "" : "opacity-70"}`}
                  >
                    <ProductThumb imageUrl={p.imageUrl} name={p.name} className="h-11 w-11" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="group-hover:text-primary">{p.name}</span>
                        <Badges p={p} />
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.sku} · {p.category ? `${p.category.accountingSection} · ${p.category.groupName}` : NO_CATEGORY}
                      </p>
                    </div>
                    <span className="hidden text-sm text-muted-foreground sm:block">{unitsLine(p)}</span>
                    <RowChevron />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

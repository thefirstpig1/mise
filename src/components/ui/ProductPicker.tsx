"use client";

// ============================================================
// Mise — pick one product (or menu) by typing or by browsing (Kong, 2026-09-28)
// ============================================================
// Thirteen forms chose from a <select> of everything in the shop. Fine at 30;
// at 1,000 it is a scroll through a wall of names on a phone ("หากันตาแตก").
//
//  - TYPE any part of the name, the code or the category; several words narrow
//    together ("หมู สับ"). A name that starts with what was typed ranks first.
//  - Or just OPEN it: the whole list, grouped by category (Kong: "แบ่งตาม
//    ประเภท") with the categories in alphabetical order and each category's
//    items in alphabetical order — so browsing is a short hop, not a scroll.
//  - ↑ ↓ Enter Esc work in both; results show the picture slot and category,
//    so หมูสับ and หมูสามชั้น are told apart at a glance.
//  - `quick` offers one-tap choices before anything is typed (on the waste
//    form: what this branch throws away most often).
//  - Once chosen, the item shows as a card with เปลี่ยน.
//
// The chosen id travels in a hidden input named `name`, so a plain <form>
// posts it exactly as the <select> did — no action has to change. Several
// pickers with the same `name` post in DOM order, like repeated selects.
// ============================================================

import { useId, useMemo, useRef, useState } from "react";
import ProductThumb from "./ProductThumb";

export type PickerProduct = {
  id: string;
  name: string;
  /** Product SKU or POS menu code; may be empty. */
  sku: string;
  imageUrl: string | null;
  section: string | null;
  group: string | null;
  baseUnitName: string | null;
  /** Second line, when something other than the unit says more (e.g. a price). */
  detail?: string | null;
};

const MAX_RESULTS = 30;
const NO_CATEGORY = "ไม่มีหมวด";
const byThai = (a: string, b: string) => a.localeCompare(b, "th");

const headingOf = (p: PickerProduct) =>
  p.section ? (p.group && p.group !== p.section ? `${p.section} · ${p.group}` : p.section) : NO_CATEGORY;

/** Every word must appear; a name that STARTS with the query ranks first. */
function search(products: PickerProduct[], query: string): PickerProduct[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { p: PickerProduct; rank: number }[] = [];
  for (const p of products) {
    const name = p.name.toLowerCase();
    const hay = `${name} ${p.sku.toLowerCase()} ${(p.section ?? "").toLowerCase()} ${(p.group ?? "").toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const rank = name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2;
    scored.push({ p, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || byThai(a.p.name, b.p.name))
    .slice(0, MAX_RESULTS)
    .map((s) => s.p);
}

/** Kong: 1. grouped by category, 2. alphabetical within each. No-category last. */
function browse(products: PickerProduct[]): { heading: string; items: PickerProduct[] }[] {
  const m = new Map<string, PickerProduct[]>();
  for (const p of products) {
    const h = headingOf(p);
    m.set(h, [...(m.get(h) ?? []), p]);
  }
  return [...m.entries()]
    .sort(([a], [b]) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : byThai(a, b)))
    .map(([heading, items]) => ({ heading, items: [...items].sort((a, b) => byThai(a.name, b.name)) }));
}

export default function ProductPicker({
  products,
  value,
  onChange,
  name,
  inputId,
  quick,
  placeholder = "พิมพ์ชื่อ รหัส หรือหมวด — หรือกดเพื่อดูทั้งหมด",
  invalid,
  footer,
  disabledText,
  onInputRef,
}: {
  products: PickerProduct[];
  value: string;
  onChange: (productId: string) => void;
  /** The hidden field the form posts, e.g. "product_id". */
  name?: string;
  /** For a <label htmlFor>. */
  inputId?: string;
  /** One-tap choices shown before typing, e.g. what is wasted most here. */
  quick?: { label: string; ids: string[] };
  placeholder?: string;
  invalid?: boolean;
  /**
   * A last line in the open list, e.g. "show products this supplier has not
   * sold before" when the list is narrowed. Shown whether or not anything matched.
   */
  footer?: { label: string; onClick: () => void };
  /** Set = nothing can be chosen yet; the text says why (e.g. "เลือกผู้ขายก่อน"). */
  disabledText?: string;
  /** Lets a form focus the search box (e.g. a row it just added). */
  onInputRef?: (el: HTMLInputElement | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const grouped = useMemo(() => browse(products), [products]);
  const selected = value ? byId.get(value) : undefined;
  const typing = query.trim() !== "";
  const results = useMemo(() => search(products, query), [products, query]);
  // One flat order for the keyboard, whichever view is showing.
  const flat = typing ? results : grouped.flatMap((g) => g.items);
  const quickProducts = (quick?.ids ?? []).map((id) => byId.get(id)).filter((p): p is PickerProduct => !!p);

  const choose = (p: PickerProduct) => {
    onChange(p.id);
    setQuery("");
    setOpen(false);
  };
  const clear = () => {
    onChange("");
    setOpen(false);
    // Hand the cursor straight back so "change" is one tap, not two.
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  const move = (next: number) => {
    setActive(next);
    // Keep the highlighted row in view while arrowing through a long list.
    window.setTimeout(() => {
      listRef.current?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: "nearest" });
    }, 0);
  };

  const hidden = name ? <input type="hidden" name={name} value={value} /> : null;

  if (selected) {
    return (
      <div className="mt-1">
        {hidden}
        <div className="flex items-center gap-3 rounded-lg border border-border-strong bg-surface p-2 pr-3">
          <ProductThumb imageUrl={selected.imageUrl} name={selected.name} className="h-11 w-11" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{selected.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[selected.sku || null, selected.group ?? selected.section, selected.detail ?? selected.baseUnitName]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded-full border border-primary-line px-3 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground"
          >
            เปลี่ยน
          </button>
        </div>
      </div>
    );
  }

  if (disabledText) {
    return (
      <div className="mt-1">
        {hidden}
        <p className="input flex h-11 w-full items-center bg-muted/50 text-sm text-muted-foreground">{disabledText}</p>
      </div>
    );
  }

  const footerRow = footer ? (
    <li className="border-t border-border">
      <button
        type="button"
        // mousedown, not click: it fires before the input's blur closes the list.
        onMouseDown={(e) => {
          e.preventDefault();
          footer.onClick();
        }}
        className="w-full px-3 py-2 text-left text-xs font-medium text-primary hover:bg-muted"
      >
        {footer.label}
      </button>
    </li>
  ) : null;

  const row = (p: PickerProduct, i: number) => (
    <li
      key={p.id}
      data-i={i}
      role="option"
      aria-selected={i === active}
      // mousedown, not click: it fires before the input's blur.
      onMouseDown={(e) => {
        e.preventDefault();
        choose(p);
      }}
      onMouseEnter={() => setActive(i)}
      className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? "bg-muted" : ""}`}
    >
      <ProductThumb imageUrl={p.imageUrl} name={p.name} className="h-9 w-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{p.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[typing ? headingOf(p) : null, p.detail ?? p.baseUnitName].filter(Boolean).join(" · ") || " "}
        </p>
      </div>
      {p.sku && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.sku}</span>}
    </li>
  );

  return (
    <div className="relative mt-1">
      {hidden}
      <input
        ref={(el) => {
          inputRef.current = el;
          onInputRef?.(el);
        }}
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        // Delay so a tap on a result lands before the list disappears.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) return setOpen(true);
            move(Math.min(active + 1, flat.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(Math.max(active - 1, 0));
          } else if (e.key === "Enter") {
            // Enter picks — it must never submit the form with nothing chosen.
            e.preventDefault();
            if (open && flat[active]) choose(flat[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`input h-11 w-full text-base ${invalid ? "border-bad" : ""}`}
      />

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          {typing ? (
            results.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">
                ไม่พบ “{query.trim()}” — ลองพิมพ์ส่วนอื่นของชื่อ หรือรหัส
              </li>
            ) : (
              <>
                {results.map(row)}
                {results.length === MAX_RESULTS && (
                  <li className="px-4 py-2 text-xs text-muted-foreground">
                    แสดง {MAX_RESULTS} รายการแรก — พิมพ์เพิ่มเพื่อให้แคบลง
                  </li>
                )}
              </>
            )
          ) : products.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">ยังไม่มีรายการให้เลือก</li>
          ) : (
            (() => {
              let i = 0;
              return grouped.map((g) => (
                <li key={g.heading} role="presentation">
                  <p className="sticky top-0 z-10 bg-muted/90 px-3 py-1 text-xs font-semibold text-muted-foreground backdrop-blur">
                    {g.heading}
                  </p>
                  <ul role="group" aria-label={g.heading}>
                    {g.items.map((p) => row(p, i++))}
                  </ul>
                </li>
              ));
            })()
          )}
          {footerRow}
        </ul>
      )}

      {quickProducts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{quick!.label}:</span>
          {quickProducts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => choose(p)}
              className="rounded-full border border-border-strong bg-surface px-2.5 py-0.5 text-xs hover:bg-muted"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

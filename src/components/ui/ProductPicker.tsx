"use client";

// ============================================================
// Mise — pick one product by typing (Kong, 2026-09-28)
// ============================================================
// Thirteen forms chose a product from a <select> of every product in the shop.
// Fine at 30; at 1,000 it is a scroll through a wall of names on a phone
// ("หากันตาแตก"). This replaces it with a search box:
//
//  - Type any part of the name, the code or the category; several words narrow
//    together ("หมู สับ"). Results show the picture slot and the category, so
//    หมูสับ and หมูสามชั้น are told apart at a glance.
//  - ↑ ↓ Enter Esc work, and the whole thing is sized for a thumb.
//  - `quick` offers a few one-tap choices before anything is typed — on the
//    waste form, what this branch throws away most often.
//  - Once chosen, the product shows as a card with เปลี่ยน, not as text in a
//    box that looks editable.
//
// The chosen id travels in a hidden input named `name`, so a plain <form>
// posts it exactly as the <select> did — no action has to change.
// ============================================================

import { useId, useMemo, useRef, useState } from "react";
import ProductThumb from "./ProductThumb";

export type PickerProduct = {
  id: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  section: string | null;
  group: string | null;
  baseUnitName: string | null;
};

const MAX_RESULTS = 30;

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
    .sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name, "th"))
    .slice(0, MAX_RESULTS)
    .map((s) => s.p);
}

export default function ProductPicker({
  products,
  value,
  onChange,
  name,
  inputId,
  quick,
  placeholder = "พิมพ์ชื่อ รหัส หรือหมวด เช่น หมู, ผักบุ้ง",
  invalid,
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
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const selected = value ? byId.get(value) : undefined;
  const results = useMemo(() => search(products, query), [products, query]);
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
              {selected.sku}
              {selected.group ? ` · ${selected.group}` : ""}
              {selected.baseUnitName ? ` · ${selected.baseUnitName}` : ""}
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

  const showList = open && query.trim() !== "";

  return (
    <div className="relative mt-1">
      {hidden}
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={showList}
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
        // Delay so a tap on a result lands before the list disappears.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            // Enter picks — it must never submit the form with nothing chosen.
            e.preventDefault();
            if (showList && results[active]) choose(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`input h-11 w-full text-base ${invalid ? "border-bad" : ""}`}
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              ไม่พบ “{query.trim()}” — ลองพิมพ์ส่วนอื่นของชื่อ หรือรหัสสินค้า
            </li>
          ) : (
            results.map((p, i) => (
              <li
                key={p.id}
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
                    {p.group ?? "ไม่มีหมวด"}
                    {p.baseUnitName ? ` · ${p.baseUnitName}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.sku}</span>
              </li>
            ))
          )}
          {results.length === MAX_RESULTS && (
            <li className="px-4 py-2 text-xs text-muted-foreground">
              แสดง {MAX_RESULTS} รายการแรก — พิมพ์เพิ่มเพื่อให้แคบลง
            </li>
          )}
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

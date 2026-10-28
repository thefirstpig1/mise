"use client";

// The two choices on เปลี่ยนวัตถุดิบในหลายสูตร (Kong 2026-10-28): type-to-search
// pickers instead of two <select>s of every product (mise-ui-review §2). Picking
// both goes straight to the plan — the URL changes in place, no reload, no
// jump to the top (§1b).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";

export default function SubstitutePickers({
  from: fromOptions,
  to: toOptions,
  initialFrom,
  initialTo,
}: {
  from: PickerProduct[];
  /** Products as `p:<id>`, menus as `m:<id>` — the action reads the prefix. */
  to: PickerProduct[];
  initialFrom: string;
  initialTo: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const go = (f: string, t: string) => {
    if (!f || !t) return;
    start(() => router.push(`/recipes/substitute?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}` as Route, { scroll: false }));
  };
  return (
    <div className={`grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] ${pending ? "opacity-60" : ""}`} aria-busy={pending || undefined}>
      <div className="min-w-0">
        <label className="mb-1 block text-sm font-semibold" htmlFor="sub-from">
          เปลี่ยนจาก
        </label>
        <ProductPicker
          inputId="sub-from"
          products={fromOptions}
          value={from}
          placeholder="พิมพ์ชื่อวัตถุดิบที่จะเลิกใช้"
          onChange={(id) => {
            setFrom(id);
            go(id, to === `p:${id}` ? "" : to);
          }}
        />
      </div>
      <span aria-hidden className="hidden h-11 items-center text-xl text-muted-subtle sm:flex">
        →
      </span>
      <div className="min-w-0">
        <label className="mb-1 block text-sm font-semibold" htmlFor="sub-to">
          เปลี่ยนเป็น
        </label>
        <ProductPicker
          inputId="sub-to"
          products={toOptions.filter((p) => p.id !== `p:${from}`)}
          value={to}
          placeholder="พิมพ์ชื่อวัตถุดิบ (หรือเมนู) ที่จะใช้แทน"
          onChange={(id) => {
            setTo(id);
            go(from, id);
          }}
        />
      </div>
    </div>
  );
}

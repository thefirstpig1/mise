"use client";

// "ก.ย. 69 เทียบกับ [ส.ค. 69 ▾]" (Kong, 2026-10-03): the period on the left comes
// from the page's filters; the one it is compared with is picked here, for the
// whole page — the cards at the top and เมนูที่น่าจับตา move together. A month,
// any range, or (the default) the period just before. Switching keeps the old
// screen up and says กำลังคำนวณ… until the new one lands (mise-ui-review §5b).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

export type CompareOption = { key: string; label: string; from: string; to: string };

export default function ComparePicker({
  curLabel,
  defaultLabel,
  months,
  selected,
  custom,
}: {
  curLabel: string;
  /** The period just before, which is what "" means. */
  defaultLabel: string;
  months: CompareOption[];
  /** "" (default), a month key, or "custom". */
  selected: string;
  custom: { from: string; to: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState(selected);
  const [from, setFrom] = useState(custom?.from ?? "");
  const [to, setTo] = useState(custom?.to ?? "");

  const go = (set: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const k of ["vs", "vsFrom", "vsTo"]) url.searchParams.delete(k);
    for (const [k, v] of Object.entries(set)) if (v) url.searchParams.set(k, v);
    start(() => router.push(`${url.pathname}${url.search}` as Route, { scroll: false }));
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-foreground">{curLabel}</span>
      เทียบกับ
      <select
        value={choice}
        aria-label="ช่วงที่ใช้เทียบ"
        onChange={(e) => {
          const v = e.target.value;
          setChoice(v);
          if (v === "") go({});
          else if (v !== "custom") go({ vs: v });
        }}
        className="cursor-pointer rounded-full border border-border-strong bg-surface py-0.5 pl-2.5 pr-7 text-xs font-medium text-foreground"
      >
        <option value="">{defaultLabel} (ช่วงก่อนหน้า)</option>
        {months.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
        <option value="custom">กำหนดช่วงเอง…</option>
      </select>
      {choice === "custom" && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input py-0.5 text-xs" aria-label="ตั้งแต่" />
          –
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input py-0.5 text-xs" aria-label="ถึง" />
          <button
            type="button"
            disabled={!from || !to || from > to}
            onClick={() => go({ vsFrom: from, vsTo: to })}
            className="rounded-full border border-primary px-2.5 py-0.5 font-medium text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40"
          >
            ใช้
          </button>
        </span>
      )}
      {pending && <span className="text-muted-subtle">กำลังคำนวณ…</span>}
    </span>
  );
}

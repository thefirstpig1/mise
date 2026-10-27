"use client";

// Pick a month from a year of twelve (expense review 2026-10-27), instead of
// typing "YYYY-MM" into a box — which nobody outside this codebase writes.
// Posts the same "YYYY-MM" the text field did, so the action is unchanged.

import { useEffect, useRef, useState } from "react";
import { monthLabelTh } from "@/lib/expense-labels";

const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export default function MonthPicker({
  name,
  id,
  defaultValue,
  fallbackYear,
  emptyLabel,
}: {
  name: string;
  id?: string;
  defaultValue: string;
  /** The year the grid opens on when nothing is chosen (CE). */
  fallbackYear: number;
  /** Set = the month may be left empty, and this is what empty reads as. */
  emptyLabel?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(value ? Number(value.slice(0, 4)) : fallbackYear);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (m: number) => {
    setValue(`${year}-${String(m + 1).padStart(2, "0")}`);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative mt-1">
      <input type="hidden" name={name} value={value} />
      <button
        id={id}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`input flex h-10 w-full items-center justify-between text-left ${open ? "border-primary" : ""}`}
      >
        <span className={value ? "" : "text-muted-foreground"}>
          {value ? monthLabelTh(value) : (emptyLabel ?? "เลือกเดือน")}
        </span>
        <svg aria-hidden viewBox="0 0 10 6" className={`h-1.5 w-2.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[16rem] animate-pop-in rounded-xl border border-border-strong bg-surface p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold">
            <button type="button" aria-label="ปีก่อน" onClick={() => setYear((y) => y - 1)} className="rounded-full px-2 hover:bg-muted">
              ‹
            </button>
            <span className="tabular-nums">{year + 543}</span>
            <button type="button" aria-label="ปีถัดไป" onClick={() => setYear((y) => y + 1)} className="rounded-full px-2 hover:bg-muted">
              ›
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {MONTHS.map((m, i) => {
              const on = value === `${year}-${String(i + 1).padStart(2, "0")}`;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(i)}
                  className={`h-9 rounded-lg border text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                >
                  {m}
                </button>
              );
            })}
          </div>
          {emptyLabel && value && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                setOpen(false);
              }}
              className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-xs text-primary hover:bg-muted"
            >
              {emptyLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

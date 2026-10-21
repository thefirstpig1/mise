"use client";

// A quantity box with large − / + buttons OUTSIDE it (Kong 2026-10-21: arrows
// inside the box look dated and are hard to hit). Three separate controls laid
// out as one, as the LINE and NN/g stepper guidance describes. Only for
// counts of things — packs, bags, pieces. Prices and weights are typed: a
// step of 1 baht or 1 gram means nothing.
//
// Typing still works as before, and the box selects its value on focus
// (NumberFieldBehaviour), so the buttons are a shortcut, never the only way.

import type { InputHTMLAttributes } from "react";

const trim = (n: number) => String(Math.round(n * 1000) / 1000);

export default function QtyStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  label,
  size = "md",
  className = "",
  inputClassName = "",
  inputProps,
}: {
  value: string;
  onChange: (next: string) => void;
  step?: number;
  min?: number;
  /** What is being counted — read out by screen readers on all three controls. */
  label: string;
  size?: "sm" | "md";
  className?: string;
  inputClassName?: string;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;
}) {
  const n = Number(value);
  const cur = Number.isFinite(n) && value.trim() !== "" ? n : 0;
  const by = (d: number) => {
    const next = Math.max(min, cur + d);
    onChange(next === 0 && min === 0 && d < 0 ? "" : trim(next));
  };
  const btn =
    size === "sm"
      ? "h-8 w-8 rounded-lg text-base"
      : "h-9 w-9 rounded-lg text-lg";
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => by(-step)}
        disabled={cur <= min || inputProps?.disabled}
        aria-label={`ลด ${label}`}
        className={`${btn} shrink-0 border border-border-strong bg-surface hover:bg-muted disabled:opacity-40`}
      >
        −
      </button>
      <input
        type="number"
        step="any"
        min={min}
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...inputProps}
        className={`input text-center tabular-nums ${size === "sm" ? "w-16 py-1" : "w-20"} ${inputClassName}`}
      />
      <button
        type="button"
        onClick={() => by(step)}
        disabled={inputProps?.disabled}
        aria-label={`เพิ่ม ${label}`}
        className={`${btn} shrink-0 border border-border-strong bg-surface hover:bg-muted disabled:opacity-40`}
      >
        +
      </button>
    </span>
  );
}

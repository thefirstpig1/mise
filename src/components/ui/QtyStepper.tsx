"use client";

// THE QUANTITY FIELD (Kong 2026-10-21/22, mockup
// https://claude.ai/artifact/BPFBfCpLAWvqFq5SpYcKTd): − number + in one
// capsule of a fixed width, the way Apple's and Shopify's steppers are drawn,
// instead of a long box with tiny arrows. Only for counts of things — packs,
// bags, pieces; money and sizes use MoneyInput / MeasureInput.
//
// Typing still works, and the number selects itself on focus
// (NumberFieldBehaviour), so the buttons are a shortcut, never the only way.

import { useState, type InputHTMLAttributes, type Ref } from "react";

const trim = (n: number) => String(Math.round(n * 1000) / 1000);

export default function QtyStepper({
  value: controlled,
  defaultValue,
  onChange,
  inputRef,
  step = 1,
  min = 0,
  label,
  size = "md",
  tone = "default",
  className = "",
  inputClassName = "",
  inputProps,
}: {
  /** Controlled — or leave it out and pass `defaultValue` for a form that posts by name. */
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  step?: number;
  min?: number;
  /** What is being counted — read out by screen readers on all three controls. */
  label: string;
  size?: "sm" | "md";
  /** "warn" = e.g. received less than ordered. */
  tone?: "default" | "warn";
  className?: string;
  inputClassName?: string;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;
}) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const value = controlled ?? own;
  const set = (v: string) => {
    if (controlled === undefined) setOwn(v);
    onChange?.(v);
  };
  const n = Number(value);
  const cur = Number.isFinite(n) && value.trim() !== "" ? n : 0;
  const disabled = Boolean(inputProps?.disabled);
  const by = (d: number) => {
    const next = Math.max(min, cur + d);
    set(next === 0 && min === 0 && d < 0 ? "" : trim(next));
  };
  const btn = `${size === "sm" ? "w-8" : "w-9"} h-full shrink-0 text-lg leading-none text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:text-border-strong disabled:hover:bg-transparent`;
  return (
    <span
      className={`inline-flex shrink-0 items-stretch overflow-hidden rounded-xl border transition-colors focus-within:border-primary ${
        size === "sm" ? "h-[34px] w-28" : "h-[42px] w-36"
      } ${tone === "warn" ? "border-warn-border bg-warn-bg" : "border-border-strong bg-surface"} ${className}`}
    >
      <button type="button" onClick={() => by(-step)} disabled={cur <= min || disabled} aria-label={`ลด ${label}`} className={btn}>
        −
      </button>
      <input
        type="number"
        step="any"
        min={min}
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        ref={inputRef}
        {...inputProps}
        className={`w-0 min-w-0 flex-1 border-x border-border bg-transparent text-center font-display tabular-nums text-foreground placeholder:text-muted-subtle focus:bg-primary-soft focus:outline-none ${inputClassName}`}
      />
      <button type="button" onClick={() => by(step)} disabled={disabled} aria-label={`เพิ่ม ${label}`} className={btn}>
        +
      </button>
    </span>
  );
}

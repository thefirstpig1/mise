"use client";

// The other two number fields of the set (Kong 2026-10-22, mockup
// https://claude.ai/artifact/BPFBfCpLAWvqFq5SpYcKTd), beside QtyStepper:
//
//   MoneyInput    ฿ inside the field, the figure right-aligned
//   MeasureInput  the unit at the end of the field: 60 %, 3 วัน, 0.25 kg
//
// Both are short — as wide as the figure, not the column — 36 px tall like
// the capsule, figures in the display face. Every other attribute (name,
// required, disabled …) passes through to the real <input>, so a form that
// posts by `name` keeps working unchanged.

import type { InputHTMLAttributes, Ref } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  /** React 19: a plain prop, passed through to the <input>. */
  ref?: Ref<HTMLInputElement>;
  /** Classes for the outer box (width lives here). */
  boxClassName?: string;
  tone?: "default" | "warn" | "bad";
  /** "sm" (32 px) for a field inside a sentence or a dense sheet. */
  size?: "sm" | "md";
};

const box = (tone: Props["tone"], disabled?: boolean, size: Props["size"] = "md") =>
  `inline-flex ${size === "sm" ? "h-8 text-sm" : "h-9"} items-center gap-1.5 rounded-[10px] border px-2.5 transition-colors focus-within:border-primary ${
    tone === "warn" ? "border-warn-border bg-warn-bg" : tone === "bad" ? "border-bad-border bg-bad-bg" : "border-border bg-background"
  } ${disabled ? "opacity-60" : ""}`;
const field =
  "w-0 min-w-0 flex-1 bg-transparent text-right font-display tabular-nums text-foreground placeholder:text-muted-subtle focus:outline-none";

export function MoneyInput({ boxClassName = "w-32", tone = "default", size, className = "", ...input }: Props) {
  return (
    <label className={`${box(tone, input.disabled, size)} ${boxClassName}`}>
      <span className="text-sm text-muted-subtle">฿</span>
      <input type="number" step="any" min="0" inputMode="decimal" {...input} className={`${field} ${className}`} />
    </label>
  );
}

export function MeasureInput({ unit, boxClassName = "w-32", tone = "default", size, className = "", ...input }: Props & { unit: string }) {
  return (
    <label className={`${box(tone, input.disabled, size)} ${boxClassName}`}>
      <input type="number" step="any" inputMode="decimal" {...input} className={`${field} ${className}`} />
      <span className="whitespace-nowrap text-sm text-muted-subtle">{unit}</span>
    </label>
  );
}

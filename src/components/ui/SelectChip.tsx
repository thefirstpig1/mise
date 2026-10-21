"use client";

// A native <select> dressed as a quiet chip, whose label can slide when the
// chosen option is longer than the chip (Kong 2026-10-22). The real select
// sits transparent on top, so the browser's own list, keyboard and screen
// reader behaviour are untouched — only what the CLOSED field shows is ours.

import type { SelectHTMLAttributes } from "react";
import Marquee, { useMarquee } from "./Marquee";

export type ChipOption = { value: string; label: string };

export default function SelectChip({
  value,
  options,
  onChange,
  placeholder = "เลือก",
  className = "",
  tone = "default",
  size = "md",
  selectProps,
}: {
  value: string;
  options: ChipOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** "warn" = nothing chosen yet and something must be. */
  tone?: "default" | "warn";
  size?: "sm" | "md";
  selectProps?: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">;
}) {
  const m = useMarquee();
  const label = options.find((o) => o.value === value)?.label ?? "";
  return (
    <span
      onMouseEnter={m.start}
      onMouseLeave={m.stop}
      className={`relative flex ${size === "sm" ? "h-8" : "h-9"} min-w-0 items-center rounded-full border pl-3 pr-7 text-sm transition-colors focus-within:border-primary ${
        tone === "warn" ? "border-warn-border bg-warn-bg text-warn" : "border-border bg-surface-sunk hover:border-border-strong"
      } ${selectProps?.disabled ? "opacity-60" : ""} ${className}`}
    >
      <Marquee marquee={m} title={label || placeholder} className={label ? "" : "text-muted-subtle"}>
        {label || placeholder}
      </Marquee>
      <svg aria-hidden viewBox="0 0 10 6" className="pointer-events-none absolute right-3 h-1.5 w-2.5 text-muted-foreground">
        <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <select
        {...selectProps}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      >
        {!label && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

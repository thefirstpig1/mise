"use client";

// One choice out of a few, answered in place (kit, Kong 2026-10-28). The
// look lives in globals.css (`.seg` / `.seg-item`), so a URL filter built from
// <FilterLink className="seg-item …"> looks exactly like this one.

export default function Seg<K extends string>({
  items,
  value,
  onChange,
  label,
  className = "",
}: {
  items: readonly (readonly [K, string])[];
  value: K;
  onChange: (k: K) => void;
  /** Read by screen readers: what is being chosen. */
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`seg ${className}`}>
      {items.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={k === value} onClick={() => onChange(k)} className={`seg-item ${k === value ? "is-on" : ""}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

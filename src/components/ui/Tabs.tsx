"use client";

// Tabs for a page that different people use for different jobs (kit, Kong
// 2026-10-28) — the staff-meal page's ขอเบิก / รออนุมัติ / สรุป. A count is
// work waiting, so it is drawn as such.

export default function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {items.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} onClick={() => onChange(t.key)} className={`tab ${t.key === value ? "is-on" : ""}`}>
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className={`rounded-full px-2 text-xs ${t.key === value ? "bg-primary text-primary-foreground" : "bg-bad text-bad-foreground"}`}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

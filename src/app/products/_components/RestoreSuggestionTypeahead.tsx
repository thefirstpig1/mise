"use client";

// ============================================================
// Mise — Restore-on-recreate typeahead (Sprint 1 Part 8.5 L5a; ADR 0010)
// ============================================================
// A debounced typeahead that wraps the product-NEW "name" input and surfaces
// SOFT-DELETED products the user may be about to re-create, so they can restore
// instead of duplicating. Standalone here; L5c swaps it in for ProductForm's
// plain name input (CREATE flow only — restore = re-create intent).
//
// Grill sources (docs/adr/0010 + Part 8.5 GRILL DECISIONS):
//   Q1 — score badge tiers (>0.7 / 0.5-0.7 / 0.4-0.5), top-5 + "ดูเพิ่มอีก 5"
//        (server pre-fetches 10), no dropdown on empty (no noise).
//   Q2 — "จับคู่จาก: ชื่อ/รหัส" (matchedOn) so a sku hit shown by name is clear.
//   Q3 — fire at 3+ chars, 400ms debounce.
//   Q5 — sku-conflict warning badge (informational; newSku resolved in L5b dialog).
//   Q6 — orphan-mapping preview (count + ≤3 sample lines, ฿price only — no unit
//        label until L5b; price is a serialized string, Pitfall #20).
//
// Selection is delegated UP via onCandidateSelected (L5c opens the restore
// dialog); picking a candidate does NOT mutate the name value. The component owns
// the <input> (controlled, lifted to parent via value/onChange) and keeps
// name="name" so the existing rawFromFormData FormData contract is unchanged.
//
// a11y is MVP (Q-approved): mouse-first + Escape-to-close + minimal combobox/
// listbox/option roles. Arrow-key navigation is deferred to post-MVP polish.
// No unit tests at L5a (components covered by E2E at L6, Sprint 1 convention).
// ============================================================

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { searchSoftDeletedProductsAction } from "@/app/products/restore-actions";
import type { FuzzyMatchCandidate } from "@/server/product-restore";

const MIN_CHARS = 3; // Q3 — typeahead fires at 3+ chars
const DEBOUNCE_MS = 400; // Q3
const INITIAL_VISIBLE = 5; // Q1 — top 5 shown; server pre-fetches 10

// Match ProductForm's inputClass for visual consistency (no shared const yet).
const DEFAULT_INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

/** Q1 — map the raw pg_trgm similarity to a coarse Thai badge (decimal never shown). */
function scoreBadge(score: number): { label: string; className: string } {
  if (score > 0.7) {
    return {
      label: "ตรงกันมาก",
      className: "border-good-border bg-good-bg text-good",
    };
  }
  if (score >= 0.5) {
    return {
      label: "ใกล้เคียง",
      className: "border-warn-border bg-warn-bg text-warn",
    };
  }
  return {
    label: "อาจเกี่ยวข้อง",
    className: "border-orange-300 bg-orange-50 text-orange-700",
  };
}

export default function RestoreSuggestionTypeahead({
  value,
  onChange,
  onCandidateSelected,
  id = "name",
  name = "name",
  placeholder = "เช่น หมูสามชั้น, น้ำมันพืช",
  inputClassName = DEFAULT_INPUT_CLASS,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onCandidateSelected: (candidate: FuzzyMatchCandidate) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  inputClassName?: string;
  disabled?: boolean;
}) {
  const [results, setResults] = useState<FuzzyMatchCandidate[]>([]);
  const [showExtended, setShowExtended] = useState(false);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // (C/D) Debounced search. The `ignore` flag (set in cleanup) drops a stale
  // response when `value` changes again before the request resolves, so an
  // out-of-order reply can never overwrite newer results.
  useEffect(() => {
    const term = value.trim();
    if (term.length < MIN_CHARS) {
      setResults([]);
      setOpen(false);
      return;
    }
    let ignore = false;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await searchSoftDeletedProductsAction(term);
        if (ignore) return;
        setResults(res);
        setShowExtended(false);
        setOpen(res.length > 0); // Q1 — no dropdown on empty
      });
    }, DEBOUNCE_MS);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [value]);

  // Close on outside pointerdown + Escape (ref-based — not onBlur, which fires
  // before an option's click registers). Listener is attached only while open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visible = showExtended ? results : results.slice(0, INITIAL_VISIBLE);
  const hasMore = results.length > INITIAL_VISIBLE;

  function handleSelect(candidate: FuzzyMatchCandidate) {
    setOpen(false);
    onCandidateSelected(candidate);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        className={inputClassName}
      />
      {isPending && (
        <p className="mt-1 text-xs text-muted-foreground">กำลังค้นหา...</p>
      )}

      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
        >
          {visible.map((c) => {
            const badge = scoreBadge(c.score);
            return (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => handleSelect(c)}
                  className="block w-full border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      · {c.sku}
                    </span>
                  </span>

                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    จับคู่จาก: {c.matchedOn === "name" ? "ชื่อ" : "รหัส"}
                  </span>

                  {/* Q5 — sku conflict warning (informational; resolve in L5b). */}
                  {c.hasSkuConflict && (
                    <span className="mt-0.5 block text-xs text-warn">
                      ⚠️ รหัส {c.sku} ถูกใช้แล้วโดย “
                      {c.conflictingLiveProductName}”
                    </span>
                  )}

                  {/* Q6 — orphan-mapping preview: count + ≤3 sample lines. */}
                  {c.orphanMappingCount > 0 && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      <span className="block">
                        มีรายการราคา {c.orphanMappingCount}{" "}
                        รายการที่จะกลับมาด้วย:
                      </span>
                      {c.orphanMappingSample.map((m) => (
                        <span key={m.id} className="block pl-3">
                          • {m.supplierName} —{" "}
                          {m.currentUnitPrice ? `฿${m.currentUnitPrice}` : "—"}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}

          {/* Q1 — "ดูเพิ่มอีก 5"; end-of-results = disabled "ไม่พบรายการเพิ่มเติม". */}
          {hasMore && (
            <li className="border-t border-border p-2">
              {showExtended ? (
                <button
                  type="button"
                  disabled
                  className="w-full rounded-md px-3 py-1.5 text-center text-xs text-muted-foreground disabled:opacity-60"
                >
                  ไม่พบรายการเพิ่มเติม
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowExtended(true)}
                  className="w-full rounded-md px-3 py-1.5 text-center text-xs hover:bg-muted/40"
                >
                  ดูเพิ่มอีก {results.length - INITIAL_VISIBLE}
                </button>
              )}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

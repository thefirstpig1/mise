"use client";

// Part 35 L5 — the filter row above every chart: one period, one set of
// branches, both in the URL. A branch chip only exists for a branch the reader
// may see (the server passes that list), so a branch manager has one chip and
// nothing to toggle — the server narrows again regardless (rule A5).

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PERIOD_LABELS_TH, PERIOD_PRESETS, type PeriodPreset } from "./dashboard-period";

export type BranchChip = { id: string; name: string; color: string };

export default function DashboardControls({
  preset,
  branches,
  selected,
  rangeLabel,
}: {
  preset: PeriodPreset;
  branches: BranchChip[];
  /** Empty = all on. */
  selected: string[];
  rangeLabel: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const on = (id: string) => selected.length === 0 || selected.includes(id);

  function go(next: { p?: string; b?: string[] }) {
    const q = new URLSearchParams(params.toString());
    if (next.p !== undefined) q.set("p", next.p);
    if (next.b !== undefined) {
      if (next.b.length === 0 || next.b.length === branches.length) q.delete("b");
      else q.set("b", next.b.join(","));
    }
    start(() => router.push(`/dashboard?${q.toString()}`, { scroll: false }));
  }

  function toggle(id: string) {
    const current = branches.filter((b) => on(b.id)).map((b) => b.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    if (next.length === 0) return; // at least one branch stays on
    go({ b: next });
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1" role="group" aria-label="ช่วงเวลา">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => go({ p })}
            aria-pressed={p === preset}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              p === preset ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
            }`}
          >
            {PERIOD_LABELS_TH[p]}
          </button>
        ))}
      </div>
      <span className="text-sm text-muted-foreground">{rangeLabel}</span>

      {branches.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="สาขา">
          {branches.map((b) => {
            const active = on(b.id);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggle(b.id)}
                aria-pressed={active}
                title={active ? "กดเพื่อซ่อนสาขานี้" : "กดเพื่อแสดงสาขานี้"}
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${
                  active ? "border-border-strong bg-surface text-foreground" : "border-border bg-transparent text-muted-subtle"
                }`}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: active ? b.color : "transparent", boxShadow: `inset 0 0 0 1.5px ${b.color}` }}
                />
                {b.name}
              </button>
            );
          })}
        </div>
      ) : branches.length === 1 ? (
        <span className="text-sm text-muted-foreground">{branches[0].name}</span>
      ) : null}
    </div>
  );
}

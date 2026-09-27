"use client";

// Part 35 L5 — the filter row above every chart: one period, one set of
// branches, both in the URL. A branch chip only exists for a branch the reader
// may see (the server passes that list), so a branch manager has one chip and
// nothing to toggle — the server narrows again regardless (rule A5).

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PERIOD_LABELS_TH, PERIOD_PRESETS, type PeriodChoice } from "./dashboard-period";

export type BranchChip = { id: string; name: string; color: string };

export default function DashboardControls({
  preset,
  branches,
  selected,
  rangeLabel,
}: {
  preset: PeriodChoice;
  branches: BranchChip[];
  /** Empty = every branch; one id = that branch alone. */
  selected: string[];
  rangeLabel: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function go(next: { p?: string; b?: string[] }) {
    const q = new URLSearchParams(params.toString());
    if (next.p !== undefined) q.set("p", next.p);
    if (next.b !== undefined) {
      if (next.b.length === 0 || next.b.length === branches.length) q.delete("b");
      else q.set("b", next.b.join(","));
    }
    start(() => router.push(`/dashboard?${q.toString()}`, { scroll: false }));
  }

  // Kong (2026-09-28): one branch at a time, and pressing the branch that is
  // already on goes BACK to every branch — so "this branch vs the whole shop"
  // is one tap each way. (The first version toggled branches in and out of a
  // set, which could never get you back to the overview in one press.)
  const current = selected.length === 1 ? selected[0] : null;
  function pick(id: string | null) {
    go({ b: id === null || id === current ? [] : [id] });
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
          {[{ id: null as string | null, name: "ทุกสาขา", color: null as string | null }, ...branches].map((b) => {
            const active = b.id === current;
            return (
              <button
                key={b.id ?? "all"}
                type="button"
                onClick={() => pick(b.id)}
                aria-pressed={active}
                title={b.id && active ? "กดอีกครั้งเพื่อกลับไปดูทุกสาขา" : undefined}
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border-strong bg-surface text-foreground hover:bg-muted"
                }`}
              >
                {b.color ? (
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                ) : null}
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

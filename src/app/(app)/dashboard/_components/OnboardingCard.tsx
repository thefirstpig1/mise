"use client";

// เริ่มต้นใช้งาน — the new shop's checklist (Kong 2026-10-28, mockup
// GG5e43SSLmNFxEHfa5RQJH). Each step is ticked by the server from what the
// shop has actually done (src/server/onboarding.ts); the only thing this
// component changes is whether the person pressing has hidden it.

import Link from "next/link";
import type { Route } from "next";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { setOnboardingDismissedAction } from "../onboarding-actions";

export type OnboardingStepView = { key: string; title: string; hint: string; cta: string; href: string; done: boolean };

export default function OnboardingCard({ steps, dismissed }: { steps: OnboardingStepView[]; dismissed: boolean }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(dismissed);
  const [pending, start] = useTransition();
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  const toggle = (dismiss: boolean) => {
    setHidden(dismiss);
    start(async () => {
      const r = await orStale(setOnboardingDismissedAction(dismiss));
      if (!r.ok) setHidden(!dismiss);
      else router.refresh();
    });
  };

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => toggle(false)}
        disabled={pending}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-primary-line bg-surface px-4 text-sm font-semibold text-primary hover:bg-primary-soft"
      >
        เริ่มต้นใช้งาน · ทำแล้ว {doneCount} จาก {steps.length}
      </button>
    );
  }

  return (
    <section aria-label="เริ่มต้นใช้งาน" className="overflow-hidden rounded-2xl border border-primary-line bg-surface">
      <div className="space-y-2.5 px-5 pb-3.5 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">เริ่มต้นใช้งาน</h2>
          <span className="text-sm text-muted-foreground">
            ทำแล้ว <strong className="text-foreground">{doneCount} จาก {steps.length}</strong> ขั้น
          </span>
        </div>
        <div aria-hidden className="h-2 overflow-hidden rounded-full bg-primary-soft">
          <div className="h-full rounded-full bg-good transition-[width]" style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }} />
        </div>
      </div>
      <ol>
        {steps.map((s, i) => {
          const isNext = next?.key === s.key;
          return (
            <li key={s.key} className="flex items-center gap-3.5 border-t border-border/70 px-5 py-3.5">
              <span
                aria-hidden
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                  s.done ? "bg-good text-good-foreground" : isNext ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary"
                }`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block font-semibold ${s.done ? "text-muted-foreground line-through" : ""}`}>
                  {s.title}
                  {s.done && <span className="sr-only"> (ทำแล้ว)</span>}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{s.hint}</span>
              </span>
              {!s.done && (
                <Link
                  href={s.href as Route}
                  className={`inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-xl px-4 text-sm font-semibold ${
                    isNext ? "bg-primary text-primary-foreground hover:bg-primary-deep" : "border border-border-strong text-primary hover:bg-muted"
                  }`}
                >
                  {s.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-sunk px-5 py-2.5">
        <span className="text-sm text-muted-foreground">ขั้นที่ทำเสร็จในระบบแล้วจะติ๊กถูกให้เอง</span>
        <button type="button" onClick={() => toggle(true)} disabled={pending} className="h-10 text-sm font-semibold text-primary underline-offset-2 hover:underline">
          ซ่อนไว้ก่อน
        </button>
      </div>
    </section>
  );
}

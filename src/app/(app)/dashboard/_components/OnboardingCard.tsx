"use client";

// เริ่มต้นใช้งาน — the new shop's checklist (Kong 2026-10-28, mockup
// GG5e43SSLmNFxEHfa5RQJH). Each step is ticked by the server from what the
// shop has actually done (src/server/onboarding.ts); the only thing this
// component changes is whether the person pressing has hidden it.
//
// 2026-10-31 (friend's-shop feedback, mockup 1wgaH9Jfx8L7CxqfNHtdn3): each
// step says what the shop GETS for doing it — and once done, what it got —
// and "เชิญคนในร้าน" is a row of its own that counts for nothing: a shop of
// one is not unfinished. The same words ride the bar on every other page.

import Link from "next/link";
import type { Route } from "next";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { setOnboardingDismissedAction } from "../onboarding-actions";

export type OnboardingStepView = { key: string; title: string; gets: string; cta: string; href: string; done: boolean };

export default function OnboardingCard({
  steps,
  team,
  dismissed,
}: {
  steps: OnboardingStepView[];
  /** เชิญคนในร้าน — any time, never counted. */
  team: OnboardingStepView | null;
  dismissed: boolean;
}) {
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
        className="btn-secondary"
      >
        ตั้งร้าน · ทำแล้ว {doneCount} จาก {steps.length} · เปิดรายการ
      </button>
    );
  }

  return (
    <section aria-label="ตั้งร้าน" className="overflow-hidden rounded-[18px] border border-primary-line bg-surface shadow-card">
      <div className="space-y-2.5 px-5 pb-3.5 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">ตั้งร้าน</h2>
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
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {s.done ? "ได้แล้ว: " : "ทำแล้วจะได้: "}
                  {s.gets}
                </span>
              </span>
              {!s.done && (
                <Link
                  href={s.href as Route}
                  className={`${isNext ? "btn" : "btn-secondary"} btn-sm shrink-0`}
                >
                  {s.cta}
                </Link>
              )}
            </li>
          );
        })}
        {team && (
          <li className="flex items-center gap-3.5 border-t border-dashed border-border px-5 py-3.5">
            <span
              aria-hidden
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${team.done ? "bg-good text-good-foreground" : "border border-dashed border-primary-line text-primary"}`}
            >
              {team.done ? "✓" : "·"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 font-semibold">
                {team.title}
                <span className="chip whitespace-nowrap">ทำเมื่อไรก็ได้</span>
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{team.gets}</span>
            </span>
            {!team.done && (
              <Link
                href={team.href as Route}
                className="btn-secondary btn-sm shrink-0"
              >
                {team.cta}
              </Link>
            )}
          </li>
        )}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-sunk px-5 py-2.5">
        <span className="text-sm text-muted-foreground">ขั้นที่ทำเสร็จในระบบแล้วจะติ๊กถูกให้เอง</span>
        <button type="button" onClick={() => toggle(true)} disabled={pending} className="btn-ghost btn-sm">
          ซ่อนไว้ก่อน
        </button>
      </div>
    </section>
  );
}

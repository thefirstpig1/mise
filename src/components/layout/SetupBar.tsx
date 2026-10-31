"use client";

// ============================================================
// Mise — ตั้งร้าน: the bar on every page until setup is done
// ============================================================
// Friend's-shop feedback (Kong 2026-10-31): "ตั้งค่าเสร็จ ระบบปล่อยล้อฟรี" —
// the checklist lived only on the dashboard, so one click into a step and the
// shop no longer knew where it was. Mockup 1wgaH9Jfx8L7CxqfNHtdn3:
//   * any page          — how far along, the next step and a way to it;
//   * the step's page   — "กำลังทำอยู่ในหน้านี้" and the "ขั้นนี้ทำอะไร" box;
//   * once it ticks     — green, and the next step one press away.
// The server decides what is done (src/server/onboarding.ts) and renders this
// only for someone who may change settings, while setup is unfinished and
// not hidden. The dashboard has the whole checklist, so the bar stays off it.
// ============================================================

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { orStale } from "@/lib/stale-tab";
import { setupCopy, setupStepOfPath, type SetupCopy, type SetupStep } from "@/lib/setup-steps";
import { setOnboardingDismissedAction } from "@/app/(app)/dashboard/onboarding-actions";

type Method = "PERIODIC_INVENTORY" | "RECIPE_CONSUMPTION";

export default function SetupBar(props: { steps: { key: SetupStep; done: boolean }[]; teamDone: boolean; method: Method }) {
  const path = usePathname();
  if (path === "/dashboard") return null;
  // Keyed by page: the box opens again on each step's page.
  return <Bar key={path} path={path} {...props} />;
}

function Bar({ path, steps, teamDone, method }: { path: string; steps: { key: SetupStep; done: boolean }[]; teamDone: boolean; method: Method }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  const [boxOpen, setBoxOpen] = useState(true);

  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const hereKey = setupStepOfPath(path);
  const hereAt = steps.findIndex((s) => s.key === hereKey);
  const here = hereAt >= 0 ? steps[hereAt] : null;
  const copy = (k: SetupStep | "team") => setupCopy(k, method);

  const hide = () => {
    setGone(true);
    start(async () => {
      const r = await orStale(setOnboardingDismissedAction(true));
      if (!r.ok) setGone(false);
      else router.refresh();
    });
  };
  if (gone) return null;

  const hideButton = (
    <button type="button" onClick={hide} disabled={pending} className="h-8 whitespace-nowrap text-sm font-semibold text-muted-foreground hover:text-foreground">
      ซ่อน
    </button>
  );

  // ---- this page's step is done: say so, and point at the next one ----
  if (here?.done) {
    return (
      <Band tone="good" label="ตั้งร้าน">
        <span className="font-display font-semibold text-good">✓ ขั้น {hereAt + 1} {copy(here.key).title} เสร็จแล้ว</span>
        <Segments steps={steps} at={hereAt} />
        {next ? (
          <>
            <span className="min-w-0 text-muted-foreground">
              ต่อไป: <strong className="font-semibold text-foreground">{copy(next.key).title}</strong>
            </span>
            <span className="ml-auto flex items-center gap-3">
              <Link href={copy(next.key).href as Route} className="btn h-8 whitespace-nowrap px-3.5 text-sm">
                ไปขั้นต่อไป ›
              </Link>
              {hideButton}
            </span>
          </>
        ) : null}
      </Band>
    );
  }

  // ---- on the page where this step is done ----
  if (here || (hereKey === "team" && !teamDone)) {
    const key = here ? here.key : "team";
    const c = copy(key);
    return (
      <Band tone="primary" label="ตั้งร้าน">
        <span className="font-display font-semibold">{here ? `ขั้น ${hereAt + 1} จาก ${total}` : "ทำเมื่อไรก็ได้"}</span>
        {here ? <Segments steps={steps} at={hereAt} /> : null}
        <span className="min-w-0">
          <strong className="font-semibold">{c.title}</strong>
          <span className="text-muted-foreground"> · กำลังทำอยู่ในหน้านี้</span>
        </span>
        <span className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setBoxOpen((o) => !o)}
            aria-expanded={boxOpen}
            className="h-8 whitespace-nowrap text-sm font-semibold text-primary hover:underline"
          >
            {boxOpen ? "ย่อคำอธิบาย" : "ขั้นนี้ทำอะไร"}
          </button>
          {hideButton}
        </span>
        {boxOpen ? <StepBox copy={c} optional={!here} /> : null}
      </Band>
    );
  }

  // ---- anywhere else: how far, and the next step ----
  if (!next) return null;
  return (
    <Band tone="primary" label="ตั้งร้าน">
      <span className="font-display font-semibold">
        ตั้งร้าน · ทำแล้ว {doneCount} จาก {total}
      </span>
      <Segments steps={steps} at={steps.indexOf(next)} />
      <span className="min-w-0 text-muted-foreground">
        ต่อไป: <strong className="font-semibold text-foreground">{copy(next.key).title}</strong>
      </span>
      <span className="ml-auto flex items-center gap-3">
        <Link href={copy(next.key).href as Route} className="btn h-8 whitespace-nowrap px-3.5 text-sm">
          ไปทำ ›
        </Link>
        <Link href="/dashboard" className="h-8 whitespace-nowrap text-sm font-semibold leading-8 text-primary hover:underline">
          ดูทุกขั้น
        </Link>
        {hideButton}
      </span>
    </Band>
  );
}

function Band({ tone, label, children }: { tone: "primary" | "good"; label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className={`border-b ${tone === "good" ? "border-good-border bg-good-bg" : "border-primary-line bg-primary-soft"}`}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm lg:px-8">{children}</div>
    </section>
  );
}

/** One segment per step: done, the one in question, still to come. */
function Segments({ steps, at }: { steps: { key: SetupStep; done: boolean }[]; at: number }) {
  return (
    <span aria-hidden className="flex gap-1">
      {steps.map((s, i) => (
        <i key={s.key} className={`block h-1.5 w-5 rounded-full ${s.done ? "bg-good" : i === at ? "bg-primary" : "bg-primary/20"}`} />
      ))}
    </span>
  );
}

function StepBox({ copy, optional }: { copy: SetupCopy; optional: boolean }) {
  return (
    <div className="mt-1 grid w-full gap-x-6 gap-y-2.5 rounded-2xl border border-primary-line/70 bg-surface px-4 py-3 text-muted-foreground sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="font-display text-[11px] font-semibold tracking-[0.1em] text-gold-ink">ขั้นนี้ทำอะไร</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          {copy.todo.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </div>
      <div className="min-w-0 space-y-2">
        <div>
          <p className="font-display text-[11px] font-semibold tracking-[0.1em] text-gold-ink">ทำแล้วจะได้</p>
          <p className="mt-0.5 text-foreground">{copy.gets}</p>
        </div>
        <div>
          <p className="font-display text-[11px] font-semibold tracking-[0.1em] text-gold-ink">{optional ? "ไม่นับเป็นขั้นตั้งร้าน" : "ระบบติ๊กขั้นนี้ให้เอง"}</p>
          <p className="mt-0.5">{optional ? "ร้านคนเดียวข้ามได้ · เชิญเมื่อไรก็ได้" : copy.doneWhen}</p>
        </div>
      </div>
    </div>
  );
}

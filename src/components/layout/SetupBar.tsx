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
// Round 2 (Kong 2026-11-01, mockup 225p68BDqKAZTpd9MqDeph): "ตั้งค่าแต่ละขั้น
// ต้องกดย้อนกลับได้" — every step is named and pressable, and a step's page
// has ‹ ขั้นก่อนหน้า beside ขั้นถัดไป ›. A done step is not locked: going
// back to it is how a shop fixes it. On a phone the names fold into one line
// and "ดูทุกขั้น" opens them as a sheet.
// The server decides what is done (src/server/onboarding.ts) and renders this
// only for someone who may change settings, while setup is unfinished and
// not hidden. The dashboard has the whole checklist, so the bar stays off it.
// ============================================================

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import { orStale } from "@/lib/stale-tab";
import { setupCopy, setupStepOfPath, type SetupCopy, type SetupKey, type SetupStep } from "@/lib/setup-steps";
import { setOnboardingDismissedAction } from "@/app/(app)/dashboard/onboarding-actions";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";

type Method = "PERIODIC_INVENTORY" | "RECIPE_CONSUMPTION";
type Step = { key: SetupStep; done: boolean };

export default function SetupBar(props: { steps: Step[]; teamDone: boolean; method: Method }) {
  const path = usePathname();
  if (path === "/dashboard") return null;
  // Keyed by page: the box opens again on each step's page.
  return <Bar key={path} path={path} {...props} />;
}

function Bar({ path, steps, teamDone, method }: { path: string; steps: Step[]; teamDone: boolean; method: Method }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const hereKey = setupStepOfPath(path);
  const hereAt = steps.findIndex((s) => s.key === hereKey);
  const here = hereAt >= 0 ? steps[hereAt] : null;
  const onTeam = hereKey === "team" && !teamDone;
  const copy = (k: SetupKey) => setupCopy(k, method);
  // The step the names light up: this page's, else the one to do next.
  const at = here ? hereAt : next ? steps.indexOf(next) : -1;
  // A step still to do opens its box; a done one keeps it folded (a phone
  // screen is mostly bar otherwise) — one press opens it again.
  const [boxOpen, setBoxOpen] = useState(!here?.done);

  const hide = () => {
    setGone(true);
    start(async () => {
      const r = await orStale(setOnboardingDismissedAction(true));
      if (!r.ok) setGone(false);
      else router.refresh();
    });
  };
  if (gone) return null;
  if (!here && !onTeam && !next) return null;

  const before = here && hereAt > 0 ? steps[hereAt - 1] : null;
  const after = here && hereAt < total - 1 ? steps[hereAt + 1] : null;
  const boxKey: SetupKey | null = here ? here.key : onTeam ? "team" : null;

  const quiet = "h-8 whitespace-nowrap text-sm font-semibold";
  const toggleBox = boxKey ? (
    <button type="button" onClick={() => setBoxOpen((o) => !o)} aria-expanded={boxOpen} className={`${quiet} text-primary hover:underline`}>
      {boxOpen ? "ย่อคำอธิบาย" : "ขั้นนี้ทำอะไร"}
    </button>
  ) : null;

  return (
    <Band tone={here?.done ? "good" : "primary"}>
      {/* Every step by name — a computer has the room. */}
      <ol aria-label="ขั้นตั้งร้าน" className="hidden flex-wrap items-center gap-1 sm:flex">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1">
            {i > 0 ? (
              <span aria-hidden className="text-border-strong">
                ›
              </span>
            ) : null}
            <StepName n={i + 1} title={copy(s.key).title} href={copy(s.key).href} done={s.done} on={i === at} current={i === hereAt} />
          </li>
        ))}
        <li className="ml-2 flex items-center">
          <Link
            href={copy("team").href as Route}
            aria-current={onTeam ? "step" : undefined}
            className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed px-2.5 text-[13px] transition-colors ${
              onTeam ? "border-primary bg-surface font-semibold text-foreground" : "border-border-strong text-muted-foreground hover:bg-surface"
            }`}
          >
            {teamDone ? <span className="text-good">✓</span> : null}
            {copy("team").title}
            <span className="text-[11px] text-muted-subtle">ทำเมื่อไรก็ได้</span>
          </Link>
        </li>
      </ol>

      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5">
        {here ? (
          <>
            <StepLink to={before} label="ขั้นก่อนหน้า" dir="back" copy={copy} />
            <p className="min-w-0 flex-1 basis-40">
              {here.done ? (
                <span className="font-display font-semibold text-good">
                  ✓ ขั้น {hereAt + 1} {copy(here.key).title} เสร็จแล้ว
                  <span className="hidden font-sans font-normal text-muted-foreground sm:inline"> · กลับมาแก้ในหน้านี้ได้ทุกเมื่อ</span>
                </span>
              ) : (
                <>
                  <span className="font-display font-semibold">
                    ขั้น {hereAt + 1} จาก {total}
                  </span>
                  <span className="sm:hidden">
                    {" "}
                    · <strong className="font-semibold">{copy(here.key).title}</strong>
                  </span>
                  <span className="hidden text-muted-foreground sm:inline"> · กำลังทำอยู่ในหน้านี้</span>
                </>
              )}
            </p>
            <StepLink to={after} label="ขั้นถัดไป" dir="next" solid={here.done} copy={copy} />
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 basis-48">
              {onTeam ? (
                <>
                  <span className="font-display font-semibold">ทำเมื่อไรก็ได้</span> · <strong className="font-semibold">{copy("team").title}</strong>
                  <span className="hidden text-muted-foreground sm:inline"> · กำลังทำอยู่ในหน้านี้</span>
                </>
              ) : (
                <>
                  <span className="font-display font-semibold">
                    ตั้งร้าน · ทำแล้ว {doneCount} จาก {total}
                  </span>
                  {next ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · ต่อไป: <strong className="font-semibold text-foreground">{copy(next.key).title}</strong>
                    </span>
                  ) : null}
                </>
              )}
            </p>
            {next && !onTeam ? (
              <Link href={copy(next.key).href as Route} className="btn btn-sm">
                ไปทำ ›
              </Link>
            ) : null}
          </>
        )}
        <span className="flex items-center gap-3 sm:ml-1">
          <button type="button" onClick={() => setSheetOpen(true)} className={`${quiet} text-primary hover:underline sm:hidden`}>
            ดูทุกขั้น
          </button>
          {toggleBox}
          <button type="button" onClick={hide} disabled={pending} className={`${quiet} text-muted-foreground hover:text-foreground`}>
            ซ่อน
          </button>
        </span>
      </div>

      {boxKey && boxOpen ? <StepBox copy={copy(boxKey)} optional={!here} /> : null}
      {sheetOpen ? (
        <AllSteps steps={steps} hereAt={hereAt} onTeam={onTeam} teamDone={teamDone} copy={copy} onClose={() => setSheetOpen(false)} />
      ) : null}
    </Band>
  );
}

function Band({ tone, children }: { tone: "primary" | "good"; children: ReactNode }) {
  return (
    <section
      aria-label="ตั้งร้าน"
      className={`border-b ${tone === "good" ? "border-good-border bg-good-bg" : "border-primary-line bg-primary-soft"}`}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-2.5 text-sm lg:px-8">{children}</div>
    </section>
  );
}

/** A step's dot: ✓ when done, its number when not. */
function Dot({ n, done, on }: { n: number; done: boolean; on: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full font-display text-[11px] font-bold ${
        done ? "bg-good text-good-foreground" : on ? "bg-primary text-primary-foreground" : "bg-surface text-primary ring-1 ring-primary-line"
      }`}
    >
      {done ? "✓" : n}
    </span>
  );
}

function StepName({ n, title, href, done, on, current }: { n: number; title: string; href: string; done: boolean; on: boolean; current: boolean }) {
  return (
    <Link
      href={href as Route}
      aria-current={current ? "step" : undefined}
      className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border py-0.5 pl-1 pr-2.5 text-[13px] transition-colors ${
        on ? "border-primary bg-surface font-semibold text-foreground" : "border-transparent text-muted-foreground hover:border-border-strong hover:bg-surface"
      }`}
    >
      <Dot n={n} done={done} on={on} />
      {title}
      {done ? <span className="sr-only">(ทำแล้ว)</span> : null}
    </Link>
  );
}

/** ‹ ขั้นก่อนหน้า / ขั้นถัดไป › — a link to that step's page, or a dimmed button at either end. */
function StepLink({
  to,
  label,
  dir,
  solid = false,
  copy,
}: {
  to: Step | null;
  label: string;
  dir: "back" | "next";
  solid?: boolean;
  copy: (k: SetupKey) => SetupCopy;
}) {
  const cls = `${solid ? "btn" : "btn-secondary"} btn-sm min-w-[34px] px-2.5 sm:px-3`;
  const body = (
    <>
      {dir === "back" ? "‹" : null}
      <span className="hidden sm:inline">{label}</span>
      {dir === "next" ? "›" : null}
    </>
  );
  if (!to) {
    return (
      <button type="button" disabled aria-label={label} className={cls}>
        {body}
      </button>
    );
  }
  return (
    <Link href={copy(to.key).href as Route} aria-label={`${label}: ${copy(to.key).title}`} className={cls}>
      {body}
    </Link>
  );
}

/** Phone: every step as a sheet from the bottom. */
function AllSteps({
  steps,
  hereAt,
  onTeam,
  teamDone,
  copy,
  onClose,
}: {
  steps: Step[];
  hereAt: number;
  onTeam: boolean;
  teamDone: boolean;
  copy: (k: SetupKey) => SetupCopy;
  onClose: () => void;
}) {
  useTopLayer(onClose);
  const titleId = useId();
  const row = (key: SetupKey, n: number | null, done: boolean, current: boolean) => {
    const c = copy(key);
    return (
      <li key={key}>
        <Link
          href={c.href as Route}
          onClick={onClose}
          aria-current={current ? "step" : undefined}
          className={`flex items-start gap-3 rounded-2xl border px-3 py-2.5 ${current ? "border-primary bg-primary-soft" : "border-border bg-surface"} ${
            n === null ? "border-dashed" : ""
          }`}
        >
          {n === null ? (
            <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${done ? "bg-good text-good-foreground" : "ring-1 ring-border-strong"}`}>
              {done ? "✓" : "+"}
            </span>
          ) : (
            <Dot n={n} done={done} on={current} />
          )}
          <span className="min-w-0 flex-1">
            <span className="block font-display font-semibold text-foreground">
              {c.title}
              {current ? <span className="font-sans text-xs font-normal text-primary"> · อยู่หน้านี้</span> : null}
            </span>
            <span className="block text-xs text-muted-foreground">{n === null ? "ทำเมื่อไรก็ได้ · " : ""}{done ? "ทำแล้ว · " : ""}{c.gets}</span>
          </span>
        </Link>
      </li>
    );
  };
  return (
    <Portal>
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 animate-fade-in bg-black/25" onClick={onClose} aria-hidden />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="absolute inset-x-0 bottom-0 max-h-[85vh] animate-slide-up space-y-3 overflow-y-auto rounded-t-[22px] bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-sm"
        >
          <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-border-strong" />
          <h2 id={titleId} className="font-display text-base font-semibold">
            ขั้นตั้งร้าน · ทำแล้ว {steps.filter((s) => s.done).length} จาก {steps.length}
          </h2>
          <ol className="space-y-2">
            {steps.map((s, i) => row(s.key, i + 1, s.done, i === hereAt))}
            {row("team", null, teamDone, onTeam)}
          </ol>
          <button type="button" onClick={onClose} className="btn-secondary h-11 w-full">
            ปิด
          </button>
        </div>
      </div>
    </Portal>
  );
}

function StepBox({ copy, optional }: { copy: SetupCopy; optional: boolean }) {
  return (
    <div className="grid w-full gap-x-6 gap-y-2.5 rounded-2xl border border-primary-line/70 bg-surface px-4 py-3 text-muted-foreground sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
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

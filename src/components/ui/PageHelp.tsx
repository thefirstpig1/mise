"use client";

// ============================================================
// คิดครัว — the "?" beside a page's title
// ============================================================
// Kong 2026-11-05 (review item 5, plan 62uD4Btj1rRXV8nAHDWymV): every data
// page says, in one window, what question it answers, what it looks like with
// data, which data it uses — with THIS shop's status for each — what comes
// out, and why it matters. Opened only when pressed; the first visit to a page
// shows a small "ใหม่" tag under the button so people know it is there.
//
// The words live in src/lib/page-help.ts. The pictures are the same made-up
// shop examples the "นี่คืออะไร" window draws, labelled so — the one place
// made-up figures may appear (Kong 2026-11-05, empty pages).
// ============================================================

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { FIGURES, NEEDS, NEED_KEYS, needStatus, type FigureCopy, type NeedKey } from "@/lib/data-needs";
import { PAGE_HELP, type PageHelpKey } from "@/lib/page-help";
import { Example, useReadiness } from "@/components/ui/WaitingFor";

const SEEN = (key: PageHelpKey) => `kitkrua-help-seen:${key}`;
const isNeed = (u: string): u is NeedKey => (NEED_KEYS as readonly string[]).includes(u);

export default function PageHelp({ page, branchId }: { page: PageHelpKey; branchId?: string }) {
  const [open, setOpen] = useState(false);
  // Read after mount: the server cannot know what this browser has seen. The
  // tag shows on the FIRST visit only (plan: "ครั้งแรกที่เปิดหน้า"), so it is
  // marked seen as soon as it is shown, pressed or not.
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN(page)) === null) {
        setFresh(true);
        window.localStorage.setItem(SEEN(page), "1");
      }
    } catch {
      // Private window or blocked storage: no tag, the button is still there.
    }
  }, [page]);

  const show = () => {
    setOpen(true);
    setFresh(false);
  };

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={show}
        aria-label="หน้านี้คืออะไร"
        title="หน้านี้คืออะไร"
        className="help-btn"
      >
        ?
      </button>
      {fresh ? (
        <span className="pointer-events-none absolute left-0 top-[calc(100%+6px)] max-sm:left-auto max-sm:right-0 z-20 animate-fade-in whitespace-nowrap rounded-lg bg-primary px-2.5 py-1 font-sans text-xs font-normal tracking-normal text-primary-foreground shadow-md before:absolute before:-top-1 before:left-2.5 max-sm:before:left-auto max-sm:before:right-2.5 before:h-2 before:w-2 before:rotate-45 before:bg-primary before:content-['']">
          ใหม่ · กดดูว่าหน้านี้บอกอะไร
        </span>
      ) : null}
      {open ? <HelpDialog page={page} branchId={branchId} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function HelpDialog({ page, branchId, onClose }: { page: PageHelpKey; branchId?: string; onClose: () => void }) {
  const h = PAGE_HELP[page];
  const titleId = useId();
  const ready = useReadiness(branchId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-foreground/40 p-4 font-sans text-base font-normal tracking-normal max-sm:place-items-end max-sm:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="grid max-h-[88vh] w-full max-w-[720px] animate-pop-in grid-cols-1 overflow-y-auto rounded-[20px] bg-background shadow-lg max-sm:max-h-[92vh] max-sm:animate-slide-up max-sm:rounded-b-none"
      >
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-background px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-lg font-semibold leading-snug">
              หน้านี้คืออะไร · {h.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="icon-btn shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-4">
          <Part n={1} title="ตอบคำถามอะไร">
            <p>{h.question}</p>
          </Part>

          <Part n={2} title="หน้าตาเมื่อมีข้อมูล">
            {h.pictures.length > 0 ? (
              <div className="grid gap-2 rounded-2xl border border-border bg-surface p-3">
                <span className="justify-self-start rounded-full border border-[#E2CE97] bg-[#F8EFD6] px-2 font-display text-[11px] font-semibold text-gold-ink">
                  ตัวอย่าง · ร้านสมมุติ
                </span>
                <div className={`grid gap-3 ${h.pictures.length > 1 ? "sm:grid-cols-2" : ""}`}>
                  {h.pictures.map((k) => {
                    const f: FigureCopy = FIGURES[k];
                    return (
                      <figure key={k} className="m-0 grid min-w-0 gap-1">
                        <figcaption className="font-display text-xs font-semibold text-muted-foreground">{f.title}</figcaption>
                        <Example shape={f.shape} sample={f.sample} />
                      </figure>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <p className="text-muted-foreground">ในหน้า: {h.pictureText}</p>
          </Part>

          <Part n={3} title="ใช้ข้อมูลอะไร · ร้านนี้มีแล้วหรือยัง">
            <ul className="grid gap-2">
              {h.uses.map((u) => {
                if (!isNeed(u)) {
                  return (
                    <li key={u} className="flex flex-wrap items-center gap-2">
                      <span className="chip">ข้อมูล</span>
                      {u}
                    </li>
                  );
                }
                const need = NEEDS[u];
                const st = ready ? needStatus(u, ready) : null;
                return (
                  <li key={u} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {st ? (
                      <span className={`chip ${st.done ? "chip-good" : "chip-bad"}`}>{st.done ? "มีแล้ว" : "ยังไม่มี"}</span>
                    ) : (
                      <span className="inline-block h-5 w-14 animate-pulse rounded-full bg-border" aria-label="กำลังอ่านสถานะ" />
                    )}
                    <span className="font-medium">{need.label}</span>
                    {st ? <span className="text-xs text-muted-foreground">{st.text}</span> : ready === null ? <span className="text-xs text-muted-foreground">อ่านสถานะไม่ได้ ลองเปิดใหม่อีกครั้ง</span> : null}
                    {st && !st.done ? (
                      <a href={need.href} className="link text-xs">
                        {need.cta} ›
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Part>

          <Part n={4} title="ได้อะไรออกมา">
            <ul className="grid list-disc gap-1 pl-5 marker:text-muted-subtle">
              {h.outputs.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </Part>

          <Part n={5} title="ทำไมสำคัญ">
            <p>{h.why}</p>
          </Part>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">
            ปิด
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Part({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      <span aria-hidden className="row-span-2 mt-0.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-[#7D8550] font-display text-xs font-bold text-white">
        {n}
      </span>
      <h3 className="font-display text-[0.95rem] font-semibold">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

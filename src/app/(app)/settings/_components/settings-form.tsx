"use client";

// ============================================================
// Mise — ตั้งค่าร้าน: sections that save on their own (review 2026-10-28)
// ============================================================
// Mockup 6A5E893FefkuYmW3Z5vzbn. What the old page got wrong was not the
// fields, it was saving: one บันทึก at the bottom of seven boxes, so a change
// at the top was lost unless somebody scrolled. Here:
//   * each SectionForm knows whether it differs from what was saved (a
//     snapshot of its FormData), says "ยังไม่ได้บันทึก" and offers ยกเลิก/บันทึก;
//   * leaving the page while any section differs asks first — the app's own
//     dialog for links inside the app, the browser's for closing the tab;
//   * on a phone the save bar rides at the bottom of the screen while the
//     section is dirty, because the section's own footer may be far away.
// Fields stay uncontrolled, so the Server Component page renders them and
// form.reset() is "ยกเลิก".
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { orStale } from "@/lib/stale-tab";
import { ConfirmDialog, Portal } from "@/app/(app)/menus/_components/sheet-parts";
import type { SectionState } from "../actions";

// ---------- which sections hold unsaved changes ----------
const dirty = new Set<string>();
const listeners = new Set<() => void>();
function setDirty(id: string, on: boolean) {
  const had = dirty.has(id);
  if (on) dirty.add(id);
  else dirty.delete(id);
  if (had !== on) listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const dirtyCount = () => dirty.size;

function snapshot(form: HTMLFormElement): string {
  const fd = new FormData(form);
  return JSON.stringify([...fd.entries()].map(([k, v]) => [k, String(v)]));
}

// ---------- field errors, read by FieldError inside a section ----------
const ErrorsContext = createContext<Record<string, string>>({});

export function FieldError({ name }: { name: string }) {
  const msg = useContext(ErrorsContext)[name];
  return msg ? <p className="mt-1 text-xs text-bad">{msg}</p> : null;
}

export function SectionForm({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action: (fd: FormData) => Promise<SectionState>;
  children: ReactNode;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const saved = useRef("");
  const [isDirty, setIsDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    if (ref.current) saved.current = snapshot(ref.current);
    return () => setDirty(id, false);
  }, [id]);

  const recheck = useCallback(() => {
    if (!ref.current) return;
    const d = snapshot(ref.current) !== saved.current;
    setIsDirty(d);
    setDirty(id, d);
    if (d) setJustSaved(false);
  }, [id]);

  const cancel = () => {
    ref.current?.reset();
    setError(null);
    setFieldErrors({});
    // reset fires before the inputs repaint their default values.
    requestAnimationFrame(recheck);
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      const r = await orStale(action(fd));
      if (r.ok) {
        saved.current = snapshot(form);
        setIsDirty(false);
        setDirty(id, false);
        setError(null);
        setFieldErrors({});
        setJustSaved(true);
        router.refresh();
      } else {
        setError(r.formError);
        setFieldErrors(r.fieldErrors ?? {});
      }
    });
  };

  const buttons = (
    <>
      <button type="button" onClick={cancel} disabled={pending} className="btn-secondary">
        ยกเลิก
      </button>
      <button type="submit" form={id} disabled={pending} className="btn h-11 px-5">
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </button>
    </>
  );

  return (
    <ErrorsContext.Provider value={fieldErrors}>
      <form
        id={id}
        ref={ref}
        onSubmit={submit}
        onInput={recheck}
        onChange={recheck}
        className="scroll-mt-36 overflow-hidden rounded-2xl border border-border bg-surface lg:scroll-mt-20"
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4 sm:px-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          {isDirty && (
            <span className="whitespace-nowrap rounded-full border border-warn-border bg-warn-bg px-2.5 py-0.5 text-xs font-semibold text-warn">
              ยังไม่ได้บันทึก
            </span>
          )}
        </div>
        <div className="divide-y divide-border/70">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-sunk px-5 py-3 sm:px-6">
          {error && <p className="mr-auto text-sm text-bad">{error}</p>}
          {isDirty ? (
            buttons
          ) : (
            <>
              {justSaved && <span className="text-sm text-good">✓ บันทึกแล้ว</span>}
              <button type="submit" disabled className="btn h-11 px-5 disabled:opacity-40">
                บันทึก
              </button>
            </>
          )}
        </div>
        {/* A phone keeps the save bar in reach while this section differs. */}
        {isDirty && (
          <Portal>
          <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-warn-border bg-surface px-4 pb-5 pt-3 shadow-[0_-6px_18px_rgba(65,67,27,.08)] lg:hidden">
            <span className="mr-auto text-sm font-semibold text-warn">ยังไม่ได้บันทึก · {title}</span>
            {buttons}
          </div>
          </Portal>
        )}
      </form>
    </ErrorsContext.Provider>
  );
}

/**
 * A line that appears only while the named checkbox differs from what is
 * saved — what pressing บันทึก is about to DO (the VAT switch moves the next
 * goods receipt only; the department switch sends new lines to the default).
 */
export function ChangedNote({ name, savedOn, whenOn, whenOff }: { name: string; savedOn: boolean; whenOn?: string; whenOff?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(savedOn);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const read = () => {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement) setOn(el.checked);
    };
    const later = () => requestAnimationFrame(read);
    read();
    form.addEventListener("change", read);
    form.addEventListener("reset", later);
    return () => {
      form.removeEventListener("change", read);
      form.removeEventListener("reset", later);
    };
  }, [name, savedOn]);
  const text = on === savedOn ? null : on ? whenOn : whenOff;
  return (
    <span ref={ref} className="block">
      {text && <span className="mt-2 block rounded-lg border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn">{text}</span>}
    </span>
  );
}

/** Ask before leaving the page while a section holds unsaved changes. */
export function UnsavedGuard() {
  const router = useRouter();
  const count = useSyncExternalStore(subscribe, dirtyCount, () => 0);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  useEffect(() => {
    if (count === 0) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    // Capture phase: runs before Next's <Link> handler on the root.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank") return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.hash) return; // the section chips
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [count]);

  if (!leaveTo) return null;
  return (
    <ConfirmDialog
      spec={{
        title: "ออกจากหน้านี้โดยไม่บันทึก?",
        lines: ["ค่าที่แก้ไว้แต่ยังไม่ได้กดบันทึกจะหายไป"],
        money: null,
        who: "",
        go: "ออกโดยไม่บันทึก",
        back: "อยู่ต่อ",
        onGo: () => {
          dirty.clear();
          listeners.forEach((l) => l());
          router.push(leaveTo as never);
        },
      }}
      onClose={() => setLeaveTo(null)}
    />
  );
}

/** The sticky chips; the one whose section is on screen is lit. */
export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = sections.find((s) => seen.get(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-140px 0px -45% 0px" }
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label="หมวดการตั้งค่า"
      className="sticky top-[3.6rem] z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur lg:top-0 lg:mx-0 lg:px-0"
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={() => setActive(s.id)}
          aria-current={active === s.id ? "true" : undefined}
          className={`pill shrink-0 ${active === s.id ? "is-on" : ""}`}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

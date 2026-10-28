"use client";

// ============================================================
// Mise — รวมเมนูที่ซ้ำกัน, the screen (Kong, 2026-10-28)
// ============================================================
// Approved mockup ULB2J5KLXq6nj8ujyv2emK. Three ways in, one popup:
//  - "น่าจะซ้ำ": groups the system suggests (menu-merge-suggest.ts). A score
//    suggests, a person decides (ADR 0019 Q7) — every row is ticked in the
//    popup before anything is written.
//  - the search box: any menu at all, by name or POS code, so two branches that
//    named one dish very differently are never a dead end.
//  - `?menu=` from a menu's sheet.
// The popup lays the rows side by side with what decides the main menu — its
// branch, code, sales and whether it has a recipe — and says, before the press,
// what the merge will and will not do (ADR 0026 Q1/Q2/Q5).
// ============================================================

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SERIES } from "@/components/charts/chart-theme";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import { orStale } from "@/lib/stale-tab";
import type { MergeMenuFacts, MergeSuggestion } from "@/server/menu-merge-suggest";
import { mergeGroupAction, revokeMergeAction, type MenuMergeActionState } from "../actions";

export type MergeRowView = {
  id: string;
  winningMenuId: string;
  losingMenuId: string;
  effectiveFrom: string;
  revokedAt: string | null;
  winnerName: string;
  winnerBranch: string | null;
  loserName: string;
  loserBranch: string | null;
  loserCode: string | null;
};

const baht = (v: number) => `฿${Math.round(v).toLocaleString("th-TH")}`;
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

export default function MergeScreen({
  menus,
  suggestions,
  salesWindow,
  merges,
  includeRevoked,
  openMenuId,
  todayIso,
}: {
  menus: MergeMenuFacts[];
  suggestions: MergeSuggestion[];
  salesWindow: { from: string; to: string } | null;
  merges: MergeRowView[];
  includeRevoked: boolean;
  openMenuId: string | null;
  todayIso: string;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const byId = useMemo(() => new Map(menus.map((m) => [m.id, m])), [menus]);
  const branchColor = useMemo(() => {
    const ids = [...new Set(menus.map((m) => m.branchId ?? "none"))].sort();
    return new Map(ids.map((id, i) => [id, SERIES[i % SERIES.length]]));
  }, [menus]);
  const [tab, setTab] = useState<"sug" | "done">(suggestions.length === 0 && merges.length > 0 ? "done" : "sug");
  const [popup, setPopup] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const liveMerges = merges.filter((m) => !m.revokedAt);

  useEffect(() => {
    if (!openMenuId || !byId.has(openMenuId)) return;
    const g = suggestions.find((s) => s.menuIds.includes(openMenuId));
    setPopup(g ? g.menuIds : [openMenuId]);
    // Opened once from the link; the URL keeps it only for a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMenuId]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const done = (msg: string) => {
    setPopup(null);
    setToast(msg);
    startRefresh(() => router.refresh());
  };
  const branchTag = (branchId: string | null, name: string | null) => (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: branchColor.get(branchId ?? "none") }} />
      {name ?? "ไม่ได้มาจาก POS"}
    </span>
  );

  return (
    <div className={`space-y-5 transition-opacity ${refreshing ? "opacity-70" : ""}`}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <a href="/menus" className="text-xs text-muted-foreground hover:text-foreground">
            จัดการเมนู ›
          </a>
          <h2 className="text-2xl font-semibold">รวมเมนูที่ซ้ำกัน</h2>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            แต่ละสาขาส่งรหัสเมนูจาก POS ของตัวเอง จานเดียวกันจึงขึ้นเป็นหลายรายการ รวมแล้วทุกหน้าจะนับเป็นจานเดียว ยอดขายเดิมยังอยู่ครบ และยกเลิกได้ทุกเมื่อ
          </p>
        </div>
        <MenuSearch menus={menus} branchTag={branchTag} onPick={(m) => {
          const g = suggestions.find((s) => s.menuIds.includes(m.id));
          const winner = m.mergedIntoMenuId;
          setPopup(g ? g.menuIds : winner ? [winner, ...byId.get(winner)!.spellingIds] : [m.id, ...m.spellingIds]);
        }} />
      </header>

      <div role="tablist" className="flex gap-1 border-b border-border">
        {(
          [
            ["sug", "น่าจะซ้ำ", suggestions.length],
            ["done", "รวมแล้ว", new Set(liveMerges.map((m) => m.winningMenuId)).size],
          ] as const
        ).map(([k, l, n]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px inline-flex h-11 items-center gap-2 border-b-2 px-3.5 font-semibold transition-colors ${
              tab === k ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {l}
            <span className={`rounded-full px-2 text-xs ${tab === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{n}</span>
          </button>
        ))}
      </div>

      {tab === "sug" ? (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ระบบจับกลุ่มเมนูที่ชื่อเหมือนหรือคล้ายกันจากต่างสาขาไว้ให้ · เรียงตามยอดขาย
            {salesWindow ? ` ${salesWindow.from} – ${salesWindow.to} (30 วันล่าสุดที่มีข้อมูล)` : ""} · ตรวจก่อนทุกครั้ง ระบบแค่เสนอ
          </p>
          {suggestions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">
              ไม่มีเมนูที่น่าจะซ้ำ · ถ้ารู้ว่าเมนูไหนซ้ำแต่ชื่อต่างกันมาก ค้นจากช่องด้านบนได้
            </div>
          ) : (
            suggestions.map((g) => {
              const ms = g.menuIds.map((id) => byId.get(id)!);
              const branches = new Set(ms.map((m) => m.branchId)).size;
              return (
                <article key={g.menuIds.join()} className="space-y-3 rounded-2xl border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold">{ms[0].name}</h3>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`rounded-full border px-2 py-0.5 font-semibold ${
                            g.kind === "exact" ? "border-good-border bg-good-bg text-good" : "border-warn-border bg-warn-bg text-warn"
                          }`}
                        >
                          {g.kind === "exact" ? "ชื่อตรงกัน" : "ชื่อคล้ายกัน"}
                        </span>
                        {ms.length} รายการ จาก {branches} สาขา{g.net > 0 ? ` · ขายรวม ${baht(g.net)}` : ""}
                      </p>
                    </div>
                    <button type="button" className="btn" onClick={() => setPopup(g.menuIds)}>
                      ตรวจแล้วรวม
                    </button>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(13rem, 1fr))` }}>
                    {ms.map((m) => (
                      <div key={m.id} className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-surface-sunk px-3 py-2.5">
                        {branchTag(m.branchId, m.branchName)}
                        <span className="break-words font-semibold">{m.name}</span>
                        <span className="flex flex-wrap gap-x-2.5 text-xs text-muted-foreground">
                          {m.posMenuCode && <span>รหัส {m.posMenuCode}</span>}
                          <span className="tabular-nums">{m.qty > 0 ? `${baht(m.net)} · ${m.qty.toLocaleString("th-TH")} จาน` : "ไม่มียอดในช่วงนี้"}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <RecipeChip has={m.hasRecipe} />
                          {m.spellingIds.length > 0 && <span className="rounded-full border border-border-strong bg-surface px-2 text-[11px] text-muted-foreground">เมนูหลักของ {m.spellingIds.length} ชื่อแล้ว</span>}
                          {m.isRetired && <span className="rounded-full border border-border-strong bg-surface px-2 text-[11px] text-muted-foreground">เลิกขายแล้ว</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })
          )}
        </section>
      ) : (
        <MergedList merges={merges} byId={byId} branchTag={branchTag} includeRevoked={includeRevoked} onRevoked={done} />
      )}

      {popup && (
        <MergePopup
          key={popup.join()}
          initial={popup}
          menus={menus}
          byId={byId}
          branchTag={branchTag}
          todayIso={todayIso}
          onClose={() => setPopup(null)}
          onDone={done}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 animate-pop-in rounded-xl bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function RecipeChip({ has }: { has: boolean }) {
  return has ? (
    <span className="rounded-full border border-good-border bg-good-bg px-2 text-[11px] text-good">มีสูตร</span>
  ) : (
    <span className="rounded-full border border-dashed border-border-strong bg-surface px-2 text-[11px] text-muted-foreground">ยังไม่มีสูตร</span>
  );
}

type Tag = (branchId: string | null, name: string | null) => React.ReactNode;

// ------------------------------------------------------------
// Search — any menu, by name or POS code, no reload
// ------------------------------------------------------------
function MenuSearch({
  menus,
  branchTag,
  onPick,
  exclude,
  placeholder = "ค้นชื่อหรือรหัสเมนู เพื่อรวมเอง",
  className = "w-full sm:w-[22rem]",
}: {
  menus: MergeMenuFacts[];
  branchTag: Tag;
  onPick: (m: MergeMenuFacts) => void;
  exclude?: Set<string>;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(0);
  const term = q.trim().toLowerCase();
  const list = term
    ? menus
        .filter((m) => !exclude?.has(m.id) && (m.name.toLowerCase().includes(term) || (m.posMenuCode ?? "").toLowerCase().includes(term)))
        .slice(0, 10)
    : [];
  const pick = (m: MergeMenuFacts | undefined) => {
    if (!m) return;
    setQ("");
    setOpen(false);
    onPick(m);
  };
  return (
    <div className={`relative ${className}`}>
      <svg className="pointer-events-none absolute left-3 top-3 text-muted-subtle" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHot(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            setHot((h) => Math.min(h + 1, list.length - 1));
            e.preventDefault();
          } else if (e.key === "ArrowUp") {
            setHot((h) => Math.max(h - 1, 0));
            e.preventDefault();
          } else if (e.key === "Enter") {
            pick(list[hot]);
            e.preventDefault();
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className="h-11 w-full rounded-xl border border-border-strong bg-surface pl-10 pr-3 text-sm"
      />
      {open && term && (
        <div className="absolute left-0 right-0 top-12 z-30 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          {list.length === 0 ? (
            <p className="p-2.5 text-sm text-muted-foreground">ไม่พบเมนูที่ชื่อหรือรหัสมี “{q.trim()}”</p>
          ) : (
            list.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${i === hot ? "bg-surface-sunk" : "hover:bg-surface-sunk"}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                {branchTag(m.branchId, m.branchName)}
                {m.posMenuCode && <span className="text-xs text-muted-foreground">{m.posMenuCode}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// The popup
// ------------------------------------------------------------
function MergePopup({
  initial,
  menus,
  byId,
  branchTag,
  todayIso,
  onClose,
  onDone,
}: {
  initial: string[];
  menus: MergeMenuFacts[];
  byId: Map<string, MergeMenuFacts>;
  branchTag: Tag;
  todayIso: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  // A row already folded into something is shown, but only as the merge it is
  // part of: it cannot be merged again (ADR 0026 Q4).
  const [ids, setIds] = useState<string[]>(initial);
  const mergeable = (m: MergeMenuFacts) => m.mergedIntoMenuId === null;
  const [include, setInclude] = useState<Set<string>>(() => new Set(initial.filter((id) => mergeable(byId.get(id)!))));
  const [main, setMain] = useState<string>(() => {
    const ms = initial.map((id) => byId.get(id)!).filter(mergeable);
    // An existing star keeps its centre; otherwise the row with a recipe, then the bigger seller.
    const star = ms.find((m) => m.spellingIds.length > 0);
    return (star ?? [...ms].sort((a, b) => Number(b.hasRecipe) - Number(a.hasRecipe) || b.net - a.net)[0] ?? byId.get(initial[0])!).id;
  });
  const [date, setDate] = useState(todayIso);
  const keys = useRef(new Map<string, string>());
  const keyFor = (id: string) => {
    let k = keys.current.get(id);
    if (!k) {
      k = newKey();
      keys.current.set(id, k);
    }
    return k;
  };
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<{ text: string; warn: boolean } | null>(null);
  const [pending, start] = useTransition();

  const ms = ids.map((id) => byId.get(id)!);
  const mainMenu = byId.get(main)!;
  // The main menu's existing spellings are already merged — never sent again.
  const losers = ms.filter((m) => m.id !== main && include.has(m.id) && mergeable(m) && !mainMenu.spellingIds.includes(m.id));
  const losersNoRecipe = losers.filter((m) => !m.hasRecipe);
  const losersOwn = losers.filter((m) => m.hasRecipe);
  // A menu that already has spellings cannot itself be folded (no chains, Q4).
  const blockedLoser = losers.find((m) => m.spellingIds.length > 0);
  const names = (xs: MergeMenuFacts[]) => [...new Set(xs.map((m) => m.branchName ?? m.name))].join(", ");

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await orStale(
        mergeGroupAction({
          winningMenuId: main,
          losers: losers.map((m) => ({ menuId: m.id, submitKey: keyFor(m.id) })),
          effectiveFrom: date,
          acknowledgeBackdate: ack,
        })
      );
      if (res.ok) return onDone(`รวมแล้ว · ${res.merged + 1} รายการนับเป็น “${mainMenu.name}”`);
      if ("needsAcknowledgement" in res && res.needsAcknowledgement) {
        setAck(true);
        setError({ text: res.formError ?? "", warn: true });
      } else setError({ text: res.formError ?? "รวมไม่สำเร็จ", warn: false });
    });

  return (
    <ModalShell onClose={onClose} labelledBy="merge-title" wide>
      <div className="space-y-4">
        <div className="pr-10">
          <h3 id="merge-title" className="text-xl font-semibold">
            รวมเป็นเมนูเดียว
          </h3>
          <p className="text-sm text-muted-foreground">เลือกรายการที่เป็นจานเดียวกันจริง แล้วเลือกเมนูหลัก (ชื่อที่ทุกหน้าจะใช้)</p>
        </div>

        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))" }}>
          {ms.map((m) => {
            const isMain = m.id === main;
            const already = mainMenu.spellingIds.includes(m.id);
            const on = include.has(m.id) && mergeable(m);
            return (
              <div
                key={m.id}
                className={`flex flex-col gap-1.5 rounded-2xl border-[1.5px] p-3.5 ${
                  isMain ? "border-primary bg-primary-soft" : on || already ? "border-border bg-surface" : "border-border bg-surface-sunk opacity-60"
                }`}
              >
                <span
                  className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${isMain ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {isMain ? "เมนูหลัก" : already ? "รวมไว้แล้ว" : !mergeable(m) ? "รวมกับเมนูอื่นอยู่" : on ? "นับรวมเข้าเมนูหลัก" : "ไม่รวม"}
                </span>
                {branchTag(m.branchId, m.branchName)}
                <span className="text-base font-semibold">{m.name}</span>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                  <dt className="text-muted-foreground">รหัส POS</dt>
                  <dd className="text-right">{m.posMenuCode ?? "—"}</dd>
                  <dt className="text-muted-foreground">ยอดขาย 30 วัน</dt>
                  <dd className="text-right tabular-nums">{m.qty > 0 ? baht(m.net) : "—"}</dd>
                  <dt className="text-muted-foreground">จำนวน</dt>
                  <dd className="text-right tabular-nums">{m.qty > 0 ? `${m.qty.toLocaleString("th-TH")} จาน` : "—"}</dd>
                  <dt className="text-muted-foreground">สูตร</dt>
                  <dd className="text-right">{m.hasRecipe ? "มีแล้ว" : "ยังไม่มี"}</dd>
                </dl>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2 text-[13px]">
                  {isMain ? (
                    <span className="text-xs text-muted-foreground">ชื่อนี้จะขึ้นในทุกรายงาน</span>
                  ) : already ? (
                    <span className="text-xs text-muted-foreground">ยกเลิกได้ที่แท็บ “รวมแล้ว”</span>
                  ) : !mergeable(m) ? (
                    <span className="text-xs text-muted-foreground">ยกเลิกการรวมเดิมก่อนจึงจะรวมใหม่ได้</span>
                  ) : (
                    <>
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            const next = new Set(include);
                            if (e.target.checked) next.add(m.id);
                            else next.delete(m.id);
                            setInclude(next);
                            setAck(false);
                          }}
                        />
                        เป็นจานเดียวกัน
                      </label>
                      {on && m.spellingIds.length === 0 && mainMenu.spellingIds.length === 0 && (
                        <button type="button" onClick={() => setMain(m.id)} className="font-semibold text-primary underline underline-offset-2">
                          ใช้เป็นเมนูหลัก
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">มีรายการอื่นที่เป็นจานเดียวกันอีกไหม</p>
          <MenuSearch
            menus={menus}
            branchTag={branchTag}
            exclude={new Set(ids)}
            placeholder="ค้นแล้วเพิ่มเข้ามา"
            className="w-full sm:w-[21rem]"
            onPick={(m) => {
              setIds((x) => [...x, m.id]);
              if (mergeable(m)) setInclude((s) => new Set([...s, m.id]));
            }}
          />
        </div>

        <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <b>เริ่มตัดสต๊อกตามสูตรของเมนูหลักตั้งแต่</b>
          <input
            type="date"
            value={date}
            max={todayIso}
            onChange={(e) => {
              setDate(e.target.value || todayIso);
              setAck(false);
              setError(null);
            }}
            className="h-10 rounded-lg border border-border-strong bg-surface px-2.5"
          />
        </label>

        <div className="space-y-1.5 rounded-2xl border border-border bg-surface-sunk px-4 py-3 text-sm">
          <p className="font-semibold">{losers.length ? `${losers.length} รายการจะนับเป็น “${mainMenu.name}”` : "ยังไม่ได้เลือกรายการที่จะรวม"}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground">
            <li>รายงานยอดขายทุกหน้านับรวมทันที รวมถึงเดือนที่ผ่านมา · ยอดขายเดิมไม่ถูกย้ายหรือลบ</li>
            {losersNoRecipe.length > 0 && <li>{names(losersNoRecipe)} ยังไม่มีสูตร จะตัดสต๊อกด้วยสูตรของเมนูหลักตั้งแต่วันที่ข้างบน</li>}
            {losersOwn.length > 0 && <li>{names(losersOwn)} มีสูตรของตัวเองแล้ว ยังใช้สูตรเดิมต่อ ไม่ถูกเขียนทับ</li>}
            <li>POS ของแต่ละสาขาส่งรหัสเดิมมาได้ตามปกติ · ยกเลิกได้ทุกเมื่อจากแท็บ “รวมแล้ว”</li>
          </ul>
          {date < todayIso && !error && (
            <p className="text-xs text-warn">วันที่ย้อนหลัง: ถ้าวันเหล่านั้นตัดสต๊อกไปแล้ว ระบบจะบอกจำนวนวันและให้ยืนยันอีกครั้ง</p>
          )}
        </div>

        {blockedLoser && (
          <p className="rounded-xl border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn">
            “{blockedLoser.name}” เป็นเมนูหลักของชื่ออื่นอยู่แล้ว จึงรวมเข้าเมนูอื่นไม่ได้ — ใช้เป็นเมนูหลักแทน หรือเอาออกจากการรวมนี้
          </p>
        )}
        {error && (
          <p className={`rounded-xl border px-3 py-2 text-sm ${error.warn ? "border-warn-border bg-warn-bg text-warn" : "border-bad-border bg-bad-bg text-bad"}`}>{error.text}</p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-border-strong px-4 text-sm font-semibold">
            ยกเลิก
          </button>
          <button type="button" className="btn" disabled={pending || losers.length === 0 || Boolean(blockedLoser)} onClick={submit}>
            {pending ? "กำลังรวม…" : losers.length === 0 ? "เลือกรายการที่จะรวมก่อน" : ack ? "เข้าใจแล้ว — รวมย้อนหลังตามวันที่เลือก" : `รวม ${losers.length + 1} รายการเป็นเมนูเดียว`}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ------------------------------------------------------------
// รวมแล้ว — one block per main menu
// ------------------------------------------------------------
function MergedList({
  merges,
  byId,
  branchTag,
  includeRevoked,
  onRevoked,
}: {
  merges: MergeRowView[];
  byId: Map<string, MergeMenuFacts>;
  branchTag: Tag;
  includeRevoked: boolean;
  onRevoked: (msg: string) => void;
}) {
  const [undo, setUndo] = useState<MergeRowView | null>(null);
  const groups = new Map<string, MergeRowView[]>();
  for (const m of merges.filter((x) => !x.revokedAt)) groups.set(m.winningMenuId, [...(groups.get(m.winningMenuId) ?? []), m]);
  const revoked = merges.filter((x) => x.revokedAt);
  const branchIdOf = (menuId: string) => byId.get(menuId)?.branchId ?? null;

  return (
    <section className="space-y-3">
      {groups.size === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">ยังไม่มีการรวมเมนู</div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {[...groups.entries()].map(([winnerId, rows]) => (
            <div key={winnerId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0 space-y-1.5">
                <h3 className="text-base font-semibold">{rows[0].winnerName}</h3>
                <p className="flex flex-wrap items-center gap-2">
                  {branchTag(branchIdOf(winnerId), rows[0].winnerBranch)}
                  <span className="text-xs text-muted-foreground">· เมนูหลัก · ทุกหน้านับรวมเป็นจานนี้</span>
                </p>
                {rows.map((r) => (
                  <p key={r.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-l-2 border-border pl-3.5 text-[13px] text-muted-foreground">
                    {branchTag(branchIdOf(r.losingMenuId), r.loserBranch)}
                    <b className="font-medium text-foreground">{r.loserName}</b>
                    {r.loserCode && <span>รหัส {r.loserCode}</span>}
                    <span>{byId.get(r.losingMenuId)?.hasRecipe ? "ใช้สูตรของตัวเอง" : `ตัดสต๊อกตามสูตรเมนูหลักตั้งแต่ ${r.effectiveFrom}`}</span>
                    <button type="button" onClick={() => setUndo(r)} className="font-semibold text-primary underline underline-offset-2">
                      ยกเลิก
                    </button>
                  </p>
                ))}
              </div>
              <span className="rounded-full border border-border-strong px-2 text-xs text-muted-foreground">{rows.length + 1} รายการ</span>
            </div>
          ))}
        </div>
      )}

      {includeRevoked && revoked.length > 0 && (
        <div className="space-y-1.5 rounded-2xl border border-border bg-surface-sunk px-4 py-3 text-[13px] text-muted-foreground">
          <p className="font-semibold text-foreground">ยกเลิกแล้ว</p>
          {revoked.map((r) => (
            <p key={r.id}>
              {r.loserName} ({r.loserBranch ?? "—"}) เคยนับเป็น {r.winnerName} · ยกเลิกเมื่อ {r.revokedAt}
            </p>
          ))}
        </div>
      )}
      <a href={includeRevoked ? "/menus/merges" : "/menus/merges?revoked=true"} className="inline-block text-xs text-primary hover:underline">
        {includeRevoked ? "ซ่อนรายการที่ยกเลิกแล้ว" : "ดูรายการที่ยกเลิกแล้วด้วย"}
      </a>

      {undo && <RevokePopup row={undo} onClose={() => setUndo(null)} onDone={onRevoked} />}
    </section>
  );
}

function RevokePopup({ row, onClose, onDone }: { row: MergeRowView; onClose: () => void; onDone: (msg: string) => void }) {
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<{ text: string; warn: boolean } | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("merge_id", row.id);
      if (ack) fd.set("acknowledge_posted", "on");
      const res = (await orStale(revokeMergeAction({ ok: false }, fd))) as MenuMergeActionState;
      if (res.ok) return onDone(`ยกเลิกแล้ว · “${row.loserName}” แยกเป็นเมนูของตัวเอง`);
      if (res.needsAcknowledgement) {
        setAck(true);
        setError({ text: res.formError ?? "", warn: true });
      } else setError({ text: res.formError ?? "ยกเลิกไม่สำเร็จ", warn: false });
    });
  return (
    <ModalShell onClose={onClose} labelledBy="revoke-title" narrow>
      <div className="space-y-4">
        <h3 id="revoke-title" className="pr-10 text-xl font-semibold">
          ยกเลิกการรวม
        </h3>
        <p>
          <b>{row.loserName}</b> ({row.loserBranch ?? "ไม่ได้มาจาก POS"}) จะกลับไปเป็นเมนูแยกจาก <b>{row.winnerName}</b>
        </p>
        <ul className="list-disc space-y-0.5 rounded-2xl border border-border bg-surface-sunk py-3 pl-9 pr-4 text-[13px] text-muted-foreground">
          <li>รายงานทุกหน้าแยกสองรายการนี้ทันที รวมถึงเดือนที่ผ่านมา</li>
          <li>วันที่ตัดสต๊อกไปแล้วไม่เปลี่ยน · ถ้าเมนูนี้ไม่มีสูตรของตัวเอง วันต่อไปจะตัดสต๊อกไม่ได้จนกว่าจะเขียนสูตร</li>
          <li>รวมใหม่ได้ทุกเมื่อ</li>
        </ul>
        {error && (
          <p className={`rounded-xl border px-3 py-2 text-sm ${error.warn ? "border-warn-border bg-warn-bg text-warn" : "border-bad-border bg-bad-bg text-bad"}`}>{error.text}</p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-border-strong px-4 text-sm font-semibold">
            ไม่ยกเลิก
          </button>
          <button type="button" className="btn" disabled={pending} onClick={submit}>
            {pending ? "กำลังยกเลิก…" : ack ? "เข้าใจแล้ว — ยกเลิกการรวม" : "ยกเลิกการรวม"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}



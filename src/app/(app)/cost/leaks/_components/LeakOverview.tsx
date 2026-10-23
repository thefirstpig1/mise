"use client";

// ของหายไปไหน — the client half. Every figure comes from
// src/server/leak-overview.ts; this file arranges them around the questions
// (research brief https://claude.ai/artifact/QMbfAJtRRM7e9uFoAb1o3a):
//   1    how much, against the shop's target (bands ≤2% / 2–5% / >5%)
//   2–4  which items, why it may have happened, where to look — ranked by money
//   5    does it repeat, did fixing it help — across counts of one branch
//   ↕    counted ABOVE the system, kept apart and never netted off
//   7    can this count be trusted
//   8    what to count more often
// Hints are rule LK-HINT: facts around the number, never a verdict.

import { use, useEffect, useMemo, useState } from "react";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import type { LeakCount, LeakItem, LeakOverview as Overview } from "@/server/leak-overview";

const f0 = (n: number) => Math.round(n).toLocaleString("th-TH");
const f2 = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q3 = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 3 });
/** Rule LK-HINT: below this share of what was expected, a difference is ordinary scooping/weighing. */
const ORDINARY = 2;
/** At or above this share, it is larger than over-portioning explains. */
const LARGE = 5;
const URGENT = 5;

const shareOf = (i: LeakItem) => (i.expected > 0 ? (i.qty / i.expected) * 100 : null);

type Hint = { tone: "bad" | "warn" | "muted"; text: string };
function hintsOf(i: LeakItem, repeats: number): Hint[] {
  const h: Hint[] = [];
  const p = shareOf(i);
  if (p !== null && p >= LARGE) h.push({ tone: "bad", text: `ต่าง ${p.toFixed(1)}% ของที่ควรเหลือ — มากเกินกว่าตักเกินสูตร` });
  else if (p !== null) h.push({ tone: "muted", text: `ต่าง ${p.toFixed(1)}% ของที่ควรเหลือ` });
  else h.push({ tone: "warn", text: "ระบบไม่มีของนี้ก่อนนับ" });
  if (i.soldAsIs) h.push({ tone: "bad", text: "ขายเป็นชิ้น ตักเกินไม่ได้" });
  if (i.sameDay) h.push({ tone: p !== null && p >= LARGE ? "bad" : "muted", text: `รับของวันเดียวกับที่นับ (${i.sameDay.label})` });
  for (const m of i.noRecipeMenus.slice(0, 2)) h.push({ tone: "warn", text: `อาจเกี่ยว: ${m.name} ขาย ${f0(m.qty)} ยังไม่มีสูตร` });
  if (p !== null && p >= LARGE && !i.soldAsIs) h.push({ tone: i.wasteLogs ? "muted" : "warn", text: i.wasteLogs ? `บันทึกทิ้ง ${i.wasteLogs} ครั้ง` : "ไม่ได้บันทึกทิ้งเลยตั้งแต่นับครั้งก่อน" });
  if (repeats >= 2) h.push({ tone: "bad", text: `ต่างทุกครั้งที่นับ (${repeats} ครั้งติดกัน)` });
  return h;
}

export function LeakOverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-6 w-60 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
      <p className="text-sm text-muted-foreground">กำลังเทียบการนับกับระบบ…</p>
    </div>
  );
}

export default function LeakOverview({ overview, initialCountId }: { overview: Promise<Overview | null>; initialCountId: string | null }) {
  const data = use(overview);
  if (data === null)
    return <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">เปิดรายงานไม่สำเร็จในครั้งนี้ กรุณารีเฟรชหน้าอีกครั้ง</div>;
  if (data.counts.length === 0)
    return (
      <div className="space-y-2 rounded-xl border border-border bg-surface p-6 text-sm">
        <h2 className="font-display text-lg font-semibold">ยังไม่มีการนับสต๊อกที่ปิดแล้ว</h2>
        <p className="text-muted-foreground">หน้านี้เทียบของที่นับได้จริงกับที่ระบบคำนวณว่าควรเหลือ จึงต้องนับสต๊อกอย่างน้อยหนึ่งครั้งก่อน</p>
        <a href="/stock-counts/new" className="btn inline-block">
          เริ่มนับสต๊อก
        </a>
      </div>
    );
  return <View data={data} initialCountId={initialCountId} />;
}

function View({ data, initialCountId }: { data: Overview; initialCountId: string | null }) {
  // Open on the latest count that found the most money — the page's whole subject.
  const defaultId = useMemo(() => {
    if (initialCountId && data.counts.some((c) => c.id === initialCountId)) return initialCountId;
    const latestPerBranch = data.branches.map((b) => data.counts.filter((c) => c.branchId === b.id).at(-1)).filter((c): c is LeakCount => !!c);
    return [...latestPerBranch].sort((a, b) => b.value - a.value)[0]?.id ?? data.counts.at(-1)!.id;
  }, [data, initialCountId]);
  const [sel, setSel] = useState(defaultId);
  const [open, setOpen] = useState<LeakItem | null>(null);
  const [showOrdinary, setShowOrdinary] = useState(false);
  const c = data.counts.find((x) => x.id === sel) ?? data.counts.at(-1)!;
  const series = data.counts.filter((x) => x.branchId === c.branchId);
  const idx = series.findIndex((x) => x.id === c.id);
  const prev = idx > 0 ? series[idx - 1] : null;

  useEffect(() => {
    try {
      window.history.replaceState(null, "", `/cost/leaks?count=${sel}`);
    } catch {
      /* a URL that cannot change is only a lost bookmark */
    }
  }, [sel]);

  /** How many counts in a row, ending with this one, found this product short. */
  const repeatsOf = (productId: string) => {
    let n = 0;
    for (let k = idx; k >= 0; k--) {
      if (series[k].short.some((s) => s.productId === productId)) n++;
      else break;
    }
    return n;
  };

  const pct = c.sinceRevenue ? (c.value / c.sinceRevenue) * 100 : null;
  const prevPct = prev && prev.sinceRevenue ? (prev.value / prev.sinceRevenue) * 100 : null;
  const sorted = c.short;
  let acc = 0;
  let n80 = 0;
  for (const s of sorted) {
    acc += s.value ?? 0;
    n80++;
    if (acc >= c.value * 0.8) break;
  }
  const big = sorted.filter((s) => (shareOf(s) ?? 100) >= ORDINARY || (s.value ?? 0) >= c.value * 0.05);
  const ordinary = sorted.filter((s) => !big.includes(s));
  const shown = showOrdinary ? [...big, ...ordinary] : big;
  const mx = Math.max(1, ...sorted.map((s) => s.value ?? 0));

  const tone = pct === null ? "muted" : pct <= data.target ? "ok" : pct <= URGENT ? "warn" : "bad";
  const word = pct === null ? "ยังเทียบยอดขายไม่ได้" : pct <= data.target ? `อยู่ในเป้า ≤${data.target}%` : pct <= URGENT ? "เกินเป้า · หาสาเหตุ" : `เกิน ${URGENT}% · เร่งด่วน`;
  const overKnown = c.over.filter((o) => o.value !== null);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">นับได้ไม่ตรงกับที่ระบบคำนวณ หลังหักที่บันทึกว่าทิ้งและของเสียแล้ว · หายเพราะอะไร ต้องไปตามที่ไหน</p>

      <div className="space-y-2 rounded-xl border border-border bg-surface px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-14 text-xs text-muted-foreground">การนับ</span>
          {[...data.counts].reverse().map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => {
                setSel(x.id);
                setShowOrdinary(false);
              }}
              aria-pressed={x.id === sel}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-0.5 text-xs transition-colors ${
                x.id === sel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-border-strong"
              }`}
            >
              {data.branches.length > 1 && `${x.branchName.replace(/^สาขา/, "")} · `}
              {x.dateLabel}
              {x.value > 0 && <span className="opacity-75">฿{f0(x.value)}</span>}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {c.scNumber} · {c.branchName} · นับ {c.dateLabel}
          {c.countedBy.length > 0 && ` · นับโดย ${c.countedBy.join(", ")}`} ·{" "}
          <a href={`/stock-counts/${c.id}`} className="text-primary hover:underline">
            เปิดใบนับ ›
          </a>
        </p>
      </div>

      <QLabel n="1">หายไปเท่าไร · เกินเป้าไหม</QLabel>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi k="ไม่ตรงกับระบบ (นับได้น้อยกว่า)">
          <b className={`font-display text-2xl tabular-nums ${c.value > 0 ? "text-bad" : ""}`}>฿{f0(c.value)}</b>
          <span className="text-xs text-muted-foreground">
            {c.short.length} รายการ{prevPct !== null && ` · ครั้งก่อน ${prevPct.toFixed(2)}%`}
          </span>
        </Kpi>
        <Kpi k={`% ของยอดขาย ${c.sinceLabel}`}>
          <b className="font-display text-2xl tabular-nums">{pct === null ? "—" : `${pct.toFixed(2)}%`}</b>
          <Tag tone={tone}>{word}</Tag>
          {pct !== null && (
            <>
              <div
                className="relative mt-1.5 h-2.5 rounded-full"
                style={{ background: `linear-gradient(90deg,#EEF2DD 0 ${(data.target / 6) * 100}%,#F8EFD6 ${(data.target / 6) * 100}% ${(URGENT / 6) * 100}%,#F9E5DF ${(URGENT / 6) * 100}%)` }}
                title={`≤${data.target}% ปกติ · ถึง ${URGENT}% หาสาเหตุ · เกิน ${URGENT}% เร่งด่วน`}
              >
                <i className="absolute -top-1 h-[18px] w-1 -translate-x-1/2 rounded bg-foreground transition-[left] duration-500" style={{ left: `${Math.min(100, (pct / 6) * 100)}%` }} />
              </div>
              <div className="flex justify-between text-[0.66rem] text-muted-foreground">
                <span>0</span>
                <span>{data.target}%</span>
                <span>{URGENT}%</span>
                <span>6%+</span>
              </div>
            </>
          )}
        </Kpi>
        <Kpi k="เงินส่วนใหญ่ (80%) มาจาก">
          <b className="font-display text-base leading-snug">{c.value > 0 ? sorted.slice(0, n80).map((s) => s.name).join(" + ") : "—"}</b>
          <span className="text-xs text-muted-foreground">
            {c.value > 0 ? `${n80} จาก ${sorted.length} รายการ = ${Math.round((acc / c.value) * 100)}% ของทั้งหมด` : "การนับนี้ไม่พบของที่นับได้น้อยกว่า"}
          </span>
        </Kpi>
        <Kpi k="นับได้มากกว่าระบบ">
          <b className="font-display text-xl tabular-nums">{c.over.length} รายการ</b>
          <span className="text-xs text-muted-foreground">
            {c.over.length === 0 ? "ไม่มี" : overKnown.length === c.over.length ? `≈ ฿${f0(overKnown.reduce((s, o) => s + (o.value ?? 0), 0))}` : "บางรายการยังไม่มีราคา"} · ไม่นำมาหักลบ
          </span>
        </Kpi>
      </div>

      <QLabel n="2–4">
        ตัวไหน · น่าจะเพราะอะไร · ต้องไปดูที่ไหน <span className="text-xs font-normal text-muted-foreground">เรียงตามเงิน · กดแถวเพื่อดูรายการตรวจ</span>
      </QLabel>
      <div className="rounded-xl border border-border bg-surface p-3">
        {sorted.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">การนับครั้งนี้ไม่พบของที่นับได้น้อยกว่าระบบ{c.over.length ? " · มีแต่ของที่นับได้มากกว่า (ดูด้านล่าง)" : ""}</p>
        ) : (
          <div className="grid gap-1.5">
            {(() => {
              let cum = 0;
              return shown.map((s, i) => {
                cum += s.value ?? 0;
                return (
                  <button
                    key={s.productId}
                    type="button"
                    onClick={() => setOpen(s)}
                    className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3 rounded-xl border border-border bg-surface px-2.5 py-2 text-left transition-all hover:translate-x-0.5 hover:border-border-strong hover:shadow-card md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_96px_52px]"
                  >
                    <div className="min-w-0">
                      <b className="font-display font-semibold">{s.name}</b>
                      <span className="block text-xs text-muted-foreground">
                        นับได้น้อยกว่าระบบ {q3(s.qty)} {s.unit} {s.expected > 0 && `(ควรเหลือ ${q3(s.expected)})`}
                      </span>
                      <Hints hints={hintsOf(s, repeatsOf(s.productId))} />
                    </div>
                    <span className="hidden h-2 overflow-hidden rounded-full bg-muted md:block">
                      <i
                        className="block h-full origin-left animate-grow-x rounded-full"
                        style={{ width: `${((s.value ?? 0) / mx) * 100}%`, background: "linear-gradient(90deg,#E8A76F,#C0692B)", animationDelay: `${i * 40}ms` }}
                      />
                    </span>
                    <span className="text-right font-display font-bold tabular-nums">฿{f2(s.value ?? 0)}</span>
                    <span className="hidden text-right text-xs tabular-nums text-muted-foreground md:block">
                      {c.value > 0 ? Math.round((cum / c.value) * 100) : 0}%<br />
                      <span className="text-[0.62rem]">สะสม</span>
                    </span>
                  </button>
                );
              });
            })()}
            {ordinary.length > 0 && (
              <button
                type="button"
                onClick={() => setShowOrdinary(!showOrdinary)}
                className="rounded-xl border border-dashed border-border-strong px-3 py-2 text-center text-sm text-muted-foreground hover:bg-muted"
              >
                {showOrdinary
                  ? "ซ่อนรายการระดับปกติ"
                  : `+ อีก ${ordinary.length} รายการ ฿${f0(ordinary.reduce((s, x) => s + (x.value ?? 0), 0))} — ต่างไม่ถึง ${ORDINARY}% ของที่ควรเหลือ อยู่ในระดับปกติของการตัก/ชั่ง · กดเพื่อดู`}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <QLabel n="5">หายซ้ำไหม · แก้แล้วดีขึ้นไหม</QLabel>
          <Trend series={series} sel={c.id} onSel={setSel} target={data.target} />
        </div>
        <div className="space-y-2">
          <QLabel n="8">ควรนับอะไรบ่อยขึ้น</QLabel>
          <Spot c={c} />
        </div>
      </div>

      <QLabel n="↕">
        นับได้มากกว่าระบบ <span className="text-xs font-normal text-muted-foreground">ไม่นำมาหักลบกับที่หาย</span>
      </QLabel>
      <Over c={c} />

      <QLabel n="7">นับครั้งนี้เชื่อได้แค่ไหน</QLabel>
      <Trust c={c} />

      {open && <ItemPopup item={open} c={c} repeats={repeatsOf(open.productId)} series={series} onClose={() => setOpen(null)} />}
    </div>
  );
}

function QLabel({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h3 className="flex flex-wrap items-center gap-2 font-display text-[0.95rem] font-semibold">
      <span className="inline-grid h-[22px] min-w-[30px] place-items-center rounded-full bg-primary px-1.5 text-[0.72rem] text-primary-foreground">{n}</span>
      {children}
    </h3>
  );
}
function Kpi({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface p-3">
      <span className="text-xs text-muted-foreground">{k}</span>
      {children}
    </div>
  );
}
function Tag({ tone, children }: { tone: "ok" | "bad" | "warn" | "muted"; children: React.ReactNode }) {
  const cls = { ok: "bg-good-bg text-good", bad: "bg-bad-bg text-bad", warn: "bg-warn-bg text-warn", muted: "bg-muted text-muted-foreground" }[tone];
  return <span className={`inline-block w-fit rounded-full px-2 py-px text-[0.7rem] ${cls}`}>{children}</span>;
}
function Hints({ hints }: { hints: Hint[] }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {hints.map((h, i) => (
        <span
          key={i}
          className={`whitespace-nowrap rounded-full px-2 py-px text-[0.7rem] ${h.tone === "bad" ? "bg-bad-bg text-bad" : h.tone === "warn" ? "bg-warn-bg text-warn" : "bg-muted text-muted-foreground"}`}
        >
          {h.text}
        </span>
      ))}
    </span>
  );
}

function Trend({ series, sel, onSel, target }: { series: LeakCount[]; sel: string; onSel: (id: string) => void; target: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (series.length < 2) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-sm">
        <p className="font-display font-semibold">
          {series[0]?.branchName}นับมาแล้ว {series.length} ครั้ง
        </p>
        <p className="mt-1 text-muted-foreground">ต้องนับอย่างน้อย 2 ครั้งถึงจะบอกได้ว่าหายซ้ำหรือดีขึ้น · ร้านส่วนใหญ่นับของราคาสูงทุกสัปดาห์ และนับทั้งร้านทุกเดือน</p>
      </div>
    );
  }
  const pcts = series.map((s) => (s.sinceRevenue ? (s.value / s.sinceRevenue) * 100 : null));
  const mx = Math.max(target, ...pcts.filter((p): p is number => p !== null)) * 1.3;
  const W = 100 / series.length;
  return (
    <div className="relative rounded-xl border border-border bg-surface p-4">
      <p className="mb-2 text-xs text-muted-foreground">% ของยอดขาย ต่อการนับแต่ละครั้งของ{series[0].branchName} · เส้นประ = เป้า {target}% · กดแท่งเพื่อดูครั้งนั้น</p>
      <div className="relative h-40">
        <div className="absolute inset-x-0 border-t border-dashed border-bad" style={{ bottom: `${(target / mx) * 100}%` }} />
        <div className="absolute inset-0 flex items-end">
          {series.map((s, i) => {
            const p = pcts[i];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSel(s.id)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className={`flex h-full flex-col items-center justify-end gap-1 rounded-lg ${s.id === sel ? "bg-[rgb(192_105_43/0.08)]" : "hover:bg-muted/60"}`}
                style={{ width: `${W}%` }}
              >
                <span className="text-xs font-bold tabular-nums">{p === null ? "—" : `${p.toFixed(2)}%`}</span>
                <i
                  className="block w-7 origin-bottom rounded-t-md"
                  style={{ height: `${p === null ? 2 : Math.max(2, (p / mx) * 100)}%`, background: s.id === sel ? "linear-gradient(#C0692B,#E8A76F)" : "linear-gradient(#5E6B14,#9DAA55)" }}
                />
                <span className={`text-[0.7rem] ${s.id === sel ? "font-bold text-[#C0692B]" : "text-muted-foreground"}`}>{s.dateLabel}</span>
              </button>
            );
          })}
        </div>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 w-56 animate-fade-in rounded-xl bg-[#262811] px-3 py-2 text-xs text-white shadow-card">
          <b>นับ {series[hover].dateLabel}</b>
          <div>ไม่ตรงกับระบบ ฿{f0(series[hover].value)}</div>
          <div className="opacity-75">{series[hover].sinceLabel}</div>
          {series[hover].short[0] && <div className="opacity-75">มากสุด: {series[hover].short[0].name}</div>}
        </div>
      )}
    </div>
  );
}

function Spot({ c }: { c: LeakCount }) {
  // Large against what was expected, or a real share of this count's money — never a ฿50 item at 2.3%.
  const items = c.short.filter((s) => (shareOf(s) ?? 0) >= LARGE || ((shareOf(s) ?? 0) >= ORDINARY && (s.value ?? 0) >= c.value * 0.05)).slice(0, 4);
  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-sm">
      {items.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีรายการที่ต้องนับถี่ขึ้น</p>
      ) : (
        <>
          <p className="mb-1 text-xs text-muted-foreground">ของที่ต่างมาก — นับเฉพาะรายการเหล่านี้ทุกสัปดาห์ ใช้เวลาไม่กี่นาที ไม่ต้องรอนับทั้งร้าน</p>
          {items.map((s) => (
            <div key={s.productId} className="flex items-center justify-between border-t border-border py-1.5">
              <span>
                <b className="font-display font-semibold">{s.name}</b> <span className="text-xs text-muted-foreground">ต่าง {(shareOf(s) ?? 0).toFixed(1)}%</span>
              </span>
              <Tag tone="warn">นับทุกสัปดาห์</Tag>
            </div>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">
            ใบนับนับเฉพาะบางรายการได้ ของที่ไม่ได้นับไม่ถูกแตะ ·{" "}
            <a href={`/stock-counts/new?branch=${c.branchId}`} className="text-primary hover:underline">
              เปิดใบนับ ›
            </a>
          </p>
        </>
      )}
    </div>
  );
}

function Over({ c }: { c: LeakCount }) {
  if (c.over.length === 0) return <div className="rounded-xl border border-border bg-surface p-3 text-sm text-muted-foreground">ไม่มี</div>;
  const mx = Math.max(1, ...c.over.map((o) => o.value ?? 0));
  const none = c.over.some((o) => o.expected === 0);
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-sm">
      <p className="mb-2 text-xs text-muted-foreground">
        มักเป็น <b>รับของแล้วไม่ได้บันทึก</b> · สูตรตัดเกินจริง · หรือนับผิด — และเป็นสัญญาณว่าการนับครั้งนี้มีความคลาดเคลื่อน
        {none && (
          <>
            {" "}
            · <b>ระบบไม่มีของนี้เลยแต่นับเจอ</b> = ยังไม่ได้บันทึกรับของ
          </>
        )}
      </p>
      {c.over.slice(0, 8).map((o, i) => (
        <div key={o.productId} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_84px] items-center gap-3 py-1">
          <span className="min-w-0 truncate">
            {o.name}{" "}
            <span className="text-xs text-muted-foreground">
              +{q3(o.qty)} {o.unit}
              {o.expected === 0 && " · ระบบมี 0"}
            </span>
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-muted">
            <i
              className="block h-full origin-left animate-grow-x rounded-full"
              style={{ width: `${((o.value ?? 0) / mx) * 100}%`, background: "linear-gradient(90deg,#9DAA55,#5E6B14)", animationDelay: `${i * 40}ms` }}
            />
          </span>
          <span className="text-right tabular-nums">{o.value === null ? <span className="text-xs text-muted-foreground">ไม่มีราคา</span> : `≈ ฿${f0(o.value)}`}</span>
        </div>
      ))}
      {c.over.length > 8 && <p className="text-xs text-muted-foreground">+ อีก {c.over.length - 8} รายการ</p>}
      <a href={`/goods-receipts?branch=${c.branchId}`} className="mt-1 inline-block text-xs text-primary hover:underline">
        ดูใบรับของของสาขานี้ ›
      </a>
    </div>
  );
}

function Trust({ c }: { c: LeakCount }) {
  const t = c.trust;
  const chips: [tone: "ok" | "warn", label: string, value: React.ReactNode][] = [
    [t.counted >= t.stocked ? "ok" : "warn", "นับ", `${t.counted} จาก ${t.stocked} รายการที่มีในสต๊อกก่อนวันนับ`],
    [t.salesDays === 0 || t.postedDays >= t.salesDays ? "ok" : "warn", "ตัดสต๊อกก่อนนับ", t.salesDays === 0 ? "ไม่มียอดขายในช่วงนี้" : `${t.postedDays} จาก ${t.salesDays} วันที่มียอดขาย`],
    [
      t.noRecipe.count === 0 ? "ok" : "warn",
      "เมนูขายแต่ไม่มีสูตร",
      t.noRecipe.count === 0 ? (
        "ไม่มี"
      ) : (
        <>
          {t.noRecipe.count} เมนู · ฿{f0(t.noRecipe.revenue)} ({t.noRecipe.names.slice(0, 3).join(" · ")}) ·{" "}
          <a href="/menus" className="text-primary underline">
            เขียนสูตร ›
          </a>
        </>
      ),
    ],
    [c.over.length > c.short.length ? "warn" : "ok", "นับได้มากกว่าระบบ", `${c.over.length} รายการ`],
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(([tone, l, v], i) => (
        <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs">
          <i className={`h-2 w-2 rounded-full ${tone === "ok" ? "bg-good" : "bg-warn"}`} />
          {l}: <b>{v}</b>
        </span>
      ))}
      {t.postedDays < t.salesDays && (
        <p className="w-full text-xs text-muted-foreground">
          วันที่ยังไม่ได้ตัดสต๊อก ของที่ขายไปแล้วยังไม่ถูกหัก จึงดูเหมือนหาย ·{" "}
          <a href="/consumption" className="text-primary hover:underline">
            ไปตัดสต๊อก ›
          </a>
        </p>
      )}
    </div>
  );
}

function ItemPopup({ item, c, repeats, series, onClose }: { item: LeakItem; c: LeakCount; repeats: number; series: LeakCount[]; onClose: () => void }) {
  const p = shareOf(item);
  const steps: { title: string; why: string; href: string; link: string }[] = [];
  if (item.soldAsIs)
    steps.push({
      title: `เทียบยอดขาย${item.name}ใน POS กับจำนวนที่หายไป`,
      why: "ขายเป็นชิ้น ตักเกินไม่ได้ ที่หายไปคือขายแต่ไม่ได้คีย์ แจก หรือแตกแต่ไม่ได้บันทึก",
      href: "/sales",
      link: "ยอดขาย ›",
    });
  if (item.sameDay)
    steps.push({
      title: `ของรอบ ${item.sameDay.label} มาถึงก่อนหรือหลังนับ?`,
      why: `บันทึกรับของวันที่นับ (${item.sameDay.grNumber}) — ถ้าของมาถึงหลังนับแต่บันทึกรับก่อนบันทึกการนับ ระบบจะรวมไว้ใน “ควรเหลือ” แล้ว ส่วนที่ต่างจะใกล้เคียงกับรอบนี้`,
      href: `/goods-receipts/${item.sameDay.grId}`,
      link: "เปิดใบรับของ ›",
    });
  for (const m of item.noRecipeMenus.slice(0, 2))
    steps.push({ title: `เขียนสูตร ${m.name}`, why: `ขาย ${f0(m.qty)} ที่ยังไม่มีสูตร ระบบจึงไม่ได้ตัด${item.name}ให้ ของจึงดูเหมือนหาย`, href: "/menus", link: "เขียนสูตร ›" });
  if (p !== null && p >= LARGE && !item.soldAsIs)
    steps.push({
      title: "ถามครัวเรื่องของที่ทิ้งแต่ไม่ได้บันทึก",
      why: item.wasteLogs ? `บันทึกทิ้งไว้ ${item.wasteLogs} ครั้งตั้งแต่นับครั้งก่อน — มีทิ้งที่ไม่ได้บันทึกอีกไหม` : "ไม่ได้บันทึกทิ้งเลยตั้งแต่นับครั้งก่อน",
      href: "/waste",
      link: "บันทึกของเสีย ›",
    });
  if (p !== null && p < LARGE && !item.soldAsIs)
    steps.push({ title: "ชั่งจานจริงเทียบสูตร", why: "ต่างเล็กน้อยสม่ำเสมอ มักเป็นการตักเกินสูตร หรือสูตรตั้งไว้น้อยกว่าที่ทำจริง", href: `/products?product=${item.productId}`, link: `ดูสูตรที่ใช้ (${item.recipes}) ›` });
  steps.push({ title: "นับซ้ำเฉพาะรายการนี้", why: "ตัดความเป็นไปได้ว่านับหรือใส่หน่วยผิด", href: `/stock-counts/new?branch=${c.branchId}`, link: "เปิดใบนับ ›" });
  const hist = series.map((s) => ({ label: s.dateLabel, v: s.short.find((x) => x.productId === item.productId)?.value ?? 0, sel: s.id === c.id }));
  const hm = Math.max(1, ...hist.map((h) => h.v));
  return (
    <ModalShell onClose={onClose} labelledBy="lk-item-title">
      <div className="mb-3 pr-10">
        <h3 id="lk-item-title" className="text-lg font-semibold">
          {item.name} · {c.branchName} · นับ {c.dateLabel}
        </h3>
        {item.usage.length > 0 && <p className="text-sm text-muted-foreground">ใช้ที่ {item.usage.map((u) => `${u.name} ${u.percent}%`).join(" · ")} (บอกว่าใครใช้ ไม่ได้บอกว่าใครทำหาย)</p>}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-muted p-3">
          <span className="block text-xs text-muted-foreground">ไม่ตรงกับระบบ</span>
          <b className="font-display text-lg tabular-nums text-bad">฿{f2(item.value ?? 0)}</b>
          {c.value > 0 && <span className="block text-xs text-muted-foreground">{Math.round(((item.value ?? 0) / c.value) * 100)}% ของการนับครั้งนี้</span>}
        </div>
        <div className="rounded-xl bg-muted p-3">
          <span className="block text-xs text-muted-foreground">นับได้น้อยกว่า</span>
          <b className="font-display text-lg tabular-nums">
            {q3(item.qty)} {item.unit}
          </b>
          {p !== null && (
            <span className="block text-xs text-muted-foreground">
              ควรเหลือ {q3(item.expected)} · ต่าง {p.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="rounded-xl bg-muted p-3">
          <span className="block text-xs text-muted-foreground">ทุกครั้งที่นับ{repeats >= 2 && ` · ต่างติดกัน ${repeats} ครั้ง`}</span>
          {hist.length > 1 ? (
            <div className="mt-1 flex h-16 items-end gap-2">
              {hist.map((h, i) => (
                <div key={i} className="flex flex-col items-center gap-0.5 text-[0.65rem] text-muted-foreground">
                  <i className="block w-6 rounded-t" style={{ height: `${Math.max(3, (h.v / hm) * 44)}px`, background: h.sel ? "#C0692B" : "#9DAA55" }} />
                  {h.label}
                </div>
              ))}
            </div>
          ) : (
            <span className="block text-xs text-muted-foreground">นับครั้งเดียว ยังไม่รู้ว่าซ้ำไหม</span>
          )}
        </div>
      </div>
      <p className="mt-4 font-display font-semibold">
        รายการตรวจ <span className="text-xs font-normal text-muted-foreground">ไล่จากที่น่าจะเป็นที่สุด · ทุกข้อเป็น “อาจเป็น” ระบบไม่ตัดสินว่าใครผิด</span>
      </p>
      <div className="mt-2 grid gap-1.5">
        {steps.map((s, i) => (
          <a key={i} href={s.href} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2 rounded-xl border border-border bg-surface-sunk px-3 py-2 hover:border-border-strong">
            <span className="mt-0.5 inline-grid h-5 w-5 place-items-center rounded-full bg-primary text-[0.7rem] text-primary-foreground">{i + 1}</span>
            <span>
              <b className="text-sm">{s.title}</b>
              <span className="block text-xs text-muted-foreground">{s.why}</span>
            </span>
            <span className="whitespace-nowrap text-xs text-primary">{s.link}</span>
          </a>
        ))}
      </div>
    </ModalShell>
  );
}

"use client";

// ============================================================
// คิดครัว — ระบบตัดตามสูตร เทียบกับที่ใช้ไปจริงตามการนับ (Kong 2026-10-31)
// ============================================================
// Mockup https://claude.ai/artifact/1kq32GjKCr34PQan8g6nqg, approved as drawn.
// Every figure comes from src/server/deduction-accuracy.ts (rules AC1–AC6);
// this file only arranges them. Each sentence is an observation, never advice
// (Kong 2026-10-30: "ชี้จุดที่น่าสังเกต ไม่ชี้นำ").
// ============================================================

import { use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import { readApi } from "@/lib/read-api";
import type { AccuracyDetail, AccuracyLine, AccuracyOverview, AccuracyView } from "@/server/deduction-accuracy";

/** AC3's bands. Values, not imported: the server module is not a client module. */
const NEAR = 2;
const FAR = 5;
const BAND = { 1: "#9DAA55", 2: "#D9B45A", 3: "#C0603F" } as const;
const SHOWN = 8;

const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const dayTh = (isoDay: string) => {
  const [, m, d] = isoDay.split("-").map(Number);
  return `${d} ${MTH[m - 1]}`;
};
const f0 = (n: number) => Math.round(n).toLocaleString("th-TH");
const q = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: Math.abs(n) >= 10 ? 1 : 2 });
const pct = (n: number) => `${Math.abs(n).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;
/** 0.12 kg reads as 120 g on a plate. */
const portion = (qty: number, unit: string) => {
  if (qty < 1 && (unit === "kg" || unit === "กก.")) return `${f0(qty * 1000)} g`;
  if (qty < 1 && (unit === "l" || unit === "ลิตร")) return `${f0(qty * 1000)} ml`;
  return `${q(qty)} ${unit}`;
};
const dir = (gap: number) => (gap > 0 ? "ใช้มากกว่า" : gap < 0 ? "ใช้น้อยกว่า" : "เท่ากัน");

export function AccuracySkeleton() {
  return (
    <div className="card space-y-3" aria-busy="true">
      <div className="h-5 w-72 animate-pulse rounded bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <p className="text-sm text-muted-foreground">กำลังเทียบที่ระบบตัดกับการนับ…</p>
    </div>
  );
}

export default function AccuracyPanel({
  overview,
  branchName,
  initialKey,
}: {
  overview: Promise<AccuracyOverview | null>;
  branchName: string;
  initialKey: string | null;
}) {
  const data = use(overview);
  if (data === null)
    return <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">เปิดส่วนเทียบกับการนับไม่สำเร็จในครั้งนี้ กรุณารีเฟรชหน้าอีกครั้ง</div>;
  return <Panel data={data} branchName={branchName} initialKey={initialKey} />;
}

function Panel({ data, branchName, initialKey }: { data: AccuracyOverview; branchName: string; initialKey: string | null }) {
  const measured = data.counts.filter((v) => v.summary.measured > 0);
  const defaultKey = useMemo(() => {
    if (initialKey === "combined" && data.combined) return "combined";
    if (initialKey && data.counts.some((v) => v.key === initialKey)) return initialKey;
    return (measured.at(-1) ?? data.counts.at(-1))?.key ?? null;
  }, [data, initialKey, measured]);
  const [key, setKey] = useState(defaultKey);
  const [open, setOpen] = useState<AccuracyLine | null>(null);
  const [all, setAll] = useState(false);
  const cache = useRef(new Map<string, Promise<AccuracyDetail | null>>());

  // A key from another branch (a kept state, an old link) falls back to the default.
  const view = (key === "combined" ? data.combined : data.counts.find((v) => v.key === key)) ?? data.counts.find((v) => v.key === defaultKey) ?? null;
  const lastCount = key === "combined" ? null : view;

  useEffect(() => {
    if (!key) return;
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("branch", data.branchId);
      u.searchParams.set("count", key);
      window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch {
      /* a URL that cannot change is only a lost bookmark */
    }
  }, [key, data.branchId]);

  const detailOf = (l: AccuracyLine) => {
    const k = `${key}:${l.productId}`;
    let p = cache.current.get(k);
    if (!p) {
      p = readApi<{ ok: true; detail: AccuracyDetail }>("/api/consumption", "accuracy-detail", { branchId: data.branchId, productId: l.productId, lineIds: l.lineIds }).then((r) =>
        r.ok ? r.detail : null
      );
      cache.current.set(k, p);
    }
    return p;
  };
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intent = (l: AccuracyLine) => ({
    onPointerEnter: () => {
      hoverTimer.current = setTimeout(() => void detailOf(l), 150);
    },
    onPointerLeave: () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
  });

  return (
    <section id="accuracy" className="card scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold">ระบบตัดตามสูตร เทียบกับที่ใช้ไปจริงตามการนับ</h2>
          {view && (
            <span className="chip">
              {view.label} · {branchName}
            </span>
          )}
        </div>
        {data.combined && (
          <div className="seg">
            <button type="button" onClick={() => setKey(measured.at(-1)?.key ?? data.counts.at(-1)!.key)} className={`seg-item ${key !== "combined" ? "is-on" : ""}`}>
              ทีละใบนับ
            </button>
            <button type="button" onClick={() => setKey("combined")} className={`seg-item ${key === "combined" ? "is-on" : ""}`}>
              รวม 3 เดือน
            </button>
          </div>
        )}
      </div>

      {!view ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            ยังไม่มีใบนับที่ปิดแล้วของ{branchName} · การเทียบใช้การนับสต๊อก: ครั้งแรกเป็นยอดตั้งต้น ครั้งถัดไปจะเห็นว่าที่ระบบตัดตามสูตรตรงกับของที่ใช้ไปจริงแค่ไหน
          </p>
          <a href="/stock-counts/new" className="btn-secondary btn-sm inline-flex">
            เริ่มนับสต๊อก
          </a>
        </div>
      ) : (
        <>
          {view.summary.measured === 0 ? (
            <div className="space-y-1 rounded-xl bg-muted/50 p-4 text-sm">
              <p className="font-medium">ใบนับนี้ยังไม่มีวัตถุดิบที่เทียบได้</p>
              <p className="text-muted-foreground">
                นับ {view.summary.counted} รายการ · วัตถุดิบที่นับเป็นครั้งแรกโดยไม่มีการรับของบันทึกไว้ก่อน คือยอดตั้งต้น และวัตถุดิบที่ระบบไม่ได้ตัดตามสูตรในช่วงนี้ ไม่มีอะไรให้เทียบ
                {measured.length > 0 ? " · เลือกใบนับอื่นจากกราฟด้านล่าง" : " · นับอีกครั้งหลังขายไปสักช่วงจะเริ่มเห็นตัวเลข"}
              </p>
            </div>
          ) : (
            <Headline v={view} withMoney={data.withMoney} />
          )}

          {view.lateSalesDays.length > 0 && (
            <div className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
              ยอดขาย <strong>{view.lateSalesDays.length} วัน</strong>ก่อนวันนับ ({view.lateSalesDays.slice(0, 4).map(dayTh).join(" · ")}
              {view.lateSalesDays.length > 4 ? " …" : ""}) ยังไม่ได้ตัดสต๊อกตอนปิดใบนับ ส่วนต่างในใบนี้จึงรวมของที่ขายไปแล้ว และใบนับครั้งถัดไปจะเห็นเป็นของเกินเท่ากัน
              {data.combined && key !== "combined" && (
                <>
                  {" "}
                  · แบบ{" "}
                  <button type="button" onClick={() => setKey("combined")} className="font-semibold underline">
                    รวม 3 เดือน
                  </button>{" "}
                  สองใบนี้หักล้างกัน
                </>
              )}
            </div>
          )}

          {measured.length > 0 && <Trend counts={measured} sel={lastCount?.key ?? null} onSel={setKey} />}

          {view.lines.length > 0 && (
            <>
              <Table lines={all ? view.lines : view.lines.slice(0, SHOWN)} withMoney={data.withMoney} onOpen={setOpen} intent={intent} />
              {view.lines.length > SHOWN && (
                <button type="button" onClick={() => setAll((x) => !x)} className="text-sm text-primary hover:underline">
                  {all ? "ย่อรายการ" : `ดูทั้งหมด ${view.lines.length} รายการ`}
                </button>
              )}
              <p className="text-xs text-muted-foreground">
                {data.withMoney ? "เรียงตามมูลค่าที่ต่างกัน" : "เรียงตาม % ที่ต่างกัน"} · กดรายการเพื่อดูว่าระบบตัดจากเมนูไหน
              </p>
            </>
          )}

          {view.summary.measured > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="chip">
              วัดได้ <b className="text-foreground">{view.summary.measured}</b> จาก {view.summary.counted} รายการที่นับ
            </span>
            {view.coverage !== null && (
              <span className={`chip ${view.coverage < 100 ? "chip-warn" : ""}`}>
                เมนูที่มีสูตร <b>{view.coverage}%</b> ของยอดขายในช่วงนี้
              </span>
            )}
            <span className={`chip ${view.lateSalesDays.length ? "chip-warn" : ""}`}>
              ยอดขายตัดสต๊อกก่อนนับ: <b>{view.lateSalesDays.length ? `ขาด ${view.lateSalesDays.length} วัน` : "ครบ"}</b>
            </span>
          </div>
          )}
        </>
      )}

      {open && view && (
        <DetailPopup
          line={open}
          view={view}
          history={data.counts.filter((v) => v.date < (view.key === "combined" ? "" : view.date)).flatMap((v) => v.lines.filter((l) => l.productId === open.productId).map((l) => ({ date: v.date, gapPct: l.gapPct })))}
          perCount={view.key === "combined" ? data.counts.flatMap((v) => v.lines.filter((l) => l.productId === open.productId && open.lineIds.some((id) => l.lineIds.includes(id))).map((l) => ({ date: v.date, gapPct: l.gapPct }))) : []}
          branchName={branchName}
          withMoney={data.withMoney}
          detail={detailOf(open)}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function Headline({ v, withMoney }: { v: AccuracyView; withMoney: boolean }) {
  const s = v.summary;
  const w = (n: number) => `${(n / s.measured) * 100}%`;
  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <div className="space-y-2">
          <p className="text-sm text-muted-subtle">วัตถุดิบที่ต่างกันไม่เกิน {NEAR}%</p>
          <p className="font-display text-4xl font-bold tabular-nums leading-none">
            {s.near} <span className="text-base font-medium text-muted-foreground">จาก {s.measured} รายการ</span>
          </p>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`ต่างไม่เกิน ${NEAR}% ${s.near} รายการ, ${NEAR}–${FAR}% ${s.mid} รายการ, เกิน ${FAR}% ${s.far} รายการ`}>
            {([1, 2, 3] as const).map((b) => {
              const n = b === 1 ? s.near : b === 2 ? s.mid : s.far;
              return n > 0 ? <i key={b} className="block h-full origin-left animate-grow-x" style={{ width: w(n), background: BAND[b] }} /> : null;
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <Legend band={1} text={`ไม่เกิน ${NEAR}% · ${s.near}`} />
            <Legend band={2} text={`${NEAR}–${FAR}% · ${s.mid}`} />
            <Legend band={3} text={`เกิน ${FAR}% · ${s.far}`} />
          </div>
        </div>
        <div className="space-y-1.5 rounded-xl bg-muted/50 p-3 text-sm">
          {withMoney && s.deductedValue !== null && (
            <>
              <Row k="ระบบตัดไป" v={`฿${f0(s.deductedValue)}`} />
              <Row k={`ใช้จริงมากกว่าที่ตัด (${s.moreCount} รายการ)`} v={`฿${f0(s.moreValue ?? 0)}`} />
              <Row k={`ใช้จริงน้อยกว่าที่ตัด (${s.lessCount} รายการ)`} v={`฿${f0(s.lessValue ?? 0)}`} />
            </>
          )}
          {!withMoney && (
            <>
              <Row k="ใช้จริงมากกว่าที่ตัด" v={`${s.moreCount} รายการ`} />
              <Row k="ใช้จริงน้อยกว่าที่ตัด" v={`${s.lessCount} รายการ`} />
            </>
          )}
          <div className="border-t border-border-strong pt-1.5">
            <Row k="ต่างกันรวม" v={s.gapPct === null ? "—" : `${pct(s.gapPct)} ของที่ระบบตัด`} />
          </div>
          <p className="text-xs text-muted-subtle">
            {s.gapPct === null ? "ยังไม่มีต้นทุนให้ถ่วงน้ำหนัก" : "ถ่วงด้วยมูลค่า · ไม่หักกลบระหว่างมากกับน้อย"}
            {withMoney ? "" : " · ตัวเลขเงินเห็นเฉพาะคนที่ดูต้นทุนได้"}
          </p>
        </div>
      </div>
      {s.farShare && (
        <p className="rounded-r-xl border-l-[3px] bg-[#FBF3EE] px-3 py-2 text-sm" style={{ borderColor: BAND[3] }}>
          <b>
            ส่วนต่าง {s.farShare.share}% มาจาก {s.farShare.names.length} รายการที่ต่างเกิน {FAR}%:
          </b>{" "}
          {s.farShare.names.slice(0, 3).map((n, i) => (
            <span key={n}>
              {i > 0 && " · "}
              <Nm>{n}</Nm>
            </span>
          ))}
          {s.farShare.names.length > 3 ? ` และอีก ${s.farShare.names.length - 3} รายการ` : ""}
          {withMoney && s.farShare.value !== null && (
            <>
              {" "}
              (฿{f0(s.farShare.value)}) · อีก {s.measured - s.farShare.names.length} รายการรวมกัน ฿{f0(s.farShare.restValue ?? 0)}
            </>
          )}
        </p>
      )}
    </div>
  );
}

const Legend = ({ band, text }: { band: 1 | 2 | 3; text: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: BAND[band] }} />
    {text}
  </span>
);
const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3">
    <span>{k}</span>
    <b className="font-display font-semibold tabular-nums">{v}</b>
  </div>
);

function Trend({ counts, sel, onSel }: { counts: AccuracyView[]; sel: string | null; onSel: (k: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = counts.filter((v) => v.summary.gapPct !== null);
  if (series.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        เทียบได้ {series.length} ใบนับ · ต้องมีอย่างน้อย 2 ใบถึงจะเห็นว่าส่วนต่างเปลี่ยนไปอย่างไร
      </p>
    );
  }
  const vals = series.map((v) => v.summary.gapPct!);
  const mx = Math.max(NEAR, ...vals) * 1.15;
  // Fixed rows so the dashed line can sit exactly at NEAR: a 1.25rem value
  // label, a 0.25rem gap, then the 6rem plot.
  return (
    <div className="relative">
      <p className="mb-2 text-xs text-muted-foreground">ต่างกันรวม (% ของที่ระบบตัด) ต่อใบนับ · เส้นประ = {NEAR}% · กดแท่งเพื่อดูใบนั้น</p>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[#8B6A1E]" style={{ top: `calc(1.5rem + 6rem * ${1 - NEAR / mx})` }} />
        <div className="flex">
          {series.map((v, i) => (
            <button
              key={v.key}
              type="button"
              onClick={() => onSel(v.key)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-lg pb-1 ${v.key === sel ? "bg-[rgb(192_96_63/0.08)]" : "hover:bg-muted/60"}`}
            >
              <span className="h-5 text-xs font-semibold leading-5 tabular-nums">{pct(vals[i])}</span>
              <span className="flex h-24 items-end">
                <i
                  className="block w-7 origin-bottom animate-grow-y rounded-t-md"
                  style={{ height: `${Math.max(2, (vals[i] / mx) * 100)}%`, animationDelay: `${i * 50}ms`, background: v.key === sel ? "linear-gradient(#C0603F,#E39A79)" : "linear-gradient(#5E6B14,#9DAA55)" }}
                />
              </span>
              <span className={`text-[0.7rem] ${v.key === sel ? "font-bold text-[#A8502C]" : "text-muted-foreground"}`}>{v.dateLabel}</span>
            </button>
          ))}
        </div>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute right-2 top-0 z-10 w-56 animate-fade-in rounded-xl bg-[#262811] px-3 py-2 text-xs text-white shadow-card">
          <b>{series[hover].label}</b>
          <div>
            ต่างไม่เกิน {NEAR}%: {series[hover].summary.near} จาก {series[hover].summary.measured} รายการ
          </div>
          {series[hover].lines[0] && <div className="opacity-75">มากสุด: {series[hover].lines[0].name}</div>}
        </div>
      )}
    </div>
  );
}

function Table({
  lines,
  withMoney,
  onOpen,
  intent,
}: {
  lines: AccuracyLine[];
  withMoney: boolean;
  onOpen: (l: AccuracyLine) => void;
  intent: (l: AccuracyLine) => { onPointerEnter: () => void; onPointerLeave: () => void };
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">วัตถุดิบ</th>
              <th className="px-3 py-2 text-right font-medium">ระบบตัด</th>
              <th className="px-3 py-2 text-right font-medium">ใช้จริงตามการนับ</th>
              <th className="px-3 py-2 text-right font-medium">ต่างกัน</th>
              {withMoney && <th className="px-3 py-2 text-right font-medium">มูลค่า</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.productId} onClick={() => onOpen(l)} {...intent(l)} className={`cursor-pointer border-t border-border hover:bg-muted/50 ${l.band === 3 ? "bg-[rgb(249_229_223/0.35)]" : ""}`}>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: BAND[l.band] }} />
                    {l.name}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {q(l.deducted)} {l.unit}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {q(l.used)} {l.unit}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <b className="font-display font-semibold tabular-nums">{pct(l.gapPct)}</b>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{dir(l.gapPct)}</span>
                </td>
                {withMoney && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{l.gapValue === null ? "—" : `฿${f0(l.gapValue)}`}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 sm:hidden">
        {lines.map((l) => (
          <button
            key={l.productId}
            type="button"
            onClick={() => onOpen(l)}
            className="grid w-full grid-cols-[1fr_auto] gap-x-3 rounded-xl border border-border bg-surface px-3 py-2 text-left active:bg-muted"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: BAND[l.band] }} />
              {l.name}
            </span>
            <span className="row-span-2 self-center text-right">
              <b className="font-display font-semibold tabular-nums">{pct(l.gapPct)}</b>
              <span className="block text-[11px] text-muted-foreground">{dir(l.gapPct)}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              ตัด {q(l.deducted)} · ใช้จริง {q(l.used)} {l.unit}
              {withMoney && l.gapValue !== null ? ` · ฿${f0(l.gapValue)}` : ""}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function DetailPopup({
  line,
  view,
  history,
  perCount,
  branchName,
  withMoney,
  detail,
  onClose,
}: {
  line: AccuracyLine;
  view: AccuracyView;
  history: { date: string; gapPct: number }[];
  perCount: { date: string; gapPct: number }[];
  branchName: string;
  withMoney: boolean;
  detail: Promise<AccuracyDetail | null>;
  onClose: () => void;
}) {
  useTopLayer(onClose);
  const [d, setD] = useState<AccuracyDetail | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    void detail.then((x) => on && setD(x));
    return () => {
      on = false;
    };
  }, [detail]);
  const gapQty = line.used - line.deducted;
  const top = d?.menus[0];
  const otherRows = d ? [
    { k: "มื้อพนักงาน", v: d.staff },
    { k: "ใช้ในการผลิต", v: d.production },
    { k: "ส่วนที่ไม่ได้มาจากเมนูในช่วงนี้ (ของแปรรูป/ตัดใหม่)", v: Math.abs(d.residual) > Math.max(0.001, d.sales * 0.01) ? d.residual : 0 },
  ].filter((r) => Math.abs(r.v) > 0.0005) : [];
  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex animate-fade-in items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" aria-labelledby="acc-title" className="max-h-[92vh] w-full max-w-md animate-pop-in space-y-3 overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 id="acc-title" className="font-display text-lg font-semibold">
                {line.name}
              </h3>
              <span className="chip">
                {view.label} · {branchName}
              </span>
            </div>
            <button type="button" onClick={onClose} aria-label="ปิด" className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted">
              ×
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-muted/50 px-3 py-2">
              <p className="text-xs text-muted-subtle">ระบบตัดตามสูตร</p>
              <p className="font-display text-xl font-semibold tabular-nums">
                {q(line.deducted)} {line.unit}
              </p>
            </div>
            <div className="rounded-xl bg-muted/50 px-3 py-2">
              <p className="text-xs text-muted-subtle">ใช้จริงตามการนับ</p>
              <p className="font-display text-xl font-semibold tabular-nums">
                {q(line.used)} {line.unit}
              </p>
            </div>
          </div>
          <p className="text-sm">
            {gapQty === 0 ? (
              "เท่ากับที่ระบบตัด"
            ) : (
              <>
                {dir(gapQty)}ที่ระบบตัด{" "}
                <b className="font-display">
                  {q(Math.abs(gapQty))} {line.unit} ({pct(line.gapPct)})
                </b>
                {withMoney && line.gapValue !== null && (
                  <>
                    {" "}
                    ≈ <b className="font-display">฿{f0(line.gapValue)}</b>
                  </>
                )}
              </>
            )}
          </p>

          {d === undefined ? (
            <p className="py-3 text-sm text-muted-foreground">กำลังดูว่าระบบตัดจากเมนูไหน…</p>
          ) : d === null ? (
            <p className="text-sm text-muted-foreground">เปิดรายละเอียดไม่ได้ในครั้งนี้</p>
          ) : (
            <>
              {(d.menus.length > 0 || otherRows.length > 0) && (
                <table className="w-full text-[13px]">
                  <thead className="text-xs text-muted-subtle">
                    <tr className="border-b border-border">
                      <th className="py-1 text-left font-normal">ระบบตัดจาก</th>
                      <th className="py-1 text-right font-normal">จาน</th>
                      <th className="py-1 text-right font-normal">ต่อจาน</th>
                      <th className="py-1 text-right font-normal">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.menus.slice(0, 8).map((m) => (
                      <tr key={m.name} className="border-b border-border">
                        <td className="py-1.5">{m.name}</td>
                        <td className="py-1.5 text-right tabular-nums">{f0(m.plates)}</td>
                        <td className="py-1.5 text-right tabular-nums">{portion(m.perPlate, d.unit)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {q(m.qty)} {d.unit}
                        </td>
                      </tr>
                    ))}
                    {d.menus.length > 8 && (
                      <tr className="border-b border-border text-muted-foreground">
                        <td className="py-1.5" colSpan={3}>
                          อีก {d.menus.length - 8} เมนู
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {q(d.menus.slice(8).reduce((s, m) => s + m.qty, 0))} {d.unit}
                        </td>
                      </tr>
                    )}
                    {otherRows.map((r) => (
                      <tr key={r.k} className="border-b border-border">
                        <td className="py-1.5" colSpan={3}>
                          {r.k}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {q(r.v)} {d.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <ol className="space-y-2 text-[13.5px] text-muted-foreground">
                {line.soldAsIs ? (
                  <Fact>
                    <Nm>{line.name}</Nm> ขายเป็น{line.unit} ตามสูตร 1 {line.unit}ต่อ 1 รายการที่ขาย ส่วนต่าง<b className="text-foreground">ไม่ได้มาจากปริมาณในสูตร</b>
                  </Fact>
                ) : (
                  top &&
                  gapQty !== 0 && (
                    <Fact>
                      ถ้าส่วนต่างทั้งหมดมาจากปริมาณต่อจาน ต่อจานจริงจะ{gapQty > 0 ? "มากกว่า" : "น้อยกว่า"}สูตร<b className="text-foreground">ประมาณ {pct(line.gapPct)}</b> เช่น {top.name}{" "}
                      {portion(top.perPlate, d.unit)} → <b className="text-foreground">{portion(top.perPlate * (1 + line.gapPct / 100), d.unit)}</b>
                    </Fact>
                  )
                )}
                <Fact>
                  {d.wastes.count > 0 ? (
                    <>
                      บันทึกของเสีย <Nm>{line.name}</Nm> ในช่วงนี้ <b className="text-foreground">{d.wastes.count} ครั้ง</b> ({q(d.wastes.qty)} {d.unit}) · หักไปแล้ว ไม่อยู่ในส่วนต่าง
                    </>
                  ) : (
                    <>ไม่ได้บันทึกของเสีย <Nm>{line.name}</Nm> ในช่วงนี้</>
                  )}
                </Fact>
                {d.sameDay && (
                  <Fact>
                    รับ <Nm>{line.name}</Nm> <b className="text-foreground">{q(d.sameDay.qty)} {d.unit}</b> ในวันนับ ({d.sameDay.grNumber})
                  </Fact>
                )}
                {d.noRecipeMenus.length > 0 && (
                  <Fact>
                    ขายเมนูที่ยังไม่มีสูตรและชื่อใกล้กัน: {d.noRecipeMenus.slice(0, 3).map((m) => `${m.name} ${f0(m.plates)} จาน`).join(" · ")}
                  </Fact>
                )}
                {perCount.length > 1 ? (
                  <Fact>แต่ละใบนับในช่วงนี้: {perCount.map((h) => `${dayTh(h.date)} ${h.gapPct > 0 ? "+" : h.gapPct < 0 ? "−" : ""}${pct(h.gapPct)}`).join(" · ")}</Fact>
                ) : view.key !== "combined" && (
                  <Fact>
                    การนับครั้งก่อน ๆ:{" "}
                    {history.length > 0 ? (
                      history.slice(-4).map((h) => `${dayTh(h.date)} ${h.gapPct > 0 ? "+" : h.gapPct < 0 ? "−" : ""}${pct(h.gapPct)}`).join(" · ")
                    ) : (
                      <>
                        <b className="text-foreground">ยังไม่มี</b>
                        {line.firstCompare && (
                          <>
                            {" "}
                            · ใบนี้เทียบกับยอดตั้งแต่เริ่มบันทึก <Nm>{line.name}</Nm>
                          </>
                        )}
                      </>
                    )}
                  </Fact>
                )}
              </ol>
            </>
          )}
          <p className="border-t border-border pt-2 text-xs text-muted-subtle">
            ส่วนต่างรวมทุกอย่างที่ไม่ได้บันทึก: ปริมาณต่อจาน ของเสียที่ไม่ได้บันทึก ทำใหม่ ของหาย และการนับ ระบบแยกไม่ได้ว่ามาจากอะไร
          </p>
        </div>
      </div>
    </Portal>
  );
}

/** A product or menu name never breaks across lines. */
const Nm = ({ children }: { children: ReactNode }) => <span className="whitespace-nowrap">{children}</span>;

function Fact({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <i className="mt-[7px] block h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
      <span>{children}</span>
    </li>
  );
}

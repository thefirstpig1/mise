"use client";

// ============================================================
// Mise — เมนูไหนควรทำอะไร: menu engineering (Kong, 2026-10-03)
// ============================================================
// Kasavana & Smith's matrix, the restaurant trade's standard way of reading a
// menu: across = plates sold, up = profit per plate (price after discount −
// recipe cost), bubble = profit in total. Two dashed lines cut it into four
// groups, each with the thing to do about it. The arithmetic lives in
// menuEngineering() (src/lib/sales-insight.ts, tested); this file draws it.
//
//  - The corners carry SYMBOLS (★ ♞ ? ✕), never words, so no label sits on a
//    bubble; the four buttons above say the names, counts and meanings.
//  - Every cost is shown with its confidence (rule: a cost never travels alone).
//  - The list searches with the app-wide smart search: nothing disappears, the
//    closest dishes rise.
//  - "?" opens a five-step lesson whose examples are THIS shop's own dishes,
//    chosen by rule from the figures on screen — never a dish the shop does not
//    sell — and which says so plainly when a group is empty.
// ============================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TONES } from "@/components/charts/chart-theme";
import {
  ENGINEERING_MIN_ITEMS,
  menuEngineering,
  type EngineeringGroup,
  type EngineeringItem,
} from "@/lib/sales-insight";
import { STRONG_MATCH, hasQuery, highlightRuns, rankBySearch, type SearchField } from "@/lib/smart-search";
import { RECIPE_CONFIDENCE_LABELS_TH } from "@/lib/validations/recipe";
import type { MenuRow } from "./SalesCharts";
import type { ToneMap } from "./Breakdown";
import { ModalShell } from "./Breakdown";
import { useMenuInsight } from "./insight-context";

const G: Record<EngineeringGroup, { name: string; sym: string; colour: string; short: string; todo: string }> = {
  star: { name: "ดาวเด่น", sym: "★", colour: "#5A7333", short: "ขายดี · กำไรดี", todo: "รักษาคุณภาพ วางตำแหน่งเด่นในเมนู" },
  plowhorse: { name: "ม้างาน", sym: "♞", colour: "#A87C1C", short: "ขายดี · กำไรต่ำ", todo: "ลองปรับราคาเล็กน้อย หรือลดต้นทุนสูตร" },
  puzzle: { name: "ปริศนา", sym: "?", colour: "#3E8077", short: "ขายน้อย · กำไรดี", todo: "ลองแนะนำ โปรโมต หรือย้ายตำแหน่งในเมนู" },
  dog: { name: "ทบทวน", sym: "✕", colour: "#A83A22", short: "ขายน้อย · กำไรต่ำ", todo: "พิจารณาปรับสูตร ราคา หรือเอาออก" },
};
const ORDER: EngineeringGroup[] = ["star", "plowhorse", "puzzle", "dog"];
const SYM_FONT = "'Apple Symbols','Segoe UI Symbol','Noto Sans Symbols 2',sans-serif";
const baht = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;

type Row = EngineeringItem & { code: string | null; categoryKey: string; category: string; confidence: string | null; costPerDish: number | null };

export default function MenuEngineering({
  rows,
  loading,
  periodLabel,
  asOfLabel,
  tones,
  table,
}: {
  /** The profit view's table; null while it is still being built. */
  rows: MenuRow[] | null;
  loading: boolean;
  periodLabel: string;
  asOfLabel: string;
  tones: ToneMap;
  /** The full table, shown on request below the matrix. */
  table: ReactNode;
}) {
  const ctx = useMenuInsight();
  const [filter, setFilter] = useState<EngineeringGroup | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [lesson, setLesson] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const model = useMemo(() => {
    if (!rows) return null;
    const meta = new Map(rows.map((r) => [r.id, r]));
    const m = menuEngineering(rows.map((r) => ({ id: r.id, name: r.name, qty: r.qty, net: r.net, profitPerDish: r.profitPerDish })));
    const items: Row[] = m.items.map((i) => {
      const r = meta.get(i.id)!;
      return { ...i, code: r.code ?? null, categoryKey: r.categoryKey ?? "none", category: r.category, confidence: r.confidence, costPerDish: r.costPerDish };
    });
    return { ...m, items };
  }, [rows]);

  const fields: SearchField<Row>[] = [
    { get: (r) => r.name, kind: "name" },
    { get: (r) => r.code, kind: "code" },
    { get: (r) => (r.category === "—" ? "" : r.category), kind: "category" },
  ];
  const ranked = useMemo(
    () => (model ? rankBySearch(model.items, query, fields) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, query]
  );
  const searching = hasQuery(query);
  const matchIds = new Set(searching ? ranked.filter((r) => r.score >= STRONG_MATCH).map((r) => r.item.id) : []);

  if (loading || !model) {
    return (
      <div className="space-y-3">
        <div className="h-[380px] animate-pulse rounded-xl bg-muted" />
        <p className="text-center text-xs text-muted-foreground">กำลังคำนวณต้นทุนจากสูตร…</p>
      </div>
    );
  }

  const byId = new Map(model.items.map((i) => [i.id, i]));
  const counts = Object.fromEntries(ORDER.map((g) => [g, model.items.filter((i) => i.group === g).length])) as Record<EngineeringGroup, number>;
  const dim = (r: Row) =>
    (filter !== null && r.group !== filter) || (hot !== null && hot !== r.id) || (searching && hot === null && !matchIds.has(r.id));

  if (model.items.length < ENGINEERING_MIN_ITEMS) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          ต้องมีเมนูที่มีสูตรอย่างน้อย {ENGINEERING_MIN_ITEMS} เมนูจึงจะจัดกลุ่มได้ (ตอนนี้ {model.items.length} เมนู) —{" "}
          <a href="/menus/coverage" className="font-medium text-primary underline">
            ดูเมนูที่ยังไม่มีสูตร
          </a>
        </p>
        {table}
      </div>
    );
  }

  const listRows = searching
    ? ranked
    : ORDER.flatMap((g) => ranked.filter((r) => r.item.group === g).sort((a, b) => b.item.profit - a.item.profit));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setLesson(0)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border-strong text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
          title="ตารางนี้คืออะไร อ่านยังไง"
          aria-label="ตารางนี้คืออะไร อ่านยังไง"
        >
          ?
        </button>
        <span className="text-xs text-muted-foreground">ตารางนี้คืออะไร อ่านยังไง</span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="กลุ่ม">
        {ORDER.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={filter === g}
            onClick={() => setFilter(filter === g ? null : g)}
            className="grid grid-cols-[auto_1fr] items-center gap-x-3 rounded-xl border border-border bg-surface px-3 py-2 text-left transition hover:border-border-strong"
            style={filter === g ? { boxShadow: `0 0 0 2px ${G[g].colour}`, borderColor: G[g].colour } : undefined}
          >
            <Sym g={g} size={30} />
            <span>
              <span className="block font-display text-sm font-medium">
                {G[g].name} · {counts[g]}
              </span>
              <span className="block text-[11px] text-muted-subtle">{G[g].short}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Chart
          items={model.items}
          popularAt={model.popularAt}
          average={model.averageProfitPerDish}
          filter={filter}
          hot={hot}
          dim={dim}
          tones={tones}
          onHover={(id, x, y) => {
            setHot(id);
            setTip(id ? { id, x, y } : null);
          }}
          onOpen={(id) => ctx?.open(id)}
        />

        <div className="min-w-0 space-y-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเมนูหรือหมวด"
            className="input w-full"
            aria-label="ค้นหาเมนู"
          />
          <div className="max-h-[420px] space-y-px overflow-auto pr-1" onMouseLeave={() => { setHot(null); setTip(null); }}>
            {listRows.map((r, i) => {
              const it = r.item;
              const weak = searching && r.score < STRONG_MATCH;
              const firstWeak = weak && (i === 0 || listRows[i - 1].score >= STRONG_MATCH);
              return (
                <div key={it.id}>
                  {firstWeak && <p className="my-1 flex items-center gap-2 text-[11px] text-muted-subtle before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">เมนูอื่น</p>}
                  <button
                    type="button"
                    onClick={() => ctx?.open(it.id)}
                    onMouseEnter={(e) => {
                      setHot(it.id);
                      const b = e.currentTarget.getBoundingClientRect();
                      setTip({ id: it.id, x: b.left - 290 > 8 ? b.left - 290 : b.right + 8, y: b.top });
                    }}
                    className={`grid w-full grid-cols-[22px_1fr_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${hot === it.id ? "bg-muted" : "hover:bg-muted"} ${weak ? "opacity-45" : ""} ${filter && it.group !== filter ? "hidden" : ""}`}
                  >
                    <Sym g={it.group} size={20} />
                    <span className="min-w-0">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: toneColour(tones, it.categoryKey) }} />
                      <Marked text={it.name} marks={r.field === 0 ? r.marks : []} />
                      {it.code && (
                        <span className="ml-1.5 text-[11px] tabular-nums text-muted-subtle">
                          <Marked text={it.code} marks={r.field === 1 ? r.marks : []} />
                        </span>
                      )}
                      <span className="block text-[11px] text-muted-subtle">
                        {it.qty.toLocaleString("th-TH")} จาน · กำไร {baht(it.profitPerDish)}/จาน
                        {it.confidence && it.confidence !== "HIGH" ? <span className="text-warn"> · ต้นทุน{confidenceTh(it.confidence)}</span> : null}
                      </span>
                    </span>
                    <span className="text-right text-[11px] tabular-nums text-muted-subtle">
                      <b className="block text-xs font-medium text-foreground">{baht(it.profit)}</b>กำไรรวม
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          {model.noRecipe.length > 0 && (
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">
              ยังไม่มีสูตร {model.noRecipe.length} เมนู จึงคิดกำไรไม่ได้: {model.noRecipe.map((r) => r.name).join(" · ")} ·{" "}
              <a href="/menus/coverage" className="font-medium text-primary underline">
                เขียนสูตร
              </a>
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-subtle">
        {periodLabel} · ต้นทุนจากสูตร ณ {asOfLabel} · เส้นประตั้ง = ขายดีตั้งแต่ {Math.round(model.popularAt).toLocaleString("th-TH")} จาน · เส้นประนอน = กำไรเฉลี่ย {baht(model.averageProfitPerDish)}/จาน
      </p>

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="text-xs text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid"
      >
        {showTable ? "ซ่อนตาราง" : "ดูทุกเมนูแบบตาราง"}
      </button>
      {showTable && table}

      {tip && byId.get(tip.id) && <TipCard item={byId.get(tip.id)!} x={tip.x} y={tip.y} />}

      {lesson !== null && (
        <Lesson step={lesson} setStep={setLesson} items={model.items} popularAt={model.popularAt} average={model.averageProfitPerDish} counts={counts} />
      )}
    </div>
  );
}

// ------------------------------------------------------------

function toneColour(tones: ToneMap, key: string): string {
  return TONES[tones[key] ?? "olive"]?.[0] ?? "#8B8D63";
}
function confidenceTh(c: string): string {
  return RECIPE_CONFIDENCE_LABELS_TH[c as keyof typeof RECIPE_CONFIDENCE_LABELS_TH] ?? c;
}

function Sym({ g, size }: { g: EngineeringGroup; size: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface font-semibold"
      style={{ width: size, height: size, border: `${size > 24 ? 2 : 1.5}px solid ${G[g].colour}`, color: G[g].colour, fontFamily: SYM_FONT, fontSize: size * 0.5 }}
    >
      {G[g].sym}
    </span>
  );
}

function Chart({
  items,
  popularAt,
  average,
  filter,
  hot,
  dim,
  tones,
  onHover,
  onOpen,
}: {
  items: Row[];
  popularAt: number;
  average: number;
  filter: EngineeringGroup | null;
  hot: string | null;
  dim: (r: Row) => boolean;
  tones: ToneMap;
  onHover: (id: string | null, x: number, y: number) => void;
  onOpen: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  void tones;
  const H = 380;
  const P = { l: 58, r: 18, t: 18, b: 44 };
  const xMax = Math.max(popularAt * 1.2, ...items.map((i) => i.qty)) * 1.1;
  const yMax = Math.max(average * 1.2, ...items.map((i) => i.profitPerDish)) * 1.15;
  const yMin = Math.min(0, ...items.map((i) => i.profitPerDish));
  const X = (v: number) => P.l + (v / xMax) * (w - P.l - P.r);
  const Y = (v: number) => H - P.b - ((v - yMin) / (yMax - yMin)) * (H - P.t - P.b);
  const pMax = Math.max(1, ...items.map((i) => Math.max(0, i.profit)));
  const R = (i: Row) => 6 + Math.sqrt(Math.max(0, i.profit) / pMax) * 14;
  const vx = X(popularAt);
  const hy = Y(average);
  const quads: [EngineeringGroup, number, number, number, number][] = [
    ["puzzle", P.l, P.t, vx, hy],
    ["star", vx, P.t, w - P.r, hy],
    ["dog", P.l, hy, vx, H - P.b],
    ["plowhorse", vx, hy, w - P.r, H - P.b],
  ];
  const hotItem = hot ? items.find((i) => i.id === hot) : null;

  return (
    <div ref={box} className="min-w-0 rounded-xl border border-border bg-surface p-2" onMouseLeave={() => onHover(null, 0, 0)}>
      <svg viewBox={`0 0 ${w} ${H}`} width="100%" role="img" aria-label="Menu engineering">
        {quads.map(([g, x1, y1, x2, y2]) => {
          const on = !filter || filter === g;
          const left = g === "puzzle" || g === "dog";
          const top = g === "puzzle" || g === "star";
          const cx = left ? x1 + 20 : x2 - 20;
          const cy = top ? y1 + 20 : y2 - 20;
          return (
            <g key={g}>
              <rect x={x1} y={y1} width={Math.max(0, x2 - x1)} height={Math.max(0, y2 - y1)} fill={G[g].colour} opacity={on ? 0.06 : 0.015} />
              <g opacity={on ? 1 : 0.35}>
                <circle cx={cx} cy={cy} r={13} fill="#FFFFFF" stroke={G[g].colour} strokeWidth={2} />
                <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight={600} fill={G[g].colour} style={{ fontFamily: SYM_FONT }}>
                  {G[g].sym}
                </text>
                <title>{`${G[g].name} — ${G[g].short}`}</title>
              </g>
            </g>
          );
        })}
        {[0, 1, 2, 3, 4].map((k) => {
          const v = yMin + ((yMax - yMin) * k) / 4;
          return (
            <g key={`y${k}`}>
              <line x1={P.l} x2={w - P.r} y1={Y(v)} y2={Y(v)} stroke="#F3EFDF" />
              <text x={P.l - 8} y={Y(v) + 4} fontSize={10} textAnchor="end" fill="#8B8D63">
                ฿{Math.round(v)}
              </text>
            </g>
          );
        })}
        {[0, 1, 2, 3, 4].map((k) => (
          <text key={`x${k}`} x={X((xMax * k) / 4)} y={H - P.b + 16} fontSize={10} textAnchor="middle" fill="#8B8D63">
            {Math.round((xMax * k) / 4).toLocaleString("th-TH")}
          </text>
        ))}
        <text x={(P.l + w - P.r) / 2} y={H - 8} fontSize={11} textAnchor="middle" fill="#5A5C31">
          ขายได้ (จาน)
        </text>
        <text x={14} y={(P.t + H - P.b) / 2} fontSize={11} textAnchor="middle" fill="#5A5C31" transform={`rotate(-90 14 ${(P.t + H - P.b) / 2})`}>
          กำไรต่อจาน (฿)
        </text>
        <line x1={vx} x2={vx} y1={P.t} y2={H - P.b} stroke="#8B8D63" strokeDasharray="4 4" />
        <line x1={P.l} x2={w - P.r} y1={hy} y2={hy} stroke="#8B8D63" strokeDasharray="4 4" />
        {[...items]
          .sort((a, b) => b.profit - a.profit)
          .map((i) => (
            <circle
              key={i.id}
              cx={X(i.qty)}
              cy={Y(i.profitPerDish)}
              r={R(i)}
              fill={G[i.group].colour}
              fillOpacity={dim(i) ? 0.1 : 0.72}
              stroke={hot === i.id ? "#262811" : "#FFFFFF"}
              strokeWidth={hot === i.id ? 2.5 : 1.5}
              className="cursor-pointer transition-[fill-opacity]"
              onMouseMove={(e) => onHover(i.id, e.clientX, e.clientY)}
              onClick={() => onOpen(i.id)}
            />
          ))}
        {hotItem && (
          <text
            x={X(hotItem.qty)}
            y={Y(hotItem.profitPerDish) - R(hotItem) - 8}
            fontSize={11}
            fontWeight={600}
            textAnchor="middle"
            fill="#262811"
            stroke="#FFFFFF"
            strokeWidth={4}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {hotItem.name}
          </text>
        )}
      </svg>
    </div>
  );
}

function TipCard({ item, x, y }: { item: Row; x: number; y: number }) {
  const g = G[item.group];
  const price = item.qty ? item.net / item.qty : 0;
  const left = typeof window === "undefined" ? x : Math.min(Math.max(8, x + 14), window.innerWidth - 290);
  const top = typeof window === "undefined" ? y : y + 230 > window.innerHeight ? y - 230 : y + 14;
  return (
    <div role="tooltip" className="pointer-events-none fixed z-40 w-[280px] animate-fade-in rounded-xl border border-border bg-surface p-3 text-xs shadow-card" style={{ left, top }}>
      <p className="mb-1.5 flex items-center gap-2 font-display text-sm font-semibold">
        <Sym g={item.group} size={20} />
        {item.name}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
        <dt className="text-muted-subtle">กลุ่ม</dt>
        <dd className="text-right font-semibold" style={{ color: g.colour }}>{g.name}</dd>
        <dt className="text-muted-subtle">ขายได้</dt>
        <dd className="text-right">{item.qty.toLocaleString("th-TH")} จาน</dd>
        <dt className="text-muted-subtle">ราคาเฉลี่ย</dt>
        <dd className="text-right">{baht(price)}</dd>
        <dt className="text-muted-subtle">ต้นทุนต่อจาน</dt>
        <dd className="text-right">
          {item.costPerDish === null ? "—" : `${baht(item.costPerDish)} · food cost ${price ? Math.round((item.costPerDish / price) * 100) : 0}%`}
        </dd>
        <dt className="text-muted-subtle">ความมั่นใจของต้นทุน</dt>
        <dd className={`text-right ${item.confidence && item.confidence !== "HIGH" ? "text-warn" : ""}`}>{item.confidence ? confidenceTh(item.confidence) : "—"}</dd>
        <dt className="text-muted-subtle">กำไรต่อจาน</dt>
        <dd className="text-right">{baht(item.profitPerDish)}</dd>
        <dt className="text-muted-subtle">กำไรรวม</dt>
        <dd className="text-right">{baht(item.profit)}</dd>
      </dl>
      <p className="mt-1.5 border-t border-border pt-1.5 text-muted-foreground">{g.todo} · กดเพื่อดู insight</p>
    </div>
  );
}

// ------------------------------------------------------------
// The lesson — five steps, each a picture, one sentence and an example from
// THIS shop, chosen by rule (never a dish it does not sell).
// ------------------------------------------------------------

function Lesson({
  step,
  setStep,
  items,
  popularAt,
  average,
  counts,
}: {
  step: number;
  setStep: (n: number | null) => void;
  items: Row[];
  popularAt: number;
  average: number;
  counts: Record<EngineeringGroup, number>;
}) {
  const byQty = [...items].sort((a, b) => b.qty - a.qty);
  const pick = (g: EngineeringGroup, key: (r: Row) => number) => items.filter((i) => i.group === g).sort((a, b) => key(b) - key(a))[0] ?? null;
  const busiest = byQty[0];
  const star = pick("star", (r) => r.profit);
  const plow = pick("plowhorse", (r) => r.qty);
  const puzzle = pick("puzzle", (r) => r.profitPerDish);
  const dog = pick("dog", (r) => -r.profit);
  const none = (g: EngineeringGroup) => (g === "dog" ? "ร้านนี้ยังไม่มีเมนูในกลุ่มทบทวน ซึ่งเป็นเรื่องดี" : `ร้านนี้ยังไม่มีเมนูในกลุ่ม${G[g].name}`);

  const steps: { title: string; ill: ReactNode; say: string; ex: ReactNode }[] = [
    {
      title: "ตารางนี้คืออะไร",
      ill: <IllIntro />,
      say: "Menu engineering คือเครื่องมือที่ร้านอาหารทั่วโลกใช้ตอบคำถามว่า \"เมนูไหนควรทำอะไร\" โดยดูสองเรื่องพร้อมกัน คือขายได้มากแค่ไหน และได้กำไรต่อจานเท่าไร แล้วจัดทุกเมนูเป็นสี่กลุ่ม แต่ละกลุ่มมีสิ่งที่ควรทำชัดเจน",
      ex: (
        <>
          มี {items.length} เมนูที่คิดกำไรได้: ★ ดาวเด่น {counts.star} · ♞ ม้างาน {counts.plowhorse} · ? ปริศนา {counts.puzzle} · ✕ ทบทวน {counts.dog} — ขั้นถัดไปจะพาดูว่าอ่านกราฟยังไง
        </>
      ),
    },
    {
      title: "แต่ละวงคือหนึ่งเมนู",
      ill: <IllDot name={busiest.name} qty={busiest.qty} cm={busiest.profitPerDish} />,
      say: "ยิ่งขายได้หลายจาน วงยิ่งอยู่ทางขวา ยิ่งได้กำไรต่อจานมาก วงยิ่งอยู่สูง และวงใหญ่แปลว่าทำกำไรรวมได้มาก",
      ex: (
        <>
          <b className="font-medium text-foreground">{busiest.name}</b> ขายได้ {busiest.qty.toLocaleString("th-TH")} จาน มากที่สุดในร้าน จึงอยู่ขวาสุด และได้กำไร {baht(busiest.profitPerDish)}/จาน
        </>
      ),
    },
    {
      title: "เส้นประสองเส้นแบ่งร้านเป็นสี่กลุ่ม",
      ill: <IllQuadrants />,
      say: "เส้นตั้งคือจุดที่ถือว่า \"ขายดี\" (70% ของจำนวนจานเฉลี่ยต่อเมนู ตามตำรา) เส้นนอนคือกำไรต่อจานเฉลี่ยของร้าน วงจะตกอยู่ในกลุ่มใดกลุ่มหนึ่งเสมอ",
      ex: (
        <>
          ร้านนี้ถือว่าขายดีเมื่อขายได้ตั้งแต่ <b className="font-medium text-foreground">{Math.round(popularAt).toLocaleString("th-TH")} จาน</b> และกำไรเฉลี่ยคือ{" "}
          <b className="font-medium text-foreground">{baht(average)}/จาน</b>
        </>
      ),
    },
    {
      title: "ขวาบนคือดาวเด่น ขวาล่างคือม้างาน",
      ill: <IllPair a="star" b="plowhorse" />,
      say: "สองกลุ่มนี้ขายดีเหมือนกัน ต่างกันที่กำไรต่อจาน ม้างานคือเมนูที่ทำงานหนักแต่ได้เงินน้อย",
      ex: (
        <>
          {star ? (
            <>
              <b className="font-medium text-foreground">{star.name}</b> เป็นดาวเด่น ({star.qty.toLocaleString("th-TH")} จาน · {baht(star.profitPerDish)}/จาน)
            </>
          ) : (
            none("star")
          )}
          {" · "}
          {plow ? (
            <>
              <b className="font-medium text-foreground">{plow.name}</b> เป็นม้างาน ถ้าขึ้นราคา ฿5 จะได้กำไรเพิ่มราว {baht(plow.qty * 5)} ในช่วงนี้ (ถ้ายังขายได้เท่าเดิม)
            </>
          ) : (
            none("plowhorse")
          )}
        </>
      ),
    },
    {
      title: "ซ้ายบนคือปริศนา ซ้ายล่างคือทบทวน",
      ill: <IllPair a="puzzle" b="dog" />,
      say: "ปริศนาคือเมนูที่คุ้มแต่คนยังไม่ค่อยสั่ง ทบทวนคือเมนูที่ทั้งขายยากและได้น้อย",
      ex: (
        <>
          {puzzle ? (
            <>
              <b className="font-medium text-foreground">{puzzle.name}</b> ได้กำไร {baht(puzzle.profitPerDish)}/จาน แต่ขายได้ {puzzle.qty.toLocaleString("th-TH")} จาน
            </>
          ) : (
            none("puzzle")
          )}
          {" · "}
          {dog ? (
            <>
              <b className="font-medium text-foreground">{dog.name}</b> อยู่กลุ่มทบทวน
            </>
          ) : (
            none("dog")
          )}
        </>
      ),
    },
  ];
  const st = steps[step];
  const last = step === steps.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && !last) setStep(step + 1);
      if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, last, setStep]);

  return (
    <ModalShell narrow onClose={() => setStep(null)} labelledBy="lesson-title">
      <div className="grid gap-3.5 pr-8">
        <span className="font-display text-xs text-muted-subtle">
          ขั้นที่ {step + 1} จาก {steps.length}
        </span>
        <h3 id="lesson-title" className="font-display text-lg font-semibold">
          {st.title}
        </h3>
        <div key={step} className="flex animate-fade-in justify-center rounded-2xl bg-surface-sunk p-2.5">
          {st.ill}
        </div>
        <p className="text-sm">{st.say}</p>
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">ในร้านนี้: {st.ex}</p>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
            className="rounded-full border border-primary px-4 py-1.5 font-display text-sm font-medium text-primary disabled:opacity-35"
          >
            ย้อนกลับ
          </button>
          <span className="flex gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <i key={i} className={`h-[7px] rounded-full transition-all ${i === step ? "w-[18px] bg-primary" : "w-[7px] bg-wash"}`} />
            ))}
          </span>
          <button
            type="button"
            onClick={() => (last ? setStep(null) : setStep(step + 1))}
            className="rounded-full bg-primary px-4 py-1.5 font-display text-sm font-medium text-primary-foreground"
          >
            {last ? "เข้าใจแล้ว" : "ถัดไป"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

const INK = "#5A5C31";
const FAINT = "#D2CBA4";

function Arrows({ w, h }: { w: number; h: number }) {
  return (
    <>
      <defs>
        <marker id="me-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={INK} />
        </marker>
      </defs>
      <line x1={40} y1={h - 30} x2={w - 20} y2={h - 30} stroke={INK} strokeWidth={1.5} markerEnd="url(#me-arrow)" />
      <line x1={40} y1={h - 30} x2={40} y2={16} stroke={INK} strokeWidth={1.5} markerEnd="url(#me-arrow)" />
      <text x={w - 22} y={h - 12} fontSize={12} textAnchor="end" fill={INK}>
        ขายได้มาก →
      </text>
      <text x={48} y={18} fontSize={12} fill={INK}>
        ↑ กำไรต่อจานสูง
      </text>
    </>
  );
}

function SvgSym({ x, y, g, r = 15 }: { x: number; y: number; g: EngineeringGroup; r?: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={r} fill="#FFFFFF" stroke={G[g].colour} strokeWidth={2} />
      <text x={x} y={y + 5} textAnchor="middle" fontSize={15} fontWeight={600} fill={G[g].colour} style={{ fontFamily: SYM_FONT }}>
        {G[g].sym}
      </text>
    </>
  );
}

function IllIntro() {
  const card = (y: number, icon: ReactNode, title: string, line: string) => (
    <>
      <rect x={10} y={y} width={150} height={64} rx={12} fill="#FFFFFF" stroke="#E9E3C8" />
      {icon}
      <text x={50} y={y + 26} fontSize={13} fontWeight={600} fill="#262811">
        {title}
      </text>
      <text x={50} y={y + 46} fontSize={11} fill={INK}>
        {line}
      </text>
    </>
  );
  return (
    <svg viewBox="0 0 440 200" width="100%" style={{ maxWidth: 440 }}>
      <defs>
        <marker id="me-arrow2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={INK} />
        </marker>
      </defs>
      {card(
        30,
        <>
          <circle cx={30} cy={62} r={11} fill="none" stroke="#5A7333" strokeWidth={2} />
          <circle cx={30} cy={62} r={5} fill="#5A7333" fillOpacity={0.35} />
        </>,
        "ขายได้มากแค่ไหน",
        "จำนวนจานที่ขาย"
      )}
      {card(
        112,
        <>
          <circle cx={30} cy={144} r={11} fill="#A87C1C" fillOpacity={0.15} stroke="#A87C1C" strokeWidth={2} />
          <text x={30} y={149} textAnchor="middle" fontSize={13} fontWeight={600} fill="#A87C1C">
            ฿
          </text>
        </>,
        "ได้กำไรเท่าไร",
        "กำไรต่อจาน"
      )}
      <path d="M168 62 C 205 62, 205 100, 236 100 M168 144 C 205 144, 205 100, 236 100" stroke={INK} strokeWidth={1.5} fill="none" markerEnd="url(#me-arrow2)" />
      <rect x={246} y={20} width={180} height={160} rx={14} fill="#FFFFFF" stroke="#E9E3C8" />
      <line x1={336} y1={30} x2={336} y2={170} stroke={INK} strokeDasharray="4 4" />
      <line x1={256} y1={100} x2={416} y2={100} stroke={INK} strokeDasharray="4 4" />
      <SvgSym x={291} y={62} g="puzzle" r={14} />
      <SvgSym x={381} y={62} g="star" r={14} />
      <SvgSym x={291} y={138} g="dog" r={14} />
      <SvgSym x={381} y={138} g="plowhorse" r={14} />
    </svg>
  );
}

function IllDot({ name, qty, cm }: { name: string; qty: number; cm: number }) {
  return (
    <svg viewBox="0 0 420 200" width="100%" style={{ maxWidth: 420 }}>
      <Arrows w={420} h={200} />
      <circle cx={300} cy={110} r={20} fill="#5A7333" fillOpacity={0.75} />
      <text x={300} y={78} fontSize={12} textAnchor="middle" fontWeight={600} fill="#262811">
        {name}
      </text>
      <line x1={300} y1={130} x2={300} y2={170} stroke={FAINT} strokeDasharray="3 3" />
      <line x1={40} y1={110} x2={280} y2={110} stroke={FAINT} strokeDasharray="3 3" />
      <text x={300} y={186} fontSize={11} textAnchor="middle" fill={INK}>
        {qty.toLocaleString("th-TH")} จาน
      </text>
      <text x={46} y={104} fontSize={11} fill={INK}>
        ฿{Math.round(cm)}/จาน
      </text>
    </svg>
  );
}

function IllQuadrants() {
  return (
    <svg viewBox="0 0 420 200" width="100%" style={{ maxWidth: 420 }}>
      <Arrows w={420} h={200} />
      <line x1={220} y1={16} x2={220} y2={170} stroke={INK} strokeDasharray="5 4" />
      <line x1={40} y1={96} x2={400} y2={96} stroke={INK} strokeDasharray="5 4" />
      <text x={226} y={164} fontSize={11} fill={INK}>
        ขายดี →
      </text>
      <text x={46} y={90} fontSize={11} fill={INK}>
        กำไรดี ↑
      </text>
      <SvgSym x={130} y={55} g="puzzle" />
      <SvgSym x={310} y={55} g="star" />
      <SvgSym x={130} y={135} g="dog" />
      <SvgSym x={310} y={135} g="plowhorse" />
    </svg>
  );
}

function IllPair({ a, b }: { a: EngineeringGroup; b: EngineeringGroup }) {
  const line = (g: EngineeringGroup, y: number) => (
    <>
      <SvgSym x={70} y={y} g={g} r={22} />
      <text x={105} y={y - 6} fontSize={14} fontWeight={600} fill={G[g].colour}>
        {G[g].name}
      </text>
      <text x={105} y={y + 14} fontSize={12} fill={INK}>
        {G[g].short} → {G[g].todo}
      </text>
    </>
  );
  return (
    <svg viewBox="0 0 440 170" width="100%" style={{ maxWidth: 440 }}>
      {line(a, 50)}
      {line(b, 120)}
    </svg>
  );
}

function Marked({ text, marks }: { text: string; marks: readonly number[] }) {
  return (
    <>
      {highlightRuns(text, marks).map((run, k) =>
        run.hit ? (
          <mark key={k} className="rounded-sm bg-highlight px-px text-inherit">
            {run.text}
          </mark>
        ) : (
          <span key={k}>{run.text}</span>
        )
      )}
    </>
  );
}

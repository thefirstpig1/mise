"use client";

// การผันผวนราคาวัตถุดิบ — the client half (mockup round 3). Every figure is
// arithmetic on the one read in src/server/price-volatility.ts, using the shared
// rules in src/lib/price-volatility.ts (PV-ALLOW) and the averages rule CO-PRICE
// v2. Views: ภาพรวม · แผนก · หมวดหมู่ · รายสินค้า; modes ① against a reference
// period and ② against the price the menus can bear.

import { use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import { orStale } from "@/lib/stale-tab";
import ReceiptPriceChart from "@/components/charts/ReceiptPriceChart";
import { allowances, menuCostDelta, type Allowance, type MenuCostRow } from "@/lib/price-volatility";
import type { PriceVolatility as Data, PvProduct } from "@/server/price-volatility";
import { saveMenuCostTargetAction } from "../../actions";

const f0 = (n: number) => Math.round(n).toLocaleString("th-TH");
const f2 = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sg = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const PAL = ["#C0692B", "#5E6B14", "#8A4F9E", "#00857B", "#B8900F", "#A83A22", "#3E6FA8", "#9C5B3B"];
const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const dayTh = (iso: string) => `${+iso.slice(8, 10)} ${MTH[+iso.slice(5, 7) - 1]}`;
/** Menus whose cost per serving rose at least this many points of their price are flagged. */
const FLAG = 1;

type Mode = "ref" | "tgt";
type View = "all" | "dept" | "cat" | "prod";
type Gran = "week" | "month";
type Ref = "first" | "month0" | "prev";
type Lay = "small" | "one";

export function PriceVolatilitySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
      <p className="text-sm text-muted-foreground">กำลังคำนวณราคาเฉลี่ยและต้นทุนเมนู…</p>
    </div>
  );
}

export default function PriceVolatility({ data, canEditTargets }: { data: Promise<Data | null>; canEditTargets: boolean }) {
  const d = use(data);
  if (d === null) return <div className="rounded-lg border border-warn-border bg-warn-bg p-4 text-sm text-warn">เปิดหน้านี้ไม่สำเร็จในครั้งนี้ กรุณารีเฟรชอีกครั้ง</div>;
  if (d.products.length === 0)
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm">
        <h2 className="font-display text-lg font-semibold">ยังไม่มีใบรับของ</h2>
        <p className="mt-1 text-muted-foreground">หน้านี้คิดราคาจากใบรับของที่ยืนยันแล้ว ต้องมีการรับของอย่างน้อยสองช่วงจึงจะเห็นว่าราคาเปลี่ยนไปเท่าไร</p>
      </div>
    );
  return <View d={d} canEditTargets={canEditTargets} />;
}

function View({ d, canEditTargets }: { d: Data; canEditTargets: boolean }) {
  const [mode, setMode] = useState<Mode>("ref");
  const [view, setView] = useState<View>("all");
  const [gran, setGran] = useState<Gran>("week");
  const [ref, setRef] = useState<Ref>("first");
  const [lay, setLay] = useState<Lay>("small");
  const [hl, setHl] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ name: string; ids: string[]; from: View } | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [popup, setPopup] = useState<string | null>(null);
  const [menus, setMenus] = useState<MenuCostRow[]>(d.menus);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const byId = useMemo(() => new Map(d.products.map((p) => [p.id, p])), [d.products]);
  const allow = useMemo(() => allowances(menus), [menus]);

  // Buckets with data, trimmed at both ends (no line through months nobody bought in).
  const rawBuckets = gran === "week" ? d.weeks : d.months;
  const cellOf = (p: PvProduct, i: number) => (gran === "week" ? p.week[i] : p.month[i]);
  const [lo, hi] = useMemo(() => {
    const has = rawBuckets.map((_, i) => d.products.some((p) => cellOf(p, i)));
    const a = has.indexOf(true);
    const b = has.lastIndexOf(true);
    return a < 0 ? [0, -1] : [a, b];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gran, d]);
  const B = rawBuckets.slice(lo, hi + 1).map((b, j) => ({ ...b, i: lo + j }));
  const priceAt = (p: PvProduct, j: number) => cellOf(p, B[j].i)?.[0] ?? null;
  const qtyAt = (p: PvProduct, j: number) => cellOf(p, B[j].i)?.[1] ?? 0;

  // Calendar months with data, for the headline and the menu impact (always month on month).
  const monthIdx = d.months.map((_, i) => i).filter((i) => d.products.some((p) => p.month[i]));
  const mNow = monthIdx.at(-1) ?? null;
  const mPrev = monthIdx.length > 1 ? monthIdx.at(-2)! : null;
  const month0 = monthIdx[0] ?? null;
  const ratio = (pid: string) => {
    const p = byId.get(pid);
    if (!p || mNow === null || mPrev === null) return null;
    const a = p.month[mPrev]?.[0];
    const b = p.month[mNow]?.[0];
    return a && b ? b / a : null;
  };

  const spend = (p: PvProduct) => p.month.reduce((s, c) => s + (c ? c[0] * c[1] : 0), 0);
  const products = useMemo(() => [...d.products].sort((a, b) => spend(b) - spend(a)), [d.products]);
  const nameOfMenu = useMemo(() => new Map(menus.map((m) => [m.menuId, m])), [menus]);
  const deptOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of d.products) {
      const w = new Map<string, number>();
      for (const mm of menus) for (const [pid, baht] of mm.leaves) if (pid === p.id) w.set(mm.department ?? "ไม่ระบุแผนก", (w.get(mm.department ?? "ไม่ระบุแผนก") ?? 0) + baht * mm.plates);
      m.set(p.id, [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ไม่ได้ใช้ในเมนู");
    }
    return m;
  }, [d.products, menus]);

  const baseOf = (p: PvProduct, j: number): number | null => {
    if (ref === "first") return priceAt(p, 0);
    if (ref === "month0") return month0 === null ? null : p.month[month0]?.[0] ?? null;
    return j > 0 ? priceAt(p, j - 1) : null;
  };
  const nowPrice = (p: PvProduct) => {
    for (let i = p.week.length - 1; i >= 0; i--) if (p.week[i]) return p.week[i]![0];
    return null;
  };

  type Ent = { name: string; ids: string[] };
  const entities = (): Ent[] => {
    if (drill) return drill.ids.map((id) => ({ name: byId.get(id)!.name, ids: [id] }));
    if (view === "all") return [{ name: "ทั้งร้าน", ids: products.map((p) => p.id) }];
    const group = (key: (p: PvProduct) => string) => {
      const g = new Map<string, string[]>();
      for (const p of products) g.set(key(p), [...(g.get(key(p)) ?? []), p.id]);
      return [...g.entries()].map(([name, ids]) => ({ name, ids }));
    };
    if (view === "dept") return group((p) => deptOf.get(p.id) ?? "ไม่ได้ใช้ในเมนู").filter((e) => mode === "ref" || e.name !== "ไม่ได้ใช้ในเมนู");
    if (view === "cat") return group((p) => p.group);
    const ids = picked ?? products.slice(0, 6).map((p) => p.id);
    return ids.map((id) => ({ name: byId.get(id)?.name ?? id, ids: [id] }));
  };

  const lineOf = (ids: string[]): (number | null)[] =>
    B.map((_, j) => {
      let num = 0;
      let den = 0;
      for (const id of ids) {
        const p = byId.get(id)!;
        const c = priceAt(p, j);
        if (c === null) continue;
        if (mode === "ref") {
          const b = baseOf(p, j);
          if (!b) continue;
          const w = spend(p);
          num += w * (c / b - 1);
          den += w;
        } else {
          const a = allow.get(id);
          const n = nowPrice(p);
          if (!a || !n) continue;
          num += a.use * (c / (n * a.k) - 1);
          den += a.use;
        }
      }
      return den ? (num / den) * 100 : null;
    });
  const moneyOf = (ids: string[]) => {
    if (mode === "tgt") return ids.reduce((s, id) => s + (allow.get(id)?.over ?? 0), 0);
    const j = B.length - 1;
    let e = 0;
    for (const id of ids) {
      const p = byId.get(id)!;
      const c = priceAt(p, j);
      const b = baseOf(p, j);
      if (c !== null && b) e += (c - b) * qtyAt(p, j);
    }
    return e;
  };
  const rows = entities()
    .map((e) => ({ ...e, v: lineOf(e.ids), money: moneyOf(e.ids) }))
    .filter((r) => r.v.some((x) => x !== null))
    .sort((a, b) => Math.abs(b.money) - Math.abs(a.money));
  const color = new Map(rows.map((r, i) => [r.name, PAL[i % PAL.length]]));

  const open = (r: { name: string; ids: string[] }) => {
    if (r.ids.length > 1) {
      setDrill({ name: r.name, ids: [...r.ids].sort((a, b) => spend(byId.get(b)!) - spend(byId.get(a)!)), from: view });
      setHl(null);
    } else setPopup(r.ids[0]);
  };

  const saveTarget = async (m: MenuCostRow, pct: number | null) => {
    setSaveErr(null);
    const prev = menus;
    setMenus(menus.map((x) => (x.menuId === m.menuId ? { ...x, target: pct ?? d.shopTarget, ownTarget: pct !== null } : x)));
    const res = await orStale(saveMenuCostTargetAction(m.menuId, pct));
    if (!res.ok) {
      setMenus(prev);
      setSaveErr(res.formError ?? "บันทึกไม่สำเร็จ");
    }
  };

  const viewName = { all: "ภาพรวม", dept: "แผนก", cat: "หมวดหมู่", prod: "รายสินค้า" } as const;
  const refName = { first: gran === "week" ? "สัปดาห์แรก" : "เดือนแรก", month0: month0 === null ? "เดือนแรก" : `เฉลี่ย ${d.months[month0].label}`, prev: "ช่วงก่อนหน้า" } as const;

  return (
    <div className="space-y-5">
      <h2 className="font-display text-xl font-semibold">การผันผวนราคาวัตถุดิบ</h2>
      <p className="text-sm text-muted-foreground">ราคาเปลี่ยนไปเท่าไร และราคานี้เมนูที่ใช้ยังรับไหวไหม · ราคาต่อหน่วยไม่รวม VAT จากใบรับของที่ยืนยันแล้ว</p>

      {/* sticky slice control */}
      <div className="sticky top-2 z-20 space-y-2 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ModeBtn on={mode === "ref"} onClick={() => { setMode("ref"); setDrill(null); }} title="① เทียบกับช่วงอ้างอิง" sub="ขึ้นหรือลงกี่ % จากฐานที่เลือก" />
          <ModeBtn on={mode === "tgt"} onClick={() => { setMode("tgt"); setDrill(null); }} title="② เทียบกับราคาที่เมนูรับได้" sub="ราคาไม่เปลี่ยน ไม่ได้แปลว่าไม่ขาดทุน" />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Ctl label="ดูแบบ">
            <Seg value={drill ? ("" as View) : view} onChange={(v) => { setView(v); setDrill(null); }} options={[["all", "ภาพรวม"], ["dept", "แผนก"], ["cat", "หมวดหมู่"], ["prod", "รายสินค้า"]]} />
          </Ctl>
          <Ctl label="ช่วง">
            <Seg value={gran} onChange={setGran} options={[["week", "รายสัปดาห์"], ["month", "รายเดือน"]]} />
          </Ctl>
          {mode === "ref" && (
            <Ctl label="ฐาน">
              <Seg value={ref} onChange={setRef} options={[["first", "แรกสุด"], ["month0", refName.month0], ["prev", "ช่วงก่อนหน้า"]]} />
            </Ctl>
          )}
          <Ctl label="กราฟ">
            <Seg value={lay} onChange={setLay} options={[["small", "แยกกราฟ"], ["one", "รวมกราฟเดียว"]]} />
          </Ctl>
        </div>
        {view === "prod" && !drill && (
          <ProductPick products={products} picked={picked ?? products.slice(0, 6).map((p) => p.id)} onChange={setPicked} />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        รับของล่าสุด <b>{d.lastReceipt ? dayTh(d.lastReceipt) : "—"}</b>
        {d.lastReceipt && ` (${Math.round((Date.parse(d.today) - Date.parse(d.lastReceipt)) / 86_400_000)} วันก่อน)`} · ช่วงที่ยังไม่มีใบรับของไม่แสดง — ไม่ได้แปลว่าราคาไม่เปลี่ยน แปลว่ายังไม่รู้ ·{" "}
        <a href="/goods-receipts/new" className="text-primary hover:underline">
          บันทึกรับของ ›
        </a>
      </p>

      <QLabel n="1">{mode === "ref" ? `ราคาที่เปลี่ยนทำให้จ่ายเพิ่มหรือประหยัดเท่าไร${mNow !== null && mPrev !== null ? ` (${d.months[mNow].label} เทียบราคาเฉลี่ย ${d.months[mPrev].label})` : ""}` : "ราคาตอนนี้ เมนูรับไหวไหม"}</QLabel>
      {mode === "ref" ? (
        <RefKpis d={d} mNow={mNow} mPrev={mPrev} menus={menus} ratio={ratio} />
      ) : (
        <TgtKpis allow={allow} menus={menus} byId={byId} shopTarget={d.shopTarget} branch={d.costBranch?.name ?? null} salesLabel={d.salesLabel} />
      )}

      <QLabel n="2">{mode === "ref" ? `แนวโน้มราคา — ขึ้นหรือลงกี่ % จาก${refName[ref]}` : "แนวโน้ม — ราคาจริงเทียบราคาที่เมนูรับได้ (0% = พอดีเป้า)"}</QLabel>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {drill ? (
              <>
                <button type="button" className="text-primary underline" onClick={() => setDrill(null)}>
                  {viewName[drill.from]}
                </button>{" "}
                › <b className="text-foreground">{drill.name}</b>
              </>
            ) : (
              <b className="text-foreground">{viewName[view]}</b>
            )}{" "}
            · {rows.length} {drill || view === "prod" ? "รายการ" : view === "all" ? "เส้น" : "กลุ่ม"} · เรียงตามเงิน
          </span>
          <span>{lay === "small" ? "ทุกใบสเกลเดียวกัน · กดการ์ดเพื่อดูละเอียด" : "เส้นเทาคือกลุ่มอื่น · ชี้ชื่อเพื่อให้เส้นนั้นเด่น"}</span>
        </div>
        {B.length < 2 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">ต้องมีใบรับของอย่างน้อยสอง{gran === "week" ? "สัปดาห์" : "เดือน"}จึงจะเห็นแนวโน้ม</p>
        ) : lay === "small" ? (
          <Smalls rows={rows} labels={B.map((b) => b.label)} color={color} mode={mode} onOpen={open} />
        ) : (
          <OneChart rows={rows} labels={B.map((b) => b.label)} color={color} mode={mode} hl={hl} setHl={setHl} onOpen={open} />
        )}
      </div>
      {mode === "tgt" && <ShrimpCallout products={products} allow={allow} menus={menus} />}

      <QLabel n="3">{mode === "ref" ? "ตัวไหน — เรียงตามเงิน (ซ้าย = ประหยัด · ขวา = จ่ายเพิ่ม)" : "ตัวไหนเกินงบ — เรียงตามเงิน (ซ้าย = ยังมีงบเหลือ · ขวา = เกินงบ)"}</QLabel>
      <Bars
        rows={rows}
        mode={mode}
        head={drill ? drill.name : viewName[view]}
        detail={(r) => {
          if (r.ids.length > 1) return `${r.ids.length} รายการ`;
          const p = byId.get(r.ids[0])!;
          const n = nowPrice(p);
          if (mode === "tgt") {
            const a = allow.get(p.id);
            return a && n ? `฿${f2(n)} / รับได้ ฿${f2(n * a.k)} ต่อ ${p.unit}` : "ไม่ได้ใช้ในเมนู";
          }
          const j = B.length - 1;
          const c = priceAt(p, j);
          const b = baseOf(p, j);
          return c !== null && b ? `฿${f2(b)} → ฿${f2(c)} ต่อ ${p.unit}` : "";
        }}
        onOpen={open}
      />

      <QLabel n="4">{mode === "ref" ? "กระทบเมนูไหน · ต้องขึ้นราคาไหม" : "เป้าต้นทุนต่อเมนู"}</QLabel>
      {mode === "ref" ? (
        <MenuImpact menus={menus} ratio={ratio} byId={byId} label={mNow !== null && mPrev !== null ? `${d.months[mNow].label} เทียบ ${d.months[mPrev].label}` : null} />
      ) : (
        <Targets menus={menus} shopTarget={d.shopTarget} canEdit={canEditTargets} onSave={saveTarget} err={saveErr} branch={d.costBranch?.name ?? null} salesLabel={d.salesLabel} />
      )}

      <QLabel n="5–6">เจ้าไหนถูกกว่า · บิลตรงราคาที่สั่งไหม</QLabel>
      <Suppliers products={products} />

      {popup && byId.get(popup) && (
        <ProductPopup
          p={byId.get(popup)!}
          mode={mode}
          allow={allow.get(popup) ?? null}
          nowPrice={nowPrice(byId.get(popup)!)}
          dept={deptOf.get(popup) ?? ""}
          menus={(allow.get(popup)?.menus ?? []).map((id) => nameOfMenu.get(id)).filter((m): m is MenuCostRow => !!m)}
          months={d.months}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

// ── small pieces ────────────────────────────────────────────────────────────

function ModeBtn({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`grid rounded-xl border px-3 py-1.5 text-left transition-colors ${on ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-border bg-surface hover:border-border-strong"}`}
    >
      <b className="font-display text-sm font-semibold">{title}</b>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}
function Ctl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </span>
  );
}
function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <span role="group" className="inline-flex rounded-full border border-border bg-muted p-0.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`whitespace-nowrap rounded-full px-3 py-0.5 text-xs transition-colors ${value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {l}
        </button>
      ))}
    </span>
  );
}
function QLabel({ n, children }: { n: string; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 font-display text-[0.95rem] font-semibold">
      <span className="inline-grid h-[22px] min-w-[30px] place-items-center rounded-full bg-primary px-1.5 text-[0.72rem] text-primary-foreground">{n}</span>
      {children}
    </h3>
  );
}
function Kpi({ k, v, s, tone }: { k: string; v: ReactNode; s?: ReactNode; tone?: "bad" | "good" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface p-3">
      <span className="text-xs text-muted-foreground">{k}</span>
      <b className={`font-display text-xl tabular-nums ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""}`}>{v}</b>
      {s && <span className="text-xs text-muted-foreground">{s}</span>}
    </div>
  );
}

function ProductPick({ products, picked, onChange }: { products: PvProduct[]; picked: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const hits = q.trim() ? products.filter((p) => p.name.includes(q.trim()) && !picked.includes(p.id)).slice(0, 8) : [];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">สินค้า</span>
      {picked.map((id) => {
        const p = products.find((x) => x.id === id);
        return p ? (
          <button key={id} type="button" onClick={() => onChange(picked.filter((x) => x !== id))} className="rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs text-primary-foreground">
            {p.name} ×
          </button>
        ) : null;
      })}
      <span className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์ชื่อเพื่อเพิ่ม…" className="input h-7 w-48 py-0 text-xs" />
        {hits.length > 0 && (
          <span className="absolute left-0 top-8 z-30 grid w-56 rounded-lg border border-border bg-surface p-1 shadow-card">
            {hits.map((p) => (
              <button key={p.id} type="button" className="rounded px-2 py-1 text-left text-xs hover:bg-muted" onClick={() => { onChange([...picked, p.id].slice(-9)); setQ(""); }}>
                {p.name}
              </button>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

type Row = { name: string; ids: string[]; v: (number | null)[]; money: number };

function scaleOf(rows: Row[]) {
  const all = rows.flatMap((r) => r.v).filter((v): v is number => v !== null);
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  const pad = (hi - lo || 4) * 0.12;
  lo -= pad;
  hi += pad;
  return { lo, hi };
}
const pathOf = (v: (number | null)[], x: (i: number) => number, y: (n: number) => number) => {
  let d = "";
  let pen = false;
  v.forEach((n, i) => {
    if (n === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i)},${y(n)}`;
    pen = true;
  });
  return d;
};
const lastOf = (v: (number | null)[]) => [...v].reverse().find((x): x is number => x !== null) ?? null;

function Smalls({ rows, labels, color, mode, onOpen }: { rows: Row[]; labels: string[]; color: Map<string, string>; mode: Mode; onOpen: (r: Row) => void }) {
  const { lo, hi } = scaleOf(rows);
  const W = 226, H = 78;
  const x = (i: number) => 6 + (labels.length === 1 ? 0.5 : i / (labels.length - 1)) * (W - 12);
  const y = (v: number) => 6 + (H - 18) * (1 - (v - lo) / (hi - lo));
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
      {rows.map((r, ci) => {
        const c = color.get(r.name)!;
        const last = lastOf(r.v);
        const d = pathOf(r.v, x, y);
        const first = r.v.findIndex((n) => n !== null);
        const lastI = r.v.length - 1 - [...r.v].reverse().findIndex((n) => n !== null);
        return (
          <button
            key={r.name}
            type="button"
            onClick={() => onOpen(r)}
            className="grid gap-0.5 rounded-xl border border-border bg-surface p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
          >
            <span className="flex items-baseline justify-between gap-2">
              <b className="truncate font-display text-sm font-semibold">{r.name}</b>
              <b className={`font-display text-lg tabular-nums ${last !== null && last > 0 ? "text-bad" : "text-good"}`}>{last === null ? "—" : sg(last)}</b>
            </span>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" aria-hidden>
              {mode === "tgt" && <rect x={0} y={6} width={W} height={Math.max(0, y(0) - 6)} fill="#A83A22" opacity={0.05} />}
              <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke={mode === "tgt" ? "#A83A22" : "#D2CBA4"} strokeDasharray="4 3" />
              {d && <path d={`${d}L${x(lastI)},${y(0)}L${x(first)},${y(0)}Z`} fill={c} opacity={0.1} />}
              <path d={d} fill="none" stroke={c} strokeWidth={2.4} strokeLinejoin="round" style={{ strokeDasharray: 600, strokeDashoffset: 600, animation: `pv-draw .8s ${ci * 50}ms cubic-bezier(.2,.8,.2,1) forwards` }} />
              {r.v.map((n, i) =>
                n === null ? null : (
                  <circle key={i} cx={x(i)} cy={y(n)} r={i === lastI ? 3.6 : 2.4} fill={c}>
                    <title>{`${labels[i]}: ${sg(n)}`}</title>
                  </circle>
                )
              )}
              <text x={2} y={H - 1} fontSize={9} fill="#8B8D63">
                {labels[0]}
              </text>
              <text x={W - 2} y={H - 1} fontSize={9} fill="#8B8D63" textAnchor="end">
                {labels.at(-1)}
              </text>
            </svg>
            <span className="text-xs text-muted-foreground">
              {mode === "ref" ? `${r.money > 0 ? "จ่ายเพิ่ม" : "ประหยัด"} ฿${f0(Math.abs(r.money))} ช่วงล่าสุด` : r.money > 0 ? `เกินงบ ฿${f0(r.money)}/เดือน` : `เหลืองบ ฿${f0(-r.money)}/เดือน`}
              {r.ids.length > 1 && ` · ${r.ids.length} รายการ`}
            </span>
          </button>
        );
      })}
      <style>{`@keyframes pv-draw{to{stroke-dashoffset:0}}`}</style>
    </div>
  );
}

function OneChart({ rows, labels, color, mode, hl, setHl, onOpen }: { rows: Row[]; labels: string[]; color: Map<string, string>; mode: Mode; hl: string | null; setHl: (n: string | null) => void; onOpen: (r: Row) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const { lo, hi } = scaleOf(rows);
  const W = Math.max(360, w), H = 300, L = 52, Bm = 30, T = 14, RM = 140;
  const x = (i: number) => L + (labels.length === 1 ? 0.5 : i / (labels.length - 1)) * (W - L - RM);
  const y = (v: number) => T + (H - T - Bm) * (1 - (v - lo) / (hi - lo));
  const key = new Set(rows.slice(0, 3).map((r) => r.name));
  const on = (n: string) => (hl ? hl === n : key.has(n));
  const order = [...rows].sort((a, b) => (on(a.name) ? 1 : 0) - (on(b.name) ? 1 : 0));
  const labelsAt = rows
    .filter((r) => on(r.name))
    .map((r) => {
      const li = r.v.length - 1 - [...r.v].reverse().findIndex((n) => n !== null);
      return { n: r.name, x: x(li), y: y(r.v[li]!), v: r.v[li]!, c: color.get(r.name)! };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labelsAt.length; i++) if (labelsAt[i].y - labelsAt[i - 1].y < 14) labelsAt[i].y = labelsAt[i - 1].y + 14;
  return (
    <div ref={ref}>
      <svg width={W} height={H} className="block overflow-visible">
        {[0, 1, 2, 3, 4].map((t) => {
          const v = lo + ((hi - lo) * t) / 4;
          return (
            <g key={t}>
              <line x1={L} x2={W - RM} y1={y(v)} y2={y(v)} stroke="#ECE6CC" />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#5A5C31">
                {sg(v, 0)}
              </text>
            </g>
          );
        })}
        <line x1={L} x2={W - RM} y1={y(0)} y2={y(0)} stroke={mode === "tgt" ? "#A83A22" : "#8B8D63"} strokeWidth={1.5} strokeDasharray={mode === "tgt" ? "6 4" : undefined} />
        {labels.map((l, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10.5} fill="#5A5C31">
            {l}
          </text>
        ))}
        {order.map((r) => (
          <path
            key={r.name}
            d={pathOf(r.v, x, y)}
            fill="none"
            stroke={on(r.name) ? color.get(r.name) : "#CFC9AE"}
            strokeWidth={on(r.name) ? 3 : 1.6}
            strokeLinejoin="round"
            className="cursor-pointer"
            onMouseEnter={() => setHl(r.name)}
            onMouseLeave={() => setHl(null)}
            onClick={() => onOpen(r)}
          />
        ))}
        {labelsAt.map((l) => (
          <g key={l.n}>
            <circle cx={l.x} cy={l.y} r={4} fill={l.c} />
            <text x={l.x + 8} y={l.y + 4} fontSize={11.5} fontWeight={700} fill={l.c}>
              {l.n.length > 14 ? `${l.n.slice(0, 13)}…` : l.n} {sg(l.v)}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <button
            key={r.name}
            type="button"
            onMouseEnter={() => setHl(r.name)}
            onMouseLeave={() => setHl(null)}
            onClick={() => onOpen(r)}
            className="rounded-full border px-2.5 py-0.5 text-xs"
            style={on(r.name) ? { borderColor: color.get(r.name), color: color.get(r.name) } : undefined}
          >
            {r.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bars({ rows, mode, head, detail, onOpen }: { rows: Row[]; mode: Mode; head: string; detail: (r: Row) => string; onOpen: (r: Row) => void }) {
  const top = rows.slice(0, 12);
  const mx = Math.max(1, ...top.map((r) => Math.abs(r.money)));
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_96px] gap-2.5 px-2 pb-1 text-xs text-muted-foreground">
        <span>{head}</span>
        <span className="text-right">{mode === "ref" ? "ประหยัด" : "เหลืองบ"} ←</span>
        <span>→ {mode === "ref" ? "จ่ายเพิ่ม" : "เกินงบ"}</span>
        <span className="text-right">{mode === "ref" ? "฿ ช่วงล่าสุด" : "฿ ต่อเดือน"}</span>
      </div>
      {top.map((r, i) => {
        const last = lastOf(r.v);
        return (
          <button
            key={r.name}
            type="button"
            onClick={() => onOpen(r)}
            className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_96px] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
          >
            <span className="min-w-0">
              <b className="font-display font-semibold">{r.name}</b>
              <span className="block truncate text-xs text-muted-foreground">
                {last !== null && `${sg(last)} ${mode === "ref" ? "จากฐาน" : "เทียบที่รับได้"} · `}
                {detail(r)}
              </span>
            </span>
            <span className="relative h-3">
              {r.money < 0 && <i className="absolute right-0 top-0 h-full origin-right animate-grow-x rounded-l-md" style={{ width: `${(-r.money / mx) * 100}%`, background: "linear-gradient(270deg,#5A7333,#A3BA73)", animationDelay: `${i * 30}ms` }} />}
            </span>
            <span className="relative h-3 border-l border-border-strong">
              {r.money > 0 && <i className="absolute left-0 top-0 h-full origin-left animate-grow-x rounded-r-md" style={{ width: `${(r.money / mx) * 100}%`, background: "linear-gradient(90deg,#DD8A74,#A83A22)", animationDelay: `${i * 30}ms` }} />}
            </span>
            <span className={`text-right font-display font-bold tabular-nums ${r.money > 0 ? "text-bad" : "text-good"}`}>
              {r.money > 0 ? "+" : "−"}฿{f0(Math.abs(r.money))}
            </span>
          </button>
        );
      })}
      {rows.length > top.length && <p className="px-2 pt-1 text-xs text-muted-foreground">+ อีก {rows.length - top.length} รายการ</p>}
    </div>
  );
}

function RefKpis({ d, mNow, mPrev, menus, ratio }: { d: Data; mNow: number | null; mPrev: number | null; menus: MenuCostRow[]; ratio: (pid: string) => number | null }) {
  if (mNow === null || mPrev === null) return <p className="rounded-xl border border-border bg-surface p-3 text-sm text-muted-foreground">ต้องมีใบรับของอย่างน้อยสองเดือนจึงจะเทียบได้</p>;
  let up = 0, dn = 0, nu = 0, nd = 0, spendNow = 0;
  let topU: [string, number] | null = null, topD: [string, number] | null = null;
  for (const p of d.products) {
    const a = p.month[mPrev], b = p.month[mNow];
    if (b) spendNow += b[0] * b[1];
    if (!a || !b) continue;
    const e = (b[0] - a[0]) * b[1];
    if (e > 0) { up += e; nu++; if (!topU || e > topU[1]) topU = [p.name, e]; }
    else if (e < 0) { dn += e; nd++; if (!topD || e < topD[1]) topD = [p.name, e]; }
  }
  const flagged = menus.filter((m) => (menuCostDelta(m, ratio).delta / m.price) * 100 >= FLAG);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi k="จ่ายเพิ่มจากของที่แพงขึ้น" v={`฿${f0(up)}`} tone="bad" s={`${nu} รายการ${topU ? ` · มากสุด ${topU[0]}` : ""}`} />
      <Kpi k="ประหยัดจากของที่ถูกลง" v={`฿${f0(-dn)}`} tone="good" s={`${nd} รายการ${topD ? ` · มากสุด ${topD[0]}` : ""}`} />
      <Kpi k="สุทธิ" v={`${up + dn < 0 ? "ประหยัด" : "จ่ายเพิ่ม"} ฿${f0(Math.abs(up + dn))}`} s={spendNow ? `${(((up + dn) / spendNow) * 100).toFixed(2)}% ของยอดซื้อ ${d.months[mNow].label} ฿${f0(spendNow)}` : undefined} />
      <Kpi k={`เมนูที่ต้นทุนขึ้นตั้งแต่ ${FLAG} จุด`} v={`${flagged.length} เมนู`} s={flagged.map((m) => m.name).join(" · ") || "ไม่มี"} />
    </div>
  );
}

function TgtKpis({ allow, menus, byId, shopTarget, branch, salesLabel }: { allow: Map<string, Allowance>; menus: MenuCostRow[]; byId: Map<string, PvProduct>; shopTarget: number; branch: string | null; salesLabel: string | null }) {
  if (menus.length === 0) return <p className="rounded-xl border border-border bg-surface p-3 text-sm text-muted-foreground">ยังไม่มีเมนูที่มีทั้งสูตรและยอดขาย จึงยังคิดราคาที่เมนูรับได้ไม่ได้</p>;
  const items = [...allow.entries()].filter(([, a]) => a.over > 0).sort((a, b) => b[1].over - a[1].over);
  const total = items.reduce((s, [, a]) => s + a.over, 0);
  const over = menus.filter((m) => (m.cost / m.price) * 100 > m.target).sort((a, b) => b.cost / b.price - a.cost / a.price);
  const own = menus.filter((m) => m.ownTarget).length;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi k={`ต้นทุนเกินเป้ารวม (${salesLabel ?? "เดือนล่าสุด"})`} v={`฿${f0(total)}`} tone="bad" s="เงินที่ราคาวัตถุดิบทำให้เมนูเกินเป้า" />
      <Kpi k="วัตถุดิบที่แพงกว่าที่เมนูรับได้" v={`${items.length} รายการ`} s={items[0] ? `มากสุด ${byId.get(items[0][0])?.name} ฿${f0(items[0][1].over)}` : "ไม่มี"} />
      <Kpi k="เมนูที่ต้นทุนเกินเป้า" v={`${over.length} จาก ${menus.length}`} s={over.slice(0, 3).map((m) => `${m.name} ${((m.cost / m.price) * 100).toFixed(0)}%`).join(" · ") || "ไม่มี"} />
      <Kpi k="เป้าที่ใช้" v={`${shopTarget}%`} s={`${own ? `${own} เมนูตั้งเป้าเอง · ` : ""}ต้นทุนเมนูคิดที่${branch ?? "—"}`} />
    </div>
  );
}

function ShrimpCallout({ products, allow, menus }: { products: PvProduct[]; allow: Map<string, Allowance>; menus: MenuCostRow[] }) {
  // The biggest overspender whose own price barely moved — the case mode ① cannot see.
  const cand = products
    .map((p) => {
      const a = allow.get(p.id);
      const ms = p.month.filter((c): c is [number, number] => !!c);
      const move = ms.length > 1 ? Math.abs(ms.at(-1)![0] / ms.at(-2)![0] - 1) * 100 : null;
      return { p, a, move };
    })
    .filter((x) => x.a && x.a.over > 0 && x.move !== null && x.move < 3)
    .sort((x, y) => y.a!.over - x.a!.over)[0];
  if (!cand) return null;
  const { p, a } = cand;
  const ms = p.month.filter((c): c is [number, number] => !!c);
  const now = ms.at(-1)![0];
  const used = a!.menus.map((id) => menus.find((m) => m.menuId === id)).filter((m): m is MenuCostRow => !!m);
  return (
    <div className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2.5 text-sm">
      <b>ที่โหมด ① มองไม่เห็น:</b> {p.name} ราคาเฉลี่ยขยับแค่ {sg(ms.length > 1 ? (now / ms.at(-2)![0] - 1) * 100 : 0)} จากเดือนก่อน แต่ถ้าจะให้ {used.length} เมนูที่ใช้อยู่ในเป้า ต้องไม่เกิน{" "}
      <b>
        ฿{f2(now * a!.k)}/{p.unit}
      </b>{" "}
      — ตอนนี้แพงกว่า <b>{((1 / a!.k - 1) * 100).toFixed(0)}%</b> ทำให้ต้นทุนเกินเป้า <b>฿{f0(a!.over)}/เดือน</b> · เมนู{" "}
      {used
        .sort((x, y) => y.cost / y.price - x.cost / x.price)
        .slice(0, 4)
        .map((m) => `${m.name} ${((m.cost / m.price) * 100).toFixed(0)}%`)
        .join(" · ")}{" "}
      · ทางเลือก: ขึ้นราคาเมนู · ลดปริมาณในสูตร · หาเจ้าที่ถูกกว่า · หรือตั้งเป้าเมนูนั้นสูงขึ้นถ้าตั้งใจ
    </div>
  );
}

function MenuImpact({ menus, ratio, byId, label }: { menus: MenuCostRow[]; ratio: (pid: string) => number | null; byId: Map<string, PvProduct>; label: string | null }) {
  if (!label || menus.length === 0) return <p className="rounded-xl border border-border bg-surface p-3 text-sm text-muted-foreground">ต้องมีเมนูที่มีสูตรและราคาวัตถุดิบสองเดือนจึงจะคิดได้</p>;
  const rows = menus
    .map((m) => ({ m, ...menuCostDelta(m, ratio) }))
    .map((r) => ({ ...r, pt: (r.delta / r.m.price) * 100 }))
    .sort((a, b) => b.pt - a.pt);
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {label} · ต้นทุนต่อจานเปลี่ยนเพราะราคาเฉลี่ยวัตถุดิบ · <b>จุด</b> = % ของราคาขาย (food cost % ขยับเท่านี้) · เน้นเมนูที่ขึ้นตั้งแต่ {FLAG} จุด
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="py-1 text-left font-normal">เมนู</th>
            <th className="py-1 text-right font-normal">ต้นทุนต่อจาน</th>
            <th className="py-1 text-right font-normal">จุด</th>
            <th className="py-1 text-right font-normal">จาน</th>
            <th className="py-1 text-right font-normal">กระทบต่อเดือน</th>
            <th className="py-1 pl-3 text-left font-normal">เพราะ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((r) => (
            <tr key={r.m.menuId} className={`border-t border-border ${r.pt >= FLAG ? "bg-warn-bg" : ""}`}>
              <td className="py-1.5">
                <b>{r.m.name}</b> <span className="text-xs text-muted-foreground">฿{f0(r.m.price)}</span>
              </td>
              <td className={`py-1.5 text-right tabular-nums ${r.delta > 0 ? "text-bad" : "text-good"}`}>
                {r.delta > 0 ? "+" : "−"}฿{f2(Math.abs(r.delta))}
              </td>
              <td className="py-1.5 text-right tabular-nums">{(r.pt > 0 ? "+" : "") + r.pt.toFixed(1)}</td>
              <td className="py-1.5 text-right tabular-nums">{f0(r.m.plates)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {r.delta > 0 ? "+" : "−"}฿{f0(Math.abs(r.delta * r.m.plates))}
              </td>
              <td className="py-1.5 pl-3 text-xs text-muted-foreground">
                {r.parts
                  .slice(0, 2)
                  .map(([pid, dd]) => `${byId.get(pid)?.name ?? ""} ${dd > 0 ? "+" : ""}${dd.toFixed(2)}`)
                  .join(" · ")}
              </td>
              <td className="py-1.5 text-right">
                {r.pt >= FLAG && (
                  <a href={`/menus/lab`} className="whitespace-nowrap text-xs text-primary hover:underline">
                    ลองราคา ›
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Targets({ menus, shopTarget, canEdit, onSave, err, branch, salesLabel }: { menus: MenuCostRow[]; shopTarget: number; canEdit: boolean; onSave: (m: MenuCostRow, pct: number | null) => void; err: string | null; branch: string | null; salesLabel: string | null }) {
  const rows = [...menus].sort((a, b) => b.cost / b.price - a.cost / a.price);
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        ค่าเริ่มต้น = เป้าร้าน {shopTarget}% · เครื่องดื่มซื้อมาขายต่อ ร้านส่วนใหญ่ตั้งเป้าสูงกว่าอาหาร · ต้นทุนคิดที่{branch ?? "—"} · จาน{salesLabel ? ` ${salesLabel}` : ""}
        {canEdit ? " · แก้ตัวเลขแล้วทั้งหน้าคิดใหม่ทันที (บันทึกให้)" : " · เจ้าของหรือผู้ดูแลเป็นคนแก้เป้า"}
      </p>
      {err && <p className="mb-2 text-sm text-bad">{err}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="py-1 text-left font-normal">เมนู</th>
            <th className="py-1 text-right font-normal">ราคาขาย</th>
            <th className="py-1 text-right font-normal">ต้นทุนต่อจาน</th>
            <th className="py-1 text-right font-normal">ต้นทุน %</th>
            <th className="py-1 text-right font-normal">เป้า %</th>
            <th className="py-1 text-right font-normal">จาน</th>
            <th className="py-1 text-right font-normal">เกินเป้าต่อเดือน</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const pct = (m.cost / m.price) * 100;
            const over = (m.cost - (m.target / 100) * m.price) * m.plates;
            return (
              <tr key={m.menuId} className={`border-t border-border ${pct > m.target ? "bg-warn-bg" : ""}`}>
                <td className="py-1.5">
                  <b>{m.name}</b> <span className="text-xs text-muted-foreground">{m.department ?? ""}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">฿{f0(m.price)}</td>
                <td className="py-1.5 text-right tabular-nums">฿{f2(m.cost)}</td>
                <td className={`py-1.5 text-right font-semibold tabular-nums ${pct > m.target ? "text-bad" : "text-good"}`}>{pct.toFixed(1)}%</td>
                <td className="py-1.5 text-right">
                  {canEdit ? (
                    <TargetInput m={m} shopTarget={shopTarget} onSave={onSave} />
                  ) : (
                    <span className="tabular-nums">{m.target}%</span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums">{f0(m.plates)}</td>
                <td className={`py-1.5 text-right tabular-nums ${over > 0 ? "text-bad" : "text-muted-foreground"}`}>{over > 0 ? `฿${f0(over)}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TargetInput({ m, shopTarget, onSave }: { m: MenuCostRow; shopTarget: number; onSave: (m: MenuCostRow, pct: number | null) => void }) {
  const [v, setV] = useState(String(m.target));
  useEffect(() => setV(String(m.target)), [m.target]);
  const commit = () => {
    const n = Number(v);
    if (v.trim() === "" || n === shopTarget) {
      if (m.ownTarget) onSave(m, null);
      else setV(String(m.target));
      return;
    }
    if (Number.isFinite(n) && n >= 5 && n <= 95 && n !== m.target) onSave(m, n);
    else setV(String(m.target));
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min={5}
        max={95}
        step={0.5}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className={`w-16 rounded-md border px-1.5 py-0.5 text-right text-sm tabular-nums ${m.ownTarget ? "border-primary bg-primary-soft" : "border-border-strong bg-surface"}`}
        aria-label={`เป้าต้นทุน ${m.name}`}
      />
      {m.ownTarget && (
        <button type="button" title={`กลับไปใช้เป้าร้าน ${shopTarget}%`} className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onSave(m, null)}>
          ↺
        </button>
      )}
    </span>
  );
}

function Suppliers({ products }: { products: PvProduct[] }) {
  const multi = products.filter((p) => p.suppliers.length > 1);
  const big = products.slice(0, 3);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-dashed border-border-strong p-3 text-sm text-muted-foreground">
        <b className="text-foreground">เจ้าไหนถูกกว่า:</b>{" "}
        {multi.length ? (
          `${multi.length} รายการซื้อจากมากกว่าหนึ่งเจ้า: ${multi.slice(0, 4).map((p) => p.name).join(" · ")} — กดสินค้าเพื่อดูราคาแต่ละใบ`
        ) : (
          <>
            ทุกรายการซื้อจากเจ้าเดียว จึงยังไม่มีราคาเทียบ · ของที่ซื้อเยอะ ({big.map((p) => p.name).join(" · ")}) คุ้มที่จะขอราคาจากเจ้าที่สอง ·{" "}
            <a href="/supplier-product-mappings" className="text-primary hover:underline">
              เพิ่มผู้ขายให้สินค้า ›
            </a>
          </>
        )}
      </div>
      <div className="rounded-xl border border-dashed border-border-strong p-3 text-sm text-muted-foreground">
        <b className="text-foreground">บิลตรงราคาที่สั่งไหม:</b> เมื่อรับของจากใบสั่งซื้อ ระบบจะเทียบราคาในบิลกับราคาที่สั่งไว้ทีละบรรทัด — ยังไม่มีในหน้านี้
      </div>
    </div>
  );
}

function ProductPopup({ p, mode, allow, nowPrice, dept, menus, months, onClose }: { p: PvProduct; mode: Mode; allow: Allowance | null; nowPrice: number | null; dept: string; menus: MenuCostRow[]; months: Data["months"]; onClose: () => void }) {
  const pts = p.receipts;
  const mIdx = months.map((_, i) => i).filter((i) => p.month[i]);
  const allowed = allow && nowPrice ? nowPrice * allow.k : null;
  const last = mIdx.at(-1), prev = mIdx.at(-2);
  return (
    <ModalShell onClose={onClose} labelledBy="pv-pop">
      <div className="mb-3 pr-10">
        <h3 id="pv-pop" className="text-lg font-semibold">
          {p.name} <span className="text-sm font-normal text-muted-foreground">{p.group} · {dept} · {p.suppliers.join(", ")}</span>
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Kpi
          k={prev !== undefined && last !== undefined ? `ราคาเฉลี่ย ${months[prev].label} → ${months[last].label}` : "ราคาเฉลี่ย"}
          v={prev !== undefined && last !== undefined ? `฿${f2(p.month[prev]![0])} → ฿${f2(p.month[last]![0])}` : last !== undefined ? `฿${f2(p.month[last]![0])}` : "—"}
          s={prev !== undefined && last !== undefined ? `ต่อ ${p.unit} · ${sg((p.month[last]![0] / p.month[prev]![0] - 1) * 100)}` : `ต่อ ${p.unit}`}
        />
        <Kpi
          k="ราคาที่เมนูรับได้"
          v={allowed ? `฿${f2(allowed)}` : "—"}
          tone={allow && allow.k < 1 ? "bad" : undefined}
          s={allow ? (allow.k < 1 ? `แพงกว่า ${((1 / allow.k - 1) * 100).toFixed(0)}% · เกินงบ ฿${f0(allow.over)}/เดือน` : `ยังมีงบเหลือ ${((1 - 1 / allow.k) * 100).toFixed(0)}%`) : "ไม่ได้ใช้ในเมนู"}
        />
        <Kpi k="ใช้ในเมนู" v={String(menus.length)} s={[...menus].sort((a, b) => b.cost / b.price - a.cost / a.price).slice(0, 3).map((m) => `${m.name} ${((m.cost / m.price) * 100).toFixed(0)}%`).join(" · ") || "—"} />
      </div>
      <p className="mt-3 font-display text-sm font-semibold">
        ราคาทุกใบ <span className="text-xs font-normal text-muted-foreground">จุด = ใบรับของ · เส้นทึบ = เฉลี่ยรายเดือน{mode === "tgt" ? " · เส้นประแดง = ราคาที่เมนูรับได้" : ""} · ชี้จุดเพื่อดูวันที่</span>
      </p>
      <ReceiptPriceChart
        points={pts.map(([date, price]) => ({ date, price }))}
        months={mIdx.map((i) => ({ key: months[i].from.slice(0, 7), label: months[i].label, avg: p.month[i]![0] }))}
        allowed={mode === "tgt" ? allowed : null}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        ราคาแกว่งทุกใบเป็นปกติของของสด ดูเส้นเฉลี่ย ไม่ใช่ใบล่าสุด ·{" "}
        <a href={`/products?product=${p.id}`} className="text-primary hover:underline">
          ดูสินค้า ›
        </a>
      </p>
    </ModalShell>
  );
}

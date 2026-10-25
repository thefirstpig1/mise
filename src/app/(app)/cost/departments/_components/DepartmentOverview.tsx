"use client";

// ต้นทุนตามแผนก — eight questions in order (mockup X2ShNU69NhR3VdeTBm1Fnf).
// The sticky bar changes the period/branch by navigation (inside a transition,
// so the pressed chip lights up at once); the department cards switch the
// lower sections with local state; the trend loads itself over GET.

import { use, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { DepartmentOverview as Data } from "@/server/department-overview";

type Bucket = { key: string; label: string; partial: boolean };
type TrendPoint = { key: string; label: string; coverage: number | null; byDept: Record<string, { revenue: number; cost: number }> };

const baht = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;
const pct = (n: number | null, d = 1) => (n === null ? "—" : `${n.toFixed(d)}%`);
const NONE = "none";
const DEPT_TONES = ["#41431B", "#C0692B", "#7D8450", "#A87C1C", "#5A7333", "#8B8D63"];

export default function DepartmentOverview(props: {
  data: Promise<Data | null>;
  branches: { id: string; name: string }[];
  branchId: string;
  view: "month" | "week";
  buckets: Bucket[];
  selectedKey: string;
  previousLabel: string;
  coverageMin: number;
  departmentsOn: boolean;
}) {
  const data = use(props.data);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pressed, setPressed] = useState<string | null>(null);
  const go = (q: { branch?: string; view?: string; p?: string | null }, mark: string) => {
    setPressed(mark);
    const u = new URLSearchParams({ branch: q.branch ?? props.branchId, view: q.view ?? props.view });
    const p = q.p === undefined ? props.selectedKey : q.p;
    if (p) u.set("p", p);
    start(() => router.push(`/cost/departments?${u}` as Route, { scroll: false }));
  };

  const names = useMemo(() => new Map((data?.departments ?? []).map((d) => [d.id, d.name])), [data]);
  const nameOf = (k: string) => (k === NONE ? "ไม่ระบุแผนก" : names.get(k) ?? "แผนกที่ปิดไปแล้ว");
  const depts = useMemo(() => {
    if (!data) return [] as string[];
    const ks = Object.keys(data.current).filter((k) => data.current[k].revenue > 0 || data.current[k].cost > 0);
    const order = data.departments.map((d) => d.id);
    return ks.sort((a, b) => (a === NONE ? 1 : b === NONE ? -1 : order.indexOf(a) - order.indexOf(b)));
  }, [data]);
  const toneOf = (k: string) => (k === NONE ? "#B4B394" : DEPT_TONES[Math.max(0, depts.indexOf(k)) % DEPT_TONES.length]);
  const [sel, setSel] = useState<string | null>(null);
  const focus = sel && depts.includes(sel) ? sel : depts.find((d) => d !== NONE) ?? depts[0] ?? null;

  // Q3 — loads itself once per branch × view.
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  useEffect(() => {
    let on = true;
    setTrend(null);
    fetch(`/api/cost?what=deptTrend&branch=${props.branchId}&view=${props.view}`, { cache: "no-store" })
      .then((r) => (r.headers.get("content-type")?.includes("json") ? r.json() : { ok: false }))
      .then((j) => on && setTrend(j.ok ? j.trend : []))
      .catch(() => on && setTrend([]));
    return () => {
      on = false;
    };
  }, [props.branchId, props.view]);

  const covered = data?.coverage !== null && data?.coverage !== undefined && data.coverage * 100 >= props.coverageMin;
  // Rule CO-COV: a period whose stock-cut is short of the threshold is not compared — on either side.
  const comparable = covered && data?.previousCoverage !== null && data?.previousCoverage !== undefined && data.previousCoverage * 100 >= props.coverageMin;
  const totalRevenue = depts.reduce((t, k) => t + (data?.current[k]?.revenue ?? 0), 0);
  const selLabel = props.buckets.find((b) => b.key === props.selectedKey)?.label ?? "";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">ต้นทุนตามแผนก</h2>
        <p className="mt-1 text-sm text-muted-foreground">แผนกไหนทำเงิน ต้นทุนอยู่ในเป้าของแผนกไหม ดีขึ้นหรือแย่ลง และอะไรดันต้นทุน</p>
      </div>

      {/* sticky slice control */}
      <div className="sticky top-2 z-20 space-y-2 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Seg value={props.view} onChange={(v) => go({ view: v, p: null }, `v${v}`)} options={[["month", "รายเดือน"], ["week", "รายสัปดาห์"]]} />
          {props.branches.length > 1 &&
            props.branches.map((b) => (
              <Chip key={b.id} on={(pressed === `b${b.id}` && pending) || (b.id === props.branchId && !(pending && pressed?.startsWith("b")))} onClick={() => go({ branch: b.id, p: null }, `b${b.id}`)}>
                {b.name}
              </Chip>
            ))}
          {pending && <span className="text-xs text-muted-subtle">กำลังคำนวณ…</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {props.buckets.map((b) => (
            <Chip
              key={b.key}
              small
              on={(pressed === `p${b.key}` && pending) || (b.key === props.selectedKey && !(pending && pressed?.startsWith("p")))}
              onClick={() => go({ p: b.key }, `p${b.key}`)}
            >
              {b.label}
              {b.partial ? " (ยังไม่จบ)" : ""}
            </Chip>
          ))}
        </div>
      </div>

      {!props.departmentsOn && (
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
          ร้านนี้ยังไม่ได้เปิดใช้แผนก — ทุกอย่างอยู่ใน “ไม่ระบุแผนก” ·{" "}
          <a href="/settings" className="text-primary underline">
            เปิดที่ตั้งค่าร้าน
          </a>
        </p>
      )}

      {data === null ? (
        <p className="rounded-xl border border-bad-border bg-bad-bg p-4 text-sm text-bad">คำนวณไม่สำเร็จ — ลองรีเฟรชหน้า</p>
      ) : depts.length === 0 ? (
        <p className="rounded-xl border border-border bg-muted/30 p-6 text-sm text-muted-foreground">ยังไม่มียอดขายของสาขานี้ใน {selLabel}</p>
      ) : (
        <>
          {/* ---------- 1–2 ---------- */}
          <section className="space-y-2">
            <Q n="1–2" title="แผนกไหนทำเงิน · อยู่ในเป้าของแผนกไหม" sub={`${selLabel} · กดแผนกเพื่อดูข้อ 4–5 ของแผนกนั้น`} />
            {!covered && data.coverage !== null && (
              <p className="rounded-xl border border-warn-border bg-warn-bg p-3 text-xs text-warn">
                ตัดสต๊อกตามยอดขายได้ {Math.round(data.coverage * 100)}% ของยอดขาย (เกณฑ์ {props.coverageMin}%) — ต้นทุนยังไม่ครบ จึงเป็นตัวเลข “อย่างน้อย” และยังไม่เทียบกับเป้า
              </p>
            )}
            {data.grossProfitUnavailable && (
              <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                ร้านคิดกำไรขั้นต้นแบบนับสต๊อก — สต๊อกปลายงวดอยู่ในห้องเก็บของสาขา ไม่มีแผนก จึงแสดงกำไรขั้นต้นต่อแผนกไม่ได้ (เปลี่ยนเป็นแบบสูตรอาหารที่ตั้งค่าร้าน)
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {depts.map((k) => {
                const c = data.current[k];
                const p = data.previous[k];
                const cp = c.revenue > 0 ? (c.cost / c.revenue) * 100 : null;
                const pp = p && p.revenue > 0 ? (p.cost / p.revenue) * 100 : null;
                const target = data.targets[k] ?? data.shopTarget;
                const over = cp !== null && covered ? cp - target : null;
                const delta = cp !== null && pp !== null ? cp - pp : null;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSel(k)}
                    className={`grid gap-2 rounded-2xl border p-4 text-left transition hover:shadow-card ${focus === k ? "border-primary ring-1 ring-primary" : "border-border bg-surface"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 font-display font-semibold">
                        <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: toneOf(k) }} />
                        {nameOf(k)}
                      </span>
                      <span className="text-xs text-muted-subtle">{totalRevenue > 0 ? `${Math.round((c.revenue / totalRevenue) * 100)}% ของยอดขาย` : ""}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <span>
                        <span className="block text-xs text-muted-subtle">ยอดขาย</span>
                        <b className="font-display tabular-nums">{baht(c.revenue)}</b>
                      </span>
                      <span>
                        <span className="block text-xs text-muted-subtle">ต้นทุนวัตถุดิบ</span>
                        <b className="font-display tabular-nums">
                          {covered ? "" : "≥ "}
                          {pct(cp)}
                        </b>
                      </span>
                      <span>
                        <span className="block text-xs text-muted-subtle">กำไรขั้นต้น</span>
                        <b className="font-display tabular-nums">{data.grossProfitUnavailable ? "—" : `${covered ? "" : "≤ "}${baht(c.revenue - c.cost)}`}</b>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full origin-left animate-grow-x rounded-full" style={{ width: `${Math.min(100, ((cp ?? 0) / Math.max(target * 1.6, cp ?? 0, 1)) * 100)}%`, background: over !== null && over > 0 ? "#A83A22" : toneOf(k) }} />
                    </div>
                    <p className="text-xs text-muted-subtle">
                      เป้าแผนก {target.toFixed(1)}%
                      {over !== null && (over > 0 ? <span className="text-bad"> · เกินเป้า {over.toFixed(1)} จุด ({baht((over / 100) * c.revenue)})</span> : <span className="text-good"> · อยู่ในเป้า</span>)}
                      {delta !== null &&
                        (comparable ? (
                          <span className={delta > 0 ? "text-bad" : "text-good"}>
                            {" "}
                            · {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} จุด เทียบ {props.previousLabel}
                          </span>
                        ) : (
                          <span> · ยังเทียบกับ {props.previousLabel} ไม่ได้ (ตัดสต๊อกไม่ครบ)</span>
                        ))}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-subtle">
              เป้าแผนก = เป้าต้นทุนของแต่ละเมนูในแผนก ถ่วงตามยอดขาย (เมนูที่ไม่ได้ตั้งใช้เป้าร้าน {data.shopTarget}%) · ต้นทุนวัตถุดิบ = ของที่ตัดสต๊อกไปจริง แบ่งตามเมนูที่ขาย
            </p>
          </section>

          {/* ---------- 3 ---------- */}
          <section className="space-y-2">
            <Q n="3" title="ดีขึ้นหรือแย่ลง" sub={`ต้นทุน % ${props.view === "week" ? "รายสัปดาห์" : "รายเดือน"} · เส้นประ = เป้าแผนก · จุดกลวง = ตัดสต๊อกไม่ถึง ${props.coverageMin}% เทียบไม่ได้`} />
            {trend === null ? (
              <div className="grid gap-3 md:grid-cols-2">
                {depts.map((k) => (
                  <div key={k} className="h-40 animate-pulse rounded-2xl border border-border bg-muted/30" />
                ))}
              </div>
            ) : trend.length === 0 ? (
              <p className="text-sm text-muted-foreground">โหลดแนวโน้มไม่สำเร็จ</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {depts.map((k) => (
                  <Spark key={k} name={nameOf(k)} tone={toneOf(k)} target={data.targets[k] ?? data.shopTarget} points={trend} dept={k} coverageMin={props.coverageMin} selectedKey={props.selectedKey} />
                ))}
              </div>
            )}
          </section>

          {focus && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* ---------- 4 ---------- */}
              <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
                <Q n="4" title={`เมนูไหนดันต้นทุน${nameOf(focus)}`} sub={`${selLabel} · เรียงตามเงินที่เกินเป้าของเมนู · ราคาวัตถุดิบวันนี้`} />
                <MenuList rows={data.menus.filter((m) => m.dept === focus)} />
              </section>
              {/* ---------- 5 ---------- */}
              <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
                <Q n="5" title={`วัตถุดิบไหนกินเงิน${nameOf(focus)}มากที่สุด`} sub={`${selLabel} · ต้นทุนในจาน × จานที่ขาย`} />
                <Bars rows={data.ingredients[focus] ?? []} tone={toneOf(focus)} />
                <a href="/cost/prices" className="text-xs text-primary hover:underline">
                  ดูว่าราคาวัตถุดิบเหล่านี้ขึ้นลงยังไง ›
                </a>
              </section>
            </div>
          )}

          {/* ---------- 6 ---------- */}
          <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
            <Q n="6" title="แผนกสั่งของมากกว่าที่ใช้ไหม" sub={selLabel} />
            {!data.anyOrderedByDept ? (
              <p className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
                ใบรับของในช่วงนี้ลงแผนกตั้งต้นทั้งหมด จึงยังเทียบของที่แผนกสั่งกับที่แผนกใช้ไม่ได้ · ตอนนี้เลือกแผนกที่บรรทัดของใบรับของได้แล้ว (ระบบเลือกไว้ให้ตามเมนูที่ใช้วัตถุดิบนั้น) — ใบใหม่จะขึ้นที่นี่เอง ·{" "}
                <a href="/goods-receipts/new" className="underline">
                  รับสินค้า
                </a>
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 font-medium">แผนก</th>
                      <th className="py-1.5 text-right font-medium">รับของเข้า (ก่อน VAT)</th>
                      <th className="py-1.5 text-right font-medium">ใช้ไป (ต้นทุนวัตถุดิบ)</th>
                      <th className="py-1.5 text-right font-medium">ส่วนต่าง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...new Set([...Object.keys(data.ordered), ...depts.filter((d) => d !== NONE)])].map((k) => {
                      const o = data.ordered[k] ?? 0;
                      const u = data.current[k]?.cost ?? 0;
                      return (
                        <tr key={k}>
                          <td className="py-1.5">{nameOf(k)}</td>
                          <td className="py-1.5 text-right tabular-nums">{baht(o)}</td>
                          <td className="py-1.5 text-right tabular-nums">{baht(u)}</td>
                          <td className={`py-1.5 text-right tabular-nums ${o - u > 0 ? "text-warn" : ""}`}>{o - u > 0 ? `สั่งเกิน ${baht(o - u)}` : `ใช้จากของเดิม ${baht(u - o)}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-subtle">สองตัวเลขนี้ห้ามบวกกัน — ส่วนต่างคือของที่ยังอยู่ในสต๊อก (หรือของเดิมที่ใช้ไป) ไม่ใช่ต้นทุนเพิ่ม</p>
              </div>
            )}
          </section>

          {/* ---------- 7 ---------- */}
          <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
            <Q n="7" title="หักค่าแรงแผนกแล้วเหลือเท่าไร" sub={selLabel} />
            {Object.keys(data.labor).length === 0 ? (
              <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                {data.laborUnassigned > 0 ? `ค่าแรง ${baht(data.laborUnassigned)} ในช่วงนี้เป็นส่วนกลางทั้งหมด` : "ยังไม่มีค่าแรงในช่วงนี้"} — ถ้าบันทึกเงินเดือนแยกแผนก (เลือกแผนกที่บรรทัดค่าใช้จ่าย) ตรงนี้จะขึ้นกำไรขั้นต้น − ค่าแรงของแต่ละแผนก ·{" "}
                <a href="/expenses" className="text-primary underline">
                  บันทึกค่าใช้จ่าย
                </a>
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {depts
                  .filter((k) => k !== NONE)
                  .map((k) => {
                    const c = data.current[k];
                    const l = data.labor[k] ?? 0;
                    return (
                      <li key={k} className="flex justify-between gap-2 py-1.5">
                        <span>{nameOf(k)}</span>
                        <span className="tabular-nums">
                          กำไรขั้นต้น {baht(c.revenue - c.cost)} − ค่าแรง {baht(l)} = <b>{baht(c.revenue - c.cost - l)}</b>
                        </span>
                      </li>
                    );
                  })}
                {data.laborUnassigned > 0 && <li className="py-1.5 text-xs text-muted-subtle">ค่าแรงส่วนกลาง {baht(data.laborUnassigned)} ไม่หารเข้าแผนก</li>}
              </ul>
            )}
            <p className="text-xs text-muted-subtle">ค่าเช่า ค่าไฟ อยู่ส่วนกลางเสมอ ไม่หารเข้าแผนก</p>
          </section>

          {/* ---------- 8 ---------- */}
          <section className="space-y-1 rounded-2xl border border-border bg-surface p-4 text-sm">
            <Q n="8" title="ตัวเลขเชื่อได้แค่ไหน" sub={selLabel} />
            <p>
              ตัดสต๊อกตามยอดขายครอบคลุม <b>{data.coverage === null ? "—" : `${Math.round(data.coverage * 100)}%`}</b> ของยอดขาย ({data.postedDays} วันที่ตัดแล้ว) · เกณฑ์ {props.coverageMin}%
            </p>
            {data.skippedMenus > 0 && (
              <p>
                {data.skippedMenus} เมนูตัดสต๊อกไม่ได้ (ยังไม่มีสูตร) ต้นทุนของเมนูเหล่านี้จึงไม่อยู่ในแผนกไหนเลย ·{" "}
                <a href="/menus" className="text-primary underline">
                  เขียนสูตร
                </a>
              </p>
            )}
            <p className="text-xs text-muted-subtle">ของเสียและของที่นับไม่ตรงกับระบบไม่แบ่งแผนก — ไม่มีใครบันทึกว่าหายจากมือใคร (ดูที่หน้าต้นทุนและของหายไปไหน)</p>
          </section>
        </>
      )}
    </div>
  );
}

function Q({ n, title, sub }: { n: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="inline-grid h-6 min-w-[2rem] place-items-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">{n}</span>
      <h3 className="font-semibold">{title}</h3>
      {sub && <span className="text-xs text-muted-subtle">{sub}</span>}
    </div>
  );
}

function Chip({ on, onClick, small, children }: { on: boolean; onClick: () => void; small?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border ${small ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"} ${on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`}
    >
      {children}
    </button>
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

function Spark({
  name,
  tone,
  target,
  points,
  dept,
  coverageMin,
  selectedKey,
}: {
  name: string;
  tone: string;
  target: number;
  points: TrendPoint[];
  dept: string;
  coverageMin: number;
  selectedKey: string;
}) {
  const vals = points.map((p) => {
    const f = p.byDept[dept];
    return f && f.revenue > 0 ? (f.cost / f.revenue) * 100 : null;
  });
  const shown = vals.filter((v): v is number => v !== null);
  const W = 420, H = 130, L = 34, B = 22;
  const lo = Math.max(0, Math.min(target, ...shown) - 5);
  const hi = Math.max(target, ...shown, lo + 10) + 5;
  const x = (i: number) => L + (i / Math.max(1, points.length - 1)) * (W - L - 10);
  const y = (v: number) => 8 + (H - B - 8) * (1 - (v - lo) / (hi - lo));
  const path = vals.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <p className="mb-1 inline-flex items-center gap-2 text-sm font-semibold">
        <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: tone }} />
        {name}
      </p>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-subtle">ยังไม่มีต้นทุนในช่วงนี้</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`ต้นทุน % ของ${name}`}>
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="#ECE6CC" />
              <text x={L - 4} y={y(v) + 3} fontSize={9} textAnchor="end" fill="#8B8D63">
                {v.toFixed(0)}%
              </text>
            </g>
          ))}
          <line x1={L} x2={W} y1={y(target)} y2={y(target)} stroke="#A83A22" strokeDasharray="5 4" strokeWidth={1.5} />
          <polyline points={path} fill="none" stroke={tone} strokeWidth={2} />
          {vals.map((v, i) => {
            if (v === null) return null;
            const p = points[i];
            const ok = p.coverage !== null && p.coverage * 100 >= coverageMin;
            return (
              <circle key={p.key} cx={x(i)} cy={y(v)} r={p.key === selectedKey ? 5 : 3.5} fill={ok ? tone : "#FFFFFF"} stroke={tone} strokeWidth={1.8}>
                <title>{`${p.label} ${v.toFixed(1)}%${ok ? "" : " · ตัดสต๊อกไม่ครบ"}`}</title>
              </circle>
            );
          })}
          {points.map((p, i) =>
            // Evenly spaced back from the newest, so the last label never collides.
            (points.length - 1 - i) % Math.ceil(points.length / 6) === 0 ? (
              <text key={p.key} x={x(i)} y={H - 6} fontSize={9} textAnchor="middle" fill="#5A5C31">
                {p.label}
              </text>
            ) : null
          )}
        </svg>
      )}
    </div>
  );
}

function MenuList({ rows }: { rows: Data["menus"] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">ไม่มีเมนูที่มีสูตรและขายในช่วงนี้</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.slice(0, 8).map((m) => (
        <li key={m.menuId} className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="min-w-0">
            <a href={`/menus?menu=${m.menuId}`} className="font-medium underline decoration-dotted underline-offset-2 hover:text-primary hover:decoration-solid">
              {m.name}
            </a>
            <span className="block text-xs text-muted-subtle">
              {m.plates.toLocaleString("th-TH")} จาน · ต้นทุน {pct(m.costPct)} · เป้า {m.target}%
            </span>
          </span>
          <span className={`whitespace-nowrap tabular-nums ${m.over > 0 ? "text-bad" : "text-good"}`}>{m.over > 0 ? `เกิน ${baht(m.over)}` : `ต่ำกว่าเป้า ${baht(-m.over)}`}</span>
        </li>
      ))}
    </ul>
  );
}

function Bars({ rows, tone }: { rows: { productId: string; name: string; baht: number }[]; tone: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูล</p>;
  const max = Math.max(...rows.map((r) => r.baht), 1);
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r, i) => (
        <li key={r.productId} className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-2">
          <span className="truncate">{r.name}</span>
          <span className="h-2.5 rounded-full bg-muted">
            <span className="block h-full origin-left animate-grow-x rounded-full" style={{ width: `${(r.baht / max) * 100}%`, background: tone, animationDelay: `${i * 30}ms` }} />
          </span>
          <span className="tabular-nums">{baht(r.baht)}</span>
        </li>
      ))}
    </ul>
  );
}

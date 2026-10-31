"use client";

// วิเคราะห์รายจ่าย — donuts with popup drill-down (Kong 2026-10-24,
// duplication review B4: "เปลี่ยนเป็นรูปแบบ pie chart แล้วลองมี interactive pop up
// ในการ drill down แทนที่จะเป็นการกด slicer"). Month and branch stay as the page's
// filters (they choose the data); everything that used to be a filter row for
// drilling — ประเภท, หมวด, กลุ่ม, ผู้ขาย — is now a click into a popup.
//
// A donut shows at most six slices; the rest fold into "อื่น ๆ" (more slices
// cannot be compared by eye). Every popup also lists the exact figures.
// Reads go through GET /api/expenses (mise-ui-review §5c), cached per filter.

import { useEffect, useMemo, useRef, useState } from "react";
import { ModalShell } from "@/app/(app)/sales/_components/Breakdown";
import { TONES, CATEGORY_TONES } from "@/components/charts/chart-theme";
import { readApi } from "@/lib/read-api";

type Row = { key: string; label: string; amount: number };
type Drill = {
  ok: true;
  total: number;
  billCount: number;
  byGroup: Row[];
  bySupplier: Row[];
  products: { productId: string; name: string; unitName: string | null; qty: number; amount: number; avgPrice: number | null }[];
  bills: { expenseId: string; billDate: string; billNo: string | null; supplierName: string | null; branchName: string; amount: number; lines: number }[];
  billsMore: number;
};
type Level = { title: string; section?: string; group?: string; supplier?: string };

const baht = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;
const pct = (v: number, t: number) => (t > 0 ? `${((v / t) * 100).toFixed(v / t < 0.1 ? 1 : 0)}%` : "—");
const COLORS: string[] = CATEGORY_TONES.map((t) => TONES[t][0]);
const OTHERS = "__others__";

/** At most six slices; the tail folds into one "อื่น ๆ" slice that opens its own list. */
function slices(rows: Row[]): (Row & { color: string })[] {
  const head = rows.slice(0, 5);
  const tail = rows.slice(5);
  const out = head.map((r, i) => ({ ...r, color: COLORS[i % COLORS.length] }));
  if (tail.length === 1) out.push({ ...tail[0], color: COLORS[5 % COLORS.length] });
  else if (tail.length > 1) out.push({ key: OTHERS, label: `อื่น ๆ (${tail.length})`, amount: tail.reduce((s, r) => s + r.amount, 0), color: "#B9B391" });
  return out;
}

function Donut({ rows, total, onPick, size = 220, center }: { rows: (Row & { color: string })[]; total: number; onPick: (r: Row) => void; size?: number; center: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const R = size / 2, r = R * 0.62;
  let a0 = -Math.PI / 2;
  const arcs = rows.map((s) => {
    const a = (s.amount / (total || 1)) * Math.PI * 2;
    const a1 = a0 + a;
    const big = a > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) => `${R + rad * Math.cos(ang)},${R + rad * Math.sin(ang)}`;
    const d = rows.length === 1 ? `M${R},${R - R}A${R},${R} 0 1 1 ${R - 0.01},${R - R}L${R - 0.01},${R - r}A${r},${r} 0 1 0 ${R},${R - r}Z` : `M${p(a0, R)}A${R},${R} 0 ${big} 1 ${p(a1, R)}L${p(a1, r)}A${r},${r} 0 ${big} 0 ${p(a0, r)}Z`;
    a0 = a1;
    return { s, d };
  });
  const hov = rows.find((x) => x.key === hover);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto block shrink-0" role="img" aria-label="สัดส่วน">
      {arcs.map(({ s, d }, i) => (
        <path
          key={s.key}
          d={d}
          fill={s.color}
          stroke="var(--color-surface, #fff)"
          strokeWidth={2}
          className="cursor-pointer outline-none transition-opacity"
          opacity={hover && hover !== s.key ? 0.45 : 1}
          style={{ transformOrigin: `${R}px ${R}px`, animation: `xd-in .6s cubic-bezier(.2,.8,.2,1) ${i * 60}ms both` }}
          tabIndex={0}
          role="button"
          aria-label={`${s.label} ${baht(s.amount)}`}
          onMouseEnter={() => setHover(s.key)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(s.key)}
          onBlur={() => setHover(null)}
          onClick={() => onPick(s)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(s))}
        />
      ))}
      <text x={R} y={R - 6} textAnchor="middle" fontSize={11} fill="#5A5C31">
        {hov ? hov.label.slice(0, 16) : center}
      </text>
      <text x={R} y={R + 14} textAnchor="middle" fontSize={15} fontWeight={700} fill="#262811">
        {hov ? `${baht(hov.amount)} · ${pct(hov.amount, total)}` : baht(total)}
      </text>
      <style>{`@keyframes xd-in{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
    </svg>
  );
}

function Legend({ rows, total, onPick }: { rows: (Row & { color: string })[]; total: number; onPick: (r: Row) => void }) {
  return (
    <ul className="grid w-full min-w-0 gap-1">
      {rows.map((s) => (
        <li key={s.key}>
          <button type="button" onClick={() => onPick(s)} className="grid w-full grid-cols-[12px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
            <i className="h-3 w-3 rounded-sm" style={{ background: s.color }} />
            <span className="truncate">{s.label}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{pct(s.amount, total)}</span>
            <span className="w-24 text-right font-medium tabular-nums">{baht(s.amount)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function ExpenseDrill({ month, branch, total, sections, suppliers }: { month: string; branch?: string; total: number; sections: Row[]; suppliers: Row[] }) {
  const [stack, setStack] = useState<Level[]>([]);
  const cache = useRef(new Map<string, Promise<Drill | { ok: false; formError: string }>>());
  const secSlices = useMemo(() => slices(sections), [sections]);
  const supSlices = useMemo(() => slices(suppliers), [suppliers]);
  const tailOf = (rows: Row[]) => rows.slice(5);

  const openSection = (r: Row) => {
    if (r.key === OTHERS) setStack([{ title: "หมวดอื่น ๆ" }]);
    else setStack([{ title: r.label, section: r.key }]);
  };
  const openSupplier = (r: Row) => {
    if (r.key === OTHERS) setStack([{ title: "ผู้ขายอื่น ๆ", supplier: OTHERS }]);
    else setStack([{ title: r.label, supplier: r.key }]);
  };
  const load = (lv: Level) => {
    const key = JSON.stringify([month, branch, lv.section, lv.group, lv.supplier]);
    if (!cache.current.has(key)) {
      cache.current.set(key, readApi<Drill>("/api/expenses", "drill", { m: month, branch, section: lv.section, group: lv.group, supplier: lv.supplier }));
    }
    return cache.current.get(key)!;
  };

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-[18px] border border-border/70 bg-surface shadow-card p-5">
          <h3 className="font-semibold">แยกตามหมวด</h3>
          <p className="text-xs text-muted-foreground">% คือสัดส่วนของรายจ่ายที่กำลังดู · กดชิ้นหรือแถวเพื่อดูข้างใน</p>
          <div className="mt-3 grid items-center gap-4 sm:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[200px_minmax(0,1fr)]">
            <Donut size={200} rows={secSlices} total={total} onPick={openSection} center="รวมรายจ่าย" />
            <Legend rows={secSlices} total={total} onPick={openSection} />
          </div>
        </section>
        <section className="rounded-[18px] border border-border/70 bg-surface shadow-card p-5">
          <h3 className="font-semibold">แยกตามผู้ขาย</h3>
          <p className="text-xs text-muted-foreground">กดชิ้นหรือแถวเพื่อดูบิลและสินค้าของผู้ขายนั้น</p>
          <div className="mt-3 grid items-center gap-4 sm:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[200px_minmax(0,1fr)]">
            <Donut size={200} rows={supSlices} total={total} onPick={openSupplier} center="รวมรายจ่าย" />
            <Legend rows={supSlices} total={total} onPick={openSupplier} />
          </div>
        </section>
      </div>
      {stack.length > 0 && (
        <DrillPopup
          stack={stack}
          setStack={setStack}
          load={load}
          othersSections={tailOf(sections)}
          othersSuppliers={tailOf(suppliers)}
        />
      )}
    </>
  );
}

function DrillPopup({
  stack,
  setStack,
  load,
  othersSections,
  othersSuppliers,
}: {
  stack: Level[];
  setStack: (s: Level[]) => void;
  load: (lv: Level) => Promise<Drill | { ok: false; formError: string }>;
  othersSections: Row[];
  othersSuppliers: Row[];
}) {
  const lv = stack[stack.length - 1];
  const [data, setData] = useState<{ key: string; d: Drill | { ok: false; formError: string } } | null>(null);
  const key = JSON.stringify(lv);
  const needsRead = !(lv.section === undefined && lv.supplier === undefined) && lv.supplier !== OTHERS;
  useEffect(() => {
    if (!needsRead) return;
    let live = true;
    load(lv).then((d) => live && setData({ key, d }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const push = (next: Level) => setStack([...stack, next]);
  const close = () => setStack([]);

  // "อื่น ๆ" levels are lists the page already holds — no read.
  const listOnly = lv.section === undefined && lv.supplier === undefined ? othersSections : lv.supplier === OTHERS ? othersSuppliers : null;
  const d = data?.key === key && data.d.ok ? (data.d as Drill) : null;
  const err = data?.key === key && !data.d.ok ? (data.d as { formError: string }).formError : null;

  return (
    <ModalShell onClose={close} labelledBy="xd-title" wide>
      <div className="mb-3 flex flex-wrap items-center gap-2 pr-10 text-sm">
        {stack.map((s, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground">›</span>}
            {i < stack.length - 1 ? (
              <button type="button" className="text-primary underline" onClick={() => setStack(stack.slice(0, i + 1))}>
                {s.title}
              </button>
            ) : (
              <h3 id="xd-title" className="text-lg font-semibold">
                {s.title}
              </h3>
            )}
          </span>
        ))}
        {d && <span className="text-muted-foreground">· {baht(d.total)} · {d.billCount} บิล</span>}
      </div>

      {listOnly ? (
        <ul className="grid gap-1">
          {listOnly.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => push(lv.supplier === OTHERS ? { title: r.label, supplier: r.key } : { title: r.label, section: r.key })}
                className="flex w-full justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span>{r.label}</span>
                <span className="font-medium tabular-nums">{baht(r.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : err ? (
        <p className="text-sm text-bad">{err}</p>
      ) : !d ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : (
        <div className="grid gap-5">
          {lv.section && !lv.group && d.byGroup.length > 1 && (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <Donut rows={slices(d.byGroup)} total={d.total} size={180} center="ในหมวดนี้" onPick={(r) => r.key !== OTHERS && push({ title: r.label, section: lv.section, group: r.key })} />
              <Legend rows={slices(d.byGroup)} total={d.total} onPick={(r) => r.key !== OTHERS && push({ title: r.label, section: lv.section, group: r.key })} />
            </div>
          )}
          {d.products.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-1 font-display text-sm font-semibold">รายวัตถุดิบ</p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 font-normal">วัตถุดิบ</th>
                    <th className="py-1 text-right font-normal">ซื้อ</th>
                    <th className="py-1 text-right font-normal">ราคาเฉลี่ย/หน่วย</th>
                    <th className="py-1 text-right font-normal">รวม</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {d.products.slice(0, 15).map((p) => (
                    <tr key={p.productId}>
                      <td className="py-1.5">
                        <a href={`/products?product=${p.productId}`} className="hover:text-primary hover:underline">
                          {p.name}
                        </a>
                      </td>
                      <td className="py-1.5 text-right">{p.unitName ? `${p.qty.toLocaleString("th-TH", { maximumFractionDigits: 2 })} ${p.unitName}` : "หลายหน่วย"}</td>
                      <td className="py-1.5 text-right">{p.avgPrice === null ? "—" : `฿${p.avgPrice.toLocaleString("th-TH", { maximumFractionDigits: 2 })}`}</td>
                      <td className="py-1.5 text-right font-medium">{baht(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!lv.supplier && d.bySupplier.length > 1 && (
            <div>
              <p className="mb-1 font-display text-sm font-semibold">ผู้ขาย</p>
              <ul className="grid gap-1">
                {d.bySupplier.slice(0, 6).map((s) => (
                  <li key={s.key} className="flex justify-between text-sm">
                    <span>{s.label}</span>
                    <span className="tabular-nums">
                      {pct(s.amount, d.total)} · <b>{baht(s.amount)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-1 font-display text-sm font-semibold">บิล</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {d.bills.map((b) => (
                <li key={b.expenseId}>
                  <a href={`/expenses/${b.expenseId}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
                    <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{b.billDate.slice(8, 10)}/{b.billDate.slice(5, 7)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{b.supplierName ?? "ไม่มีผู้ขาย"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {b.billNo ?? "ไม่มีเลขบิล"} · {b.branchName} · {b.lines} รายการ
                      </span>
                    </span>
                    <span className="font-medium tabular-nums">{baht(b.amount)}</span>
                  </a>
                </li>
              ))}
            </ul>
            {d.billsMore > 0 && <p className="mt-1 text-xs text-muted-foreground">+ อีก {d.billsMore} บิล</p>}
          </div>
        </div>
      )}
    </ModalShell>
  );
}

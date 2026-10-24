"use client";

// Waste in baht or quantity, by month / department / ingredient type / product
// (Kong 2026-10-24, duplication review D2). Every view is a fold of the same
// rows from getWasteSummaryLogic, so switching never goes back to the server.
//
// Quantity is never summed ACROSS products — "3 กระสอบ + 5 kg" is not 8 of
// anything — so a group in จำนวน mode shows how many times something was thrown
// away, plus each product's own quantity in its own unit underneath.

import { use, useMemo, useState } from "react";
import type { WasteSummary, WasteSummaryRow } from "@/server/waste-summary";

type Measure = "baht" | "qty";
type View = "month" | "department" | "group" | "product";

const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const monthTh = (k: string) => `${MTH[+k.slice(5, 7) - 1]} ${String((+k.slice(0, 4) + 543) % 100).padStart(2, "0")}`;
const baht = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;
const qtyFmt = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });

type Group = { key: string; label: string; value: number; unpriced: number; count: number; products: { name: string; qty: number; unit: string }[] };

export default function WasteSummaryPanel({ data, canSeeCost }: { data: Promise<WasteSummary>; canSeeCost: boolean }) {
  const { months, departments, rows } = use(data);
  const [measure, setMeasure] = useState<Measure>(canSeeCost ? "baht" : "qty");
  const [view, setView] = useState<View>("month");
  const [month, setMonth] = useState<string | null>(months.at(-1) ?? null);
  const [filter, setFilter] = useState<{ view: View; key: string; label: string } | null>(null);

  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const showDepartments = departments.length > 1 || rows.some((r) => r.departmentId !== null);

  const keyOf = (r: WasteSummaryRow, v: View): [string, string] => {
    if (v === "month") return [r.month, monthTh(r.month)];
    if (v === "department") return [r.departmentId ?? "-", r.departmentId ? deptName.get(r.departmentId) ?? "แผนกที่ปิดไปแล้ว" : "ไม่ระบุแผนก"];
    if (v === "group") return [r.group ?? "-", r.group ?? "ไม่ระบุประเภท"];
    return [r.productId, r.productName];
  };

  const scoped = rows.filter((r) => (view === "month" || month === null || r.month === month) && (!filter || keyOf(r, filter.view)[0] === filter.key));

  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    if (view === "month") for (const m of months) by.set(m, { key: m, label: monthTh(m), value: 0, unpriced: 0, count: 0, products: [] });
    for (const r of scoped) {
      const [k, label] = keyOf(r, view);
      const g = by.get(k) ?? { key: k, label, value: 0, unpriced: 0, count: 0, products: [] };
      g.count += 1;
      if (r.value === null) g.unpriced += 1;
      else g.value += r.value;
      const p = g.products.find((x) => x.name === r.productName && x.unit === r.unit);
      if (p) p.qty += r.qty;
      else g.products.push({ name: r.productName, qty: r.qty, unit: r.unit });
      by.set(k, g);
    }
    const list = [...by.values()];
    for (const g of list) g.products.sort((a, b) => b.qty - a.qty);
    if (view !== "month") list.sort((a, b) => (measure === "baht" ? b.value - a.value : b.count - a.count));
    return list;
    // keyOf depends only on deptName, which is memoised
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, view, measure, months, deptName]);

  const metric = (g: Group) => (measure === "baht" ? g.value : view === "product" ? g.products[0]?.qty ?? 0 : g.count);
  const max = Math.max(1, ...groups.map(metric));
  const total = scoped.reduce((t, r) => t + (r.value ?? 0), 0);
  const unpriced = scoped.filter((r) => r.value === null).length;

  const drill = (g: Group) => {
    if (view === "product") return;
    if (view === "month") {
      setMonth(g.key);
      setView("product");
      return;
    }
    setFilter({ view, key: g.key, label: g.label });
    setView("product");
  };

  const views: [View, string][] = [
    ["month", "รายเดือน"],
    ...(showDepartments ? ([["department", "แผนก"]] as [View, string][]) : []),
    ["group", "ประเภทวัตถุดิบ"],
    ["product", "รายวัตถุดิบ"],
  ];

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">สรุปของเสีย</h3>
          <p className="text-xs text-muted-foreground">
            {view === "month" ? `${WASTE_MONTHS_LABEL(months)}` : month ? `เดือน ${monthTh(month)}` : WASTE_MONTHS_LABEL(months)} ·{" "}
            {scoped.length.toLocaleString("th-TH")} รายการ
            {canSeeCost && (
              <>
                {" "}· รวม <span className="font-medium text-foreground tabular-nums">{baht(total)}</span>
                {unpriced > 0 && ` (ตีราคาไม่ได้ ${unpriced} รายการ)`}
              </>
            )}
          </p>
        </div>
        {canSeeCost && (
          <Seg
            value={measure}
            onChange={(v) => setMeasure(v as Measure)}
            options={[
              ["baht", "บาท"],
              ["qty", "จำนวน"],
            ]}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg value={view} onChange={(v) => setView(v as View)} options={views} />
        {view !== "month" && (
          <select value={month ?? ""} onChange={(e) => setMonth(e.target.value || null)} className="input py-1.5 text-sm" aria-label="เดือน">
            <option value="">ทั้ง {months.length} เดือน</option>
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthTh(m)}
              </option>
            ))}
          </select>
        )}
        {filter && (
          <button
            type="button"
            onClick={() => setFilter(null)}
            className="rounded-full border border-primary-line bg-primary/10 px-3 py-1 text-xs font-medium text-primary whitespace-nowrap"
          >
            {filter.label} ✕
          </button>
        )}
      </div>

      {groups.length === 0 || scoped.length === 0 ? (
        <p className="rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">ไม่มีของเสียที่บันทึกไว้ในช่วงนี้</p>
      ) : (
        <ul className="space-y-1">
          {groups.map((g, i) => (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => drill(g)}
                disabled={view === "product"}
                className={`grid w-full grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm ${view === "product" ? "cursor-default" : "hover:bg-muted/50 cursor-pointer"}`}
              >
                <span className="truncate">{g.label}</span>
                <span className="h-3 rounded-full bg-muted/60">
                  <span
                    className="block h-3 origin-left rounded-full bg-gradient-to-r from-[#AEB784] to-[#41431B] animate-grow-x"
                    style={{ width: `${(metric(g) / max) * 100}%`, animationDelay: `${i * 30}ms` }}
                  />
                </span>
                <span className="tabular-nums font-medium whitespace-nowrap">
                  {g.count === 0
                    ? "—"
                    : measure === "baht"
                      ? `${baht(g.value)}${g.unpriced ? " *" : ""}`
                      : view === "product"
                        ? `${qtyFmt(g.products[0].qty)} ${g.products[0].unit}`
                        : `${g.count} ครั้ง`}
                </span>
              </button>
              {measure === "qty" && view !== "product" && g.products.length > 0 && (
                <p className="px-2 pb-1 text-xs text-muted-foreground">
                  {g.products
                    .slice(0, 4)
                    .map((p) => `${p.name} ${qtyFmt(p.qty)} ${p.unit}`)
                    .join(" · ")}
                  {g.products.length > 4 && ` · อีก ${g.products.length - 4} อย่าง`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {view !== "product" && <p className="text-xs text-muted-foreground">กดที่แถวเพื่อดูว่าเป็นวัตถุดิบอะไรบ้าง</p>}
      {canSeeCost && measure === "baht" && unpriced > 0 && (
        <p className="text-xs text-muted-foreground">* มีรายการที่ยังไม่รู้ต้นทุน (ยังไม่เคยรับของเข้า) จึงไม่ได้นับเป็นบาท</p>
      )}
    </section>
  );
}

const WASTE_MONTHS_LABEL = (months: string[]) => (months.length ? `${monthTh(months[0])} – ${monthTh(months.at(-1)!)}` : "");

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="inline-flex rounded-full border border-border p-0.5 text-sm">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`rounded-full px-3 py-1 whitespace-nowrap ${value === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Baht for one list row, from the same streamed summary. */
export function WasteRowValue({ data, id }: { data: Promise<WasteSummary>; id: string }) {
  const { rows } = use(data);
  const r = rows.find((x) => x.id === id);
  if (!r || r.value === null) return null;
  return <span className="text-muted-foreground tabular-nums"> · {baht(r.value)}</span>;
}

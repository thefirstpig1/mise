import { requireTenant } from "@/lib/require-tenant";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic } from "@/server/branch";
import { getPriceWatchLogic } from "@/server/price-watch";
import ActionLink from "@/components/ui/ActionLink";
import { PriceChangeChart, PriceTrendChart, type TrendRow } from "../_components/PriceCharts";

// ============================================================
// Mise — ราคาวัตถุดิบขึ้นลง (Part 35 D)
// ============================================================
// Kong's "ราคาผันผวน" sheet on Mise's own receipts (src/server/price-watch.ts
// has the rules). `cost:view` because a purchase price IS a cost.
// ============================================================

type SP = Promise<{ w?: string; branch?: string; group?: string; supplier?: string; product?: string }>;

const WINDOWS = [
  { key: "4", label: "4 สัปดาห์", days: 28 },
  { key: "8", label: "8 สัปดาห์", days: 56 },
  { key: "12", label: "12 สัปดาห์", days: 84 },
  { key: "26", label: "6 เดือน", days: 182 },
];

const baht2 = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function PricesPage({ searchParams }: { searchParams: SP }) {
  const { tenantId, reach } = await requireTenant("cost:view");
  const sp = await searchParams;

  const win = WINDOWS.find((w) => w.key === sp.w) ?? WINDOWS[1];
  const today = computeBangkokToday();
  const from = addDays(today, -(win.days - 1));
  const branches = await getBranchesLogic(tenantId, reach);
  const branchId = branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;

  const pw = await getPriceWatchLogic(
    tenantId,
    { from, to: today, branchId, group: sp.group || undefined, supplier: sp.supplier || undefined },
    reach
  );

  const current = { w: win.key, branch: branchId, group: sp.group || undefined, supplier: sp.supplier || undefined, product: sp.product || undefined };
  const href = (next: Partial<typeof current>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...next })) if (v) q.set(k, v);
    return `/cost/prices?${q.toString()}`;
  };
  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`;

  const comparable = pw.products.filter((p) => p.changePct !== null);
  const risers = comparable.filter((p) => (p.changePct ?? 0) > 0);
  const fallers = comparable.filter((p) => (p.changePct ?? 0) < 0);

  // The picked product's price line, one series per supplier.
  const picked = sp.product ? pw.products.find((p) => p.productId === sp.product) ?? null : null;
  let trendRows: TrendRow[] = [];
  let trendSuppliers: { id: string; name: string }[] = [];
  if (picked) {
    const pts = pw.points.filter((p) => p.productId === picked.productId);
    const bySup = new Map<string, string>();
    const byDay = new Map<string, TrendRow>();
    for (const p of pts) {
      bySup.set(p.supplierId, p.supplierName);
      const d = p.date.toISOString().slice(0, 10);
      const row = byDay.get(d) ?? ({ day: d } as TrendRow);
      row[p.supplierId] = Math.round(p.pricePerBase * 100) / 100;
      byDay.set(d, row);
    }
    trendRows = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
    trendSuppliers = [...bySup.entries()].map(([id, name]) => ({ id, name }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ราคาวัตถุดิบขึ้นลง</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          จากใบรับของที่ยืนยันแล้ว · ราคาต่อหน่วยพื้นฐาน (เช่น ต่อ กก.) ไม่รวม VAT จึงเทียบกันได้แม้ซื้อคนละขนาดบรรจุ ·
          เทียบราคาครั้งแรกกับครั้งล่าสุดในช่วงที่เลือก
        </p>
      </div>

      <section className="sticky top-0 z-20 space-y-3 rounded-xl border border-border bg-surface/95 p-4 shadow-sm backdrop-blur lg:top-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">ย้อนหลัง</span>
          {WINDOWS.map((w) => (
            <a key={w.key} href={href({ w: w.key })} className={pill(w.key === win.key)}>{w.label}</a>
          ))}
        </div>
        {branches.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">สาขา</span>
            <a href={href({ branch: undefined })} className={pill(!branchId)}>ทุกสาขา</a>
            {branches.map((b) => (
              <a key={b.id} href={href({ branch: branchId === b.id ? undefined : b.id })} className={pill(branchId === b.id)}>{b.name}</a>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">กลุ่ม</span>
          <a href={href({ group: undefined, product: undefined })} className={pill(!current.group)}>ทุกกลุ่ม</a>
          {pw.options.groups.map((g) => (
            <a key={g} href={href({ group: current.group === g ? undefined : g, product: undefined })} className={pill(current.group === g)}>{g}</a>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">ผู้ขาย</span>
          <a href={href({ supplier: undefined })} className={pill(!current.supplier)}>ทุกเจ้า</a>
          {pw.options.suppliers.map((s) => (
            <a key={s.id} href={href({ supplier: current.supplier === s.id ? undefined : s.id })} className={pill(current.supplier === s.id)}>{s.name}</a>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="วัตถุดิบที่เทียบราคาได้" value={`${comparable.length} รายการ`} sub={`ซื้อมากกว่า 1 ครั้งในช่วงนี้ จาก ${pw.products.length} รายการ`} />
        <Stat label="แพงขึ้น" value={`${risers.length} รายการ`} sub={risers[0] ? `มากสุด: ${risers[0].productName} +${risers[0].changePct}%` : "—"} tone="bad" />
        <Stat label="ถูกลง" value={`${fallers.length} รายการ`} sub={fallers.length ? `มากสุด: ${fallers[fallers.length - 1].productName} ${fallers[fallers.length - 1].changePct}%` : "—"} tone="good" />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="ราคาเปลี่ยนไปเท่าไร รายวัตถุดิบ" hint="แดง = แพงขึ้น · เขียว = ถูกลง · กดแท่งเพื่อดูกราฟราคาของวัตถุดิบนั้น">
          <PriceChangeChart
            rows={comparable.slice(0, 25).map((p) => ({
              productId: p.productId,
              name: p.productName,
              changePct: p.changePct!,
              first: p.first,
              last: p.last,
              unit: p.baseUnit,
              receipts: p.receipts,
            }))}
          />
        </Card>
        <Card className="xl:col-span-2" title="เฉลี่ยรายกลุ่ม" hint="ค่าเฉลี่ยของ % เปลี่ยนของวัตถุดิบในกลุ่ม · กดเพื่อกรองกลุ่มนั้น">
          {pw.groups.length ? (
            <ul className="space-y-1.5">
              {pw.groups.map((g) => (
                <li key={g.group}>
                  <a href={href({ group: g.group, product: undefined })} className="group flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted">
                    <span className="min-w-0">
                      <span className="block font-medium">{g.group}</span>
                      <span className="block text-xs text-muted-foreground">{g.products} รายการ</span>
                    </span>
                    <span className={`tabular-nums font-semibold ${g.avgChangePct > 0 ? "text-bad" : g.avgChangePct < 0 ? "text-good" : ""}`}>
                      {g.avgChangePct > 0 ? "+" : ""}
                      {g.avgChangePct.toFixed(1)}%
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">ยังเทียบราคาไม่ได้ในช่วงนี้</p>
          )}
        </Card>
      </div>

      {picked ? (
        <section id="trend" className="rounded-xl border-2 border-primary-line bg-surface p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">ราคา {picked.productName} ต่อ {picked.baseUnit}</h2>
              <p className="text-xs text-muted-foreground">
                ต่ำสุด {baht2(picked.min)} · สูงสุด {baht2(picked.max)} · {picked.receipts} ใบรับของ · แยกเส้นตามผู้ขาย
              </p>
            </div>
            <div className="flex gap-2">
              <ActionLink href={`/products/${picked.productId}`}>เปิดหน้าสินค้า</ActionLink>
              <ActionLink href={href({ product: undefined })}>ปิดกราฟ</ActionLink>
            </div>
          </div>
          <PriceTrendChart rows={trendRows} suppliers={trendSuppliers} unit={picked.baseUnit} />
        </section>
      ) : null}

      <Card title="รายละเอียดรายวัตถุดิบ × ผู้ขาย" hint="ราคาต่อหน่วยพื้นฐาน · กดชื่อเพื่อดูกราฟราคา">
        {pw.rows.length ? (
          <div className="max-h-[520px] overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-sunk text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">วัตถุดิบ</th>
                  <th className="px-3 py-2 font-medium">ผู้ขาย</th>
                  <th className="px-3 py-2 font-medium">กลุ่ม</th>
                  <th className="px-3 py-2 text-right font-medium">ครั้งแรก</th>
                  <th className="px-3 py-2 text-right font-medium">ล่าสุด</th>
                  <th className="px-3 py-2 text-right font-medium">เปลี่ยน</th>
                  <th className="px-3 py-2 text-right font-medium">ครั้ง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {pw.rows.map((r) => (
                  <tr key={r.key} className="hover:bg-muted">
                    <td className="px-3 py-2">
                      <a href={`${href({ product: r.productId })}#trend`} className="font-medium text-primary hover:underline">{r.productName}</a>
                      <span className="block text-xs text-muted-foreground">ต่อ {r.baseUnit}</span>
                    </td>
                    <td className="px-3 py-2">{r.supplierName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.group}</td>
                    <td className="px-3 py-2 text-right">{baht2(r.first)}</td>
                    <td className="px-3 py-2 text-right">{baht2(r.last)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${(r.changePct ?? 0) > 0 ? "text-bad" : (r.changePct ?? 0) < 0 ? "text-good" : "text-muted-foreground"}`}>
                      {r.changePct === null ? "—" : `${r.changePct > 0 ? "+" : ""}${r.changePct.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{r.receipts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีใบรับของในช่วงนี้</p>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""}`}>{value}</p>
      {sub ? <p className="mt-0.5 truncate text-xs text-muted-foreground" title={sub}>{sub}</p> : null}
    </div>
  );
}

function Card({ title, hint, className = "", children }: { title: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? <p className="mb-4 mt-0.5 text-xs text-muted-foreground">{hint}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

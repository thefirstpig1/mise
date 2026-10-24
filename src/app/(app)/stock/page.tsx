// /stock — งานสต๊อก (Kong 2026-10-24, duplication review B6, mockup
// https://claude.ai/artifact/4hGLXhjU1Gt5kNpMwrycXv, option A).
//
// This page used to be a second list of every product with its balance — the
// same 31 rows /products shows with more beside them. The list now lives only
// on /products (with the value column, "หมด / ติดลบ" and "ไม่เคลื่อนไหว"
// filters this page had), and /stock is the door to stock WORK: the things
// that move stock without a purchase or a sale, what moved last, and what to
// look at — each tile saying one fact about its job.
//
// `searchParams` is a PROMISE in Next 15.

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getBranchesLogic, liveliestBranchId } from "@/server/branch";
import { getStockBalancesByBranchLogic } from "@/server/stock-movement";
import { getProductCostsLogic } from "@/server/stock-cost";
import { getProductCostsQuerySchema } from "@/lib/validations/stock-cost";
import { getProductListFactsLogic, getRecentMovementsLogic } from "@/server/product-list";
import { getStockHubFactsLogic } from "@/server/stock-hub";
import { getIncomingTransfersLogic } from "@/server/transfer";
import { toTransferView } from "@/app/(app)/transfers/_components/transfer-view";
import IncomingTransfers from "@/app/(app)/transfers/_components/IncomingTransfers";
import { MOVEMENT_TYPE_LABELS_TH, SOURCE_TYPE_LABELS_TH } from "@/lib/validations/stock-movement";
import { PAR_RED } from "@/lib/par-alert";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";

const label = (m: Record<string, string>, k: string) => m[k] ?? k;
const baht = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;
const qty = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("th-TH", { maximumFractionDigits: 3 })}`;
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

export default async function StockWorkPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const { tenantId, reach, costAccess, can } = await requireTenant("any:member");
  const { branch: branchParam } = await searchParams;

  const branches = await getBranchesLogic(tenantId, reach);
  if (branches.length === 0) {
    return <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">ยังไม่มีสาขาในระบบ</div>;
  }
  const fallbackId = branchParam ? undefined : await liveliestBranchId(tenantId, branches.map((b) => b.id));
  const branch = branches.find((b) => b.id === branchParam) ?? branches.find((b) => b.id === fallbackId) ?? branches[0];

  const [incoming, facts, hub, recent, value] = await Promise.all([
    getIncomingTransfersLogic(tenantId, branch.id).then((ts) => ts.map((t) => toTransferView(t, costAccess))),
    getProductListFactsLogic(tenantId, branch.id, null),
    getStockHubFactsLogic(tenantId, branch.id),
    getRecentMovementsLogic(tenantId, null, branch.id, 8),
    costAccess === null
      ? Promise.resolve(null)
      : getStockBalancesByBranchLogic(tenantId, branch.id).then(async (balances) => {
          const costs = await getProductCostsLogic(
            tenantId,
            getProductCostsQuerySchema.parse({ productIds: balances.map((b) => b.productId), branchId: branch.id })
          );
          let total = 0;
          for (const c of costs.values()) total += Number(c.inventoryValue);
          return total;
        }),
  ]);

  // The same two counts /products floats over its chips (rule PAR-3).
  const kinds = Object.values(facts.facts).map((f) => f.state?.kind ?? null);
  const low = kinds.filter((k) => k !== null && PAR_RED.has(k)).length;
  const near = kinds.filter((k) => k === "near").length;
  const today = computeBangkokToday();
  const countAgo = hub.lastCountDate
    ? Math.round((today.getTime() - Date.parse(`${hub.lastCountDate}T00:00:00Z`)) / 86_400_000)
    : null;

  const tiles: { href: string; title: string; sub: string; show: boolean; main?: boolean; alert?: boolean }[] = [
    {
      href: `/stock-counts/new?branch=${branch.id}`,
      title: "นับสต๊อก",
      sub: countAgo === null ? "ยังไม่เคยนับที่สาขานี้" : countAgo === 0 ? "นับล่าสุดวันนี้" : `นับล่าสุด ${countAgo} วันก่อน`,
      show: can("count:write"),
      main: true,
    },
    { href: "/waste", title: "บันทึกของเสีย", sub: `เดือนนี้ ${hub.wasteThisMonth} รายการ`, show: can("stock:write") },
    { href: "/stock/adjust", title: "ปรับสต๊อก", sub: "ของเกิน/ขาดที่รู้สาเหตุ", show: can("stock:write") },
    {
      href: `/transfers/new?from=${branch.id}`,
      title: "โอนไปสาขาอื่น",
      sub: incoming.length > 0 ? `มีของกำลังมาส่ง ${incoming.length} ใบ` : "ไม่มีของกำลังมาส่ง",
      show: branches.length > 1 || reach.allBranches,
    },
    { href: "/staff-meals", title: "มื้อพนักงาน", sub: "ของที่พนักงานกิน", show: can("stock:write") },
    {
      href: `/consumption?branch=${branch.id}`,
      title: "ตัดสต๊อกตามยอดขาย",
      sub:
        hub.staleDays > 0
          ? `${hub.staleDays} วันควรตัดใหม่ (สูตรเปลี่ยน)`
          : hub.unpostedDays > 0
            ? `${hub.unpostedDays} วันยังไม่ได้ตัด`
            : "ตัดครบแล้ว · ตัดให้เองตอนนำเข้า",
      show: can("consumption:post"),
      alert: hub.staleDays > 0 || hub.unpostedDays > 0,
    },
    { href: `/stock/history?branch=${branch.id}`, title: "ประวัติการเคลื่อนไหว", sub: "ทุกรายการ แก้ไม่ได้", show: true },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">งานสต๊อก</h2>
          <p className="mt-1 text-sm text-muted-foreground">ของเข้า-ออกที่ไม่ได้มาจากการซื้อหรือการขาย บันทึกที่นี่ · ดูรายการสินค้าและยอดคงเหลือที่หน้าสินค้า/วัตถุดิบ</p>
        </div>
        {branches.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {branches.map((b) => (
              <a
                key={b.id}
                href={`/stock?branch=${b.id}`}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${
                  b.id === branch.id ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"
                }`}
              >
                {b.name}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Part 18 Q8: the receiving half of a transfer appears where the branch looks every day. */}
      <IncomingTransfers transfers={incoming} branchName={branch.name} variant="quiet" />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {tiles
          .filter((t) => t.show)
          .map((t) => (
            <a
              key={t.title}
              href={t.href}
              className={`grid gap-0.5 rounded-2xl border p-3.5 transition hover:-translate-y-px hover:shadow-card ${
                t.main ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-muted/40"
              }`}
            >
              <span className="font-display font-semibold">{t.title}</span>
              <span className={`text-xs ${t.main ? "text-primary-foreground/80" : t.alert ? "font-medium text-warn" : "text-muted-subtle"}`}>{t.sub}</span>
            </a>
          ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">เคลื่อนไหวล่าสุดของ{branch.name}</h3>
            <a href={`/stock/history?branch=${branch.id}`} className="text-xs text-primary hover:underline">
              ดูทั้งหมด
            </a>
          </div>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">ยังไม่มีของเข้า-ออกที่สาขานี้</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {recent.map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <a href={`/products?product=${m.product.id}`} className="font-medium hover:text-primary hover:underline">
                      {m.product.name}
                    </a>
                    <span className="text-muted-foreground"> · {label(MOVEMENT_TYPE_LABELS_TH, m.type)}</span>
                    <span className="block text-xs text-muted-subtle">
                      {label(SOURCE_TYPE_LABELS_TH, m.sourceType)} · {day(m.date)}
                      {m.by ? ` · ${m.by}` : ""}
                    </span>
                  </span>
                  <span className={`whitespace-nowrap tabular-nums ${m.qty < 0 ? "text-bad" : "text-good"}`}>
                    {qty(m.qty)} {unitTh(m.product.unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid content-start gap-4">
          {value !== null && (
            <a href="/products?sort=value" className="block rounded-2xl border border-border bg-surface p-4 hover:bg-muted/40">
              <span className="text-xs text-muted-subtle">มูลค่าสต๊อก{branch.name} · ตามราคาทุน (FIFO)</span>
              <span className="block font-display text-2xl font-semibold tabular-nums">{baht(value)}</span>
              <span className="text-xs text-primary">ดูรายการเรียงตามมูลค่า ›</span>
            </a>
          )}
          <section className="rounded-2xl border border-border bg-surface p-4">
            <h3 className="font-semibold">ต้องดู</h3>
            {low === 0 && near === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">ไม่มีของต่ำกว่าหรือใกล้ขั้นต่ำ</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {low > 0 && (
                  <a href="/products?filter=low" className="whitespace-nowrap rounded-full bg-bad-bg px-3 py-1 text-sm text-bad hover:underline">
                    ต่ำกว่าขั้นต่ำ {low}
                  </a>
                )}
                {near > 0 && (
                  <a href="/products?filter=near" className="whitespace-nowrap rounded-full border border-warn-border bg-warn-bg px-3 py-1 text-sm text-warn hover:underline">
                    ใกล้ขั้นต่ำ {near}
                  </a>
                )}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-subtle">กดแล้วไปหน้าสินค้าที่กรองไว้ — ขอซื้อได้จากตรงนั้น</p>
          </section>
        </div>
      </div>
    </div>
  );
}

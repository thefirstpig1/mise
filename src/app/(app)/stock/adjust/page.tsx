// Sprint 2 Part 10 L5a — the manual stock-adjustment page.
//
// Server Component: auth, reference data, and the Bangkok "today" the form
// needs. Everything handed to the client is a plain shape — ProductUnit
// carries a Decimal (toBaseRatio), which cannot cross to a Client Component
// (Pitfall #20), so it is stringified here.
//
// `todayBangkok` is computed on the server on purpose: the zod backdate window
// is checked against BANGKOK today, so a device in another timezone would
// otherwise be offered a date the server rejects (Decision #60).

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getProductsLogic } from "@/server/product";
import { getBranchesLogic } from "@/server/branch";
import { getRecentMovementsLogic } from "@/server/product-list";
import { ADJUSTMENT_TYPE_LABELS_TH } from "@/lib/validations/stock-movement";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";
import { createStockAdjustmentAction } from "../actions";
import StockAdjustForm, {
  type StockBranchOption,
  type StockProductOption,
} from "../_components/StockAdjustForm";

import EmptyState from "@/components/ui/EmptyState";
export default async function StockAdjustPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const { tenantId, reach, can } = await requireTenant("stock:write");
  const sp = await searchParams;

  const [products, branches] = await Promise.all([
    getProductsLogic(tenantId),
    getBranchesLogic(tenantId, reach),
  ]);
  const initialBranchId = branches.find((b) => b.id === sp.branch)?.id ?? branches[0]?.id;
  // Kong 2026-10-25: what was adjusted lately, beside the form — so nobody
  // records the same correction twice.
  const recent = initialBranchId ? await getRecentMovementsLogic(tenantId, null, initialBranchId, 10, "ADJUSTMENT") : [];

  // getProductsLogic orders by category tree (built for the product page); a
  // picker reads better by name.
  const productOptions: StockProductOption[] = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      imageUrl: p.imageUrl,
      section: p.category?.accountingSection ?? null,
      group: p.category?.groupName ?? null,
      baseUnitName: p.productUnits.find((u) => u.isBase)?.unitName ?? null,
      units: p.productUnits
        .map((u) => ({
          id: u.id,
          unitName: u.unitName,
          toBaseRatio: u.toBaseRatio.toString(),
          isBase: u.isBase,
        }))
        // Base unit first — it is the unit stock is counted in.
        .sort((a, b) => Number(b.isBase) - Number(a.isBase)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  const branchOptions: StockBranchOption[] = branches.map((b) => ({
    id: b.id,
    name: b.name,
  }));

  const todayBangkok = computeBangkokToday().toISOString().slice(0, 10);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">ปรับสต๊อก</h2>
        {/* Part 17 Q4 retired ของเสีย/ของชำรุด from this form; this line still
            advertised them, which is worse than a stale comment — it promises
            the user an option that is not in the dropdown below it. */}
        <p className="mt-1 text-sm text-muted-foreground">
          แก้ตัวเลขให้ตรงกับของจริง เมื่อนับใหม่แล้วไม่ตรง หรือคีย์ผิด —
          ทุกการปรับจะถูกบันทึกถาวรและแก้ไม่ได้ หากบันทึกผิดให้บันทึกรายการปรับกลับ
        </p>
      </div>

      {productOptions.length === 0 ? (
        <EmptyState art="setup">
          ยังไม่มีวัตถุดิบในระบบ —{" "}
          <a href="/products/new" className="text-primary hover:underline">
            เพิ่มวัตถุดิบก่อน
          </a>
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <StockAdjustForm
            action={createStockAdjustmentAction}
            products={productOptions}
            branches={branchOptions}
            todayBangkok={todayBangkok}
            canSeeCost={can("cost:view")}
            initialBranchId={initialBranchId}
          />
          <aside className="h-fit rounded-[18px] border border-border/70 bg-surface shadow-card p-4 text-sm">
            <h3 className="font-semibold">ปรับล่าสุด · {branches.find((b) => b.id === initialBranchId)?.name}</h3>
            {recent.length === 0 ? (
              <p className="mt-1 text-muted-foreground">ยังไม่เคยปรับสต๊อกที่สาขานี้</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {recent.map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-2 py-1.5">
                    <span className="min-w-0">
                      {m.product.name}
                      <span className="block text-xs text-muted-subtle">
                        {ADJUSTMENT_TYPE_LABELS_TH[m.type as keyof typeof ADJUSTMENT_TYPE_LABELS_TH] ?? m.type} ·{" "}
                        {new Date(`${m.date}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" })}
                        {m.by ? ` · ${m.by}` : ""}
                      </span>
                    </span>
                    <span className={`whitespace-nowrap tabular-nums ${m.qty < 0 ? "text-bad" : "text-good"}`}>
                      {m.qty > 0 ? "+" : ""}
                      {m.qty.toLocaleString("th-TH", { maximumFractionDigits: 3 })} {unitTh(m.product.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-subtle">ดูก่อนบันทึก — กันปรับซ้ำ</p>
          </aside>
        </div>
      )}
    </div>
  );
}

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
import { createStockAdjustmentAction, getStockBalanceAction } from "../actions";
import { getProductCostAction } from "@/app/cost/actions";
import StockAdjustForm, {
  type StockBranchOption,
  type StockProductOption,
} from "../_components/StockAdjustForm";

export default async function StockAdjustPage() {
  const { tenantId } = await requireTenant();

  const [products, branches] = await Promise.all([
    getProductsLogic(tenantId),
    getBranchesLogic(tenantId),
  ]);

  // getProductsLogic orders by category tree (built for the product page); a
  // picker reads better by name.
  const productOptions: StockProductOption[] = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">ปรับสต๊อก</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          บันทึกการนับสต๊อกใหม่ ของเสีย หรือของชำรุด — ทุกการปรับจะถูกบันทึกถาวร
          และแก้ไม่ได้ หากบันทึกผิดให้บันทึกรายการปรับกลับ
        </p>
      </div>

      {productOptions.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
          ยังไม่มีวัตถุดิบในระบบ —{" "}
          <a href="/products/new" className="text-primary hover:underline">
            เพิ่มวัตถุดิบก่อน
          </a>
        </div>
      ) : (
        <StockAdjustForm
          action={createStockAdjustmentAction}
          products={productOptions}
          branches={branchOptions}
          todayBangkok={todayBangkok}
          fetchBalance={getStockBalanceAction}
          fetchCost={getProductCostAction}
        />
      )}
    </div>
  );
}

// Sprint 2 Part 14 L5b — one product's cost at one branch (ADR 0014 Q11).
//
// Server Component. The branch lives in the URL (`?branch=`) exactly as /stock
// does, so the view is linkable and revalidatePath("/cost") refreshes what the
// user is looking at.
//
// `params` and `searchParams` are PROMISES in Next 15 — the plain-object
// signature type-checks under `pnpm tsc` and fails `pnpm build` (Part 10 L5a).

import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getProductByIdLogic } from "@/server/product";
import { getProductCostLogic } from "@/server/stock-cost";
import { getProductCostQuerySchema } from "@/lib/validations/stock-cost";
import { formatMoney, formatQty, toProductCostView } from "../_components/cost-view";
import CostLayerTable from "../_components/CostLayerTable";

export default async function ProductCostPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { productId } = await params;
  const { branch: branchParam } = await searchParams;

  const [product, branches] = await Promise.all([
    getProductByIdLogic(tenantId, productId),
    getBranchesLogic(tenantId),
  ]);

  if (!product) notFound();
  if (branches.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
        ยังไม่มีสาขาในระบบ
      </div>
    );
  }

  // An unknown or foreign branch id falls back to the first branch; it never
  // reaches the query unvalidated (the /stock rule).
  const activeBranch = branches.find((b) => b.id === branchParam) ?? branches[0];

  const cost = toProductCostView(
    await getProductCostLogic(
      tenantId,
      getProductCostQuerySchema.parse({
        productId: product.id,
        branchId: activeBranch.id,
      })
    )
  );

  const baseUnit = product.productUnits.find((u) => u.isBase);
  const baseUnitName = baseUnit?.unitName ?? "";
  const units = product.productUnits.map((u) => ({
    id: u.id,
    unitName: u.unitName,
    isBase: u.isBase,
  }));

  return (
    <div className="space-y-6">
      <div>
        <a href="/stock" className="text-sm text-muted-foreground hover:text-foreground">
          ← กลับไปหน้าสต๊อก
        </a>
        <h2 className="mt-1 text-base font-semibold">
          {product.name}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {product.sku}
          </span>
        </h2>
      </div>

      {branches.length > 1 && (
        <form method="get" className="flex items-end gap-3">
          <div>
            <label htmlFor="branch" className="block text-sm font-medium">
              สาขา
            </label>
            <select
              id="branch"
              name="branch"
              defaultValue={activeBranch.id}
              className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
          >
            ดูสาขานี้
          </button>
        </form>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">ต้นทุนต่อ {baseUnitName}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatMoney(cost.costPerBaseUnit)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{cost.costSourceHint}</p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">คงเหลือ</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${cost.negativeStock ? "text-red-700" : ""}`}
          >
            {formatQty(cost.qtyOnHand)}{" "}
            <span className="text-sm font-normal">{baseUnitName}</span>
          </p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">มูลค่าของคงเหลือ</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatMoney(cost.inventoryValue)}
          </p>
          {/* Summed layer by layer — cost × qty would be a different, wrong number. */}
          <p className="mt-1 text-xs text-muted-foreground">รวมทุกล็อตที่ยังเหลือ</p>
        </div>
      </div>

      {cost.negativeStock && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          สต๊อกติดลบ — มีการตัดของออกมากกว่าที่บันทึกรับเข้ามา
          ตรวจสอบว่ามีใบรับของที่ยังไม่ได้คีย์หรือไม่ ตัวเลขจะกลับมาถูกเองเมื่อคีย์ครบ
        </div>
      )}

      {cost.hasUnpricedLayers && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          มีของบางล็อตที่ยังไม่ทราบต้นทุน — กด &ldquo;ระบุต้นทุน&rdquo; ในตารางด้านล่างเพื่อใส่ราคาที่ถูกต้อง
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium">ล็อตที่ยังเหลืออยู่</h3>
        <CostLayerTable
          layers={cost.layers}
          units={units}
          baseUnitName={baseUnitName}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          ระบบตัดของแบบเข้าก่อน-ออกก่อน (FIFO) — ต้นทุนที่แสดงด้านบนคือราคาของล็อตบนสุด
          ซึ่งเป็นล็อตที่จะถูกใช้เป็นลำดับถัดไป
        </p>
      </div>
    </div>
  );
}

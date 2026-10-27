// Sprint 2 Part 10 L5c — the ledger history page.
//
// Filters are a plain GET form: the state lives in the URL, so a filtered view
// is linkable and the back button behaves. The first page is fetched here on the
// server; the client component pages on from `nextCursor` via the L4 action,
// replaying these same filters.
//
// `searchParams` is a Promise in Next 15 (see the login fix `a669e05`).

import { requireTenant } from "@/lib/require-tenant";
import { getBranchesLogic } from "@/server/branch";
import { getProductsLogic } from "@/server/product";
import ProductFilter from "./_components/ProductFilter";
import { getStockBalanceLogic, getStockMovementHistoryLogic } from "@/server/stock-movement";
import { getStockCardLogic } from "@/server/stock-card";
import { getProductCostLogic } from "@/server/stock-cost";
import { getProductCostQuerySchema } from "@/lib/validations/stock-cost";
import { toProductCostView } from "@/app/(app)/cost/_components/cost-view";
import CostLayerTable from "@/app/(app)/cost/_components/CostLayerTable";
import StockCardTable from "./_components/StockCardTable";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getStockMovementHistoryQuerySchema, MOVEMENT_ORIGINS, MOVEMENT_ORIGIN_VALUES } from "@/lib/validations/stock-movement";
import { toStockMovementView } from "../_components/stock-view";
import StockMovementHistory, {
  type HistoryFilter,
} from "../_components/StockMovementHistory";


export default async function StockHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    product?: string;
    branch?: string;
    type?: string;
    source?: string;
    origin?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { tenantId, reach, costAccess } = await requireTenant("any:member");
  const sp = await searchParams;

  // The URL is user-editable, so it is parsed, not trusted. A malformed filter
  // falls back to the unfiltered feed rather than erroring the page — the query
  // string is navigation, not a form the user is filling in.
  const parsed = getStockMovementHistoryQuerySchema.safeParse({
    productId: sp.product,
    branchId: sp.branch,
    type: sp.type,
    sourceType: sp.source,
    origin: sp.origin,
    dateFrom: sp.from,
    dateTo: sp.to,
  });
  const query = parsed.success
    ? parsed.data
    : getStockMovementHistoryQuerySchema.parse({});

  const [products, branches] = await Promise.all([getProductsLogic(tenantId), getBranchesLogic(tenantId, reach)]);

  // Kong 2026-10-25: one product at one branch IS a stock card — the kardex,
  // balance after every row. With several branches in reach a card needs one named.
  const cardBranchId = query.productId ? (query.branchId ?? (branches.length === 1 ? branches[0].id : null)) : null;
  const today = computeBangkokToday();
  const cardFrom = query.dateFrom ?? addDays(today, -30);
  const cardTo = query.dateTo ?? today;
  // Document-page review 2026-10-27: the stock that arrived without a price
  // (an upward adjustment, an opening balance) is priced HERE, on the card,
  // instead of on /cost/[productId], which no page linked to. Cost readers only.
  const [page, card, onHand, layerCost] = await Promise.all([
    cardBranchId ? Promise.resolve(null) : getStockMovementHistoryLogic(tenantId, query, reach),
    cardBranchId
      ? getStockCardLogic(tenantId, { productId: query.productId!, branchId: cardBranchId, from: cardFrom, to: cardTo, withCost: costAccess !== null })
      : Promise.resolve(null),
    cardBranchId ? getStockBalanceLogic(tenantId, { productId: query.productId!, branchId: cardBranchId }).then((b) => Number(b.balance)).catch(() => null) : Promise.resolve(null),
    cardBranchId && costAccess
      ? getProductCostLogic(
          tenantId,
          getProductCostQuerySchema.parse({ productId: query.productId!, branchId: cardBranchId })
        ).then(toProductCostView)
      : Promise.resolve(null),
  ]);
  const guessed = layerCost?.layers.filter((l) => l.pricing === "LAST_KNOWN" || l.pricing === "UNPRICED") ?? [];
  const cardProduct = query.productId ? products.find((p) => p.id === query.productId) : undefined;

  // Only the filters the schema accepted are replayed for the next page.
  const filter: HistoryFilter = {
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    ...(query.origin ? { origin: query.origin } : {}),
    ...(query.dateFrom ? { dateFrom: query.dateFrom.toISOString() } : {}),
    ...(query.dateTo ? { dateTo: query.dateTo.toISOString() } : {}),
  };

  const asDateValue = (d: Date | undefined) =>
    d ? d.toISOString().slice(0, 10) : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">ประวัติการเคลื่อนไหว</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            บันทึกถาวร แก้ไขหรือลบไม่ได้ — การแก้ทำโดยบันทึกรายการปรับกลับ · เลือกวัตถุดิบตัวเดียว = บัตรสต๊อก พร้อมยอดคงเหลือ
          </p>
        </div>
        <a
          href="/stock"
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
        >
          งานสต๊อก
        </a>
      </div>

      {!parsed.success && (
        <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          เงื่อนไขการค้นหาใน URL ไม่ถูกต้อง — แสดงรายการทั้งหมดแทน
        </div>
      )}

      <form
        method="get"
        action="/stock/history"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3"
      >
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          วัตถุดิบ
          <ProductFilter
            initial={sp.product ?? ""}
            products={products.map((p) => ({
              id: p.id,
              name: p.name,
              sku: p.sku,
              imageUrl: p.imageUrl,
              section: p.category?.accountingSection ?? null,
              group: p.category?.groupName ?? null,
              baseUnitName: p.productUnits.find((u) => u.isBase)?.unitName ?? null,
            }))}
          />
        </div>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          สาขา
          <select name="branch" defaultValue={sp.branch ?? ""} className="input">
            <option value="">ทั้งหมด</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        {/* Kong 2026-10-25: one "เกิดจาก" instead of ประเภท + แหล่งที่มา, which overlapped. */}
        <fieldset className="flex w-full flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <legend className="sr-only">เกิดจาก</legend>
          <span className="mr-1">เกิดจาก</span>
          {([["", "ทั้งหมด"], ...MOVEMENT_ORIGIN_VALUES.map((o) => [o, MOVEMENT_ORIGINS[o].label] as const)] as const).map(([v, l]) => (
            <label
              key={v || "all"}
              className="cursor-pointer whitespace-nowrap rounded-full border border-border-strong bg-surface px-3 py-1 text-sm text-foreground has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
            >
              <input type="radio" name="origin" value={v} defaultChecked={(query.origin ?? "") === v} className="sr-only" />
              {l}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          ตั้งแต่
          <input
            type="date"
            name="from"
            defaultValue={asDateValue(query.dateFrom ?? (query.productId ? cardFrom : undefined))}
            className="input"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          ถึง
          <input
            type="date"
            name="to"
            defaultValue={asDateValue(query.dateTo ?? (query.productId ? cardTo : undefined))}
            className="input"
          />
        </label>

        <button
          type="submit"
          className="btn"
        >
          กรอง
        </button>
        <a
          href="/stock/history"
          className="px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          ล้าง
        </a>
      </form>

      {query.productId && !cardBranchId && (
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">เลือกสาขาเพื่อดูบัตรสต๊อกของวัตถุดิบนี้ (ยอดคงเหลือนับแยกสาขา)</p>
      )}
      {card ? (
        <section className="space-y-2">
          <h3 className="font-semibold">
            บัตรสต๊อก · {card.product.name} · {branches.find((b) => b.id === cardBranchId)?.name}
          </h3>
          {guessed.length > 0 && cardProduct && (
            <div className="space-y-2 rounded-xl border border-warn-border bg-warn-bg p-4">
              <p className="font-semibold text-warn">ของที่ยังไม่รู้ต้นทุน · {guessed.length} ล็อต</p>
              <p className="text-sm text-warn">
                เข้ามาโดยไม่มีบิล (ปรับสต๊อกเพิ่ม · นับได้เกิน · ยอดยกมา) ตอนนี้ระบบใช้ราคาล่าสุดแทนไปก่อน ·
                ล็อตจากการปรับสต๊อกกด &ldquo;ระบุต้นทุน&rdquo; ได้เมื่อเจอบิล แล้วต้นทุนย้อนหลังจะคิดใหม่ให้ ·
                ล็อตจากการนับได้เกินใช้ราคาล่าสุดเสมอ
              </p>
              <div className="rounded-lg bg-surface">
                <CostLayerTable
                  layers={guessed}
                  units={cardProduct.productUnits.map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase }))}
                  baseUnitName={cardProduct.productUnits.find((u) => u.isBase)?.unitName ?? ""}
                />
              </div>
            </div>
          )}
          <StockCardTable
            card={card}
            from={cardFrom.toISOString().slice(0, 10)}
            to={cardTo.toISOString().slice(0, 10)}
            onHandNow={onHand}
            showCost={costAccess !== null}
            originSources={query.origin ? MOVEMENT_ORIGINS[query.origin].sources : null}
          />
        </section>
      ) : page ? (
        <StockMovementHistory
          initialRows={page.rows.map(toStockMovementView)}
          initialCursor={page.nextCursor}
          filter={filter}
        />
      ) : null}
    </div>
  );
}

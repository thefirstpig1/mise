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
import { getStockMovementHistoryLogic } from "@/server/stock-movement";
import {
  getStockMovementHistoryQuerySchema,
  MOVEMENT_TYPE_LABELS_TH,
  MOVEMENT_TYPE_VALUES,
  SOURCE_TYPE_LABELS_TH,
  SOURCE_TYPE_VALUES,
} from "@/lib/validations/stock-movement";
import { toStockMovementView } from "../_components/stock-view";
import StockMovementHistory, {
  type HistoryFilter,
} from "../_components/StockMovementHistory";

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

export default async function StockHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    product?: string;
    branch?: string;
    type?: string;
    source?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { tenantId } = await requireTenant();
  const sp = await searchParams;

  // The URL is user-editable, so it is parsed, not trusted. A malformed filter
  // falls back to the unfiltered feed rather than erroring the page — the query
  // string is navigation, not a form the user is filling in.
  const parsed = getStockMovementHistoryQuerySchema.safeParse({
    productId: sp.product,
    branchId: sp.branch,
    type: sp.type,
    sourceType: sp.source,
    dateFrom: sp.from,
    dateTo: sp.to,
  });
  const query = parsed.success
    ? parsed.data
    : getStockMovementHistoryQuerySchema.parse({});

  const [products, branches, page] = await Promise.all([
    getProductsLogic(tenantId),
    getBranchesLogic(tenantId),
    getStockMovementHistoryLogic(tenantId, query),
  ]);

  // Only the filters the schema accepted are replayed for the next page.
  const filter: HistoryFilter = {
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.sourceType ? { sourceType: query.sourceType } : {}),
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
            บันทึกถาวร แก้ไขหรือลบไม่ได้ — การแก้ทำโดยบันทึกรายการปรับกลับ
          </p>
        </div>
        <a
          href="/stock"
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/40"
        >
          ยอดคงเหลือ
        </a>
      </div>

      {!parsed.success && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          เงื่อนไขการค้นหาใน URL ไม่ถูกต้อง — แสดงรายการทั้งหมดแทน
        </div>
      )}

      <form
        method="get"
        action="/stock/history"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3"
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          วัตถุดิบ
          <select name="product" defaultValue={sp.product ?? ""} className={inputClass}>
            <option value="">ทั้งหมด</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          สาขา
          <select name="branch" defaultValue={sp.branch ?? ""} className={inputClass}>
            <option value="">ทั้งหมด</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          ประเภท
          <select name="type" defaultValue={sp.type ?? ""} className={inputClass}>
            <option value="">ทั้งหมด</option>
            {MOVEMENT_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {MOVEMENT_TYPE_LABELS_TH[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          แหล่งที่มา
          <select name="source" defaultValue={sp.source ?? ""} className={inputClass}>
            <option value="">ทั้งหมด</option>
            {SOURCE_TYPE_VALUES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_TYPE_LABELS_TH[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          ตั้งแต่
          <input
            type="date"
            name="from"
            defaultValue={asDateValue(query.dateFrom)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          ถึง
          <input
            type="date"
            name="to"
            defaultValue={asDateValue(query.dateTo)}
            className={inputClass}
          />
        </label>

        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
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

      <StockMovementHistory
        initialRows={page.rows.map(toStockMovementView)}
        initialCursor={page.nextCursor}
        filter={filter}
      />
    </div>
  );
}

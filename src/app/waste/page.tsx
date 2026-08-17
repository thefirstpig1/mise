// Sprint 3 Part 17 L5a — /waste: record something thrown away, and see what has been.
//
// Server Component. A route of its own rather than a corner of /stock/adjust
// (ADR 0017 Q7): waste is entered from the kitchen, often on a phone, and it
// should be two taps from the dashboard.
//
// Filters live in the URL (`?branch=&reason=&voided=`) so the view is linkable
// and `revalidatePath("/waste")` from the L4 write path refreshes whatever the
// user is actually looking at.
//
// `searchParams` is a PROMISE in Next 15 — the plain-object signature
// type-checks under `pnpm tsc` and fails `pnpm build` (Sprint 0's fix, `a669e05`).

import { requireTenant } from "@/lib/require-tenant";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { getProductsLogic } from "@/server/product";
import { getBranchesLogic } from "@/server/branch";
import { MAX_WASTE_ROWS, getWasteLogsLogic } from "@/server/waste";
import { getWasteQuerySchema, WASTE_REASON_LABELS_TH, WASTE_REASON_VALUES } from "@/lib/validations/waste";
import { createWasteAction, voidWasteAction } from "./actions";
import { toWasteLogView } from "./_components/waste-view";
import WasteEntryForm, {
  type WasteBranchOption,
  type WasteProductOption,
} from "./_components/WasteEntryForm";
import VoidWasteButton from "./_components/VoidWasteButton";

const inputClass =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

/**
 * A serialized row's `reason` is a plain string (the view layer stays
 * structural), so the lookup falls back to the raw value rather than casting.
 * Same helper, and same reason, as StockMovementHistory.tsx:37.
 */
const label = (map: Record<string, string>, key: string): string => map[key] ?? key;

/**
 * The list defaults to THIS MONTH, not to all of history (UX pass).
 *
 * "Everything ever" is the wrong question for a waste log — nobody reads it, and
 * it grows without bound. The month is the period a shop actually reviews, and it
 * matches the counting cycle the par design already rests on (ADR 0017 Q6b).
 * Both ends are shown in the filter form, so the narrowing is visible rather than
 * a silent truncation.
 */
function currentMonthBangkok(): { from: string; to: string } {
  const today = computeBangkokToday();
  const first = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  );
  return {
    from: first.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

/**
 * `occurredAt` is filtered with `lte`, and the form posts a DATE — which coerces
 * to that day's midnight. Without this, "to = today" would exclude everything
 * logged today with a real instant behind it.
 */
const endOfDay = (isoDate: string): Date =>
  new Date(`${isoDate}T23:59:59.999Z`);

export default async function WastePage({
  searchParams,
}: {
  searchParams: Promise<{
    branch?: string;
    product?: string;
    reason?: string;
    voided?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { tenantId } = await requireTenant();
  const sp = await searchParams;

  const [products, branches] = await Promise.all([
    getProductsLogic(tenantId),
    getBranchesLogic(tenantId),
  ]);

  const month = currentMonthBangkok();
  const fromParam = sp.from || month.from;
  const toParam = sp.to || month.to;

  const query = getWasteQuerySchema.safeParse({
    branchId: sp.branch,
    productId: sp.product,
    reason: sp.reason,
    includeVoided: sp.voided,
    from: fromParam,
    to: endOfDay(toParam),
  });

  const fetched = query.success
    ? (await getWasteLogsLogic(tenantId, query.data)).map(toWasteLogView)
    : [];
  const truncated = fetched.length > MAX_WASTE_ROWS;
  const rows = truncated ? fetched.slice(0, MAX_WASTE_ROWS) : fetched;

  // getProductsLogic orders by the category tree (built for the product page);
  // a picker reads better by name.
  const productOptions: WasteProductOption[] = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      baseUnitName: p.productUnits.find((u) => u.isBase)?.unitName ?? null,
      units: p.productUnits
        .map((u) => ({ id: u.id, unitName: u.unitName, isBase: u.isBase }))
        // Base unit first — the unit stock is kept in.
        .sort((a, b) => Number(b.isBase) - Number(a.isBase)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  const branchOptions: WasteBranchOption[] = branches.map((b) => ({
    id: b.id,
    name: b.name,
  }));

  const todayBangkok = computeBangkokToday().toISOString().slice(0, 10);
  const showingVoided = query.success && query.data.includeVoided;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">บันทึกของเสีย</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ของที่ทิ้งไปแล้วจริง ๆ — เน่าเสีย ตกแตก ทำไหม้ ลูกค้าตีกลับ
          บันทึกทีละอย่างแล้วตัดสต๊อกทันที
        </p>
      </div>

      {productOptions.length === 0 || branchOptions.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm">
          ยังไม่มีวัตถุดิบหรือสาขาในระบบ —{" "}
          <a href="/products/new" className="text-primary hover:underline">
            เพิ่มวัตถุดิบก่อน
          </a>
        </div>
      ) : (
        <section className="rounded-xl border border-border bg-card p-5">
          <WasteEntryForm
            action={createWasteAction}
            products={productOptions}
            branches={branchOptions}
            todayBangkok={todayBangkok}
            defaultBranchId={branchOptions[0].id}
          />
        </section>
      )}

      <section className="space-y-3">
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold">รายการที่บันทึกไว้</h3>
            {/* Scale, in rows. The BAHT lives on /cost — quantities here are in
                each product's own unit, so summing them would invent a number
                that means nothing ("3 กระสอบ + 5 kg" is not 8 of anything). */}
            <p className="text-sm text-muted-foreground">
              {rows.length} รายการ ·{" "}
              <a href="/cost" className="text-primary hover:underline">
                ดูมูลค่าเป็นบาทที่หน้าต้นทุน
              </a>
            </p>
          </div>

          {/* GET form: the filters belong in the URL, not in component state. */}
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              name="from"
              defaultValue={fromParam}
              className={inputClass}
              aria-label="ตั้งแต่วันที่"
            />
            <span className="text-sm text-muted-foreground">ถึง</span>
            <input
              type="date"
              name="to"
              defaultValue={toParam}
              className={inputClass}
              aria-label="ถึงวันที่"
            />
            <select name="branch" defaultValue={sp.branch ?? ""} className={inputClass}>
              <option value="">ทุกสาขา</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <select name="product" defaultValue={sp.product ?? ""} className={inputClass}>
              <option value="">ทุกวัตถุดิบ</option>
              {productOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select name="reason" defaultValue={sp.reason ?? ""} className={inputClass}>
              <option value="">ทุกสาเหตุ</option>
              {WASTE_REASON_VALUES.map((r) => (
                <option key={r} value={r}>
                  {WASTE_REASON_LABELS_TH[r]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="voided"
                value="true"
                defaultChecked={showingVoided}
              />
              แสดงรายการที่ยกเลิกแล้ว
            </label>
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              กรอง
            </button>
          </form>
        </div>

        {truncated && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            แสดง {MAX_WASTE_ROWS} รายการแรกของช่วงนี้เท่านั้น — ลองแคบช่วงวันที่
            หรือเลือกวัตถุดิบ เพื่อให้เห็นครบ
          </p>
        )}

        {rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
            ไม่มีรายการของเสียในช่วงวันที่นี้ — ลองขยายช่วงวันที่ดู
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const isVoided = row.voidedAt !== null;
              return (
                <li
                  key={row.id}
                  className={`rounded-lg border p-4 text-sm ${
                    isVoided || row.isReversal
                      ? "border-border bg-muted/30 text-muted-foreground"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {row.product.name}
                    </span>
                    <span className="font-medium">
                      {row.inputQty} {row.inputUnitName}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>{label(WASTE_REASON_LABELS_TH, row.reason)}</span>
                    <span>{row.occurredAtLabel}</span>
                    <span>{row.branch.name}</span>
                    {/* Who actually did it, falling back to the account (Q7). */}
                    <span>{row.wastedByName ?? row.wastedByAccount}</span>
                    {row.isReversal && (
                      <span className="font-medium">รายการคืนของ</span>
                    )}
                    {isVoided && (
                      <span className="font-medium text-red-700">
                        ยกเลิกแล้ว — {row.voidReason}
                      </span>
                    )}
                  </div>

                  {row.notes && (
                    <p className="mt-1 text-xs text-muted-foreground">{row.notes}</p>
                  )}

                  {/* A reversal is not itself voidable, and a voided row is done. */}
                  {!isVoided && !row.isReversal && (
                    <VoidWasteButton
                      action={voidWasteAction}
                      wasteId={row.id}
                      label={`${row.inputQty} ${row.inputUnitName} ${row.product.name}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

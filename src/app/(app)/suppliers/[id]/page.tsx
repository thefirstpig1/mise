// Sprint 1 Part 5, Step 7.5 — one supplier.
// Review 2026-10-27 (Kong, mockup 5sMMvLFbYSjsXDVpZirBXM): the page opened on
// an edit form and said "ยังไม่มีประวัติราคา" for a supplier with fifteen
// receipts. It now answers what an owner asks first — what we owe them, what is
// still coming, how much we buy, whether they deliver on time, and what we buy
// at what price (catalog cards, prices PAID) — with the edit form folded below
// and deleting at the bottom. Money is shown only to a reader allowed it:
// bills need expense:view, prices and spend need cost:view.
//
// Part 9 L5c's price-list and price-history views stay, inside the fold.
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { requireTenant } from "@/lib/require-tenant";
import { getSupplierByIdLogic } from "@/server/supplier";
import { getSupplierOverviewLogic } from "@/server/supplier-overview";
import {
  getSupplierMappingsLogic,
  getPriceHistoryLogic,
} from "@/server/supplier-product-mapping";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { monthLabelTh } from "@/lib/expense-labels";
import ProductThumb from "@/components/ui/ProductThumb";
import { updateSupplier } from "../actions";
import SupplierForm from "../_components/SupplierForm";
import DeleteSupplierButton from "../_components/DeleteSupplierButton";
import { toSupplierView } from "../_components/supplier-view";
// Shared mapping UI lives under products/_components (generalized in L5c). The
// `_components` folder is a private-folder convention, not an import boundary —
// importing across routes is fine.
import MappingListSection from "../../products/_components/MappingListSection";
import MappingHistoryViewer from "../../products/_components/MappingHistoryViewer";
import {
  toMappingView,
  seriesKeyOf,
  type PriceHistorySeries,
} from "../../products/_components/mapping-view";

const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const price = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayTh = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const PO_STATUS: Record<string, string> = { DRAFT: "ร่าง", SENT: "ส่งแล้ว", PARTIALLY_RECEIVED: "รับบางส่วน" };

// Next 15: route params are async (await before use).
export default async function SupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId, can, reach, membership } = await requireTenant("master:write");
  const seeCost = can("cost:view");
  const seeBills = can("expense:view");

  const [supplier, mappings, overview] = await Promise.all([
    getSupplierByIdLogic(tenantId, id),
    // L5b/L5c: "all" = live mappings of this supplier incl. orphans whose product
    // is soft-deleted (still live rows). Feeds BOTH the delete blast-radius dialog
    // and the read-only price list below.
    getSupplierMappingsLogic(tenantId, id, "all"),
    getSupplierOverviewLogic(tenantId, id, reach),
  ]);
  if (!supplier) notFound();

  const mappingViews = mappings.map(toMappingView);

  // Price history (L5c): one series per distinct (product, branch) tuple for THIS
  // supplier — the supplier-perspective mirror of the product page's per-supplier
  // series. getPriceHistoryLogic returns ALL rows incl. soft-deleted (audit
  // trail, Q9), newest first. Tuples are few, so per-tuple Promise.all is fine.
  const tuples = new Map<
    string,
    { productId: string; branchId: string | null }
  >();
  for (const m of mappings) {
    const key = seriesKeyOf(m.productId, m.branchId);
    if (!tuples.has(key)) {
      tuples.set(key, { productId: m.productId, branchId: m.branchId });
    }
  }
  const histories = await Promise.all(
    [...tuples.values()].map((t) =>
      getPriceHistoryLogic(tenantId, t.productId, id, t.branchId)
    )
  );
  const series: PriceHistorySeries[] = histories
    .filter((rows) => rows.length > 0)
    .map((rows) => {
      const views = rows.map(toMappingView);
      const head = views[0];
      return {
        key: seriesKeyOf(head.productId, head.branchId),
        supplier: head.supplier,
        product: head.product,
        branch: head.branch,
        rows: views,
      };
    });

  // L5b: blast-radius items for the delete dialog — built from the serialized
  // views (no extra query, no raw Decimal). primaryLabel = product (the "other
  // side" on a supplier page); priceLabel mirrors MappingListSection's format.
  const cascadeItems = mappingViews.map((m) => ({
    id: m.id,
    primaryLabel: m.product?.name ?? "(ไม่ทราบ)",
    secondaryLabel: m.branch ? m.branch.name : "ทุกสาขา",
    priceLabel:
      m.currentUnitPrice === null
        ? "—"
        : `฿${m.currentUnitPrice}${m.orderUnit ? ` / ${m.orderUnit.name}` : ""}`,
  }));

  const today = computeBangkokToday().toISOString().slice(0, 10);
  const o = overview;
  const canOrder = supplier.isActive && can("purchase:write");
  const shortName = supplier.nameShort ?? supplier.nameFull;
  const [thisMonth, prevMonth] = o.spendByMonth;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <nav aria-label="ตำแหน่งของหน้านี้" className="text-sm text-muted-foreground">
            <Link href="/suppliers" className="hover:text-foreground">
              ผู้ขาย
            </Link>
            <span aria-hidden className="mx-1.5">›</span>
            <span className="text-foreground">{shortName}</span>
          </nav>
          <h2 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            {supplier.nameFull}
            {!supplier.isActive && (
              <span className="rounded-full border border-border-strong bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                ปิดใช้งาน
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[
              supplier.code ? `รหัส ${supplier.code}` : null,
              supplier.contactName,
              supplier.contactPhone,
              o.firstReceivedAt ? `ซื้อครั้งแรก ${dayTh(o.firstReceivedAt)}` : "ยังไม่เคยรับของจากผู้ขายนี้",
              o.lastReceivedAt ? `ล่าสุด ${dayTh(o.lastReceivedAt)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {canOrder && (
          <Link href={`/suppliers/${supplier.id}/order` as Route} className="btn">
            สั่งซื้อ
          </Link>
        )}
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {seeBills && (
          <div className={`space-y-1 rounded-2xl border p-4 ${o.unpaid.count ? "border-warn-border bg-warn-bg/40" : "border-border bg-surface"}`}>
            <p className={`text-sm ${o.unpaid.count ? "text-warn" : "text-muted-foreground"}`}>ค้างจ่าย</p>
            {o.unpaid.count ? (
              <>
                <p className="text-2xl font-semibold tabular-nums text-warn">{baht(o.unpaid.total)}</p>
                <p className="text-xs text-warn">
                  {o.unpaid.count} บิล · เก่าสุด {dayTh(o.unpaid.oldestBillDate!)} ({daysBetween(o.unpaid.oldestBillDate!, today)} วันก่อน)
                </p>
                <Link
                  href={`/expenses?supplier=${supplier.id}&status=UNPAID` as Route}
                  className="inline-block pt-1 text-sm font-semibold text-primary hover:underline"
                >
                  ดูบิลที่ยังไม่จ่าย ›
                </Link>
              </>
            ) : (
              <p className="text-lg font-semibold text-good">ไม่มีบิลค้าง</p>
            )}
          </div>
        )}
        <div className="space-y-1 rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm text-muted-foreground">ของค้างส่ง</p>
          <p className="text-2xl font-semibold">{o.openOrders.length ? `${o.openOrders.length} ใบ` : "ไม่มี"}</p>
          {o.openOrders.slice(0, 2).map((po) => (
            <Link key={po.id} href={`/purchase-orders/${po.id}` as Route} className="block text-xs text-primary hover:underline">
              {po.poNumber}
              {seeCost ? ` · ${baht(po.total)}` : ""} · {po.expectedDate ? `นัดส่ง ${dayTh(po.expectedDate)}` : "ยังไม่มีวันนัดส่ง"}
            </Link>
          ))}
          {o.draftCount > 0 && <p className="text-xs text-muted-foreground">+ ร่าง {o.draftCount} ใบ ยังไม่ได้ส่ง</p>}
        </div>
        {seeCost && (
          <div className="space-y-1 rounded-2xl border border-border bg-surface p-4">
            <p className="text-sm text-muted-foreground">{thisMonth ? `ซื้อเดือน ${monthLabelTh(thisMonth.period)}` : "ยอดซื้อ"}</p>
            <p className="text-2xl font-semibold tabular-nums">{thisMonth ? baht(thisMonth.total) : "—"}</p>
            <p className="text-xs text-muted-foreground">
              {thisMonth
                ? `${prevMonth ? `${monthLabelTh(prevMonth.period)} ${baht(prevMonth.total)} · ` : ""}ตามวันที่รับของ ไม่รวม VAT`
                : "ยังไม่มีใบรับของ"}
            </p>
          </div>
        )}
        <div className="space-y-1 rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm text-muted-foreground">ส่งตรงนัด</p>
          {o.onTime ? (
            <>
              <p className="text-2xl font-semibold tabular-nums">{Math.round((o.onTime.onTime / o.onTime.judged) * 100)}%</p>
              <p className="text-xs text-muted-foreground">
                {o.onTime.onTime} จาก {o.onTime.judged} ใบรับของที่มีวันนัด
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-muted-subtle">ยังไม่มีข้อมูล</p>
              <p className="text-xs text-muted-foreground">คิดได้เมื่อรับของจากใบสั่งซื้อที่มีวันนัดส่ง</p>
            </>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold">ของที่ซื้อจากผู้ขายนี้</h3>
          {seeCost && o.items.length > 0 && (
            <span className="text-xs text-muted-foreground">ราคาที่จ่ายจริงจากใบรับของ ไม่รวม VAT · ราคาขึ้นเป็นสีแดง</span>
          )}
        </div>
        {o.items.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
            ยังไม่เคยรับของจากผู้ขายนี้
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {o.items.map((it) => {
              const change = it.prevPrice ? ((it.lastPrice - it.prevPrice) / it.prevPrice) * 100 : null;
              return (
                <li key={`${it.productId}|${it.unitName}`} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
                  <ProductThumb imageUrl={it.imageUrl} name={it.productName} className="aspect-[4/3] w-full rounded-none" />
                  <div className="flex flex-1 flex-col gap-0.5 p-3 [&>a]:mt-2">
                    <p className="font-semibold">{it.productName}</p>
                    <p className="text-xs text-muted-foreground">{it.unitName}</p>
                    {seeCost && (
                      <>
                        <p className="mt-1 text-lg font-semibold tabular-nums">฿{price(it.lastPrice)}</p>
                        <p className="text-xs text-muted-foreground">
                          {change === null || Math.abs(change) < 0.05 ? (
                            it.prevPrice === null ? (
                              `ซื้อครั้งเดียว · ${dayTh(it.lastAt)}`
                            ) : (
                              `เท่าเดิม · เทียบ ${dayTh(it.prevAt!)}`
                            )
                          ) : (
                            <>
                              <span className={change > 0 ? "text-bad" : "text-good"}>
                                {change > 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
                              </span>{" "}
                              เทียบ {dayTh(it.prevAt!)}
                            </>
                          )}
                        </p>
                      </>
                    )}
                    <p className="text-xs text-muted-foreground">ซื้อมาแล้ว {it.times} ครั้ง</p>
                    {canOrder && (
                      <Link
                        href={`/suppliers/${supplier.id}/order` as Route}
                        className="mt-auto inline-flex h-9 items-center justify-center rounded-full border border-primary text-sm font-semibold text-primary hover:bg-primary-soft"
                      >
                        + สั่ง
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {o.recent.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">เอกสารล่าสุด</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {o.recent.map((d) => (
              <li key={d.id} className="group relative flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50">
                <Link
                  href={(d.kind === "PO" ? `/purchase-orders/${d.id}` : `/goods-receipts/${d.id}`) as Route}
                  className="font-semibold after:absolute after:inset-0 after:content-['']"
                >
                  {d.number}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {d.kind === "PO" ? "ใบสั่งซื้อ" : "ใบรับของ"} · {d.branchName} · {dayTh(d.at)}
                    {d.kind === "GR" && !d.viaOrder ? " · ซื้อสด" : ""}
                  </span>
                </Link>
                <span className="whitespace-nowrap rounded-full border border-border-strong bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                  {d.kind === "PO" ? (PO_STATUS[d.status] ?? d.status) : d.status === "VOIDED" ? "ยกเลิกแล้ว" : "รับเข้าคลังแล้ว"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="group rounded-2xl border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-semibold">
          ข้อมูลผู้ขาย (ชื่อ ติดต่อ ภาษี เงื่อนไขชำระ · รายการราคา)
          <span className="text-sm font-normal text-muted-foreground group-open:hidden">กดเพื่อแก้</span>
          <span className="hidden text-sm font-normal text-muted-foreground group-open:inline">ย่อ</span>
        </summary>
        <div className="space-y-6 px-5 pb-5">
          <SupplierForm
            action={updateSupplier.bind(null, supplier.id)}
            initial={toSupplierView(supplier)}
            submitLabel="บันทึกการแก้ไข"
            shopVatRate={membership.tenant.defaultVatRatePercent.toString()}
          />
          <MappingListSection mappings={mappingViews} perspective="supplier" />
          <MappingHistoryViewer series={series} perspective="supplier" />
        </div>
      </details>

      <section className="border-t border-border pt-4">
        <DeleteSupplierButton id={supplier.id} cascadeItems={cascadeItems} />
      </section>
    </div>
  );
}

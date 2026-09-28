"use client";

// Kong (2026-09-28) — a supplier's catalog you can order from.
//
// Pick quantities, press สร้างใบสั่งซื้อ, and a DRAFT is saved through the
// order form's own action (createPurchaseOrderAction), then opened for review.
// The fields below carry the order form's snake_case names and parallel line
// arrays, because that action reads nothing else.
//
// Two deliberate limits, both to keep a line's price true to its unit:
//  - A product WITH a current price is ordered in the unit that price is for;
//    changing the unit would leave a per-กก. price on a per-ลัง line.
//  - A product WITHOUT one asks for the price and lets the unit be chosen —
//    the hand-typed path (ADR 0012 Q5), recorded with no mapping id. When the
//    supplier has delivered it before, the box starts at what was last paid,
//    in the unit it came in, and says so.

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseOrderActionState } from "../../../purchase-orders/actions";
import EmptyState from "@/components/ui/EmptyState";
import ProductThumb from "@/components/ui/ProductThumb";

export type CatalogItemView = {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  section: string | null;
  group: string | null;
  units: { id: string; unitName: string; isBase: boolean }[];
  defaultUnitId: string | null;
  price: {
    mappingId: string;
    unitPrice: string;
    orderUnitId: string | null;
    orderUnitName: string | null;
    minOrderQty: string | null;
    scope: "branch" | "tenant";
  } | null;
  /** What this supplier last invoiced — a prefill the user may change, never a price-list price. */
  lastPaid: {
    unitPrice: string;
    unitId: string;
    unitName: string;
    receivedOn: string;
    otherBranchName: string | null;
  } | null;
};

type Pick = { qty: string; unitId: string; price: string };

const NO_CATEGORY = "ไม่ระบุหมวด";
const ALL = "__all";

const num = (s: string) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};
const money = (v: number) =>
  v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`;

export default function SupplierCatalog({
  supplier,
  branches,
  branchId,
  vatRate,
  items,
  action,
}: {
  supplier: { id: string; nameFull: string };
  branches: { id: string; name: string }[];
  branchId: string;
  vatRate: string;
  items: CatalogItemView[];
  action: (prev: PurchaseOrderActionState, fd: FormData) => Promise<PurchaseOrderActionState>;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(action, { ok: false } as PurchaseOrderActionState);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [section, setSection] = useState(ALL);
  const [search, setSearch] = useState("");

  // A saved draft opens straight away — reviewing and sending happen there.
  useEffect(() => {
    if (state.ok) router.push(`/purchase-orders/${state.id}`);
  }, [state, router]);

  // What a product starts at before anyone touches it.
  const fresh = (item: CatalogItemView): Pick => ({
    qty: "",
    unitId: item.price?.orderUnitId ?? item.lastPaid?.unitId ?? item.defaultUnitId ?? "",
    price: item.price?.unitPrice ?? item.lastPaid?.unitPrice ?? "",
  });
  const pickOf = (item: CatalogItemView) => picks[item.productId] ?? fresh(item);
  const unitOf = (item: CatalogItemView) => pickOf(item).unitId;
  const priceOf = (item: CatalogItemView) => (item.price ? item.price.unitPrice : pickOf(item).price);

  const patch = (item: CatalogItemView, next: Partial<Pick>) =>
    setPicks((p) => ({ ...p, [item.productId]: { ...(p[item.productId] ?? fresh(item)), ...next } }));
  const setQty = (item: CatalogItemView, qty: string) => patch(item, { qty });
  const step = (item: CatalogItemView, by: number) => {
    const next = Math.max(0, num(pickOf(item).qty || "0") + by);
    setQty(item, next === 0 ? "" : String(next));
  };

  const sections = useMemo(() => {
    const s = new Set(items.map((i) => i.section ?? NO_CATEGORY));
    return [...s].sort((a, b) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b, "th")));
  }, [items]);

  const term = search.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (section === ALL || (i.section ?? NO_CATEGORY) === section) &&
      (!term || `${i.name} ${i.sku}`.toLowerCase().includes(term))
  );
  // Group headings in section order, then group name; a product with no
  // category sits under one heading at the end.
  const groups = useMemo(() => {
    const m = new Map<string, CatalogItemView[]>();
    for (const i of shown) {
      const key = i.section ? `${i.section} · ${i.group}` : NO_CATEGORY;
      m.set(key, [...(m.get(key) ?? []), i]);
    }
    return [...m.entries()].sort(([a], [b]) =>
      a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b, "th")
    );
  }, [shown]);

  const chosen = items.filter((i) => num(picks[i.productId]?.qty ?? "") > 0);
  const missingPrice = chosen.filter((i) => priceOf(i).trim() === "");
  const subtotal = chosen.reduce((s, i) => s + num(pickOf(i).qty) * num(priceOf(i)), 0);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false && state.fieldErrors ? Object.values(state.fieldErrors) : [];

  return (
    <form action={formAction} className="space-y-5 pb-28">
      <input type="hidden" name="supplier_id" value={supplier.id} />
      <input type="hidden" name="branch_id" value={branchId} />
      <input type="hidden" name="vat_rate_percent" value={vatRate} />
      {chosen.map((i) => {
        const pick = pickOf(i);
        return (
          <span key={i.productId} hidden>
            <input type="hidden" name="line_product_id" value={i.productId} />
            <input type="hidden" name="line_order_unit_id" value={unitOf(i)} />
            <input type="hidden" name="line_qty" value={pick.qty} />
            <input type="hidden" name="line_unit_price" value={priceOf(i)} />
            <input type="hidden" name="line_mapping_id" value={i.price?.mappingId ?? ""} />
            <input type="hidden" name="line_notes" value="" />
          </span>
        );
      })}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">สั่งซื้อจาก {supplier.nameFull}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            เลือกจำนวนสินค้าที่ต้องการ แล้วกดสร้างใบสั่งซื้อ ระบบจะบันทึกเป็นร่างให้ตรวจก่อนส่ง
          </p>
        </div>
        {branches.length > 1 && (
          <label className="text-sm">
            <span className="label">สั่งให้สาขา</span>
            <select
              value={branchId}
              onChange={(e) => router.push(`/suppliers/${supplier.id}/order?branch=${e.target.value}`)}
              className="input mt-1"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState art="setup">
          ยังไม่มีสินค้าจากผู้ขายรายนี้ — รายการจะขึ้นเองเมื่อรับของจากผู้ขายรายนี้ครั้งแรก
          หรือบันทึกราคาจากผู้ขายได้ที่หน้า{" "}
          <a href="/products" className="text-primary hover:underline">
            วัตถุดิบ
          </a>
        </EmptyState>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" className={chip(section === ALL)} onClick={() => setSection(ALL)}>
                ทั้งหมด ({items.length})
              </button>
              {sections.map((s) => (
                <button key={s} type="button" className={chip(section === s)} onClick={() => setSection(s)}>
                  {s}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อหรือรหัสสินค้า"
              className="input w-full"
            />
          </div>

          {groups.length === 0 && <EmptyState art="none">ไม่พบสินค้าที่ค้นหา</EmptyState>}

          {groups.map(([heading, list]) => (
            <section key={heading} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">{heading}</h3>
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                {list.map((item) => {
                  const pick = pickOf(item);
                  const qty = pick.qty;
                  const on = num(qty) > 0;
                  const belowMin =
                    on && item.price?.minOrderQty != null && num(qty) < num(item.price.minOrderQty);
                  return (
                    <li
                      key={item.productId}
                      className={`flex flex-wrap items-center gap-3 px-4 py-3 ${on ? "bg-primary/5" : ""}`}
                    >
                      <ProductThumb imageUrl={item.imageUrl} name={item.name} className="h-12 w-12" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.sku}
                          {item.price ? (
                            <>
                              {" · "}
                              <span className="tabular-nums text-foreground">
                                ฿{money(num(item.price.unitPrice))}
                              </span>{" "}
                              / {item.price.orderUnitName ?? "หน่วย"}
                              {item.price.scope === "branch" && " (ราคาเฉพาะสาขานี้)"}
                            </>
                          ) : item.lastPaid ? (
                            <>
                              {" · "}จ่ายล่าสุด{" "}
                              <span className="tabular-nums text-foreground">
                                ฿{money(num(item.lastPaid.unitPrice))}
                              </span>{" "}
                              / {item.lastPaid.unitName} เมื่อ {item.lastPaid.receivedOn}
                              {item.lastPaid.otherBranchName && ` (${item.lastPaid.otherBranchName})`}
                            </>
                          ) : (
                            <span className="text-warn"> · ยังไม่มีราคา — โปรดกรอกราคา</span>
                          )}
                        </p>
                        {belowMin && (
                          <p className="mt-0.5 text-xs text-warn">ผู้ขายกำหนดขั้นต่ำ {item.price!.minOrderQty}</p>
                        )}
                      </div>

                      {!item.price && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="ราคา/หน่วย"
                            aria-label={`ราคาต่อหน่วยของ ${item.name}`}
                            value={pick.price}
                            onChange={(e) => patch(item, { price: e.target.value })}
                            className="input w-28"
                          />
                          <select
                            aria-label={`หน่วยของ ${item.name}`}
                            value={unitOf(item)}
                            onChange={(e) => patch(item, { unitId: e.target.value })}
                            className="input w-44"
                          >
                            {item.units.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.unitName}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => step(item, -1)}
                          disabled={!on}
                          aria-label={`ลดจำนวน ${item.name}`}
                          className="h-9 w-9 rounded-lg border border-border-strong text-lg hover:bg-muted disabled:opacity-40"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          inputMode="decimal"
                          aria-label={`จำนวน ${item.name}`}
                          value={qty}
                          placeholder="0"
                          onChange={(e) => setQty(item, e.target.value)}
                          className="input w-20 text-center tabular-nums"
                        />
                        <button
                          type="button"
                          onClick={() => step(item, 1)}
                          aria-label={`เพิ่มจำนวน ${item.name}`}
                          className="h-9 w-9 rounded-lg border border-border-strong text-lg hover:bg-muted"
                        >
                          +
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      {/* The order so far — always in reach, however long the catalog is. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm">
            {chosen.length === 0 ? (
              <span className="text-muted-foreground">ยังไม่ได้เลือกสินค้า</span>
            ) : (
              <>
                <span className="font-medium">{chosen.length} รายการ</span>
                <span className="ml-2 tabular-nums">฿{money(subtotal)}</span>
                <span className="ml-1 text-xs text-muted-foreground">
                  (ก่อน VAT{vatRate ? ` ${vatRate}%` : ""})
                </span>
              </>
            )}
            {missingPrice.length > 0 && (
              <p className="text-xs text-warn">กรอกราคาอีก {missingPrice.length} รายการก่อนสร้างใบสั่งซื้อ</p>
            )}
            {formError && <p className="text-xs text-bad">{formError}</p>}
            {fieldErrors.map((e) => (
              <p key={e} className="text-xs text-bad">
                {e}
              </p>
            ))}
          </div>
          <button
            type="submit"
            className="btn"
            disabled={isPending || chosen.length === 0 || missingPrice.length > 0}
          >
            {isPending ? "กำลังสร้าง…" : "สร้างใบสั่งซื้อ"}
          </button>
        </div>
      </div>
    </form>
  );
}

"use client";

// Sprint 1 Part 8 L5a-2 — shared create + edit form for one supplier-product
// price mapping (the product's price list, Q9 product-centric write side).
// Driven by React 19 useActionState against the L4 "use server" actions
// (createMappingAction / updateMappingAction.bind(null, id)). Input `name=`
// attributes are snake_case to match rawFromFormData in
// src/app/supplier-product-mappings/actions.ts (12 fields); fieldErrors keys are
// the schema's camelCase names.
//
// Two state machines:
//  - branch selector (CREATE only): ทุกสาขา (branchId = null) / เฉพาะสาขา + a
//    conditional <select> — mirrors ProductForm's densityMode radio.
//  - edit-mode identity lock: supplier + branch define the time-series and are
//    IMMUTABLE in updateLogic. On edit they render read-only (a display box +
//    hidden input carrying the original value, so zod still receives a valid
//    supplierId/branchId). orderUnit / pricing / dates / isPreferred stay live.
//
// initial values come from a MappingView (Decimal-free; Pitfall #20 handled by
// mapping-view.ts). Reference data (suppliers/branches/orderUnits) is projected
// to id+label plain shapes by the page (drops Supplier/ProductUnit Decimals).

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MappingActionState } from "@/app/supplier-product-mappings/actions";
import type { MappingView } from "./mapping-view";

export type SupplierOption = { id: string; nameFull: string };
export type BranchOption = { id: string; name: string };
export type OrderUnitOption = { id: string; unitName: string };

type BranchMode = "all" | "specific";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
const lockedClass =
  "w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground";

/** Local yyyy-mm-dd for the CREATE effectiveFrom pre-fill (Q1; user can change). */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MappingForm({
  action,
  initial,
  productId,
  suppliers,
  branches,
  orderUnits,
  submitLabel,
}: {
  action: (
    prev: MappingActionState,
    fd: FormData
  ) => Promise<MappingActionState>;
  /** Present = edit (identity locked); absent = create. */
  initial?: MappingView;
  productId: string;
  suppliers: SupplierOption[];
  branches: BranchOption[];
  /** This product's ProductUnits, projected to id + name (Q5i picker). */
  orderUnits: OrderUnitOption[];
  submitLabel: string;
}) {
  const router = useRouter();
  const isEdit = !!initial;
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as MappingActionState
  );

  // --- branch selector state (create only; edit locks the branch) ---
  const [branchMode, setBranchMode] = useState<BranchMode>(
    initial?.branchId != null ? "specific" : "all"
  );
  const [branchId, setBranchId] = useState(initial?.branchId ?? "");

  function onBranchModeChange(next: BranchMode) {
    setBranchMode(next);
    // Leaving "specific" clears the selection so "all" submits no branch_id.
    if (next === "all") setBranchId("");
  }

  // --- controlled fields that drive soft hints ---
  const [unitPrice, setUnitPrice] = useState(initial?.currentUnitPrice ?? "");
  const [leadTime, setLeadTime] = useState(
    initial?.leadTimeDays != null ? String(initial.leadTimeDays) : ""
  );

  const priceNum = Number(unitPrice);
  const showHighPriceHint =
    unitPrice.trim() !== "" && Number.isFinite(priceNum) && priceNum > 10000;
  const leadNum = Number(leadTime);
  const showLongLeadHint =
    leadTime.trim() !== "" && Number.isFinite(leadNum) && leadNum > 30;

  useEffect(() => {
    if (state.ok) router.push(`/products/${productId}`);
  }, [state, router, productId]);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const err = (key: string) => fieldErrors?.[key];

  const branchDisplay = initial?.branch ? initial.branch.name : "ทุกสาขา";

  return (
    <form action={formAction} className="space-y-6">
      {formError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {formError}
        </div>
      )}

      {/* product_id is fixed by the route (this product's price list). */}
      <input type="hidden" name="product_id" value={productId} />

      {/* Supplier + branch (identity — locked on edit) */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <label htmlFor="supplier_id" className="mb-1 block text-sm font-medium">
            ซัพพลายเออร์<span className="text-red-600"> *</span>
          </label>
          {isEdit ? (
            <>
              <div className={lockedClass}>
                {initial?.supplier?.name ?? "(ไม่ทราบ)"}
              </div>
              <input
                type="hidden"
                name="supplier_id"
                value={initial?.supplierId ?? ""}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                เปลี่ยนซัพพลายเออร์ไม่ได้ — สร้างรายการราคาใหม่แทน
              </p>
            </>
          ) : (
            <select
              id="supplier_id"
              name="supplier_id"
              defaultValue=""
              className={inputClass}
            >
              <option value="" disabled>
                — เลือกซัพพลายเออร์ —
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameFull}
                </option>
              ))}
            </select>
          )}
          {err("supplierId") && (
            <p className="mt-1 text-sm text-red-600">{err("supplierId")}</p>
          )}
        </div>

        <div>
          <span className="mb-2 block text-sm font-medium">ขอบเขตสาขา</span>
          {isEdit ? (
            <>
              <div className={lockedClass}>{branchDisplay}</div>
              <input
                type="hidden"
                name="branch_id"
                value={initial?.branchId ?? ""}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                เปลี่ยนขอบเขตสาขาไม่ได้ — สร้างรายการราคาใหม่แทน
              </p>
            </>
          ) : (
            <div className="space-y-3">
              {/* ( ) ทุกสาขา — branchId null (tenant default, Q7) */}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="branch_mode"
                  checked={branchMode === "all"}
                  onChange={() => onBranchModeChange("all")}
                  className="h-4 w-4"
                />
                ทุกสาขา (ค่าเริ่มต้นของร้าน)
              </label>
              {/* (•) เฉพาะสาขา → dropdown (branch override) */}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="branch_mode"
                  checked={branchMode === "specific"}
                  onChange={() => onBranchModeChange("specific")}
                  className="h-4 w-4"
                />
                เฉพาะสาขา
              </label>
              {branchMode === "specific" && (
                <div className="pl-6">
                  <select
                    name="branch_id"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="" disabled>
                      — เลือกสาขา —
                    </option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
          {err("branchId") && (
            <p className="mt-1 text-sm text-red-600">{err("branchId")}</p>
          )}
        </div>
      </section>

      {/* Supplier's own item code/name (optional) */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <label
            htmlFor="supplier_item_code"
            className="mb-1 block text-sm font-medium"
          >
            รหัสสินค้าของซัพพลายเออร์
          </label>
          <input
            id="supplier_item_code"
            name="supplier_item_code"
            type="text"
            maxLength={64}
            defaultValue={initial?.supplierItemCode ?? ""}
            placeholder="เช่น SKU ฝั่งซัพพลายเออร์"
            className={inputClass}
          />
          {err("supplierItemCode") && (
            <p className="mt-1 text-sm text-red-600">{err("supplierItemCode")}</p>
          )}
        </div>
        <div>
          <label
            htmlFor="supplier_item_name"
            className="mb-1 block text-sm font-medium"
          >
            ชื่อสินค้าของซัพพลายเออร์
          </label>
          <input
            id="supplier_item_name"
            name="supplier_item_name"
            type="text"
            maxLength={200}
            defaultValue={initial?.supplierItemName ?? ""}
            placeholder="ชื่อที่ซัพพลายเออร์ใช้เรียกสินค้านี้"
            className={inputClass}
          />
          {err("supplierItemName") && (
            <p className="mt-1 text-sm text-red-600">{err("supplierItemName")}</p>
          )}
        </div>
      </section>

      {/* Order unit + pricing */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <label htmlFor="order_unit_id" className="mb-1 block text-sm font-medium">
            หน่วยสั่งซื้อ
          </label>
          <select
            id="order_unit_id"
            name="order_unit_id"
            defaultValue={initial?.orderUnitId ?? ""}
            className={inputClass}
          >
            <option value="">— ไม่ระบุ —</option>
            {orderUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitName}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            หน่วยที่สั่งซื้อจากซัพพลายเออร์รายนี้ (ต้องเป็นหน่วยของวัตถุดิบนี้)
          </p>
          {err("orderUnitId") && (
            <p className="mt-1 text-sm text-red-600">{err("orderUnitId")}</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="current_unit_price"
              className="mb-1 block text-sm font-medium"
            >
              ราคา/หน่วย (บาท)
            </label>
            <input
              id="current_unit_price"
              name="current_unit_price"
              type="number"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="เช่น 25.00"
              className={inputClass}
            />
            {showHighPriceHint && (
              <p className="mt-1 text-xs text-amber-600">
                ราคาสูง — กรุณาตรวจสอบอีกครั้ง
              </p>
            )}
            {err("currentUnitPrice") && (
              <p className="mt-1 text-sm text-red-600">{err("currentUnitPrice")}</p>
            )}
          </div>
          <div>
            <label
              htmlFor="min_order_qty"
              className="mb-1 block text-sm font-medium"
            >
              ปริมาณขั้นต่ำ
            </label>
            <input
              id="min_order_qty"
              name="min_order_qty"
              type="number"
              defaultValue={initial?.minOrderQty ?? ""}
              step="any"
              min="0"
              inputMode="decimal"
              placeholder="เช่น 1"
              className={inputClass}
            />
            {err("minOrderQty") && (
              <p className="mt-1 text-sm text-red-600">{err("minOrderQty")}</p>
            )}
          </div>
          <div>
            <label
              htmlFor="lead_time_days"
              className="mb-1 block text-sm font-medium"
            >
              Lead time (วัน)
            </label>
            <input
              id="lead_time_days"
              name="lead_time_days"
              type="number"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
              step="1"
              min="0"
              max="365"
              inputMode="numeric"
              placeholder="เช่น 3"
              className={inputClass}
            />
            {showLongLeadHint && (
              <p className="mt-1 text-xs text-amber-600">
                Lead time มากกว่า 30 วัน — กรุณาตรวจสอบ
              </p>
            )}
            {err("leadTimeDays") && (
              <p className="mt-1 text-sm text-red-600">{err("leadTimeDays")}</p>
            )}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            id="is_preferred"
            name="is_preferred"
            type="checkbox"
            defaultChecked={initial?.isPreferred ?? false}
            className="h-4 w-4 rounded border-border"
          />
          ตั้งเป็นซัพพลายเออร์แนะนำ (1 รายต่อสาขา)
        </label>
        {err("isPreferred") && (
          <p className="text-sm text-red-600">{err("isPreferred")}</p>
        )}
      </section>

      {/* Effective dates (Q1/Q4) */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="effective_from"
              className="mb-1 block text-sm font-medium"
            >
              เริ่มมีผล<span className="text-red-600"> *</span>
            </label>
            <input
              id="effective_from"
              name="effective_from"
              type="date"
              defaultValue={initial?.effectiveFrom ?? todayLocal()}
              className={inputClass}
            />
            {err("effectiveFrom") && (
              <p className="mt-1 text-sm text-red-600">{err("effectiveFrom")}</p>
            )}
          </div>
          <div>
            <label
              htmlFor="effective_to"
              className="mb-1 block text-sm font-medium"
            >
              สิ้นสุด
            </label>
            <input
              id="effective_to"
              name="effective_to"
              type="date"
              defaultValue={initial?.effectiveTo ?? ""}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              เว้นว่าง = ราคาปัจจุบัน (ยังไม่สิ้นสุด)
            </p>
            {err("effectiveTo") && (
              <p className="mt-1 text-sm text-red-600">{err("effectiveTo")}</p>
            )}
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-6 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : submitLabel}
        </button>
        <a
          href={`/products/${productId}`}
          className="rounded-lg border border-border px-6 py-2 text-sm hover:bg-muted/40"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}

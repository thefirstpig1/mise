"use client";

// Sprint 1 Part 7a — shared create + edit form for a RAW product.
// Driven by React 19 useActionState against the "use server" actions. Input
// `name=` attributes are snake_case to match rawFromFormData in
// src/app/products/actions.ts; fieldErrors keys are camelCase schema names.
//
// The dimension → base-unit cascade lives here (client state): picking a
// primaryDimension filters the base-unit <select> to that dimension and resets
// the selection if it no longer fits (Q1/Q5). Initial values come from a
// ProductView (Decimal-free; Pitfall #20 handled by the serializer).

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductActionState } from "@/app/products/actions";
import {
  PRIMARY_DIMENSION_VALUES,
  PRIMARY_DIMENSION_LABELS_TH,
  PRODUCT_FIELD_LABELS_TH,
} from "@/lib/validations/product";
import { ACCOUNT_LABELS_TH, type Account } from "@/lib/validations/category";
import type { ProductView } from "./product-view";
import type { UnitOption } from "@/server/product";

type CategoryOption = {
  id: string;
  account: string;
  accountingSection: string;
  groupName: string;
};

/** One editable "additional unit" row. `id` is a stable client key so the
 *  default-buy selection survives renames (we resolve id → name only at submit). */
type UnitRow = { id: number; unitName: string; toBaseRatio: string };

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

export default function ProductForm({
  action,
  initial,
  units,
  categories,
  submitLabel,
}: {
  action: (
    prev: ProductActionState,
    fd: FormData
  ) => Promise<ProductActionState>;
  initial?: ProductView;
  units: UnitOption[];
  categories: CategoryOption[];
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as ProductActionState
  );

  // Cascade state: dimension drives which base units are valid.
  const [dimension, setDimension] = useState(initial?.primaryDimension ?? "");
  const [baseUnit, setBaseUnit] = useState(initial?.baseUnitName ?? "");

  const unitOptions = useMemo(
    () => units.filter((u) => u.unitDimension === dimension),
    [units, dimension]
  );

  function onDimensionChange(next: string) {
    setDimension(next);
    // Keep the chosen unit only if it still belongs to the new dimension.
    if (!units.some((u) => u.unitDimension === next && u.unitName === baseUnit)) {
      setBaseUnit("");
    }
  }

  // --- Additional units (7b, Option A): dynamic rows below the base unit. ---
  // Ids are assigned 0..n-1 in order on first render (idCounter starts at 0), so
  // the default-buy index below lines up with the matching row id.
  const idCounter = useRef(0);
  const [rows, setRows] = useState<UnitRow[]>(() =>
    (initial?.units ?? [])
      .filter((u) => !u.isBase)
      .map((u) => ({
        id: idCounter.current++,
        unitName: u.unitName,
        toBaseRatio: u.toBaseRatio,
      }))
  );
  // Which unit is the default buy unit: "base" or an additional row's id.
  const [defaultBuyId, setDefaultBuyId] = useState<number | "base">(() => {
    const idx = (initial?.units ?? [])
      .filter((u) => !u.isBase)
      .findIndex((u) => u.isDefaultBuyUnit);
    return idx === -1 ? "base" : idx; // first-render row ids == their index
  });

  function addRow() {
    setRows((prev) => [
      ...prev,
      { id: idCounter.current++, unitName: "", toBaseRatio: "" },
    ]);
  }
  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    // If we removed the default-buy unit, the default falls back to the base.
    setDefaultBuyId((prev) => (prev === id ? "base" : prev));
  }
  function patchRow(id: number, patch: Partial<UnitRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Resolve the default-buy selection to a unit NAME for submission (the logic
  // matches by name). Tracking by id means a rename never breaks the link.
  const defaultBuyName =
    defaultBuyId === "base"
      ? baseUnit
      : rows.find((r) => r.id === defaultBuyId)?.unitName ?? baseUnit;

  useEffect(() => {
    if (state.ok) router.push("/products");
  }, [state, router]);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;
  const L = PRODUCT_FIELD_LABELS_TH;
  const err = (key: string) => fieldErrors?.[key];

  return (
    <form action={formAction} className="space-y-6">
      {formError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {formError}
        </div>
      )}

      {/* Identity */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">
            {L.name}
            <span className="text-red-600"> *</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            defaultValue={initial?.name ?? ""}
            placeholder="เช่น หมูสามชั้น, น้ำมันพืช"
            className={inputClass}
          />
          {err("name") && (
            <p className="mt-1 text-sm text-red-600">{err("name")}</p>
          )}
        </div>

        <div>
          <label htmlFor="name_en" className="mb-1 block text-sm font-medium">
            {L.nameEn}
          </label>
          <input
            id="name_en"
            name="name_en"
            type="text"
            defaultValue={initial?.nameEn ?? ""}
            placeholder="เช่น Pork belly"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="sku" className="mb-1 block text-sm font-medium">
            {L.sku}
          </label>
          <input
            id="sku"
            name="sku"
            type="text"
            defaultValue={initial?.sku ?? ""}
            placeholder="เว้นว่างเพื่อสร้างอัตโนมัติ (เช่น P-0001)"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            เว้นว่างไว้ ระบบจะสร้างรหัสให้อัตโนมัติ
          </p>
        </div>
      </section>

      {/* Measurement */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <label
            htmlFor="primary_dimension"
            className="mb-1 block text-sm font-medium"
          >
            {L.primaryDimension}
            <span className="text-red-600"> *</span>
          </label>
          <select
            id="primary_dimension"
            name="primary_dimension"
            value={dimension}
            onChange={(e) => onDimensionChange(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              — เลือกหน่วยวัดหลัก —
            </option>
            {PRIMARY_DIMENSION_VALUES.map((d) => (
              <option key={d} value={d}>
                {PRIMARY_DIMENSION_LABELS_TH[d]}
              </option>
            ))}
          </select>
          {err("primaryDimension") && (
            <p className="mt-1 text-sm text-red-600">{err("primaryDimension")}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="base_unit_name"
            className="mb-1 block text-sm font-medium"
          >
            {L.baseUnitName}
            <span className="text-red-600"> *</span>
          </label>
          <select
            id="base_unit_name"
            name="base_unit_name"
            value={baseUnit}
            onChange={(e) => setBaseUnit(e.target.value)}
            disabled={!dimension}
            className={`${inputClass} disabled:opacity-50`}
          >
            <option value="" disabled>
              {dimension ? "— เลือกหน่วยพื้นฐาน —" : "เลือกหน่วยวัดหลักก่อน"}
            </option>
            {unitOptions.map((u) => (
              <option key={u.unitName} value={u.unitName}>
                {u.unitName}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            หน่วยที่ใช้บันทึกสต๊อกของสินค้านี้ (เพิ่มหน่วยซื้อ-ขายอื่นได้ภายหลัง)
          </p>
          {err("baseUnitName") && (
            <p className="mt-1 text-sm text-red-600">{err("baseUnitName")}</p>
          )}
        </div>
      </section>

      {/* Additional units (7b) — extra buy/sell units beyond the base */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">{L.additionalUnits}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              เพิ่มหน่วยซื้อ-ขาย เช่น กระสอบ ลัง ขวด พร้อมระบุว่าเท่ากับกี่
              {baseUnit ? ` ${baseUnit}` : "หน่วยพื้นฐาน"}
            </p>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
          >
            + เพิ่มหน่วย
          </button>
        </div>

        {/* Default-buy selector spans the base + every additional row. */}
        <div className="space-y-2">
          {/* Base row (read-only mirror of the base unit chosen above) */}
          <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="default_buy_radio"
                checked={defaultBuyId === "base"}
                onChange={() => setDefaultBuyId("base")}
                className="h-4 w-4"
              />
              <span className="text-muted-foreground">ซื้อหลัก</span>
            </label>
            <span className="font-medium">
              {baseUnit || "(เลือกหน่วยพื้นฐานก่อน)"}
            </span>
            <span className="text-xs text-muted-foreground">
              หน่วยพื้นฐาน · = 1
            </span>
          </div>

          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                type="text"
                name="additional_unit_name"
                value={row.unitName}
                onChange={(e) => patchRow(row.id, { unitName: e.target.value })}
                placeholder="ชื่อหน่วย เช่น กระสอบ"
                className={inputClass}
              />
              <input
                type="number"
                name="additional_unit_ratio"
                value={row.toBaseRatio}
                onChange={(e) => patchRow(row.id, { toBaseRatio: e.target.value })}
                step="any"
                min="0"
                placeholder={`= กี่ ${baseUnit || "หน่วยพื้นฐาน"}`}
                className={`${inputClass} max-w-[10rem]`}
              />
              <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="radio"
                  name="default_buy_radio"
                  checked={defaultBuyId === row.id}
                  onChange={() => setDefaultBuyId(row.id)}
                  className="h-4 w-4"
                />
                ซื้อหลัก
              </label>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="shrink-0 rounded-lg border border-border px-2 py-2 text-sm text-red-600 hover:bg-red-50"
                aria-label="ลบหน่วย"
              >
                ลบ
              </button>
            </div>
          ))}
        </div>

        {/* Resolved at submit: id → name (rename-safe). The base unit name is
            included so the logic can treat "default = base" via name match. */}
        <input type="hidden" name="default_buy_unit_name" value={defaultBuyName} />

        {err("additionalUnits") && (
          <p className="text-sm text-red-600">{err("additionalUnits")}</p>
        )}
        {err("defaultBuyUnitName") && (
          <p className="text-sm text-red-600">{err("defaultBuyUnitName")}</p>
        )}
      </section>

      {/* Classification + status */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <label htmlFor="category_id" className="mb-1 block text-sm font-medium">
            {L.categoryId}
          </label>
          <select
            id="category_id"
            name="category_id"
            defaultValue={initial?.categoryId ?? ""}
            className={inputClass}
          >
            <option value="">— ไม่ระบุหมวดหมู่ —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {`${ACCOUNT_LABELS_TH[c.account as Account] ?? c.account} › ${c.accountingSection} › ${c.groupName}`}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="is_active"
            name="is_active"
            type="checkbox"
            defaultChecked={initial?.isActive ?? true}
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor="is_active" className="text-sm font-medium">
            {L.isActive}
          </label>
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
          href="/products"
          className="rounded-lg border border-border px-6 py-2 text-sm hover:bg-muted/40"
        >
          ยกเลิก
        </a>
      </div>
    </form>
  );
}

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
//
// 7c additions:
//  - type radio (RAW/PREPPED) drives a conditional "การผลิต" section.
//  - PREPPED requires a parent (live products of the tenant minus self; the
//    page filters self before passing). NO client-side cycle/depth filtering —
//    the server guard runs on submit and returns a Thai field error.
//  - yield_percent: number 0.01-999.99; defaults to 100 on first RAW→PREPPED
//    toggle. >300 fires a non-blocking soft hint (cooked rice etc.).

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductActionState } from "@/app/products/actions";
import {
  PRIMARY_DIMENSION_VALUES,
  PRIMARY_DIMENSION_LABELS_TH,
  PRODUCT_FIELD_LABELS_TH,
  PRODUCT_TYPE_VALUES,
  PRODUCT_TYPE_LABELS_TH,
  type ProductType,
} from "@/lib/validations/product";
import { ACCOUNT_LABELS_TH, type Account } from "@/lib/validations/category";
import type { ProductView } from "./product-view";
import type {
  UnitOption,
  ProductParentOption,
  LiquidDensityTemplateOption,
} from "@/server/product";
import type { FuzzyMatchCandidate } from "@/server/product-restore";
import RestoreSuggestionTypeahead from "./RestoreSuggestionTypeahead";
import RestoreDialog from "./RestoreDialog";

type CategoryOption = {
  id: string;
  account: string;
  accountingSection: string;
  groupName: string;
};

/** One editable "additional unit" row. `id` is a stable client key so the
 *  default-buy selection survives renames (we resolve id → name only at submit). */
type UnitRow = { id: number; unitName: string; toBaseRatio: string };

/** Q17: the recipes written in one unit, and the ratio they were written against. */
export type UnitRecipeUsage = {
  unitName: string;
  originalRatio: string;
  recipeLabels: string[];
};

/** 7d density section mode (Q5): ไม่ระบุ / ใช้ค่ามาตรฐาน / ใส่ค่าเอง. */
type DensityMode = "none" | "template" | "custom";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

export default function ProductForm({
  action,
  initial,
  units,
  categories,
  parentOptions,
  availableTemplates,
  submitLabel,
  showRestoreSuggestion = false,
  unitRecipeUsage = [],
}: {
  action: (
    prev: ProductActionState,
    fd: FormData
  ) => Promise<ProductActionState>;
  initial?: ProductView;
  units: UnitOption[];
  categories: CategoryOption[];
  /** Live products of the tenant (self already filtered on edit). */
  parentOptions: ProductParentOption[];
  /** 7d: all liquid density templates for the dropdown (ordered by displayOrder). */
  availableTemplates: LiquidDensityTemplateOption[];
  submitLabel: string;
  /** Part 8.5 L5c — CREATE flow only: swap the plain name input for the
   *  restore-on-recreate typeahead + dialog. Default false keeps edit untouched. */
  showRestoreSuggestion?: boolean;
  /**
   * Part 21 Q17 — which recipes are WRITTEN in each of this product's units, so
   * changing a ratio can say what it moves before it moves it (ADR 0006 left
   * this guard open for want of a downstream reference; recipes supply it).
   *
   * Deliberately a WARNING and not a block: refusing a ratio correction forces
   * the data to stay wrong, which is the same argument Q13 makes about
   * RAW → PREPPED. Keyed by unit NAME, because that is the identity the form
   * itself uses for these rows.
   */
  unitRecipeUsage?: UnitRecipeUsage[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as ProductActionState
  );

  // Part 8.5 L5c — restore-on-recreate (CREATE flow only; hooks declared
  // unconditionally per Rules of Hooks, but only WIRED when showRestoreSuggestion).
  // `name` becomes controlled so the typeahead owns the <input name="name">;
  // `restoreCandidate` (non-null) opens the dialog. In edit these stay inert.
  const [name, setName] = useState(initial?.name ?? "");
  const [restoreCandidate, setRestoreCandidate] =
    useState<FuzzyMatchCandidate | null>(null);

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

  // --- 7c: type + PREPPED parent/yield ---
  // type is a controlled radio: switches show/hide of the production section
  // and is always submitted (snake_case `name="type"` per rawFromFormData).
  const [productType, setProductType] = useState<ProductType>(
    (initial?.type as ProductType) ?? "RAW"
  );
  // Parent picker is controlled so a soft-deleted parent (not in parentOptions)
  // can still pre-fill from initial.parentProductId — we inject a "(ลบไปแล้ว)"
  // option for it below.
  const [parentId, setParentId] = useState(initial?.parentProductId ?? "");
  // Yield is controlled so a fresh RAW→PREPPED toggle can pre-fill 100 if blank.
  const [yieldPercent, setYieldPercent] = useState(initial?.yieldPercent ?? "");

  function onTypeChange(next: ProductType) {
    setProductType(next);
    if (next === "PREPPED" && yieldPercent.trim() === "") {
      setYieldPercent("100");
    }
    // RAW→hide does NOT clear parent/yield from state — the server cleanses on
    // submit (actions.ts: isRaw → null). Keeping client state lets a user
    // toggle back to PREPPED without re-entering the values.
  }

  // Show a "(ลบไปแล้ว)" fallback option ONLY when the saved parent is missing
  // from the live options (soft-deleted). Without this the <select> would
  // render the placeholder and the user couldn't tell what the current parent
  // is. parentOptions is live-only by construction (getProductParentOptionsLogic).
  const parentMissingFromOptions =
    !!initial?.parentProductId &&
    !parentOptions.some((p) => p.id === initial.parentProductId);

  const yieldNum = Number(yieldPercent);
  const showHighYieldHint =
    productType === "PREPPED" &&
    Number.isFinite(yieldNum) &&
    yieldNum > 300;

  // --- 7d: liquid density (Q5). Mode is client-only UI state; only the ACTIVE
  // field is rendered (and thus submitted), so the template-vs-override XOR holds
  // by construction. Initial mode derives from DB state (the DB CHECK makes the
  // both-set state impossible, so no fallback needed). Hidden entirely on COUNT.
  const [densityMode, setDensityMode] = useState<DensityMode>(
    initial?.liquidDensityTemplateId
      ? "template"
      : initial?.densityGPerMlOverride
        ? "custom"
        : "none"
  );
  const [densityTemplateId, setDensityTemplateId] = useState(
    initial?.liquidDensityTemplateId ?? ""
  );
  const [densityOverride, setDensityOverride] = useState(
    initial?.densityGPerMlOverride ?? ""
  );

  function onDensityModeChange(next: DensityMode) {
    setDensityMode(next);
    // Clear the opposite field so a mode switch leaves no stale value behind.
    if (next !== "template") setDensityTemplateId("");
    if (next !== "custom") setDensityOverride("");
  }

  // Density applies only to WEIGHT/VOLUME (Q3); the whole section hides otherwise.
  const densityApplies = dimension === "WEIGHT" || dimension === "VOLUME";
  // Soft hint (custom mode only, non-blocking): value outside the usual food
  // liquid band [0.5, 2.0] g/ml (Q4). The hard cap (0, 2.5] lives in zod.
  const overrideNum = Number(densityOverride);
  const showDensityHint =
    densityMode === "custom" &&
    densityOverride.trim() !== "" &&
    Number.isFinite(overrideNum) &&
    (overrideNum < 0.5 || overrideNum > 2.0);

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
    <>
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
          {showRestoreSuggestion ? (
            // CREATE flow: controlled typeahead owns the name input; selecting a
            // soft-deleted candidate opens the restore dialog (does NOT alter name).
            <RestoreSuggestionTypeahead
              value={name}
              onChange={setName}
              onCandidateSelected={setRestoreCandidate}
            />
          ) : (
            // Edit flow (and any non-restore host): unchanged uncontrolled input.
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={initial?.name ?? ""}
              placeholder="เช่น หมูสามชั้น, น้ำมันพืช"
              className={inputClass}
            />
          )}
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

      {/* 7c: Type + (conditional) PREPPED production fields */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <span className="mb-2 block text-sm font-medium">
            {L.type}
            <span className="text-red-600"> *</span>
          </span>
          <div className="flex flex-wrap gap-4">
            {PRODUCT_TYPE_VALUES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="type"
                  value={t}
                  checked={productType === t}
                  onChange={() => onTypeChange(t)}
                  className="h-4 w-4"
                />
                {PRODUCT_TYPE_LABELS_TH[t]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {productType === "RAW"
              ? "ซื้อมาใช้ตามนั้น (ไม่ได้ผลิตจากสินค้าตัวอื่น)"
              : "ผลิตจากสินค้าแม่ — ระบุสินค้าแม่และเปอร์เซ็นต์ผลผลิตด้านล่าง"}
          </p>
          {err("type") && (
            <p className="mt-1 text-sm text-red-600">{err("type")}</p>
          )}
        </div>

        {productType === "PREPPED" && (
          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <label
                htmlFor="parent_product_id"
                className="mb-1 block text-sm font-medium"
              >
                {L.parentProductId}
                <span className="text-red-600"> *</span>
              </label>
              <select
                id="parent_product_id"
                name="parent_product_id"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className={inputClass}
              >
                <option value="" disabled>
                  — เลือกสินค้าแม่ —
                </option>
                {/* Soft-deleted parent: prepend a labelled fallback so the
                    user can see the current value (selectable but flagged). */}
                {parentMissingFromOptions && initial?.parent && (
                  <option value={initial.parentProductId ?? ""}>
                    {initial.parent.name} · {initial.parent.sku} · (ลบไปแล้ว)
                  </option>
                )}
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.sku} · [
                    {PRODUCT_TYPE_LABELS_TH[p.type as ProductType] ?? p.type}]
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                สินค้าที่นำมาแปรรูปเป็นสินค้านี้
              </p>
              {err("parentProductId") && (
                <p className="mt-1 text-sm text-red-600">
                  {err("parentProductId")}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="yield_percent"
                className="mb-1 block text-sm font-medium"
              >
                {L.yieldPercent}
                <span className="text-red-600"> *</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="yield_percent"
                  name="yield_percent"
                  type="number"
                  value={yieldPercent}
                  onChange={(e) => setYieldPercent(e.target.value)}
                  step="0.01"
                  min="0.01"
                  max="999.99"
                  placeholder="เช่น 80.00"
                  className={`${inputClass} max-w-[10rem]`}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                สินค้าแม่ 100 หน่วย ได้สินค้านี้กี่หน่วย (เช่น เนื้อหั่นแล้ว
                yield 80 = เนื้อ 100 kg → ได้ 80 kg)
              </p>
              {showHighYieldHint && (
                <p className="mt-1 text-xs text-amber-600">
                  yield &gt; 300% มักเป็นการดูดน้ำของวัตถุดิบ (เช่น ข้าวสุก,
                  ถั่วแช่น้ำ) — ตรวจสอบอีกครั้งว่าใช่หรือไม่
                </p>
              )}
              {err("yieldPercent") && (
                <p className="mt-1 text-sm text-red-600">{err("yieldPercent")}</p>
              )}
            </div>
          </div>
        )}
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

      {/* 7d: Liquid density (Q5) — placed after หน่วยวัด, hidden entirely when
          COUNT (Q3). 3-state mode: ไม่ระบุ / ใช้ค่ามาตรฐาน / ใส่ค่าเอง. Only the
          active field is rendered, so template-vs-override XOR holds by
          construction; the server still cleanses + zod still guards. */}
      {densityApplies && (
        <section className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h3 className="text-sm font-medium">ความหนาแน่น (ของเหลว)</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              ใช้แปลงหน่วยข้ามน้ำหนัก↔ปริมาตร (เช่น น้ำมัน 1 ลิตร = กี่กรัม) —
              ระบุหรือเว้นว่างก็ได้
            </p>
          </div>

          <div className="space-y-3">
            {/* ( ) ไม่ระบุ */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="density_mode"
                checked={densityMode === "none"}
                onChange={() => onDensityModeChange("none")}
                className="h-4 w-4"
              />
              ไม่ระบุ
            </label>

            {/* ( ) ใช้ค่ามาตรฐาน → dropdown */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="density_mode"
                checked={densityMode === "template"}
                onChange={() => onDensityModeChange("template")}
                className="h-4 w-4"
              />
              ใช้ค่ามาตรฐาน
            </label>
            {densityMode === "template" && (
              <div className="pl-6">
                <select
                  id="liquid_density_template_id"
                  name="liquid_density_template_id"
                  value={densityTemplateId}
                  onChange={(e) => setDensityTemplateId(e.target.value)}
                  className={inputClass}
                >
                  <option value="" disabled>
                    — เลือกค่ามาตรฐาน —
                  </option>
                  {availableTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.gPerMl} g/ml
                    </option>
                  ))}
                </select>
                {err("liquidDensityTemplateId") && (
                  <p className="mt-1 text-sm text-red-600">
                    {err("liquidDensityTemplateId")}
                  </p>
                )}
              </div>
            )}

            {/* ( ) ใส่ค่าเอง → number input + soft hint */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="density_mode"
                checked={densityMode === "custom"}
                onChange={() => onDensityModeChange("custom")}
                className="h-4 w-4"
              />
              ใส่ค่าเอง
            </label>
            {densityMode === "custom" && (
              <div className="pl-6">
                <div className="flex items-center gap-2">
                  <input
                    id="density_g_per_ml_override"
                    name="density_g_per_ml_override"
                    type="number"
                    value={densityOverride}
                    onChange={(e) => setDensityOverride(e.target.value)}
                    step="0.001"
                    min="0"
                    inputMode="decimal"
                    placeholder="1.030"
                    className={`${inputClass} max-w-[10rem]`}
                  />
                  <span className="text-sm text-muted-foreground">g/ml</span>
                </div>
                {showDensityHint && (
                  <p className="mt-1 text-xs text-amber-600">
                    ค่านอกช่วงปกติของเหลวอาหาร (0.5-2.0 g/ml) — กรุณาตรวจสอบ
                  </p>
                )}
                {err("densityGPerMlOverride") && (
                  <p className="mt-1 text-sm text-red-600">
                    {err("densityGPerMlOverride")}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

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

          {rows.map((row) => {
            const usage = unitRecipeUsage.find(
              (u) => u.unitName === row.unitName
            );
            // Only once the number actually differs. A permanent notice under
            // every unit is a notice nobody reads by the third product.
            const ratioMoved =
              usage !== undefined &&
              row.toBaseRatio.trim() !== "" &&
              row.toBaseRatio.trim() !== usage.originalRatio;
            return (
            <div key={row.id} className="space-y-1">
            <div className="flex items-center gap-2">
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

            {/* Q17. The instruction in the recipe has not changed — "1 กระสอบ"
                still says กระสอบ — but the quantity it DENOTES has, and every
                cost figure built on it moves with it. */}
            {ratioMoved && usage ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-medium">
                  แก้อัตราส่วนนี้จะเปลี่ยนปริมาณจริงใน {usage.recipeLabels.length} สูตร
                  ที่เขียนไว้เป็น “{row.unitName}”
                </p>
                <p className="mt-0.5">{usage.recipeLabels.join(" · ")}</p>
                <p className="mt-0.5">
                  ข้อความในสูตรไม่เปลี่ยน แต่ปริมาณที่มันหมายถึงเปลี่ยน —
                  ถ้าอัตราส่วนเดิมผิด นี่คือสิ่งที่ต้องแก้ ไม่ใช่สิ่งที่ต้องเลี่ยง
                </p>
              </div>
            ) : null}
            </div>
            );
          })}
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

      {/* Part 8.5 L5c — restore dialog mounted OUTSIDE the form (it renders its
          own <form>; nested forms are invalid HTML). Gated by showRestoreSuggestion
          so edit never mounts it. onRestored navigates to the restored product. */}
      {showRestoreSuggestion && (
        <RestoreDialog
          candidate={restoreCandidate}
          onClose={() => setRestoreCandidate(null)}
          onRestored={(id) => router.push(`/products/${id}`)}
        />
      )}
    </>
  );
}

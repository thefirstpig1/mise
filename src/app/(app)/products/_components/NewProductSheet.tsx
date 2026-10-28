"use client";

// "+ เพิ่มสินค้า" as a sheet over the list (Kong 2026-10-22, mockup
// https://claude.ai/artifact/9KoNNnZYeQSyA1dVNEfKcr) instead of a page of seven
// boxes. Every field the old form had is here — name, English name, code,
// raw / prepped (made from + %), the counting unit, density, purchase units,
// category — posted through the SAME `createProduct` action, so validation is
// one code path. On save the sheet hands over to the product's own sheet
// (pars, production recipe…), or empties for the next one ("บันทึกแล้วเพิ่มอีก").
//
// The counting unit is never pre-picked: g against kg is the person's call
// (Kong 2026-10-21), and a wrong base unit poisons every cost after it.

import { useEffect, useMemo, useState, useTransition } from "react";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import SelectChip from "@/components/ui/SelectChip";
import { MeasureInput } from "@/components/ui/NumberField";
import { createProduct } from "@/app/(app)/products/actions";
import { orStale } from "@/lib/stale-tab";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";
import { PhotoSlot, Sheet } from "@/app/(app)/menus/_components/sheet-parts";
import type { NewProductForm } from "@/server/product-list";
import type { FuzzyMatchCandidate } from "@/server/product-restore";
import { composePackName, packRatio, sizeUnitsFor } from "@/lib/pack-unit";
import RestoreSuggestionTypeahead from "./RestoreSuggestionTypeahead";
import RestoreDialog from "./RestoreDialog";
import type { ProductView } from "./product-view";

type PackRow = { key: number; box: string; size: string; sizeUnit: string; custom: boolean; name: string; ratio: string };
type Density = "none" | "template" | "custom";
let seq = 0;

/**
 * Kitchen measures are for WRITING recipes, never for counting stock (Kong
 * 2026-10-22): nobody counts fish sauce in pinches. They stay unit templates —
 * the recipe editor uses them — and are only left out of this choice.
 */
const RECIPE_ONLY_UNITS = new Set(["ช้อนชา", "ช้อนโต๊ะ", "ถ้วยตวง", "หยิบมือ"]);

const DIMENSIONS: { key: string; label: string }[] = [
  { key: "WEIGHT", label: "ชั่ง" },
  { key: "VOLUME", label: "ตวง" },
  { key: "COUNT", label: "นับเป็นชิ้น" },
];

async function readForm(): Promise<{ ok: true; form: NewProductForm } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/products?what=newform", { cache: "no-store" });
    if (r.redirected || !r.headers.get("content-type")?.includes("json")) return { ok: false, error: "เปิดไม่ได้ — ลองรีเฟรชหน้า" };
    return await r.json();
  } catch {
    return { ok: false, error: "เชื่อมต่อไม่ได้ — ลองอีกครั้ง" };
  }
}

export default function NewProductSheet({
  products,
  onClose,
  onCreated,
  onRestored,
  onToast,
}: {
  products: ProductView[];
  onClose: () => void;
  /** `again`: the person asked for an empty sheet for the next product. */
  onCreated: (productId: string, again: boolean) => void;
  onRestored: (productId: string) => void;
  onToast: (msg: string) => void;
}) {
  const [form, setForm] = useState<NewProductForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    void readForm().then((r) => (r.ok ? setForm(r.form) : setLoadError(r.error)));
  }, []);

  const blank = () => ({
    name: "",
    nameEn: "",
    sku: "",
    ownSku: false,
    type: "RAW" as "RAW" | "PREPPED",
    parentId: "",
    yieldPct: "100",
    baseUnit: "",
    density: "none" as Density,
    densityId: "",
    densityOwn: "",
    showWeightDensity: false,
    packs: [] as PackRow[],
    buyKey: null as number | null,
    categoryId: "",
  });
  const [d, setD] = useState(blank);
  const set = (patch: Partial<ReturnType<typeof blank>>) => setD((x) => ({ ...x, ...patch }));
  const [restoreCandidate, setRestoreCandidate] = useState<FuzzyMatchCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const dimension = form?.units.find((u) => u.unitName === d.baseUnit)?.unitDimension ?? "";
  const base = unitTh(d.baseUnit);
  const densityShown = dimension === "VOLUME" || (dimension === "WEIGHT" && d.showWeightDensity);

  const packName = (p: PackRow) => (p.custom ? p.name.trim() : composePackName(p.box, p.size, p.sizeUnit));
  const packRatioOf = (p: PackRow) => (p.custom ? p.ratio.trim() : String(packRatio(p.size, p.sizeUnit, d.baseUnit) ?? ""));
  const buyPack = d.packs.find((p) => p.key === d.buyKey) ?? null;
  const dirty = d.name.trim() !== "" || d.baseUnit !== "" || d.packs.length > 0;

  const parents: PickerProduct[] = useMemo(
    () =>
      products
        .filter((p) => p.isActive)
        .map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          imageUrl: p.imageUrl,
          section: p.category?.accountingSection ?? null,
          group: p.category?.groupName ?? null,
          baseUnitName: p.baseUnitName,
        })),
    [products]
  );

  const chooseBase = (u: string) => {
    // A size written in the old base's units would now mean something else.
    setD((x) => ({ ...x, baseUnit: u, packs: x.packs.map((p) => (p.custom ? p : { ...p, sizeUnit: sizeUnitsFor(u).includes(p.sizeUnit) ? p.sizeUnit : "" })) }));
  };
  const addPack = () => {
    const key = ++seq;
    setD((x) => ({ ...x, packs: [...x.packs, { key, box: "", size: "", sizeUnit: sizeUnitsFor(x.baseUnit).length === 1 ? sizeUnitsFor(x.baseUnit)[0] : "", custom: false, name: "", ratio: "" }], buyKey: x.buyKey ?? key }));
  };
  const setPack = (key: number, patch: Partial<PackRow>) => setD((x) => ({ ...x, packs: x.packs.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));

  const close = () => {
    if (dirty) onToast("ปิดแล้ว · ยังไม่ได้บันทึกสินค้านี้");
    onClose();
  };

  const save = (again: boolean) =>
    start(async () => {
      setError(null);
      if (d.name.trim() === "") return setError("ใส่ชื่อสินค้าก่อน");
      if (d.baseUnit === "") return setError("เลือกว่านับสต๊อกเป็นหน่วยอะไร");
      if (d.type === "PREPPED" && d.parentId === "") return setError("เลือกว่าของแปรรูปนี้ทำจากอะไร");
      const bad = d.packs.find((p) => (packName(p) !== "" || p.box || p.size) && (packName(p) === "" || !(Number(packRatioOf(p)) > 0)));
      if (bad) return setError("หน่วยซื้อยังไม่ครบ: ใส่ภาชนะ ขนาด และหน่วยของขนาด");
      const fd = new FormData();
      if (d.ownSku && d.sku.trim()) fd.set("sku", d.sku.trim());
      fd.set("name", d.name.trim());
      fd.set("name_en", d.nameEn.trim());
      fd.set("primary_dimension", dimension);
      fd.set("base_unit_name", d.baseUnit);
      fd.set("category_id", d.categoryId);
      fd.set("is_active", "on");
      for (const p of d.packs) {
        if (packName(p) === "") continue;
        fd.append("additional_unit_name", packName(p));
        fd.append("additional_unit_ratio", packRatioOf(p));
      }
      fd.set("default_buy_unit_name", buyPack && packName(buyPack) ? packName(buyPack) : d.baseUnit);
      fd.set("type", d.type);
      fd.set("parent_product_id", d.type === "PREPPED" ? d.parentId : "");
      fd.set("yield_percent", d.type === "PREPPED" ? d.yieldPct : "");
      fd.set("liquid_density_template_id", densityShown && d.density === "template" ? d.densityId : "");
      fd.set("density_g_per_ml_override", densityShown && d.density === "custom" ? d.densityOwn : "");
      const res = await orStale(createProduct({ ok: false }, fd));
      if (!res.ok) return setError(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? "บันทึกไม่ได้");
      onToast(again ? `เพิ่ม “${d.name.trim()}” แล้ว · ใส่ตัวต่อไปได้เลย` : `เพิ่ม “${d.name.trim()}” แล้ว`);
      if (again) {
        setD(blank());
        void readForm().then((r) => r.ok && setForm(r.form));
      }
      onCreated(res.productId, again);
    });

  const preview = buyPack && packName(buyPack) ? `${packName(buyPack)} (= ${Number(packRatioOf(buyPack))} ${base})` : base || "—";

  return (
    <Sheet onClose={close} labelledBy="new-product-title">
      <div className="relative flex flex-col gap-4 border-b border-border bg-surface px-5 py-4 sm:flex-row sm:items-start">
        <PhotoSlot label="รูปสินค้า" className="aspect-[4/3] w-full sm:w-[200px]" />
        <div className="min-w-0 flex-1 space-y-2.5 pr-8">
          <p id="new-product-title" className="text-xs text-muted-subtle">
            สินค้าใหม่ ·{" "}
            {d.ownSku ? (
              <input value={d.sku} onChange={(e) => set({ sku: e.target.value })} placeholder={form?.nextSku ?? "P-0001"} aria-label="รหัสสินค้า" className="input inline-block w-28 py-0 text-xs" />
            ) : (
              <>
                จะได้รหัส <b className="tabular-nums text-foreground">{form?.nextSku ?? "…"}</b> อัตโนมัติ ·{" "}
                <button type="button" onClick={() => set({ ownSku: true })} className="text-primary underline decoration-dotted underline-offset-4">
                  ตั้งรหัสเอง
                </button>
              </>
            )}
          </p>
          <label className="grid gap-0.5">
            <span className="pl-2.5 text-[11px] text-muted-subtle">ชื่อสินค้า</span>
            <RestoreSuggestionTypeahead
              id="new-product-name"
              value={d.name}
              onChange={(v) => set({ name: v })}
              onCandidateSelected={setRestoreCandidate}
              placeholder="เช่น กระเทียม, น้ำปลา, กล่องข้าว"
              inputClassName="input w-full text-base font-semibold"
            />
          </label>
          <label className="grid gap-0.5">
            <span className="pl-2.5 text-[11px] text-muted-subtle">ชื่อภาษาอังกฤษ (ไม่บังคับ)</span>
            <input value={d.nameEn} onChange={(e) => set({ nameEn: e.target.value })} placeholder="เช่น Garlic" className="input w-full py-1 text-sm" />
          </label>
        </div>
        <button type="button" onClick={close} aria-label="ปิด" className="absolute right-3 top-3 rounded-lg px-2 text-2xl leading-none text-muted-foreground hover:bg-muted">
          ×
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {loadError && <p className="text-sm text-bad">{loadError}</p>}

        <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <h4 className="font-semibold">เป็นของแบบไหน</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["RAW", "วัตถุดิบ", "ซื้อมาใช้เลย เช่น กระเทียม น้ำปลา กล่องข้าว"],
                ["PREPPED", "ของแปรรูป", "ทำเองจากของอื่น เช่น ข้าวสวย กุ้งแกะ น้ำจิ้ม"],
              ] as const
            ).map(([t, label, hint]) => (
              <button
                key={t}
                type="button"
                onClick={() => set({ type: t })}
                aria-pressed={d.type === t}
                className={`grid gap-0.5 rounded-xl border-[1.5px] px-3.5 py-3 text-left transition-colors ${d.type === t ? "border-primary bg-highlight" : "border-border hover:border-border-strong"}`}
              >
                <b className="font-display">{label}</b>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
          {d.type === "PREPPED" && (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-muted-foreground">ทำจากของตัวเดียว + % ที่ได้ · ถ้าทำจากหลายอย่าง ตั้ง “สูตรผลิต” ต่อได้ในแผงหลังบันทึก</p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                ทำจาก
                <div className="min-w-[14rem] flex-1">
                  <ProductPicker products={parents} value={d.parentId} onChange={(id) => set({ parentId: id })} placeholder="ค้นหาสินค้าที่ใช้ทำ" />
                </div>
                1 หน่วย ได้
                <MeasureInput size="sm" unit="%" min="0.01" value={d.yieldPct} onChange={(e) => set({ yieldPct: e.target.value })} aria-label="% ที่ได้" boxClassName="w-24" />
              </div>
              {Number(d.yieldPct) > 300 && <p className="text-xs text-muted-foreground">เกิน 300% · ปกติสำหรับของที่พองตอนปรุง เช่น ข้าวสาร → ข้าวสวย</p>}
            </div>
          )}
        </section>

        <section className="space-y-2.5 rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-semibold">นับสต๊อกเป็น</h4>
            <span className="text-xs text-muted-foreground">หน่วยที่นับ · ต้นทุนคิดต่อหน่วยนี้ · เปลี่ยนภายหลังยาก</span>
          </div>
          {!form && !loadError && <div className="h-20 animate-pulse rounded-lg bg-muted" />}
          {form &&
            DIMENSIONS.map((g) => {
              const us = form.units.filter((u) => u.unitDimension === g.key && !RECIPE_ONLY_UNITS.has(u.unitName));
              if (us.length === 0) return null;
              return (
                <div key={g.key} className="space-y-1">
                  <p className="text-[11px] text-muted-subtle">{g.label}</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={g.label}>
                    {us.map((u) => (
                      <button
                        key={u.unitName}
                        type="button"
                        onClick={() => chooseBase(u.unitName)}
                        aria-pressed={d.baseUnit === u.unitName}
                        className={`rounded-full border px-3.5 py-1 text-sm transition-colors ${d.baseUnit === u.unitName ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-surface hover:bg-muted"}`}
                      >
                        {unitTh(u.unitName)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          {dimension === "WEIGHT" && !d.showWeightDensity && (
            <button type="button" onClick={() => set({ showWeightDensity: true })} className="text-xs text-primary underline decoration-dotted underline-offset-4">
              สูตรตวงของนี้เป็นช้อนหรือถ้วยด้วย? ตั้งความหนาแน่น
            </button>
          )}
          {densityShown && (
            <div className="space-y-1.5 border-t border-border pt-2.5 text-sm">
              <p className="text-xs text-muted-foreground">
                {dimension === "VOLUME" ? "ของเหลวนี้ 1 ml หนักกี่ g?" : "ของนี้ 1 ml หนักกี่ g?"} <span className="text-muted-subtle">(ไม่บังคับ · ใช้เมื่อสูตรเขียนคนละแบบกับที่นับ)</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <SelectChip
                  size="sm"
                  value={d.density === "template" ? d.densityId : d.density === "custom" ? "__own" : ""}
                  onChange={(v) => (v === "" ? set({ density: "none", densityId: "" }) : v === "__own" ? set({ density: "custom", densityId: "" }) : set({ density: "template", densityId: v }))}
                  placeholder="ไม่ระบุ"
                  options={[
                    { value: "", label: "ไม่ระบุ" },
                    ...(form?.densities ?? []).map((t) => ({ value: t.id, label: `${t.name} ~${Number(t.gPerMl)} g` })),
                    { value: "__own", label: "ใส่ค่าเอง" },
                  ]}
                  className="w-56"
                  selectProps={{ "aria-label": "ความหนาแน่น" }}
                />
                {d.density === "custom" && <MeasureInput size="sm" unit="g / ml" min="0.01" value={d.densityOwn} onChange={(e) => set({ densityOwn: e.target.value })} aria-label="g ต่อ ml" boxClassName="w-32" />}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-semibold">ซื้อมาเป็น</h4>
            <span className="text-xs text-muted-foreground">ใช้ตอนสั่งซื้อ รับของ และนับ</span>
          </div>
          {d.baseUnit === "" ? (
            <p className="text-xs text-muted-foreground">เลือกหน่วยที่นับก่อน แล้วค่อยใส่ขนาดที่ซื้อ</p>
          ) : (
            <>
              {d.packs.length === 0 && <p className="text-xs text-muted-foreground">ถ้าซื้อเป็น {base} ตรง ๆ ไม่ต้องเพิ่ม · ถ้าซื้อเป็นถุงหรือลัง ใส่ภาชนะกับขนาด เช่น ถุง 500 g ระบบเขียนชื่อให้เอง</p>}
              {d.packs.map((p) => (
                <div key={p.key} className="flex flex-wrap items-center gap-1.5 border-b border-border py-1.5 text-sm last:border-b-0">
                  {p.custom ? (
                    <>
                      <input value={p.name} onChange={(e) => setPack(p.key, { name: e.target.value })} placeholder="ชื่อหน่วย เช่น ลัง 24 กล่อง" className="input w-48 py-0.5" aria-label="ชื่อหน่วย" />
                      =
                      <MeasureInput size="sm" unit={base} min="0" value={p.ratio} onChange={(e) => setPack(p.key, { ratio: e.target.value })} aria-label="เท่ากับ" boxClassName="w-28" />
                    </>
                  ) : (
                    <>
                      <input value={p.box} onChange={(e) => setPack(p.key, { box: e.target.value })} placeholder="ถุง" className="input w-24 py-0.5" aria-label="ภาชนะ" />
                      <span className="text-xs text-muted-foreground">บรรจุ</span>
                      <MeasureInput size="sm" unit="" min="0" value={p.size} onChange={(e) => setPack(p.key, { size: e.target.value })} aria-label="ขนาด" boxClassName="w-24" />
                      {sizeUnitsFor(d.baseUnit).length > 1 ? (
                        <SelectChip
                          size="sm"
                          value={p.sizeUnit}
                          onChange={(v) => setPack(p.key, { sizeUnit: v })}
                          placeholder="หน่วย"
                          tone={p.sizeUnit ? "default" : "warn"}
                          options={sizeUnitsFor(d.baseUnit).map((x) => ({ value: x, label: x }))}
                          className="w-24"
                          selectProps={{ "aria-label": "หน่วยของขนาด" }}
                        />
                      ) : (
                        base
                      )}
                    </>
                  )}
                  <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="radio" name="new-buy" checked={d.buyKey === p.key} onChange={() => set({ buyKey: p.key })} />
                    ซื้อหลัก
                  </label>
                  <button
                    type="button"
                    onClick={() => setPack(p.key, p.custom ? { custom: false } : { custom: true, name: packName(p), ratio: packRatioOf(p) })}
                    className="text-xs text-primary underline"
                  >
                    {p.custom ? "ใช้ชื่ออัตโนมัติ" : "ตั้งชื่อเอง"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setD((x) => ({ ...x, packs: x.packs.filter((y) => y.key !== p.key), buyKey: x.buyKey === p.key ? null : x.buyKey }))}
                    className="rounded px-1.5 text-muted-subtle hover:bg-bad-bg hover:text-bad"
                    aria-label="ลบหน่วยนี้"
                  >
                    ×
                  </button>
                  {!p.custom && packName(p) && (
                    <p className="basis-full text-xs text-muted-foreground">
                      จะแสดงเป็น <span className="font-medium text-foreground">{packName(p)}</span>
                      {p.sizeUnit !== base && packRatioOf(p) && <span> · = {Number(packRatioOf(p))} {base}</span>}
                    </p>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={addPack} className="rounded-full border border-border-strong px-3 py-1 text-sm hover:bg-muted">
                  + เพิ่มขนาด
                </button>
                {d.packs.length > 0 && (
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="radio" name="new-buy" checked={d.buyKey === null} onChange={() => set({ buyKey: null })} />
                    ซื้อเป็น {base} ตรง ๆ เป็นหลัก
                  </label>
                )}
              </div>
            </>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <label className="grid max-w-sm gap-0.5">
            <span className="pl-2.5 text-[11px] text-muted-subtle">หมวด</span>
            <select value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className="w-full rounded-full border border-border bg-surface px-2.5 py-1 text-sm">
              <option value="">— ไม่ระบุหมวด —</option>
              {(form?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-0.5 rounded-xl border border-dashed border-border-strong bg-surface-sunk px-3 py-2.5 text-sm">
            <p className="text-xs text-muted-subtle">จะเห็นในใบสั่งซื้อและใบรับของแบบนี้</p>
            <p>
              <b className="font-display">{d.name.trim() || "ชื่อสินค้า"}</b> · {preview} · <span className="tabular-nums">{d.ownSku && d.sku.trim() ? d.sku.trim() : (form?.nextSku ?? "…")}</span>
            </p>
            <p className="text-xs text-muted-subtle">{d.baseUnit ? `นับสต๊อกเป็น ${base} · ต้นทุนคิดต่อ ${base}` : "ยังไม่ได้เลือกหน่วยที่นับ"}</p>
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-5 py-3">
        <span className="text-xs">{error ? <span className="text-bad">{error}</span> : <span className="text-muted-foreground">ยังไม่ได้บันทึก</span>}</span>
        <span className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={close} disabled={busy} className="rounded-full border border-border-strong px-4 py-1.5 text-sm hover:bg-muted">
            ยกเลิก
          </button>
          <button type="button" onClick={() => save(true)} disabled={busy || !form} className="rounded-full border border-border-strong px-4 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            บันทึกแล้วเพิ่มอีก
          </button>
          <button type="button" onClick={() => save(false)} disabled={busy || !form} className="btn disabled:opacity-50">
            {busy ? "กำลังบันทึก…" : "บันทึกสินค้า"}
          </button>
        </span>
      </div>

      {restoreCandidate && <RestoreDialog candidate={restoreCandidate} onClose={() => setRestoreCandidate(null)} onRestored={onRestored} />}
    </Sheet>
  );
}

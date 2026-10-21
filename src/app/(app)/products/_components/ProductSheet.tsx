"use client";

// One product, as the products screen's main panel (Kong 2026-10-21, mockup
// https://claude.ai/artifact/AJiZcD1N3HUJAz6wkkVeSf). It IS the ingredient
// sheet "จัดการเมนู" stacks over a dish — figures, how it is made, receipts,
// dishes that use it — plus what only this screen edits: the name and details,
// purchase/count units, and par per branch. One บันทึก saves it all; × closes
// without saving and says so.
//
// The details post through the same `updateProduct` action as the full form,
// so validation and the unit guard (ProductUnitInUseError) are one code path.
// Changing what the product IS (raw ↔ prepped, weight ↔ volume, density) stays
// on the full form, linked from here.

import { useEffect, useMemo, useState } from "react";
import { updateProduct, deleteProduct } from "@/app/(app)/products/actions";
import { setParLevelAction, deleteParLevelAction } from "@/app/(app)/stock/par-level-actions";
import IngredientSheet, { type SheetExtra } from "@/app/(app)/menus/_components/IngredientSheet";
import type { Option, Perm } from "@/app/(app)/menus/_components/MenuManager";
import type { IngredientOption, PriceBook, StandardUnit } from "@/server/menu-manager";
import type { ProductSheetForm } from "@/server/product-list";
import { orStale } from "@/lib/stale-tab";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";
import { ConfirmDialog, type ConfirmSpec } from "@/app/(app)/menus/_components/sheet-parts";
import type { ProductView } from "./product-view";

type UnitRow = { key: string; id: string | null; unitName: string; ratio: string; buy: boolean };
type ParRow = { id: string | null; qty: string; unitId: string };
let seq = 0;

async function readForm(id: string): Promise<{ ok: true; form: ProductSheetForm } | { ok: false; error: string }> {
  try {
    const r = await fetch(`/api/products?what=sheet&id=${id}`, { cache: "no-store" });
    if (r.redirected || !r.headers.get("content-type")?.includes("json")) return { ok: false, error: "เปิดไม่ได้ — ลองรีเฟรชหน้า" };
    return await r.json();
  } catch {
    return { ok: false, error: "เชื่อมต่อไม่ได้ — ลองอีกครั้ง" };
  }
}

export default function ProductSheet({
  product,
  branch,
  branches,
  today,
  costHidden,
  perm,
  canEditInfo,
  canEditPar,
  book,
  options,
  standards,
  onClose,
  onToast,
  onSaved,
  onDeleted,
}: {
  product: ProductView;
  branch: Option;
  branches: Option[];
  today: string;
  costHidden: boolean;
  perm: Perm;
  canEditInfo: boolean;
  canEditPar: boolean;
  book: PriceBook | null;
  options: IngredientOption[] | null;
  standards: StandardUnit[];
  onClose: () => void;
  onToast: (msg: string) => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState<ProductSheetForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // ---- the editable state, and the copy it is compared against ----
  const base = useMemo(() => {
    const units: UnitRow[] = (form?.units ?? [])
      .filter((u) => !u.isBase)
      .map((u) => ({ key: `u${++seq}`, id: u.id, unitName: u.unitName, ratio: String(u.toBaseRatio), buy: u.isDefaultBuyUnit }));
    const pars: Record<string, ParRow> = {};
    const baseUnitId = form?.units.find((u) => u.isBase)?.id ?? "";
    for (const b of branches) {
      const p = form?.pars.find((x) => x.branchId === b.id);
      pars[b.id] = p ? { id: p.id, qty: String(p.inputQty), unitId: p.inputUnitId } : { id: null, qty: "", unitId: baseUnitId };
    }
    return { name: product.name, nameEn: product.nameEn ?? "", categoryId: product.categoryId ?? "", active: product.isActive, units, pars };
  }, [form, product, branches]);
  const [draft, setDraft] = useState(base);
  useEffect(() => setDraft(base), [base]);

  useEffect(() => {
    let on = true;
    void readForm(product.id).then((r) => on && (r.ok ? setForm(r.form) : setFormError(r.error)));
    return () => {
      on = false;
    };
  }, [product.id]);

  const baseUnit = product.baseUnitName ?? "";
  const locked = new Set(form?.lockedUnitIds ?? []);
  const sig = (u: UnitRow[]) => JSON.stringify(u.map((x) => [x.unitName.trim(), Number(x.ratio), x.buy]));
  const infoDirty =
    form !== null &&
    (draft.name.trim() !== base.name || draft.nameEn.trim() !== base.nameEn || draft.categoryId !== base.categoryId || draft.active !== base.active || sig(draft.units) !== sig(base.units));
  const parDirtyIds = branches.filter((b) => {
    const a = draft.pars[b.id], o = base.pars[b.id];
    return a && o && (a.qty.trim() !== o.qty || (a.qty.trim() !== "" && a.unitId !== o.unitId));
  });
  const dirty = [...(infoDirty ? ["ข้อมูลสินค้า"] : []), ...(parDirtyIds.length ? ["ขั้นต่ำ"] : [])];

  // A unit whose SIZE changes moves every recipe written in it (Part 21 Q17).
  const resized = draft.units.filter((u) => {
    const o = base.units.find((x) => x.id !== null && x.id === u.id);
    return o && Number(o.ratio) !== Number(u.ratio);
  });
  // Only a unit something was WRITTEN in moves anything — the lock set says which.
  const resizedInUse = resized.filter((u) => u.id !== null && locked.has(u.id));
  const confirm =
    resizedInUse.length > 0
      ? {
          lines: resizedInUse.map((u) => `${u.unitName}: ${base.units.find((x) => x.id === u.id)?.ratio} → ${u.ratio} ${unitTh(baseUnit)}`),
          who: "หน่วยนี้มีสูตรหรือเอกสารใช้อยู่ · ทุกตัวเลขที่บันทึกด้วยหน่วยนี้ (สูตร การนับ การรับของ) จะคิดด้วยขนาดใหม่ · ทุกสาขา",
        }
      : null;

  const save = async (): Promise<boolean> => {
    if (infoDirty) {
      const fd = new FormData();
      fd.set("sku", product.sku);
      fd.set("name", draft.name.trim());
      fd.set("name_en", draft.nameEn.trim());
      fd.set("primary_dimension", product.primaryDimension);
      fd.set("base_unit_name", baseUnit);
      fd.set("category_id", draft.categoryId);
      if (draft.active) fd.set("is_active", "on");
      for (const u of draft.units) {
        fd.append("additional_unit_name", u.unitName);
        fd.append("additional_unit_ratio", u.ratio);
      }
      fd.set("default_buy_unit_name", draft.units.find((u) => u.buy && u.unitName.trim())?.unitName.trim() ?? baseUnit);
      fd.set("type", product.type);
      fd.set("parent_product_id", product.parentProductId ?? "");
      fd.set("yield_percent", product.yieldPercent ?? "");
      fd.set("liquid_density_template_id", product.liquidDensityTemplateId ?? "");
      fd.set("density_g_per_ml_override", product.densityGPerMlOverride ?? "");
      const res = await orStale(updateProduct(product.id, { ok: false }, fd));
      if (!res.ok) {
        onToast(("formError" in res && res.formError) || Object.values(("fieldErrors" in res && res.fieldErrors) || {})[0] || "บันทึกไม่ได้");
        return false;
      }
    }
    for (const b of parDirtyIds) {
      const a = draft.pars[b.id];
      const fd = new FormData();
      if (a.qty.trim() === "") {
        if (!a.id) continue;
        fd.set("id", a.id);
        const res = await orStale(deleteParLevelAction({ ok: false }, fd));
        if (!res.ok) return onToast(`ลบขั้นต่ำของ${b.name}ไม่ได้`), false;
      } else {
        fd.set("product_id", product.id);
        fd.set("branch_id", b.id);
        fd.set("input_qty", a.qty.trim());
        fd.set("input_unit_id", a.unitId);
        const res = await orStale(setParLevelAction({ ok: false }, fd));
        if (!res.ok) {
          onToast(`ขั้นต่ำของ${b.name}: ${("formError" in res && res.formError) || Object.values(("fieldErrors" in res && res.fieldErrors) || {})[0] || "บันทึกไม่ได้"}`);
          return false;
        }
      }
    }
    onSaved();
    const r = await readForm(product.id);
    if (r.ok) setForm(r.form);
    return true;
  };

  const [ask, setAsk] = useState<ConfirmSpec | null>(null);
  const askDelete = () =>
    setAsk({
      title: `ลบ${product.name}?`,
      lines: [],
      money: null,
      who: "สินค้าที่อยู่ในสูตรหรือมีของแปรรูปทำจากมันลบไม่ได้ — ใช้ “ใช้งานอยู่” ปิดแทน ข้อมูลเก่ายังอยู่ครบ",
      go: "ลบสินค้า",
      onGo: async () => {
        const res = await deleteProduct(product.id).catch(() => ({ ok: false, error: "ลบไม่ได้" }));
        if (!res.ok) return onToast(res.error ?? "ลบไม่ได้");
        onToast(`ลบ${product.name}แล้ว`);
        onDeleted();
      },
    });

  const setUnit = (key: string, patch: Partial<UnitRow>) => setDraft((d) => ({ ...d, units: d.units.map((u) => (u.key === key ? { ...u, ...patch } : u)) }));
  const unitOptions = [{ id: form?.units.find((u) => u.isBase)?.id ?? "", unitName: baseUnit }, ...(form?.units.filter((u) => !u.isBase).map((u) => ({ id: u.id, unitName: u.unitName })) ?? [])];

  const sections = (
    <>
      {canEditPar && (
        <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-semibold">ขั้นต่ำที่ควรมี</h4>
            <span className="text-xs text-muted-foreground">ต่ำกว่านี้ขึ้นเตือนสีแดง และใช้เสนอจำนวนในใบขอซื้อ · เว้นว่าง = ไม่ตั้ง</span>
          </div>
          {!form ? (
            <div className="h-10 animate-pulse rounded-lg bg-muted" />
          ) : (
            branches.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{b.name}</span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={draft.pars[b.id]?.qty ?? ""}
                    placeholder="ไม่ตั้ง"
                    onChange={(e) => setDraft((d) => ({ ...d, pars: { ...d.pars, [b.id]: { ...d.pars[b.id], qty: e.target.value } } }))}
                    className="input w-24 py-0.5 text-right tabular-nums"
                    aria-label={`ขั้นต่ำ ${b.name}`}
                  />
                  <select
                    value={draft.pars[b.id]?.unitId ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, pars: { ...d.pars, [b.id]: { ...d.pars[b.id], unitId: e.target.value } } }))}
                    className="rounded border border-border bg-surface px-1 py-0.5 text-sm"
                    aria-label={`หน่วยขั้นต่ำ ${b.name}`}
                  >
                    {unitOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {unitTh(u.unitName)}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            ))
          )}
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="font-semibold">ข้อมูลสินค้า</h4>
          <span className="text-xs text-muted-foreground">รหัส {product.sku} (เปลี่ยนไม่ได้)</span>
        </div>
        {formError && <p className="text-sm text-bad">{formError}</p>}
        {!form ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs text-muted-foreground">
                ชื่อภาษาอังกฤษ (ไม่บังคับ)
                <input value={draft.nameEn} disabled={!canEditInfo} onChange={(e) => setDraft((d) => ({ ...d, nameEn: e.target.value }))} placeholder="เช่น Jasmine rice" className="input py-1 text-sm text-foreground" />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                หมวด
                <select value={draft.categoryId} disabled={!canEditInfo} onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))} className="input py-1 text-sm text-foreground">
                  <option value="">— ไม่ระบุ —</option>
                  {form.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h5 className="text-sm font-semibold">หน่วยซื้อและหน่วยนับเพิ่ม</h5>
              <span className="text-xs text-muted-foreground">นับสต๊อกเป็น {unitTh(baseUnit)} · ใช้ตอนสั่งซื้อ รับของ และนับหลายหน่วย</span>
            </div>
            {draft.units.length === 0 && <p className="text-xs text-muted-foreground">ยังไม่มี · เช่น กระสอบ 15 กก. แพ็ค 12 ขวด</p>}
            {draft.units.map((u) => {
              const isLocked = u.id !== null && locked.has(u.id);
              return (
                <div key={u.key} className="flex flex-wrap items-center gap-1.5 text-sm">
                  <input
                    value={u.unitName}
                    disabled={!canEditInfo || isLocked}
                    onChange={(e) => setUnit(u.key, { unitName: e.target.value })}
                    placeholder="ชื่อหน่วย"
                    className="input w-40 py-0.5"
                    aria-label="ชื่อหน่วย"
                    title={isLocked ? "ใช้ในสูตรหรือเอกสารแล้ว เปลี่ยนชื่อไม่ได้ แก้ตัวเลขได้" : undefined}
                  />
                  =
                  <input type="number" step="any" min="0" value={u.ratio} disabled={!canEditInfo} onChange={(e) => setUnit(u.key, { ratio: e.target.value })} className="input w-24 py-0.5 text-right tabular-nums" aria-label={`${u.unitName} เท่ากับ`} />
                  {unitTh(baseUnit)}
                  <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="radio" name="buy" checked={u.buy} disabled={!canEditInfo} onChange={() => setDraft((d) => ({ ...d, units: d.units.map((x) => ({ ...x, buy: x.key === u.key })) }))} />
                    ซื้อหลัก
                  </label>
                  {canEditInfo &&
                    (isLocked ? (
                      <span className="text-xs text-muted-subtle" title="ใช้ในสูตรหรือเอกสารแล้ว ลบไม่ได้ แก้ตัวเลขได้">
                        🔒
                      </span>
                    ) : (
                      <button type="button" onClick={() => setDraft((d) => ({ ...d, units: d.units.filter((x) => x.key !== u.key) }))} className="rounded px-1.5 text-muted-subtle hover:bg-bad-bg hover:text-bad" aria-label={`ลบหน่วย ${u.unitName}`}>
                        ×
                      </button>
                    ))}
                </div>
              );
            })}
            {canEditInfo && (
              <button type="button" onClick={() => setDraft((d) => ({ ...d, units: [...d.units, { key: `u${++seq}`, id: null, unitName: "", ratio: "", buy: false }] }))} className="justify-self-start rounded-full border border-border-strong px-3 py-0.5 text-xs hover:bg-muted">
                + เพิ่มหน่วย
              </button>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.active} disabled={!canEditInfo} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} />
              ใช้งานอยู่ <span className="text-xs text-muted-foreground">(ปิดแล้วไม่ขึ้นในตัวเลือกตอนสั่งซื้อ/รับของ ข้อมูลเก่ายังอยู่)</span>
            </label>
            {canEditInfo && (
              <a href={`/products/${product.id}`} className="justify-self-start text-xs text-primary underline">
                แก้แบบละเอียด: ประเภท หน่วยวัดหลัก ความหนาแน่น
              </a>
            )}
          </>
        )}
      </section>
    </>
  );

  const extra: SheetExtra = {
    title: (
      <input
        id="ing-title"
        value={draft.name}
        disabled={!canEditInfo}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        aria-label="ชื่อสินค้า"
        className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 -ml-1.5 font-display text-lg font-semibold hover:border-border focus:border-border focus:bg-surface-sunk"
      />
    ),
    sections,
    dirty,
    confirm,
    save,
    footerLeft: canEditInfo ? (
      <button type="button" onClick={askDelete} className="rounded-full border border-border-strong px-3 py-1 text-sm text-bad hover:bg-bad-bg">
        ลบสินค้า
      </button>
    ) : undefined,
  };

  return (
    <>
      <IngredientSheet
        productId={product.id}
        branch={branch}
        today={today}
        inThisDish={null}
        costHidden={costHidden}
        perm={perm}
        book={book}
        options={options}
        standards={standards}
        onClose={onClose}
        onToast={onToast}
        onPreppedSaved={onSaved}
        stacked={false}
        extra={extra}
      />
      {ask && <ConfirmDialog spec={ask} onClose={() => setAsk(null)} />}
    </>
  );
}

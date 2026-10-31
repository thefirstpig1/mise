"use client";

// ADR 0040 step 7 — บันทึกการผลิต (mockup 5rcGTWvS3qBw5dNUhoLxa6, Kong 2026-10-29
// "เอาตามแนะนำ"). Three taps for a pot of soup: pick it, say how many pots, save.
// The ingredients fill from the recipe × pots (Apicbase's "scale the recipe,
// never retype it"); "ได้จริง" fills from the recipe and nobody is asked to weigh
// it (Q3). A trim takes the whole thing's weight and fills each part by its
// % of weight (Q7). Money shows only to someone with cost:view.

import { useEffect, useMemo, useState } from "react";
import { addDays } from "@/lib/bangkok-date";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import QtyStepper from "@/components/ui/QtyStepper";
import { Sheet } from "@/app/(app)/menus/_components/sheet-parts";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";
import { readApi } from "@/lib/read-api";
import { orStale } from "@/lib/stale-tab";
import { PRODUCTION_BACKDATE_DAYS } from "@/lib/validations/production";
import type { PickableProduct, ProductionForm, TrimForm, UnitOption } from "@/server/production-read";
import { recordProductionAction, type ProductionActionResult } from "../actions";

type Mode = "make" | "trim";
type Line = { productId: string; name: string; qty: string; unitId: string; units: UnitOption[] };

const num = (s: string) => {
  const v = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(v) ? v : NaN;
};
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const show = (v: number) => (Number.isFinite(v) ? v.toLocaleString("th-TH", { maximumFractionDigits: 3 }) : "—");
const baht = (v: number, dp = 2) => `฿${v.toLocaleString("th-TH", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const ratioOf = (units: UnitOption[], id: string) => units.find((u) => u.id === id)?.ratio ?? 1;
const baseOf = (units: UnitOption[]) => units.find((u) => u.isBase) ?? units[0];

const toPicker = (p: PickableProduct): PickerProduct => ({ ...p, imageUrl: null });

export default function RecordProductionSheet({
  branches,
  defaultBranchId,
  make,
  trim,
  today,
  costHidden,
  initial,
  onClose,
  onDone,
}: {
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  make: PickableProduct[];
  trim: PickableProduct[];
  /** YYYY-MM-DD, Bangkok. */
  today: string;
  costHidden: boolean;
  initial?: { mode: Mode; productId: string };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "make");
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [productId, setProductId] = useState(initial?.mode === "make" ? initial.productId : "");
  const [parentId, setParentId] = useState(initial?.mode === "trim" ? initial.productId : "");
  const [form, setForm] = useState<ProductionForm | null>(null);
  const [trimForm, setTrimForm] = useState<TrimForm | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitKey] = useState(() => crypto.randomUUID());

  // make
  const [pots, setPots] = useState("1");
  const [lines, setLines] = useState<Line[]>([]);
  const [outQty, setOutQty] = useState("");
  const [parentQty, setParentQty] = useState("");
  // trim
  const [trimId, setTrimId] = useState("");
  const [wholeQty, setWholeQty] = useState("");
  const [parts, setParts] = useState<{ productId: string | null; name: string; qty: string; weightPct: number; valuePct: number; unit: string; unitId: string }[]>([]);
  // when
  const [when, setWhen] = useState<"today" | "yesterday" | "pick">("today");
  const [picked, setPicked] = useState(today);
  const minDay = addDays(new Date(`${today}T00:00:00Z`), -PRODUCTION_BACKDATE_DAYS).toISOString().slice(0, 10);
  const producedOn = when === "today" ? today : when === "yesterday" ? addDays(new Date(`${today}T00:00:00Z`), -1).toISOString().slice(0, 10) : picked;

  // ---- load the recipe for what is being made ----
  useEffect(() => {
    if (mode !== "make" || !productId) return;
    let on = true;
    setLoading(true);
    setError(null);
    setForm(null);
    void readApi<{ ok: true; form: ProductionForm }>("/api/production", "form", { productId, branchId }).then((r) => {
      if (!on) return;
      setLoading(false);
      if (!r.ok) return setError(r.formError);
      setForm(r.form);
      setPots("1");
      if (r.form.kind === "RECIPE") {
        setLines(r.form.lines.map((l) => ({ productId: l.productId, name: l.name, qty: String(r3(l.qty)), unitId: l.unitId, units: l.units })));
        setOutQty(String(r3(r.form.batchBaseQty)));
      } else {
        setLines([]);
        setOutQty("");
        setParentQty("");
      }
    });
    return () => {
      on = false;
    };
  }, [mode, productId, branchId]);

  // ---- load the trim recipes of the whole thing ----
  useEffect(() => {
    if (mode !== "trim" || !parentId) return;
    let on = true;
    setLoading(true);
    setError(null);
    setTrimForm(null);
    void readApi<{ ok: true; form: TrimForm }>("/api/production", "trim", { parentId, branchId }).then((r) => {
      if (!on) return;
      setLoading(false);
      if (!r.ok) return setError(r.formError);
      setTrimForm(r.form);
      setTrimId(r.form.recipes[0]?.id ?? "");
      setWholeQty("");
    });
    return () => {
      on = false;
    };
  }, [mode, parentId, branchId]);

  const recipe = trimForm?.recipes.find((t) => t.id === trimId) ?? null;
  const parentBase = trimForm ? baseOf(trimForm.parent.units) : undefined;

  // Parts follow the whole weight until someone types over them.
  useEffect(() => {
    if (!recipe) return setParts([]);
    const whole = num(wholeQty);
    setParts(
      recipe.parts.map((p) => {
        const base = p.units.length ? baseOf(p.units) : undefined;
        return {
          productId: p.productId,
          name: p.name,
          qty: Number.isFinite(whole) && whole > 0 ? String(r3((whole * p.weightPct) / 100)) : "",
          weightPct: p.weightPct,
          valuePct: p.valuePct,
          unit: base?.unitName ?? parentBase?.unitName ?? "",
          unitId: base?.id ?? "",
        };
      })
    );
  }, [recipe, wholeQty, parentBase?.unitName]);

  const scalePots = (v: string) => {
    setPots(v);
    const k = num(v);
    if (!form || form.kind !== "RECIPE" || !Number.isFinite(k) || k <= 0) return;
    setLines(form.lines.map((l) => ({ productId: l.productId, name: l.name, qty: String(r3(l.qty * k)), unitId: l.unitId, units: l.units })));
    setOutQty(String(r3(form.batchBaseQty * k)));
  };

  // ---- the money, for someone allowed to see it ----
  const cost = useMemo(() => {
    if (costHidden) return null;
    // What cannot be priced here is NAMED, never counted as ฿0: an ingredient
    // this branch has never bought has no price at this branch.
    if (mode === "make" && form?.kind === "RECIPE" && form.unitCost) {
      let total = 0;
      const missing: string[] = [];
      for (const l of lines) {
        const c = form.unitCost[l.productId];
        if (c === undefined) {
          if (num(l.qty) > 0) missing.push(l.name);
          continue;
        }
        total += num(l.qty) * ratioOf(l.units, l.unitId) * c;
      }
      const out = num(outQty);
      return { total, per: out > 0 && missing.length === 0 ? total / out : null, missing };
    }
    if (mode === "make" && form?.kind === "PARENT" && form.unitCost) {
      const c = form.unitCost[form.parent.id];
      if (c === undefined) return { total: 0, per: null, missing: [form.parent.name] };
      const total = num(parentQty) * c;
      const out = num(outQty);
      return { total, per: out > 0 ? total / out : null, missing: [] as string[] };
    }
    return null;
  }, [costHidden, mode, form, lines, outQty, parentQty]);

  const product = mode === "make" ? form?.product : undefined;
  const outBase = product ? baseOf(product.units) : undefined;
  const wholeCost = trimForm?.unitCost != null && num(wholeQty) > 0 ? trimForm.unitCost * num(wholeQty) : null;

  // ---- save ----
  const canSave =
    !saving &&
    ((mode === "make" &&
      form !== null &&
      form.kind !== "NONE" &&
      num(outQty) > 0 &&
      (form.kind === "RECIPE" ? lines.some((l) => num(l.qty) > 0) : num(parentQty) > 0)) ||
      (mode === "trim" && recipe !== null && num(wholeQty) > 0 && parts.some((p) => p.productId && num(p.qty) > 0)));

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    let input: Record<string, unknown>;
    if (mode === "make" && form && form.kind !== "NONE") {
      const outLine = { productId: form.product.id, inputQty: num(outQty), inputUnitId: outBase!.id };
      const inputs =
        form.kind === "RECIPE"
          ? lines.filter((l) => num(l.qty) > 0).map((l) => ({ productId: l.productId, inputQty: num(l.qty), inputUnitId: l.unitId }))
          : [{ productId: form.parent.id, inputQty: num(parentQty), inputUnitId: baseOf(form.parent.units).id }];
      input = {
        submitKey,
        branchId,
        kind: "PRODUCE",
        producedOn,
        recipeId: form.kind === "RECIPE" ? form.recipeId : null,
        inputs,
        outputs: [outLine],
      };
    } else {
      input = {
        submitKey,
        branchId,
        kind: "TRIM",
        producedOn,
        trimRecipeId: trimId,
        inputs: [{ productId: trimForm!.parent.id, inputQty: num(wholeQty), inputUnitId: parentBase!.id }],
        outputs: parts.filter((p) => p.productId && num(p.qty) > 0).map((p) => ({ productId: p.productId, inputQty: num(p.qty), inputUnitId: p.unitId })),
      };
    }
    const res: ProductionActionResult = await orStale(recordProductionAction(input));
    setSaving(false);
    if (!res.ok) return setError(res.formError);
    const reposted = res.reposted.filter((r) => r.outcome === "REPOSTED").length;
    const kept = res.reposted.filter((r) => r.outcome !== "REPOSTED").length;
    onDone(
      `บันทึกแล้ว ${res.pdNumber}` +
        (reposted ? ` · ตัดสต๊อกของวันขายใหม่ ${reposted} วัน` : "") +
        (kept ? ` · ${kept} วันตัดใหม่ไม่ได้ คงยอดเดิม` : "")
    );
  };

  const makeLabel =
    mode === "make" && product ? `บันทึก · ${product.name} ${show(num(outQty))} ${unitTh(outBase?.unitName)} ขึ้นชั้น` : "บันทึก";
  const trimLabel = mode === "trim" && recipe ? `บันทึก · ${parts.filter((p) => p.productId && num(p.qty) > 0).length} ส่วนขึ้นชั้น` : "บันทึก";

  return (
    <Sheet onClose={onClose} labelledBy="record-production-title">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-5 py-4">
        <h3 id="record-production-title" className="flex-1 text-lg font-semibold">
          บันทึกการผลิต
        </h3>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-muted-foreground hover:bg-muted" aria-label="ปิด">
          ×
        </button>
      </div>

      <div className="space-y-5 px-5 py-4 pb-10 max-sm:flex-none sm:flex-1 sm:overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="seg" role="group" aria-label="ทำอะไร">
            <button type="button" onClick={() => setMode("make")} className={`seg-item ${mode === "make" ? "is-on" : ""}`}>
              ทำของแปรรูป
            </button>
            <button type="button" onClick={() => setMode("trim")} className={`seg-item ${mode === "trim" ? "is-on" : ""}`}>
              ตัดแต่ง/แล่
            </button>
          </div>
          {branches.length > 1 ? (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input h-9 w-auto py-0 text-sm" aria-label="สาขา">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm text-muted-foreground">{branches[0]?.name}</span>
          )}
        </div>

        {mode === "make" ? (
          <>
            <div className="space-y-1.5">
              <label className="label" htmlFor="pd-product">
                ทำอะไร
              </label>
              <ProductPicker
                inputId="pd-product"
                products={make.map(toPicker)}
                value={productId}
                onChange={setProductId}
                thumbs={false}
                placeholder="พิมพ์ชื่อของแปรรูป เช่น น้ำซุป น้ำพริก"
              />
              {make.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  ยังไม่มีของแปรรูปที่มีสูตรผลิต — ตั้งวิธีทำในหน้าสินค้า/วัตถุดิบก่อน
                </p>
              )}
            </div>

            {loading && <div className="h-28 animate-pulse rounded-2xl bg-muted" aria-label="กำลังโหลด…" />}

            {form?.kind === "NONE" && (
              <p className="rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
                {form.product.name} ยังไม่มีวิธีทำ — ตั้งสูตรผลิตหรือของที่ใช้ทำในหน้าสินค้า/วัตถุดิบก่อน
              </p>
            )}

            {form?.kind === "RECIPE" && (
              <>
                <div className="space-y-1.5">
                  <span className="label">ทำกี่หม้อ</span>
                  <div className="flex items-center gap-3">
                    <QtyStepper value={pots} onChange={scalePots} label="จำนวนหม้อ" />
                    <span className="text-sm text-muted-foreground">
                      = {show(form.batchBaseQty * (num(pots) || 0))} {unitTh(outBase?.unitName)} ตามสูตร
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="label">
                    วัตถุดิบที่ใช้ <span className="text-xs text-muted-foreground">เติมจากสูตร แก้ได้</span>
                  </span>
                  <ul className="space-y-1.5">
                    {lines.map((l, i) => (
                      <li key={l.productId} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">{l.name}</span>
                        <input
                          inputMode="decimal"
                          value={l.qty}
                          onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                          className="input h-9 w-24 py-0 text-right tabular-nums"
                          aria-label={`จำนวน ${l.name}`}
                        />
                        <span className="w-14 text-muted-foreground">{unitTh(l.units.find((u) => u.id === l.unitId)?.unitName)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {form?.kind === "PARENT" && (
              <div className="space-y-1.5">
                <label className="label" htmlFor="pd-parent-qty">
                  ใช้{form.parent.name}เท่าไร
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="pd-parent-qty"
                    inputMode="decimal"
                    value={parentQty}
                    onChange={(e) => {
                      setParentQty(e.target.value);
                      const v = num(e.target.value);
                      if (Number.isFinite(v) && v > 0) setOutQty(String(r3((v * form.yieldPct) / 100)));
                    }}
                    className="input w-32 text-right tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">
                    {unitTh(baseOf(form.parent.units).unitName)} · ได้ประมาณ {form.yieldPct}%
                  </span>
                </div>
              </div>
            )}

            {form && form.kind !== "NONE" && (
              <div className="space-y-1.5">
                <label className="label" htmlFor="pd-out">
                  ได้จริง
                </label>
                <div className="flex items-center gap-2">
                  <input id="pd-out" inputMode="decimal" value={outQty} onChange={(e) => setOutQty(e.target.value)} className="input w-32 text-right tabular-nums" />
                  <span className="text-sm text-muted-foreground">{unitTh(outBase?.unitName)} · ไม่ต้องชั่ง กะได้</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="label" htmlFor="pd-whole">
                แล่อะไร
              </label>
              <ProductPicker
                inputId="pd-whole"
                products={trim.map(toPicker)}
                value={parentId}
                onChange={setParentId}
                thumbs={false}
                placeholder="พิมพ์ชื่อของทั้งชิ้น เช่น ปลาทั้งตัว ไก่ทั้งตัว"
              />
              {trim.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  ยังไม่มีสูตรตัดแต่ง — ตั้งในแผงของของทั้งชิ้น (หน้าสินค้า/วัตถุดิบ หัวข้อ “ตัดแต่งเป็น”)
                </p>
              )}
            </div>

            {loading && <div className="h-28 animate-pulse rounded-2xl bg-muted" aria-label="กำลังโหลด…" />}

            {trimForm && trimForm.recipes.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {trimForm.recipes.map((t) => (
                  <button key={t.id} type="button" onClick={() => setTrimId(t.id)} className={`pill ${t.id === trimId ? "is-on" : ""}`}>
                    {t.name}
                  </button>
                ))}
              </div>
            )}

            {recipe && (
              <>
                <div className="space-y-1.5">
                  <label className="label" htmlFor="pd-whole-qty">
                    น้ำหนักทั้งชิ้นที่ซื้อมา
                  </label>
                  <div className="flex items-center gap-2">
                    <input id="pd-whole-qty" inputMode="decimal" value={wholeQty} onChange={(e) => setWholeQty(e.target.value)} className="input w-32 text-right tabular-nums" />
                    <span className="text-sm text-muted-foreground">{unitTh(parentBase?.unitName)}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="label">
                    ได้อะไรเท่าไร <span className="text-xs text-muted-foreground">เติมตาม % แก้ได้ถ้าชั่ง</span>
                  </span>
                  <ul className="space-y-1.5">
                    {parts.map((p, i) => (
                      <li
                        key={`${p.productId ?? "waste"}-${i}`}
                        className={`flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm ${p.productId ? "bg-surface" : "bg-surface-sunk text-muted-foreground"}`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {p.name}
                          {!p.productId && " (ทิ้ง)"}
                        </span>
                        {p.productId ? (
                          <input
                            inputMode="decimal"
                            value={p.qty}
                            onChange={(e) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                            className="input h-9 w-24 py-0 text-right tabular-nums"
                            aria-label={`จำนวน ${p.name}`}
                          />
                        ) : (
                          <span className="w-24 text-right tabular-nums">{p.qty ? show(num(p.qty)) : "—"}</span>
                        )}
                        <span className="w-12">{unitTh(p.unit)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {!costHidden && wholeCost !== null && (
                  <div className="space-y-1.5 rounded-[18px] border border-border/70 bg-surface shadow-card p-3 text-sm">
                    <p className="text-muted-foreground">ต้นทุนชิ้นนี้ {baht(wholeCost, 0)} แบ่งตาม % มูลค่า</p>
                    {parts
                      .filter((p) => p.productId && p.valuePct > 0)
                      .map((p) => {
                        const v = (wholeCost * p.valuePct) / 100;
                        const q = num(p.qty);
                        return (
                          <p key={p.productId} className="flex justify-between gap-2">
                            <span>
                              {p.name} {p.valuePct}%
                            </span>
                            <b className="tabular-nums">
                              {baht(v, 0)}
                              {q > 0 && ` · ${baht(v / q, 0)}/${unitTh(p.unit)}`}
                            </b>
                          </p>
                        );
                      })}
                    <p className="text-xs text-muted-subtle">รวมเท่าต้นทุนของทั้งชิ้นถึงสตางค์ · ของทิ้งไม่มีมูลค่า · ส่วนที่ไม่ได้เก็บครั้งนี้ใส่ 0 ได้ ส่วนแบ่งยกให้ส่วนที่เก็บ</p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {((mode === "make" && form && form.kind !== "NONE") || (mode === "trim" && recipe)) && (
          <div className="space-y-1.5">
            <span className="label">
              วันที่ทำ <span className="text-xs text-muted-foreground">ย้อนหลังได้ไม่เกิน {PRODUCTION_BACKDATE_DAYS} วัน</span>
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setWhen("today")} className={`pill ${when === "today" ? "is-on" : ""}`}>
                วันนี้
              </button>
              <button type="button" onClick={() => setWhen("yesterday")} className={`pill ${when === "yesterday" ? "is-on" : ""}`}>
                เมื่อวาน
              </button>
              <button type="button" onClick={() => setWhen("pick")} className={`pill ${when === "pick" ? "is-on" : ""}`}>
                เลือกวัน…
              </button>
              {when === "pick" && (
                <input type="date" value={picked} min={minDay} max={today} onChange={(e) => setPicked(e.target.value)} className="input h-9 w-auto py-0" aria-label="วันที่ทำ" />
              )}
            </div>
            {producedOn !== today && (
              <p className="text-xs text-muted-foreground">วันขายที่เคยตัดวัตถุดิบแทน ตั้งแต่วันนั้น ระบบจะตัดสต๊อกใหม่ให้เอง</p>
            )}
          </div>
        )}

        {cost && (
          <div className="space-y-0.5 rounded-xl bg-primary/10 px-3 py-2 text-xs text-muted-foreground">
            <p className="flex items-center justify-between gap-2">
              <span>ต้นทุน (เห็นเฉพาะคนดูต้นทุนได้)</span>
              <b className="text-sm tabular-nums text-foreground">
                {cost.missing.length > 0 && cost.total === 0
                  ? "—"
                  : `${cost.missing.length ? "อย่างน้อย " : ""}${baht(cost.total, 0)}${cost.per !== null ? ` · ${baht(cost.per)} / ${unitTh(outBase?.unitName)}` : ""}`}
              </b>
            </p>
            {cost.missing.length > 0 && <p>ไม่รวม {cost.missing.join(" · ")} — สาขานี้ยังไม่เคยซื้อ จึงยังไม่มีราคา</p>}
          </div>
        )}

        {error && <p className="rounded-xl border border-bad-border bg-bad-bg p-3 text-sm text-bad">{error}</p>}
      </div>

      <div className="sticky bottom-0 mt-auto border-t border-border bg-surface px-5 py-3">
        <button type="button" onClick={save} disabled={!canSave} className="btn w-full">
          {saving ? "กำลังบันทึก…" : mode === "make" ? makeLabel : trimLabel}
        </button>
      </div>
    </Sheet>
  );
}

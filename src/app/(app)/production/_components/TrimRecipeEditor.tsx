"use client";

// ADR 0040 Q7 — ตัดแต่งเป็น: how one whole thing is cut into parts, in the
// columns a butcher's yield test uses (part · % weight · % value · cost/kg).
// Lives in the WHOLE thing's panel (Kong 2026-10-29, "เอาตามแนะนำ"): the
// question is "what does this fish give". The % arithmetic is the same module
// the server validates with (`@/lib/trim-recipe`), so the screen cannot accept
// what the save would refuse.

import { useCallback, useEffect, useState } from "react";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import { ConfirmDialog, type ConfirmSpec } from "@/app/(app)/menus/_components/sheet-parts";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";
import { readApi } from "@/lib/read-api";
import { orStale } from "@/lib/stale-tab";
import { maxValueFor, resetToWeight, setValuePct, trimPartsProblem, type TrimPartDraft } from "@/lib/trim-recipe";
import type { TrimForm } from "@/server/production-read";
import { deleteTrimRecipeAction, saveTrimRecipeAction } from "../actions";

/** A row: a part kept (a prepped product — maybe not chosen yet) or one thrown away. */
type Part = { key: string; kind: "keep" | "waste"; productId: string | null; label: string; weightPct: number; valuePct: number; locked: boolean };
type Draft = { id: string; name: string; parts: Part[]; isNew: boolean; valueTouched: boolean };
let seq = 0;
const k = () => `p${++seq}`;
const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (v: number) => v.toLocaleString("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/**
 * The rows as the shared % rules see them. A kept part not chosen yet still
 * counts as KEPT (a placeholder id), so its value is not forced to 0 while the
 * person is still picking it.
 */
const drafts = (ps: Part[]): TrimPartDraft[] =>
  ps.map((p) => ({
    productId: p.kind === "keep" ? (p.productId ?? `pending-${p.key}`) : null,
    weightPct: p.weightPct,
    valuePct: p.kind === "keep" ? p.valuePct : 0,
    locked: p.locked,
  }));

export default function TrimRecipeEditor({
  parent,
  baseUnitName,
  branchId,
  canEdit,
  costHidden,
  partOptions,
  startNew = false,
  onToast,
  onSaved,
}: {
  parent: { id: string; name: string };
  baseUnitName: string;
  branchId: string;
  canEdit: boolean;
  costHidden: boolean;
  /** Prepped products that may be a part. */
  partOptions: PickerProduct[];
  /** Open straight into a new recipe (the person pressed "+ ตั้งสูตรตัดแต่ง"). */
  startNew?: boolean;
  onToast: (m: string) => void;
  /** After a save or a delete — never after a refusal, which keeps the draft. */
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<TrimForm | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [ask, setAsk] = useState<ConfirmSpec | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    void readApi<{ ok: true; form: TrimForm }>("/api/production", "trim", { parentId: parent.id, branchId }).then((r) =>
      r.ok ? setForm(r.form) : setFailed(true)
    );
  }, [parent.id, branchId]);
  useEffect(load, [load]);

  const start = (recipe: TrimForm["recipes"][number] | null) =>
    setEditing(
      recipe
        ? {
            id: recipe.id,
            name: recipe.name,
            isNew: false,
            valueTouched: true,
            parts: recipe.parts.map((p) => ({ key: k(), kind: p.productId ? ("keep" as const) : ("waste" as const), productId: p.productId, label: p.productId ? "" : p.name, weightPct: p.weightPct, valuePct: p.valuePct, locked: p.locked })),
          }
        : {
            id: crypto.randomUUID(),
            name: `${parent.name}แล่`,
            isNew: true,
            valueTouched: false,
            parts: [{ key: k(), kind: "keep", productId: null, label: "", weightPct: 0, valuePct: 0, locked: false }],
          }
    );

  const setParts = (fn: (ps: Part[]) => Part[], touchedValue = false) =>
    setEditing((d) => {
      if (!d) return d;
      let parts = fn(d.parts);
      const valueTouched = d.valueTouched || touchedValue;
      // Until someone types a value, values follow the weights (Q7's default).
      if (!valueTouched) {
        const next = resetToWeight(drafts(parts));
        parts = parts.map((p, i) => ({ ...p, valuePct: next[i].valuePct }));
      }
      return { ...d, parts, valueTouched };
    });

  const problem = editing
    ? editing.parts.some((p) => p.kind === "keep" && !p.productId)
      ? "เลือกสินค้าให้ครบทุกส่วนที่เก็บไว้ใช้"
      : trimPartsProblem(drafts(editing.parts))
    : null;
  const nameOf = (id: string | null) => partOptions.find((o) => o.id === id)?.name ?? "";
  const unitCost = form?.unitCost ?? null;
  const example = unitCost ?? 100;

  const save = async () => {
    if (!editing || problem) return;
    setSaving(true);
    const res = await orStale(
      saveTrimRecipeAction({
        id: editing.id,
        parentProductId: parent.id,
        name: editing.name,
        parts: editing.parts.map((p) => ({
          productId: p.kind === "keep" ? p.productId : null,
          label: p.kind === "waste" ? p.label.trim() || "ส่วนที่ทิ้ง" : null,
          weightPct: p.weightPct,
          valuePct: p.kind === "keep" ? p.valuePct : 0,
          locked: p.kind === "keep" && p.locked,
        })),
      })
    );
    setSaving(false);
    if (!res.ok) return onToast(res.formError);
    onToast(`บันทึกสูตรตัดแต่ง “${editing.name}” แล้ว`);
    setEditing(null);
    load();
    onSaved?.();
  };

  const askDelete = (recipe: TrimForm["recipes"][number]) =>
    setAsk({
      title: `ลบสูตรตัดแต่ง “${recipe.name}”?`,
      lines: [],
      money: null,
      who: "การแล่ที่บันทึกไปแล้วไม่เปลี่ยน · ส่วนต่าง ๆ จะกลับเป็น “ยังไม่มีวิธีทำ” จนกว่าจะตั้งใหม่",
      go: "ลบสูตรตัดแต่ง",
      onGo: async () => {
        const res = await orStale(deleteTrimRecipeAction(recipe.id));
        if (!res.ok) return onToast(res.formError);
        onToast("ลบสูตรตัดแต่งแล้ว");
        load();
        onSaved?.();
      },
    });

  // Pressed "+ ตั้งสูตรตัดแต่ง" before the editor existed: open the new one at once.
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (startNew && form && !autoStarted && form.recipes.length === 0) {
      setAutoStarted(true);
      start(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNew, form, autoStarted]);

  if (failed) return <p className="text-sm text-muted-foreground">โหลดสูตรตัดแต่งไม่ได้ — ลองเปิดใหม่</p>;
  if (!form) return <div className="h-16 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="space-y-3">
      {!editing && form.recipes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          ยังไม่ได้ตั้ง · ถ้าซื้อ{parent.name}มาทั้งชิ้นแล้วแล่เป็นหลายส่วน (เช่น ฟิลเล่ พุง หัว) ตั้งไว้ครั้งเดียว ใช้ได้ทุกครั้งที่บันทึกการแล่
        </p>
      )}

      {!editing &&
        form.recipes.map((r) => (
          <div key={r.id} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b className="text-sm">{r.name}</b>
              {canEdit && (
                <span className="flex gap-2">
                  <button type="button" onClick={() => start(r)} className="btn-secondary btn-sm">
                    แก้
                  </button>
                  <button type="button" onClick={() => askDelete(r)} className="btn-danger btn-sm">
                    ลบ
                  </button>
                </span>
              )}
            </div>
            <PartsTable
              rows={r.parts.map((p) => ({ name: p.name, kept: p.productId !== null, weightPct: p.weightPct, valuePct: p.valuePct, locked: p.locked }))}
              unitCost={costHidden ? null : unitCost}
              baseUnitName={baseUnitName}
            />
          </div>
        ))}

      {editing && (
        <div className="space-y-3 rounded-xl border border-primary p-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            ชื่อสูตรตัดแต่ง
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="input text-sm text-foreground" />
          </label>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>ส่วน</th>
                  <th className="text-right">% น้ำหนัก</th>
                  <th className="text-right">% มูลค่า</th>
                  <th></th>
                  <th className="text-right">฿/{unitTh(baseUnitName)} {unitCost === null ? "(ถ้าทั้งชิ้น ฿100)" : ""}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {editing.parts.map((p, i) => {
                  const isWaste = p.kind === "waste";
                  const perKg = p.weightPct > 0 && !isWaste ? (example * p.valuePct) / p.weightPct : null;
                  return (
                    <tr key={p.key} className={isWaste ? "bg-surface-sunk text-muted-foreground" : ""}>
                      <td className="min-w-[12rem]">
                        {isWaste ? (
                          <input
                            value={p.label}
                            onChange={(e) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                            placeholder="เช่น เกล็ด เครื่องใน"
                            className="input h-9 py-0 text-sm"
                            aria-label="ชื่อส่วนที่ทิ้ง"
                          />
                        ) : (
                          <ProductPicker
                            products={partOptions}
                            value={p.productId ?? ""}
                            onChange={(id) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, productId: id } : x)))}
                            thumbs={false}
                            placeholder="เลือกของแปรรูป เช่น ฟิลเล่"
                          />
                        )}
                        {isWaste && <span className="mt-0.5 block text-[11px]">ทิ้ง — ไม่มีมูลค่า</span>}
                        {!isWaste && p.productId && !nameOf(p.productId) && <span className="text-[11px] text-warn">ไม่พบสินค้านี้</span>}
                      </td>
                      <td className="text-right">
                        <input
                          inputMode="decimal"
                          value={p.weightPct || ""}
                          onChange={(e) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, weightPct: Number(e.target.value) || 0 } : x)))}
                          className="input h-9 w-20 py-0 text-right tabular-nums"
                          aria-label="% น้ำหนัก"
                        />
                      </td>
                      <td className="text-right">
                        {isWaste ? (
                          "0"
                        ) : (
                          <input
                            inputMode="decimal"
                            value={p.valuePct || ""}
                            max={maxValueFor(drafts(editing.parts), i)}
                            onChange={(e) =>
                              setParts(
                                (ps) => {
                                  const next = setValuePct(drafts(ps), i, Number(e.target.value) || 0);
                                  return ps.map((x, j) => ({ ...x, valuePct: next[j].valuePct }));
                                },
                                true
                              )
                            }
                            className={`input h-9 w-20 py-0 text-right tabular-nums ${p.locked ? "border-primary" : ""}`}
                            aria-label="% มูลค่า"
                          />
                        )}
                      </td>
                      <td>
                        {!isWaste && (
                          <button
                            type="button"
                            onClick={() => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, locked: !x.locked } : x)), true)}
                            aria-pressed={p.locked}
                            title={p.locked ? "ล็อกแล้ว — บรรทัดอื่นขยับแทน" : "กดเพื่อล็อก"}
                            className={p.locked ? "" : "opacity-40"}
                          >
                            {p.locked ? "🔒" : "🔓"}
                          </button>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{perKg === null ? "—" : `฿${Math.round(perKg).toLocaleString("th-TH")}`}</td>
                      <td>
                        <button type="button" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} className="rounded px-1.5 text-muted-subtle hover:bg-bad-bg hover:text-bad" aria-label="ลบบรรทัด">
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="font-semibold">รวม</td>
                  <td className="text-right font-semibold tabular-nums">{pct(r2(editing.parts.reduce((a, p) => a + p.weightPct, 0)))}</td>
                  <td className="text-right font-semibold tabular-nums">{pct(r2(editing.parts.filter((p) => p.kind === "keep").reduce((a, p) => a + p.valuePct, 0)))}</td>
                  <td colSpan={3}></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" onClick={() => setParts((ps) => [...ps, { key: k(), kind: "keep", productId: null, label: "", weightPct: 0, valuePct: 0, locked: false }])} className="btn-secondary btn-sm">
              + เพิ่มส่วน
            </button>
            <button type="button" onClick={() => setParts((ps) => [...ps, { key: k(), kind: "waste", productId: null, label: "", weightPct: 0, valuePct: 0, locked: false }])} className="btn-secondary btn-sm">
              + เพิ่มส่วนที่ทิ้ง
            </button>
            <button
              type="button"
              onClick={() =>
                setParts((ps) => {
                  const next = resetToWeight(drafts(ps));
                  return ps.map((x, j) => ({ ...x, valuePct: next[j].valuePct }));
                }, true)
              }
              className="btn-secondary btn-sm"
            >
              คืนค่าตามน้ำหนัก
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            % มูลค่าเริ่มตามน้ำหนักของส่วนที่ใช้ได้ · แก้บรรทัดไหน บรรทัดที่ไม่ล็อกปรับตามให้รวม 100% · กด 🔓 เพื่อล็อกบรรทัดที่ไม่อยากให้ขยับ
          </p>
          {problem && <p className="text-sm text-warn">{problem}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="btn-secondary btn-sm">
              ยกเลิก
            </button>
            <button type="button" onClick={save} disabled={!!problem || saving} className="btn btn-sm">
              {saving ? "กำลังบันทึก…" : "บันทึกสูตรตัดแต่ง"}
            </button>
          </div>
        </div>
      )}

      {!editing && canEdit && (
        <button type="button" onClick={() => start(null)} className="btn-secondary btn-sm">
          + ตั้งสูตรตัดแต่ง
        </button>
      )}

      {!editing && form.recipes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          ทำไมบางส่วนถูกกว่าทั้งที่มาจากชิ้นเดียวกัน: ถ้าแบ่งตามน้ำหนักอย่างเดียว ทุกส่วนราคาต่อ{unitTh(baseUnitName)}เท่ากัน ส่วนที่ไม่ค่อยมีค่าจะแพงเกินจริง ร้านจึงกำหนดว่าแต่ละส่วนแบกต้นทุนเท่าไร (วิธี butcher&apos;s yield test)
        </p>
      )}
      {ask && <ConfirmDialog spec={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

function PartsTable({
  rows,
  unitCost,
  baseUnitName,
}: {
  rows: { name: string; kept: boolean; weightPct: number; valuePct: number; locked: boolean }[];
  unitCost: number | null;
  baseUnitName: string;
}) {
  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            <th>ส่วน</th>
            <th className="text-right">% น้ำหนัก</th>
            <th className="text-right">% มูลค่า</th>
            {unitCost !== null && <th className="text-right">฿/{unitTh(baseUnitName)} ตอนนี้</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.kept ? "" : "bg-surface-sunk text-muted-foreground"}>
              <td>
                {r.name}
                {!r.kept && <span className="block text-[11px]">ทิ้ง — ไม่มีมูลค่า</span>}
              </td>
              <td className="text-right tabular-nums">{pct(r.weightPct)}</td>
              <td className="text-right tabular-nums">
                {r.kept ? pct(r.valuePct) : "0"}
                {r.locked && " 🔒"}
              </td>
              {unitCost !== null && (
                <td className="text-right tabular-nums">{r.kept && r.weightPct > 0 ? `฿${Math.round((unitCost * r.valuePct) / r.weightPct).toLocaleString("th-TH")}` : "—"}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

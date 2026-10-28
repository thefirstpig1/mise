"use client";

// "+ ขนาดใหม่…" (Kong 2026-10-21): the same product bought in another size,
// added where the order is being written. The container is filled in from the
// size in use, so a 500 g bag after a 250 g one is "500" and one press.

import { useCallback, useMemo, useState } from "react";
import { addPackSizeAction } from "@/app/(app)/products/pack-size-actions";
import { orStale } from "@/lib/stale-tab";
import { composePackName, guessContainer, packRatio, sizeUnitsFor } from "@/lib/pack-unit";
import { unitTh } from "@/app/(app)/menus/_components/manager-format";
import { Portal, useTopLayer } from "@/app/(app)/menus/_components/sheet-parts";
import SelectChip from "./SelectChip";
import { MeasureInput, MoneyInput } from "./NumberField";

/** The option value a unit `<select>` uses for "+ ขนาดใหม่…". */
export const NEW_PACK_SIZE = "__new_pack_size";

export type NewPackSizeResult = { id: string; unitName: string; toBaseRatio: number; unitPrice: string | null };

type FormUnit = { id: string; unitName: string; isBase: boolean; toBaseRatio?: string };

/**
 * A form's product list plus the sizes added on this screen, so a new size is
 * selectable at once without reloading the form (and losing what was typed).
 */
export function useAddedUnits<P extends { id: string; units: FormUnit[] }>(products: P[]): readonly [P[], (productId: string, u: NewPackSizeResult) => void] {
  const [added, setAdded] = useState<Record<string, FormUnit[]>>({});
  const merged = useMemo(
    () =>
      products.map((p) => {
        const more = (added[p.id] ?? []).filter((u) => !p.units.some((x) => x.id === u.id));
        return more.length ? ({ ...p, units: [...p.units, ...more] } as P) : p;
      }),
    [products, added]
  );
  const add = useCallback(
    (productId: string, u: NewPackSizeResult) =>
      setAdded((a) => ({ ...a, [productId]: [...(a[productId] ?? []), { id: u.id, unitName: u.unitName, toBaseRatio: String(u.toBaseRatio), isBase: false }] })),
    []
  );
  return [merged, add] as const;
}

/** The container a new size starts from: the pack in use, else any pack the product has. */
export function containerGuess(units: { id: string; unitName: string; isBase: boolean }[], currentUnitId: string): string {
  return guessContainer(packInUse(units, currentUnitId));
}

/** The pack in use, else any pack the product has — what a new size is guessed from. */
export function packInUse(units: { id: string; unitName: string; isBase: boolean }[], currentUnitId: string): string | undefined {
  const cur = units.find((u) => u.id === currentUnitId);
  return cur && !cur.isBase ? cur.unitName : units.find((u) => !u.isBase)?.unitName;
}

export default function NewPackSize({
  productId,
  productName,
  baseUnitName,
  guessBox,
  guessUnit,
  mapping,
  onDone,
  onClose,
}: {
  productId: string;
  productName: string;
  baseUnitName: string;
  guessBox: string;
  /** The pack in use ("ถุง 250 g") — its g/kg is the only one ever pre-chosen. */
  guessUnit?: string | null;
  /**
   * A supplier price-list row the new size may replace as the regular order
   * unit. `required`: the screen orders in the price list's unit, so a new
   * size there can only be used by becoming it.
   */
  mapping?: { id: string; supplierName: string; required?: boolean } | null;
  onDone: (unit: NewPackSizeResult) => void;
  onClose: () => void;
}) {
  useTopLayer(onClose);
  const [box, setBox] = useState(guessBox);
  const [size, setSize] = useState("");
  const units = sizeUnitsFor(baseUnitName);
  // g or kg is never guessed ("500" is grams to a person, kilos to a form) —
  // except from the pack in use: after "ถุง 250 g" the new one is in g too.
  const inUse = (guessUnit ?? "").trim().split(/\s+/).pop() ?? "";
  const [sizeUnit, setSizeUnit] = useState(units.length === 1 ? units[0] : units.includes(inUse) ? inUse : "");
  const ratio = packRatio(size, sizeUnit, baseUnitName);
  const [regular, setRegular] = useState(Boolean(mapping));
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = composePackName(box, size, sizeUnit);
  const needPrice = Boolean(mapping) && regular;

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await orStale(
      addPackSizeAction({ productId, box, size, sizeUnit, mappingId: needPrice ? mapping!.id : null, unitPrice: needPrice ? price : null })
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "บันทึกไม่ได้");
      return;
    }
    onDone({ ...res.unit, unitPrice: needPrice ? price : null });
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] grid animate-fade-in place-items-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div role="dialog" aria-modal="true" aria-labelledby="nps-title" className="w-full max-w-sm animate-pop-in space-y-3 rounded-2xl bg-surface p-5 shadow-2xl">
          <div>
            <h3 id="nps-title" className="text-base font-semibold">
              ขนาดใหม่ของ {productName}
            </h3>
            <p className="text-xs text-muted-foreground">ต้นทุน ขั้นต่ำ และสูตร ไม่ต้องแก้ — ทุกอย่างคิดเป็น {unitTh(baseUnitName)} อยู่แล้ว</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input value={box} onChange={(e) => setBox(e.target.value)} placeholder="ถุง" aria-label="ภาชนะ" className="input w-24" />
            <span className="text-xs text-muted-foreground">บรรจุ</span>
            <MeasureInput autoFocus value={size} onChange={(e) => setSize(e.target.value)} unit="" aria-label="ขนาด" boxClassName="w-24" />
            {units.length > 1 ? (
              <SelectChip
                value={sizeUnit}
                onChange={setSizeUnit}
                placeholder="หน่วย"
                tone={sizeUnit ? "default" : "warn"}
                options={units.map((u) => ({ value: u, label: u }))}
                className="w-24"
                selectProps={{ "aria-label": "หน่วยของขนาด" }}
              />
            ) : (
              unitTh(baseUnitName)
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            จะแสดงเป็น <span className="font-medium text-foreground">{name || "…"}</span>
            {name && ratio !== null && sizeUnit !== unitTh(baseUnitName) && ` · = ${ratio} ${unitTh(baseUnitName)}`}
          </p>
          {mapping && (
            <div className="space-y-2 rounded-lg bg-muted/40 p-2.5">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={regular} disabled={mapping.required} onChange={(e) => setRegular(e.target.checked)} className="mt-1" />
                <span>
                  ใช้ขนาดนี้เป็นหน่วยสั่งประจำของ {mapping.supplierName}
                  <span className="block text-xs text-muted-foreground">ราคาเดิมเป็นของขนาดเก่า จึงต้องใส่ราคาใหม่ · ราคาเก่ายังเก็บไว้ในประวัติ</span>
                </span>
              </label>
              {regular && (
                <label className="flex items-center gap-2 text-sm">
                  ราคาต่อ{name ? ` ${name}` : "หน่วยใหม่"} (ไม่รวม VAT)
                  <MoneyInput value={price} onChange={(e) => setPrice(e.target.value)} aria-label="ราคาขนาดใหม่" boxClassName="w-32" />
                </label>
              )}
            </div>
          )}
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary btn-sm">
              ยกเลิก
            </button>
            <button type="button" onClick={save} disabled={busy || !name || ratio === null || (needPrice && !(Number(price) >= 0 && price.trim() !== ""))} className="btn">
              {busy ? "กำลังบันทึก…" : "เพิ่มและเลือก"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

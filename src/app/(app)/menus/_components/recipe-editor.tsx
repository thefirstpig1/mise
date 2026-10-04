"use client";

// ============================================================
// Mise — the recipe table both recipe screens share (Kong 2026-10-04)
// ============================================================
// "จัดการเมนู"'s sheet, "ทดลองเมนู"'s sheet and a prepped item's production
// recipe edit the SAME shape — ingredient, amount, unit, cost — so it lives once:
// the lines, their price from the branch's price book, the adder on the app-wide
// smart search, and the UNIT a line is written in.
//
// Units (Kong: "สูตรใช้กรัม บางที pinch บางทีนับเป็นใบ … ควรจะเปลี่ยนได้"):
//   - standard measures of the product's own dimension are always offered and
//     convert by themselves (กรัม for a product kept in กก., ช้อนโต๊ะ for one in
//     ลิตร). One not yet on the product is created when the recipe is SAVED
//     (`materializeUnits`), never while somebody is still deciding;
//   - anything else — a leaf counted as ใบ, a spoon of sugar, the shop's own
//     ทัพพี — the shop weighs once ("+ ตั้งหน่วยใหม่…"), and it is written to
//     the product at once, because it is a fact about the product, not a draft;
//   - changing the unit keeps the AMOUNT: 0.1 กก. becomes 100 กรัม.
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { rankBySearch, hasQuery, highlightRuns, STRONG_MATCH, type SearchField } from "@/lib/smart-search";
import { orStale } from "@/lib/stale-tab";
import { ensureRecipeUnitAction } from "@/app/(app)/menus/manager-actions";
import type { IngredientOption, PriceBook, StandardUnit } from "@/server/menu-manager";
import { baht, qtyFmt, unitTh } from "./manager-format";
import { Portal, useTopLayer } from "./sheet-parts";

export type Line = {
  key: string;
  kind: "product" | "menu";
  productId: string | null;
  componentMenuId: string | null;
  label: string;
  sku: string | null;
  prepped: boolean;
  qty: string;
  /** null = a standard measure chosen but not yet on the product (made on save). */
  unitId: string | null;
  unitName: string | null;
  /** This unit in the product's base unit (1 for a menu component). */
  ratio: number;
  notes: string;
};

let keySeq = 0;
export const nextKey = () => `n${++keySeq}`;
export const qtyOf = (l: Line) => (Number.isFinite(Number(l.qty)) ? Number(l.qty) : 0);

/** Baht per base unit (per serving for a menu) at this branch; null = nobody bought it here. */
export const priceOf = (l: Pick<Line, "kind" | "productId" | "componentMenuId">, book: PriceBook | null): number | null =>
  book === null ? null : l.kind === "menu" ? (book.menus[l.componentMenuId ?? ""]?.costPerServing ?? null) : (book.products[l.productId ?? ""] ?? null);
export const lineCost = (l: Line, book: PriceBook | null) => {
  const p = priceOf(l, book);
  return p === null ? null : qtyOf(l) * l.ratio * p;
};
export const signature = (lines: Line[], servings: number) =>
  JSON.stringify([servings, lines.map((l) => [l.productId, l.componentMenuId, qtyOf(l), l.unitName, l.notes.trim()])]);

// ---- units -----------------------------------------------------------------

// Units a person set up in this tab (ทัพพี, ใบ …). The ingredient list is loaded
// once per page, so without this a unit made a minute ago would not be in it.
const madeHere = new Map<string, IngredientOption["units"]>();
const withMade = (o: IngredientOption | undefined): IngredientOption | undefined => {
  const extra = o ? madeHere.get(o.id) : undefined;
  if (!o || !extra) return o;
  return { ...o, units: [...o.units, ...extra.filter((u) => !o.units.some((x) => x.id === u.id))] };
};
const remember = (productId: string, u: { id: string; unitName: string; toBaseRatio: number }) =>
  madeHere.set(productId, [...(madeHere.get(productId) ?? []), { ...u, isBase: false }]);

type UnitChoice = { id: string | null; unitName: string; ratio: number; standard: boolean };

// Products created before the Thai spellings (Part 35) keep "kg" / "l" — the
// same sizes under another label — so a standard is matched by its Thai name.
const ALIAS: Record<string, string> = { kg: "กก.", g: "กรัม", l: "ลิตร", ml: "มล." };
const canon = (n: string) => ALIAS[n] ?? n;

/** The base unit's size in the standard's terms (g or ml), or null when it is not a standard. */
const baseSi = (o: IngredientOption, standards: StandardUnit[]) => {
  const base = o.units.find((u) => u.isBase);
  return base ? (standards.find((s) => s.unitName === canon(base.unitName))?.si ?? null) : null;
};

/** Every unit a line for this product can be written in, standard measures first. */
export function unitChoices(opt: IngredientOption | undefined, standards: StandardUnit[]): UnitChoice[] {
  const o = withMade(opt);
  if (!o || o.kind === "menu") return [];
  const have = new Map(o.units.map((u) => [canon(u.unitName), u]));
  const bs = baseSi(o, standards);
  const std: UnitChoice[] =
    bs === null
      ? []
      : standards
          .filter((s) => s.dimension === o.dimension)
          .map((s) => {
            const h = have.get(s.unitName);
            // An existing unit keeps its stored name ("kg"), so a saved line still matches it.
            return { id: h?.id ?? null, unitName: h?.unitName ?? s.unitName, ratio: h?.toBaseRatio ?? s.si / bs, standard: true };
          });
  const stdNames = new Set(std.map((s) => canon(s.unitName)));
  const own: UnitChoice[] = o.units.filter((u) => !stdNames.has(canon(u.unitName))).map((u) => ({ id: u.id, unitName: u.unitName, ratio: u.toBaseRatio, standard: false }));
  return [...std, ...own];
}

/** A new line's unit: grams for something weighed, ml for a liquid, else its base. */
export function defaultUnit(o: IngredientOption, standards: StandardUnit[]): UnitChoice | null {
  const choices = unitChoices(o, standards);
  const pick = o.dimension === "WEIGHT" ? "กรัม" : o.dimension === "VOLUME" ? "มล." : null;
  const base = o.units.find((u) => u.isBase);
  return choices.find((c) => canon(c.unitName) === pick) ?? (base ? { id: base.id, unitName: base.unitName, ratio: 1, standard: false } : null);
}

/** Create on the product every standard unit a line chose that it does not have yet. */
export async function materializeUnits(lines: Line[]): Promise<{ ok: true; lines: Line[] } | { ok: false; error: string }> {
  const out: Line[] = [];
  for (const l of lines) {
    if (l.kind !== "product" || l.unitId !== null || !l.productId || !l.unitName) {
      out.push(l);
      continue;
    }
    const res = await orStale(ensureRecipeUnitAction({ productId: l.productId, unitName: l.unitName }));
    if (!res.ok) return { ok: false, error: "error" in res ? res.error : "บันทึกหน่วยไม่ได้" };
    remember(l.productId, res.unit);
    out.push({ ...l, unitId: res.unit.id, ratio: res.unit.toBaseRatio });
  }
  return { ok: true, lines: out };
}

// ---- the table -------------------------------------------------------------

export function RecipeTable({
  lines,
  setLines,
  baseLines,
  book,
  options,
  standards,
  editable,
  costHidden,
  showNotes,
  canDefineUnit,
  stockLine,
  onOpen,
  onHover,
  onToast,
}: {
  lines: Line[];
  setLines: (f: (ls: Line[]) => Line[]) => void;
  baseLines: Line[];
  book: PriceBook | null;
  options: IngredientOption[] | null;
  standards: StandardUnit[];
  editable: boolean;
  costHidden: boolean;
  showNotes: boolean;
  /** Shop-defined units are shared by every branch (shared reach). */
  canDefineUnit: boolean;
  stockLine?: (l: Line) => ReactNode;
  onOpen?: (productId: string) => void;
  onHover?: (productId: string) => void;
  onToast: (msg: string) => void;
}) {
  const [defining, setDefining] = useState<{ key: string; o: IngredientOption; preset?: string } | null>(null);
  const pricesPending = !costHidden && book === null;
  const total = lines.reduce((s, l) => s + (lineCost(l, book) ?? 0), 0);
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const optionOf = (l: Line) => options?.find((x) => x.kind === "product" && x.id === l.productId);

  const changeUnit = (l: Line, c: UnitChoice) => {
    // Keep the AMOUNT, not the number: 0.1 กก. → 100 กรัม.
    const amount = qtyOf(l) * l.ratio;
    setLine(l.key, { unitId: c.id, unitName: c.unitName, ratio: c.ratio, qty: l.qty === "" ? "" : String(+(amount / c.ratio).toFixed(3)) });
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">วัตถุดิบ</th>
              <th className="py-1 text-right font-medium">ปริมาณ</th>
              <th className="py-1 pl-2 font-medium">หน่วย</th>
              {!costHidden && <th className="py-1 text-right font-medium">ต้นทุน</th>}
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l) => {
              const o = baseLines.find((b) => (b.productId ?? b.componentMenuId) === (l.productId ?? l.componentMenuId));
              const changed = !o ? "bg-good-bg" : qtyOf(o) !== qtyOf(l) || o.unitName !== l.unitName ? "bg-warn-bg" : "";
              const choices = unitChoices(optionOf(l), standards);
              const c = lineCost(l, book);
              const base = optionOf(l)?.units.find((u) => u.isBase)?.unitName;
              return (
                <tr
                  key={l.key}
                  className={`${l.kind === "product" && onOpen ? "cursor-pointer hover:bg-muted/60" : ""} ${changed}`}
                  onPointerEnter={() => l.kind === "product" && l.productId && onHover?.(l.productId)}
                  onClick={(e) => {
                    if (l.kind !== "product" || !l.productId || !onOpen) return;
                    if ((e.target as HTMLElement).closest("input,select,button")) return;
                    onOpen(l.productId);
                  }}
                >
                  <td className="py-1.5 pr-2">
                    <span>{l.label}</span>
                    {l.prepped && <span className="ml-1.5 rounded border border-warn-border bg-warn-bg px-1 text-[10px] text-warn">ของแปรรูป</span>}
                    {l.kind === "menu" && <span className="ml-1.5 rounded border border-border px-1 text-[10px] text-muted-foreground">เมนู</span>}
                    {stockLine && <span className="block text-[11px] text-muted-subtle">{stockLine(l)}</span>}
                    {!costHidden && c !== null && total > 0 && <span className="mt-0.5 block h-1 rounded-full bg-border-strong/60" style={{ width: `${Math.max(2, (c / total) * 100)}%` }} />}
                    {showNotes && editable && (
                      <input value={l.notes} onChange={(e) => setLine(l.key, { notes: e.target.value })} placeholder="หมายเหตุของบรรทัดนี้" className="input mt-1 w-full py-0.5 text-xs" aria-label={`หมายเหตุ ${l.label}`} />
                    )}
                    {!showNotes && l.notes && <span className="block text-[11px] italic text-muted-foreground">{l.notes}</span>}
                  </td>
                  <td className="py-1.5 text-right align-top">
                    {editable ? (
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={l.qty}
                        autoFocus={l.qty === "" && !o}
                        onChange={(e) => setLine(l.key, { qty: e.target.value })}
                        className="input w-20 py-0.5 text-right tabular-nums"
                        aria-label={`ปริมาณ ${l.label}`}
                      />
                    ) : (
                      <span className="tabular-nums">{l.qty}</span>
                    )}
                  </td>
                  <td className="py-1.5 pl-2 align-top">
                    {editable && l.kind === "product" && choices.length > 0 ? (
                      <select
                        value={l.unitName ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__new" || v === "__ladle") {
                            const opt = optionOf(l);
                            if (!opt) return;
                            if (!canDefineUnit) return onToast("ตั้งหน่วยใหม่ได้เฉพาะเจ้าของร้าน ส่วนกลาง และผู้ดูแลทุกสาขา");
                            return setDefining({ key: l.key, o: opt, preset: v === "__ladle" ? "ทัพพี" : undefined });
                          }
                          const ch = choices.find((x) => x.unitName === v);
                          if (ch) changeUnit(l, ch);
                        }}
                        className="max-w-[9.5rem] rounded border border-border bg-surface px-1 py-0.5 text-sm"
                        aria-label={`หน่วย ${l.label}`}
                      >
                        {choices.some((x) => x.standard) && (
                          <optgroup label="หน่วยตวงมาตรฐาน">
                            {choices.filter((x) => x.standard).map((x) => (
                              <option key={x.unitName} value={x.unitName}>
                                {unitTh(x.unitName)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="หน่วยของวัตถุดิบนี้">
                          {choices.filter((x) => !x.standard).map((x) => (
                            <option key={x.unitName} value={x.unitName}>
                              {unitTh(x.unitName)}
                            </option>
                          ))}
                        </optgroup>
                        {optionOf(l)?.dimension !== "COUNT" && !choices.some((x) => x.unitName === "ทัพพี") && <option value="__ladle">ทัพพี (ตั้งขนาดก่อน)…</option>}
                        <option value="__new">+ ตั้งหน่วยใหม่…</option>
                      </select>
                    ) : (
                      unitTh(l.unitName) || (l.kind === "menu" ? "จาน" : "")
                    )}
                    {l.kind === "product" && l.ratio !== 1 && qtyOf(l) > 0 && base && (
                      <span className="block text-[11px] text-muted-subtle">= {qtyFmt(qtyOf(l) * l.ratio, base)}</span>
                    )}
                  </td>
                  {!costHidden && (
                    <td className="py-1.5 text-right align-top tabular-nums">
                      {pricesPending ? <span className="inline-block h-3.5 w-12 animate-pulse rounded bg-muted align-middle" /> : c === null ? <span className="text-xs text-warn">ไม่มีราคา</span> : baht(c, 2)}
                    </td>
                  )}
                  <td className="py-1.5 text-right align-top">
                    {editable && (
                      <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`เอา ${l.label} ออก`} className="rounded px-1.5 text-muted-subtle hover:bg-bad-bg hover:text-bad">
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {defining && (
        <NewUnitDialog
          option={defining.o}
          preset={defining.preset}
          standards={standards}
          onClose={() => setDefining(null)}
          onDone={(u) => {
            remember(defining.o.id, u);
            const l = lines.find((x) => x.key === defining.key);
            if (l) changeUnit(l, { id: u.id, unitName: u.unitName, ratio: u.toBaseRatio, standard: false });
            setDefining(null);
            onToast(`ตั้งหน่วย “${u.unitName}” ของ${defining.o.name}แล้ว · ใช้ได้ทุกสูตรทุกสาขา`);
          }}
        />
      )}
    </>
  );
}

/** "1 ใบ = 0.3 กรัม" — the shop weighs once, every recipe and branch uses it. */
function NewUnitDialog({
  option,
  preset,
  standards,
  onClose,
  onDone,
}: {
  option: IngredientOption;
  preset?: string;
  standards: StandardUnit[];
  onClose: () => void;
  onDone: (u: { id: string; unitName: string; toBaseRatio: number }) => void;
}) {
  const [name, setName] = useState(preset ?? "");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useTopLayer(onClose);
  // Asked in grams or millilitres — what a kitchen scale or a measuring jug
  // shows — and turned into the product's base unit here.
  const base = option.units.find((u) => u.isBase)?.unitName ?? "";
  const ref = option.dimension === "WEIGHT" ? "กรัม" : option.dimension === "VOLUME" ? "มล." : base;
  const refSi = standards.find((s) => s.unitName === ref)?.si ?? null;
  const bs = standards.find((s) => s.unitName === canon(base))?.si ?? null;
  const toBase = (v: number) => (refSi !== null && bs !== null && ref !== canon(base) ? (v * refSi) / bs : v);

  const save = async () => {
    const v = Number(value);
    if (name.trim() === "" || !(v > 0)) return setError("ใส่ชื่อหน่วยและตัวเลขให้ครบ");
    setBusy(true);
    const res = await orStale(ensureRecipeUnitAction({ productId: option.id, unitName: name.trim(), toBaseRatio: toBase(v) }));
    setBusy(false);
    if (!res.ok) return setError("error" in res ? res.error : "บันทึกไม่ได้");
    onDone(res.unit);
  };

  return (
    <Portal>
    <div className="fixed inset-0 z-[70] grid animate-fade-in place-items-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="nu-title" className="w-full max-w-sm animate-pop-in space-y-3 rounded-2xl bg-surface p-5 shadow-2xl">
        <h3 id="nu-title" className="text-base font-semibold">
          ตั้งหน่วยใหม่ของ{option.name}
        </h3>
        <p className="text-xs text-muted-foreground">ชั่งหรือตวงของจริงครั้งเดียว ใช้ได้ทุกสูตรทุกสาขา · สต๊อกยังนับเป็น {unitTh(base)} เหมือนเดิม</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          1
          <input autoFocus={!preset} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ใบ, เม็ด, ทัพพี" className="input w-36 py-1" aria-label="ชื่อหน่วย" />
          =
          <input autoFocus={!!preset} type="number" step="any" min="0" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.3" className="input w-24 py-1 text-right tabular-nums" aria-label="เท่ากับ" />
          {unitTh(ref)}
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-full border border-border-strong px-4 py-1.5 text-sm hover:bg-muted">
            ยกเลิก
          </button>
          <button type="button" onClick={save} disabled={busy} className="btn">
            {busy ? "กำลังบันทึก…" : "ตั้งหน่วยนี้"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ---- the adder ---------------------------------------------------------------

function Marked({ text, marks }: { text: string; marks: readonly number[] }) {
  return (
    <>
      {highlightRuns(text, marks).map((r, i) =>
        r.hit ? (
          <mark key={i} className="rounded-sm bg-highlight px-px text-inherit">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        )
      )}
    </>
  );
}

/** A new line from a picked option, in its sensible default unit. */
export function lineFrom(o: IngredientOption, standards: StandardUnit[]): Line {
  const u = defaultUnit(o, standards);
  return {
    key: nextKey(),
    kind: o.kind,
    productId: o.kind === "product" ? o.id : null,
    componentMenuId: o.kind === "menu" ? o.id : null,
    label: o.name,
    sku: o.sku,
    prepped: o.prepped,
    qty: "",
    unitId: u?.id ?? null,
    unitName: u?.unitName ?? (o.kind === "menu" ? "จาน" : null),
    ratio: u?.ratio ?? 1,
    notes: "",
  };
}

/** "+ เพิ่มวัตถุดิบ" — the app-wide smart search over products and dishes. */
export function Adder({
  options,
  book,
  exclude,
  costHidden,
  menus = true,
  onPick,
}: {
  options: IngredientOption[] | null;
  book: PriceBook | null;
  exclude: Set<string>;
  costHidden: boolean;
  /** A production recipe takes products only. */
  menus?: boolean;
  onPick: (o: IngredientOption) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  const items = (options ?? []).filter((o) => !exclude.has(o.id) && (menus || o.kind === "product"));
  const fields: SearchField<IngredientOption>[] = [
    { get: (o) => o.name, kind: "name" },
    { get: (o) => o.sku, kind: "code" },
  ];
  const price = (o: IngredientOption) => {
    if (costHidden) return null;
    if (book === null) return <small className="text-xs text-muted-subtle">…</small>;
    const p = priceOf({ kind: o.kind, productId: o.kind === "product" ? o.id : null, componentMenuId: o.kind === "menu" ? o.id : null }, book);
    if (p === null) return <small className="text-xs text-muted-subtle">ยังไม่มีราคา</small>;
    const base = o.units.find((u) => u.isBase);
    return (
      <small className="text-xs tabular-nums text-muted-subtle">
        {baht(p, 2)}/{o.kind === "menu" ? "จาน" : unitTh(base?.unitName)}
      </small>
    );
  };
  const row = (o: IngredientOption, marks: { field: number | null; marks: number[] }, weak = false) => (
    <button
      key={`${o.kind}-${o.id}`}
      type="button"
      onClick={() => {
        onPick(o);
        setQ("");
        setOpen(false);
      }}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted ${weak ? "opacity-45" : ""}`}
    >
      <span className="min-w-0">
        {marks.field === 0 ? <Marked text={o.name} marks={marks.marks} /> : o.name}{" "}
        {o.sku && <small className="text-xs tabular-nums text-muted-subtle">{marks.field === 1 ? <Marked text={o.sku} marks={marks.marks} /> : o.sku}</small>}
        {o.prepped && <span className="ml-1 rounded border border-warn-border bg-warn-bg px-1 text-[10px] text-warn">ของแปรรูป</span>}
      </span>
      {price(o)}
    </button>
  );

  let list: ReactNode;
  if (options === null) list = <p className="px-2 py-2 text-xs text-muted-subtle">กำลังโหลดรายการ…</p>;
  else if (!hasQuery(q)) {
    const plain = { field: null, marks: [] as number[] };
    const prepped = items.filter((o) => o.kind === "product" && o.prepped);
    const raw = items.filter((o) => o.kind === "product" && !o.prepped).sort((a, b) => a.name.localeCompare(b.name, "th"));
    const ms = items.filter((o) => o.kind === "menu");
    list = (
      <>
        {prepped.length > 0 && <p className="px-2 pt-1 font-display text-[11px] text-muted-subtle">ของแปรรูป</p>}
        {prepped.map((o) => row(o, plain))}
        <p className="px-2 pt-1 font-display text-[11px] text-muted-subtle">วัตถุดิบ</p>
        {raw.map((o) => row(o, plain))}
        {ms.length > 0 && <p className="px-2 pt-1 font-display text-[11px] text-muted-subtle">เมนู (สำหรับเซ็ต)</p>}
        {ms.map((o) => row(o, plain))}
      </>
    );
  } else {
    const ranked = rankBySearch(items, q, fields);
    const strong = ranked.filter((r) => r.score >= STRONG_MATCH);
    const rest = ranked.filter((r) => r.score < STRONG_MATCH);
    list = (
      <>
        {strong.length === 0 && <p className="px-2 py-1 text-xs text-muted-subtle">ไม่มีที่ตรงกับ “{q}” · ถ้าเป็นวัตถุดิบใหม่ เพิ่มที่หน้าวัตถุดิบ</p>}
        {strong.map((r) => row(r.item, r))}
        {rest.length > 0 && <p className="px-2 pt-1 font-display text-[11px] text-muted-subtle">รายการอื่น</p>}
        {rest.map((r) => row(r.item, r, true))}
      </>
    );
  }

  return (
    <div className="relative" ref={box}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="+ เพิ่มวัตถุดิบ พิมพ์ชื่อหรือรหัส"
        aria-label="เพิ่มวัตถุดิบ"
        className="w-full rounded-lg border border-dashed border-border-strong bg-surface-sunk px-3 py-1.5 text-sm focus:border-solid focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {open && <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-card">{list}</div>}
    </div>
  );
}

/** Append a line's five inputs to a recipe FormData (parallel arrays, in order). */
export function appendLines(fd: FormData, lines: Line[]) {
  for (const l of lines) {
    fd.append("ingredient_product_id", l.productId ?? "");
    fd.append("ingredient_component_menu_id", l.componentMenuId ?? "");
    fd.append("ingredient_qty", l.qty);
    fd.append("ingredient_product_unit_id", l.unitId ?? "");
    fd.append("ingredient_notes", l.notes);
  }
}

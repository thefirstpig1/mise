"use client";

// One ingredient, stacked over the dish (Kong, 2026-10-04): what is in stock,
// how fast it goes, what it cost the last four times, who sold it, which dishes
// use it, and — for a prepped item — how it is made, editable in place.
//
// Stock figures are the ledger, which knows only what has been POSTED: the
// sheet always says "ตัดสต๊อกถึง <date>" under the number, because on-hand is
// what the ledger knows, not what is on the shelf.
//
// A prepped item's recipe is shared by every branch, so editing it needs the
// shared reach (`perm.recipeShared` / `perm.yield`); its save is its own, with
// the same second look as a dish's recipe (ConfirmDialog).

import { useEffect, useState, useTransition } from "react";
import { setPreppedYieldAction } from "@/app/(app)/menus/manager-actions";
import { dropPrefetched, ingredientInsight } from "./prefetch";
import { updateRecipeAction } from "@/app/(app)/recipes/actions";
import type { IngredientInsight, PriceBook, SheetLine } from "@/server/menu-manager";
import { orStale } from "@/lib/stale-tab";
import { baht, newSubmitKey, qtyFmt, thDate, unitTh } from "./manager-format";
import { ConfirmDialog, type ConfirmSpec, PhotoSlot, Sheet } from "./sheet-parts";
import type { Option, Perm } from "./MenuManager";

export type InThisDish = { dishName: string; qty: number; unitName: string | null; toBaseRatio: number; cost: number | null; dishCost: number | null; servings: number };

export default function IngredientSheet({
  productId,
  branch,
  today,
  inThisDish,
  costHidden,
  perm,
  book,
  onClose,
  onToast,
  onPreppedSaved,
}: {
  productId: string;
  branch: Option;
  today: string;
  inThisDish: InThisDish | null;
  costHidden: boolean;
  perm: Perm;
  /** The branch's prices, held by the list — no second walk here. */
  book: PriceBook | null;
  onClose: () => void;
  onToast: (msg: string) => void;
  onPreppedSaved: () => void;
}) {
  const [data, setData] = useState<IngredientInsight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<SheetLine[] | null>(null);
  const [yieldPct, setYieldPct] = useState<string>("");
  const [eff, setEff] = useState(today);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [saving, startSaving] = useTransition();

  const load = (fresh = false) =>
    ingredientInsight(productId, branch.id, fresh).then((res) => {
      if (!res.ok) return setError("error" in res ? res.error : "เปิดไม่ได้");
      setData(res.insight);
      const m = res.insight.made;
      setLines(m?.how === "recipe" ? m.lines.map((l) => ({ ...l })) : null);
      setYieldPct(m?.how === "yield" ? String(m.yieldPercent) : "");
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, branch.id]);

  const made = data?.made ?? null;
  const editable = made?.how === "recipe" ? perm.recipeShared : made?.how === "yield" ? perm.yield : false;
  const baseUnit = data?.product.baseUnitName ?? null;
  const fact = data?.facts.facts[productId] ?? null;

  // Prices come from the branch's price book: a line costs qty × its unit in
  // base units × the price per base unit — what the recipe walk does one level
  // down, from the same FIFO and walk figures.
  const price = (l: Pick<SheetLine, "kind" | "productId" | "componentMenuId">) =>
    book === null ? null : l.kind === "menu" ? (book.menus[l.componentMenuId ?? ""]?.costPerServing ?? null) : (book.products[l.productId ?? ""] ?? null);
  const lineCost = (l: SheetLine) => {
    const p = price(l);
    return p === null ? null : l.qty * l.toBaseRatio * p;
  };
  const total = (ls: SheetLine[]) => ls.reduce((s, l) => s + (lineCost(l) ?? 0), 0);
  const servings = made?.how === "recipe" ? made.servings : 1;
  const parentPrice = made?.how === "yield" ? (book?.products[made.parentId] ?? null) : null;
  const baseCost =
    made?.how === "recipe"
      ? total(made.lines) / servings
      : made?.how === "yield"
        ? parentPrice === null ? null : parentPrice / (made.yieldPercent / 100)
        : (book?.products[productId] ?? null);
  const draftCost =
    made?.how === "recipe" && lines
      ? total(lines) / servings
      : made?.how === "yield"
        ? parentPrice === null || !(Number(yieldPct) > 0) ? null : parentPrice / (Number(yieldPct) / 100)
        : baseCost;

  const dirty =
    made?.how === "recipe"
      ? JSON.stringify(lines?.map((l) => [l.ingredientId, l.qty])) !== JSON.stringify(made.lines.map((l) => [l.ingredientId, l.qty]))
      : made?.how === "yield"
        ? Number(yieldPct) !== made.yieldPercent
        : false;

  const close = () => {
    if (dirty && data) onToast(`ปิดแล้ว · ไม่ได้บันทึกการแก้สูตรของ${data.product.name}`);
    onClose();
  };

  const askSave = () => {
    if (!data || !made) return;
    const uses = data.usedIn.length;
    const diff: string[] =
      made.how === "yield"
        ? [`ผลผลิตจาก${made.parentName} ${made.yieldPercent}% → ${yieldPct}%`]
        : (lines ?? []).flatMap((l) => {
            const o = made.how === "recipe" ? made.lines.find((x) => x.ingredientId === l.ingredientId) : undefined;
            return o && o.qty !== l.qty ? [`${l.label} ${o.qty} → ${l.qty} ${unitTh(l.unitName)}`] : [];
          });
    const removed = made.how === "recipe" ? made.lines.filter((o) => !(lines ?? []).some((l) => l.ingredientId === o.ingredientId)).map((o) => `เอาออก ${o.label}`) : [];
    setConfirm({
      title: `ใช้สูตรใหม่ของ${data.product.name}?`,
      lines: [...diff, ...removed],
      money:
        costHidden || draftCost === null || baseCost === null
          ? null
          : `ต้นทุนต่อ${unitTh(baseUnit)} ${baht(baseCost, 2)} → ${baht(draftCost, 2)}`,
      who: `ทุกสาขา · ${uses ? `ต้นทุนของ ${uses} เมนูที่ใช้จะเปลี่ยนตาม` : "ยังไม่มีเมนูไหนใช้"} · มีผลตั้งแต่ ${thDate(eff)}`,
      go: uses ? `ใช้กับทุกสาขา · ${uses} เมนู` : "ใช้กับทุกสาขา",
      onGo: save,
    });
  };

  const save = () =>
    startSaving(async () => {
      if (!data || !made) return;
      if (made.how === "yield") {
        const res = await orStale(setPreppedYieldAction(productId, Number(yieldPct)));
        if (!res.ok) return onToast("error" in res ? res.error : "บันทึกไม่ได้");
      } else if (made.how === "recipe") {
        const fd = new FormData();
        fd.set("submit_key", newSubmitKey());
        fd.set("menu_id", "");
        fd.set("output_product_id", productId);
        fd.set("servings", String(made.servings));
        fd.set("effective_from", eff);
        fd.set("notes", "");
        for (const l of lines ?? []) {
          fd.append("ingredient_product_id", l.productId ?? "");
          fd.append("ingredient_component_menu_id", l.componentMenuId ?? "");
          fd.append("ingredient_qty", String(l.qty));
          fd.append("ingredient_product_unit_id", l.unitId ?? "");
          fd.append("ingredient_notes", l.notes ?? "");
        }
        const res = await orStale(updateRecipeAction(made.recipeId, { ok: false }, fd));
        if (!res.ok) {
          const msg = "formError" in res && res.formError ? res.formError : Object.values(("fieldErrors" in res && res.fieldErrors) || {})[0];
          return onToast(msg ?? "บันทึกไม่ได้");
        }
      }
      onToast(`บันทึกสูตรของ${data.product.name}แล้ว${!costHidden && draftCost !== null ? ` · ต้นทุนใหม่ ${baht(draftCost, 2)}/${unitTh(baseUnit)}` : ""}`);
      dropPrefetched();
      onPreppedSaved();
      await load(true);
    });

  const receipts = data?.receipts ?? null;
  const trend =
    receipts && receipts.length >= 2
      ? ((receipts[0].perBase - receipts[receipts.length - 1].perBase) / receipts[receipts.length - 1].perBase) * 100
      : null;

  return (
    <Sheet stacked onClose={close} labelledBy="ing-title">
      <div className="flex items-start gap-3 border-b border-border bg-surface px-5 py-4">
        <PhotoSlot size={64} label="รูป" />
        <div className="min-w-0 flex-1">
          <span className="badge">{data?.product.type === "PREPPED" ? "ของแปรรูป" : "วัตถุดิบ"}{data ? ` · ${data.product.sku}` : ""}</span>
          <h3 id="ing-title" className="mt-1 text-lg font-semibold">{data?.product.name ?? "กำลังโหลด…"}</h3>
          <p className="text-xs text-muted-foreground">นับสต๊อกเป็น {unitTh(baseUnit) || "—"} · {branch.name}</p>
        </div>
        <button type="button" onClick={close} aria-label="ปิด" className="rounded-lg px-2 text-2xl leading-none text-muted-foreground hover:bg-muted">
          ×
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {error && <p className="text-sm text-bad">{error}</p>}
        {!data && !error && <div className="h-40 animate-pulse rounded-xl bg-muted" />}
        {data && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.product.type === "PREPPED" ? (
                <Tile k="คงเหลือ" v="—" s="ยังไม่มีการบันทึกการผลิต" />
              ) : (
                <>
                  <Tile k="คงเหลือ" v={fact ? qtyFmt(fact.onHand, baseUnit) : "—"} s={data.facts.postedThrough ? `ตามระบบ · ตัดสต๊อกถึง ${thDate(data.facts.postedThrough, false)}` : "ยังไม่มีการตัดสต๊อกตามยอดขาย"} />
                  <Tile k="ใช้เฉลี่ยต่อวัน" v={fact?.usedPerDay ? qtyFmt(fact.usedPerDay, baseUnit) : "—"} s={`จากยอดขาย ${data.facts.postedDays} วันที่ตัดสต๊อกแล้ว`} />
                  <Tile
                    k="พอใช้อีก"
                    v={fact?.daysLeft == null ? "—" : `~${fact.daysLeft} วัน`}
                    s={fact?.par != null ? `ขั้นต่ำ ${qtyFmt(fact.par, baseUnit)}${fact.belowPar ? " · ต่ำกว่าแล้ว" : ""}` : "ยังไม่ได้ตั้งขั้นต่ำ"}
                    warn={fact?.belowPar}
                  />
                </>
              )}
              {!costHidden && (
                <Tile
                  k={`ต้นทุนต่อ${unitTh(baseUnit)}`}
                  v={book === null ? "…" : draftCost === null ? "—" : baht(draftCost, 2)}
                  s={book === null ? "กำลังคำนวณ…" : dirty && baseCost !== null ? `เดิม ${baht(baseCost, 2)}` : data.product.type === "PREPPED" ? "คิดจากวัตถุดิบที่ใช้ทำ" : "FIFO · " + branch.name}
                  warn={dirty}
                />
              )}
            </div>

            {made?.how === "recipe" && lines && (
              <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">สูตรผลิต</h4>
                  <span className="text-xs text-muted-foreground">ทำครั้งละ {qtyFmt(made.servings, baseUnit)} · ใช้ร่วมกันทุกสาขา</span>
                </div>
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
                    {lines.map((l, i) => {
                      const o = made.lines.find((x) => x.ingredientId === l.ingredientId);
                      const c = lineCost(l);
                      return (
                        <tr key={l.ingredientId} className={o && o.qty !== l.qty ? "bg-warn-bg" : ""}>
                          <td className="py-1.5">{l.label}</td>
                          <td className="py-1.5 text-right">
                            {editable ? (
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={l.qty}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  setLines((ls) => ls!.map((x, j) => (j === i ? { ...x, qty: Number.isFinite(v) ? v : x.qty } : x)));
                                }}
                                className="input w-20 py-0.5 text-right tabular-nums"
                                aria-label={`ปริมาณ ${l.label}`}
                              />
                            ) : (
                              <span className="tabular-nums">{l.qty}</span>
                            )}
                          </td>
                          <td className="py-1.5 pl-2">{unitTh(l.unitName)}</td>
                          {!costHidden && <td className="py-1.5 text-right tabular-nums">{book === null ? "…" : c === null ? "—" : baht(c, 2)}</td>}
                          <td className="py-1.5 text-right">
                            {editable && lines.length > 1 && (
                              <button type="button" onClick={() => setLines((ls) => ls!.filter((_, j) => j !== i))} aria-label={`เอา ${l.label} ออก`} className="rounded px-1.5 text-muted-subtle hover:bg-bad-bg hover:text-bad">
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!editable && <p className="text-xs text-muted-foreground">สูตรของแปรรูปใช้ร่วมกันทุกสาขา แก้ได้เฉพาะเจ้าของร้าน ส่วนกลาง และผู้ดูแลทุกสาขา</p>}
              </section>
            )}

            {made?.how === "yield" && (
              <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">ทำจาก</h4>
                  <span className="text-xs text-muted-foreground">สินค้าแม่ตัวเดียว + % ผลผลิต</span>
                </div>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {made.parentName} 1 {unitTh(baseUnit)} ได้{data.product.name}
                  {editable ? (
                    <input type="number" step="any" min="0.01" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} className="input w-20 py-0.5 text-right tabular-nums" aria-label="% ผลผลิต" />
                  ) : (
                    <b className="tabular-nums">{made.yieldPercent}</b>
                  )}
                  %
                </p>
                {!costHidden && draftCost !== null && parentPrice !== null && (
                  <p className="text-xs text-muted-foreground">
                    ต้นทุน = ราคา{made.parentName} {baht(parentPrice, 2)} ÷ {yieldPct || made.yieldPercent}% = <b className="text-foreground">{baht(draftCost, 2)}</b>
                  </p>
                )}
              </section>
            )}
            {made?.how === "none" && <p className="rounded-lg bg-warn-bg p-3 text-sm text-warn">ของแปรรูปนี้ยังไม่ได้บอกว่าทำจากอะไร จึงคิดต้นทุนไม่ได้ — ตั้งที่หน้าวัตถุดิบ</p>}

            {inThisDish && (
              <section className="space-y-1 rounded-xl border border-border bg-surface p-4">
                <h4 className="font-semibold">ใน{inThisDish.dishName}</h4>
                <p className="text-sm tabular-nums">
                  ใช้ {qtyFmt(inThisDish.qty / inThisDish.servings, inThisDish.unitName)} ต่อจาน
                  {!costHidden && inThisDish.cost !== null && inThisDish.dishCost
                    ? ` · ต้นทุน ${baht(inThisDish.cost / inThisDish.servings, 2)} (${((inThisDish.cost / inThisDish.dishCost) * 100).toFixed(0)}% ของต้นทุนจาน)`
                    : ""}
                </p>
                {fact && data.product.type !== "PREPPED" && inThisDish.qty > 0 && (
                  <p className="text-xs text-muted-foreground">
                    ถ้าใช้{data.product.name}ที่มีอยู่ทำแต่จานนี้ ได้อีก ~{Math.floor(fact.onHand / ((inThisDish.qty * inThisDish.toBaseRatio) / inThisDish.servings)).toLocaleString("th-TH")} จาน
                  </p>
                )}
              </section>
            )}

            {!costHidden && receipts && receipts.length > 0 && (
              <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">ราคาที่รับเข้า</h4>
                  <span className="text-xs text-muted-foreground">ซื้อจาก {[...new Set(receipts.map((r) => r.supplier))].join(", ")}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Spark values={[...receipts].reverse().map((r) => r.perBase)} />
                  {trend !== null && (
                    <span className="text-xs text-muted-foreground">
                      ต่อ{unitTh(baseUnit)} {Math.abs(trend) < 1 ? "เท่าเดิม" : `${trend > 0 ? "แพงขึ้น" : "ถูกลง"} ${Math.abs(trend).toFixed(1)}%`} จาก {thDate(receipts[receipts.length - 1].date, false)}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 font-medium">วันที่รับ</th>
                        <th className="py-1 font-medium">ซัพพลายเออร์</th>
                        <th className="py-1 font-medium">หน่วยซื้อ</th>
                        <th className="py-1 text-right font-medium">ราคา</th>
                        <th className="py-1 text-right font-medium">ต่อ{unitTh(baseUnit)}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border tabular-nums">
                      {receipts.map((r, i) => (
                        <tr key={i}>
                          <td className="py-1.5">{thDate(r.date, false)}</td>
                          <td className="py-1.5">{r.supplier}</td>
                          <td className="py-1.5">{r.qty.toLocaleString("th-TH")} × {r.packUnit}</td>
                          <td className="py-1.5 text-right">{baht(r.price, 2)}</td>
                          <td className="py-1.5 text-right">{baht(r.perBase, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="space-y-1 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">ใช้ในเมนู</h4>
                <span className="text-xs text-muted-foreground">{data.usedIn.length} สูตร</span>
              </div>
              {data.usedIn.length === 0 ? (
                <p className="text-sm text-muted-foreground">ยังไม่มีสูตรไหนใช้</p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {data.usedIn.map((u, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>
                        {u.label}
                        {!u.isCentral && <span className="ml-1 text-xs text-muted-subtle">(สูตรของสาขา)</span>}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {u.qty} {unitTh(u.unitName)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.product.type === "PREPPED" && (
              <p className="text-xs text-muted-foreground">⚠️ ระบบยังไม่มีการบันทึกการผลิต นับสต๊อกของแปรรูปเมื่อไรจะขึ้นเป็นของเกินเสมอ</p>
            )}

            <div className="flex flex-wrap gap-2">
              <a href={`/products/${productId}`} className="rounded-full border border-border-strong px-3 py-1 text-sm hover:bg-muted">
                ดูทั้งหมดในหน้าวัตถุดิบ
              </a>
              <a href="/purchase-requests" className="rounded-full border border-border-strong px-3 py-1 text-sm hover:bg-muted">
                ขอซื้อเพิ่ม
              </a>
            </div>
          </>
        )}
      </div>

      {data && editable && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-5 py-3 text-sm">
          <span className="flex flex-wrap items-center gap-1 text-muted-foreground">
            {dirty ? (
              <>
                {!costHidden && baseCost !== null && draftCost !== null ? `ต้นทุนเปลี่ยน ${baht(baseCost, 2)} → ${baht(draftCost, 2)} · ` : ""}
                {data.usedIn.length ? `กระทบ ${data.usedIn.length} เมนู · ` : ""}
                {made?.how === "recipe" && (
                  <>
                    มีผลตั้งแต่ <input type="date" value={eff} max={today} onChange={(e) => setEff(e.target.value)} className="input py-0.5" aria-label="วันที่มีผล" />
                  </>
                )}
              </>
            ) : (
              "ยังไม่มีอะไรเปลี่ยน"
            )}
          </span>
          <button type="button" disabled={!dirty || saving} onClick={askSave} className="btn">
            {saving ? "กำลังบันทึก…" : made?.how === "yield" ? "บันทึก % ผลผลิต" : "บันทึกสูตรผลิต"}
          </button>
        </div>
      )}

      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
    </Sheet>
  );
}

function Tile({ k, v, s, warn }: { k: string; v: string; s: string; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-2.5">
      <p className="text-[11px] text-muted-subtle">{k}</p>
      <p className={`font-display text-lg font-semibold tabular-nums ${warn ? "text-warn" : ""}`}>{v}</p>
      <p className="text-[11px] text-muted-foreground">{s}</p>
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 80,
    h = 22,
    lo = Math.min(...values),
    hi = Math.max(...values),
    span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - lo) / span) * (h - 6)]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#AEB784" strokeWidth={1.6} />
      <circle cx={lx} cy={ly} r={2.4} fill="#41431B" />
    </svg>
  );
}

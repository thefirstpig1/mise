"use client";

// นำเข้าสูตรจากไฟล์ (คิวงานข้อ 5d, Kong 2026-10-30) — the recipes tab of
// mockup R3vZEuvaWr2gWQosAgYfkA round 3. The same file and the same three steps
// as the ingredient import; the review is grouped by dish, and everything is
// saved as a DRAFT. Every rule shown here comes from src/lib/recipe-import.ts.

import Link from "next/link";
import { useMemo, useState } from "react";
import { orStale } from "@/lib/stale-tab";
import { PromptCard, UploadCard } from "@/components/import/ImportParts";
import ProductPicker, { type PickerProduct } from "@/components/ui/ProductPicker";
import {
  draftRecipes,
  judgeIngredient,
  judgeRecipe,
  toRecipeSave,
  type IngDraft,
  type IngVerdict,
  type RawRecipeRow,
  type RecipeContext,
  type RecipeDraftRow,
  type RecipeVerdict,
} from "@/lib/recipe-import";
import { FROM_METHOD_MARK, nameKey } from "@/lib/product-import";
import { importRecipesAction, type ImportRecipesState } from "../actions";

type Filter = "all" | "need" | "review" | "ready" | "skip";

export default function RecipeImport({ prompt, menuCount, productCount }: { prompt: string; menuCount: number; productCount: number }) {
  const [bypass, setBypass] = useState(menuCount > 0 && productCount > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [ctx, setCtx] = useState<RecipeContext | null>(null);
  const [drafts, setDrafts] = useState<RecipeDraftRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<ImportRecipesState, { ok: true }> | null>(null);

  async function send(body: FormData, label: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/menus/import", { method: "POST", body });
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("เปิดข้อมูลไม่ได้ — กรุณารีเฟรชหน้าแล้วลองอีกครั้ง");
        return;
      }
      const data = (await res.json()) as { ok: true; rows: RawRecipeRow[]; context: RecipeContext } | { ok: false; formError: string };
      if (!data.ok) {
        setError(data.formError);
        return;
      }
      setCtx(data.context);
      setDrafts(draftRecipes(data.rows, data.context));
      setSource(label);
      setDone(null);
      setSaveError(null);
    } catch {
      setError("เชื่อมต่อไม่ได้ — ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCtx(null);
    setDrafts([]);
    setSource(null);
    setDone(null);
    setError(null);
    setSaveError(null);
  }

  async function save() {
    if (!ctx) return;
    setSaving(true);
    setSaveError(null);
    const res = await orStale(importRecipesAction(toRecipeSave(drafts, ctx)));
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.formError);
      return;
    }
    setDone(res);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (done) return <Done done={done} onAgain={reset} />;

  if (!bypass) {
    // Kong 2026-10-30: setup in order — a recipe matches menus (from the sales
    // file) and ingredients (from the ingredient import).
    return (
      <section className="card grid gap-3 border-warn-border bg-warn-bg/50">
        <h3 className="text-lg font-semibold">แนะนำให้ทำสองอย่างนี้ก่อนนำเข้าสูตร</h3>
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          <li>
            {menuCount > 0 ? "✓" : "·"} <b className="font-medium text-foreground">นำเข้ายอดขายจาก POS</b> — สูตรจับคู่กับเมนูที่มาจากไฟล์ยอดขาย {menuCount > 0 ? `(มีเมนูแล้ว ${menuCount} รายการ)` : "(ยังไม่มีเมนู)"}
          </li>
          <li>
            {productCount > 0 ? "✓" : "·"} <b className="font-medium text-foreground">นำเข้าวัตถุดิบ</b> — วัตถุดิบในสูตรจับคู่กับรายการวัตถุดิบ {productCount > 0 ? `(มีแล้ว ${productCount} รายการ)` : "(ยังไม่มีวัตถุดิบ)"}
          </li>
        </ul>
        <div className="flex flex-wrap gap-2">
          {menuCount === 0 && (
            <Link href="/sales/import" className="btn">
              นำเข้ายอดขายก่อน
            </Link>
          )}
          {productCount === 0 && (
            <Link href="/products/import" className={menuCount === 0 ? "btn-secondary" : "btn"}>
              นำเข้าวัตถุดิบก่อน
            </Link>
          )}
          <button type="button" className="btn-secondary" onClick={() => setBypass(true)}>
            นำเข้าสูตรต่อเลย
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-4">
      {ctx === null ? (
        <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
          <PromptCard
            prompt={prompt}
            title="ขั้น 1 · เตรียมไฟล์ด้วย AI ของร้าน"
            sub="ใช้ไฟล์เดียวกับตอนนำเข้าวัตถุดิบได้เลย (แผ่น “สูตร”) · ถ้ายังไม่มี คัดลอกคำสั่งนี้ไปใช้กับ AI พร้อมแนบสูตรของร้าน"
            templateHref="/api/products/import?what=template"
          />
          <UploadCard busy={busy} error={error} onSend={send} pasteHint="ระบบอ่านเฉพาะตารางสูตร (หัวคอลัมน์ ชื่อเมนู … วัตถุดิบ)" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
          <p className="text-sm">
            <span className="text-muted-foreground">อ่านจาก </span>
            <b className="font-semibold">{source}</b>
            <span className="text-muted-foreground"> · ยังไม่มีอะไรถูกบันทึก</span>
          </p>
          <button type="button" onClick={reset} className="btn-secondary btn-sm">
            เลือกไฟล์ใหม่
          </button>
        </div>
      )}
      {ctx !== null && <Review ctx={ctx} drafts={drafts} setDrafts={setDrafts} saving={saving} saveError={saveError} onSave={save} />}
    </div>
  );
}

// ------------------------------------------------------------
// Review
// ------------------------------------------------------------

const measureKey = (l: IngDraft) =>
  l.unit === null ? null : l.choice.kind === "PRODUCT" ? `p:${l.choice.id}|${l.unit}` : l.choice.kind === "NEW" ? `n:${nameKey(l.choice.name)}|${l.unit}` : null;

function bucket(v: RecipeVerdict): Exclude<Filter, "all"> {
  if (v.kind === "SKIP") return "skip";
  if (v.kind === "NEED") return "need";
  return v.review ? "review" : "ready";
}

function Review({
  ctx,
  drafts,
  setDrafts,
  saving,
  saveError,
  onSave,
}: {
  ctx: RecipeContext;
  drafts: RecipeDraftRow[];
  setDrafts: (f: (d: RecipeDraftRow[]) => RecipeDraftRow[]) => void;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const judged = useMemo(
    () =>
      drafts.map((r) => {
        const lines = r.lines.map((l) => judgeIngredient(l, ctx));
        return { lines, verdict: judgeRecipe(r, ctx, lines) };
      }),
    [drafts, ctx]
  );
  const counts = useMemo(() => {
    const c = { need: 0, review: 0, ready: 0, skip: 0 };
    for (const j of judged) c[bucket(j.verdict)]++;
    return c;
  }, [judged]);
  const plan = useMemo(() => toRecipeSave(drafts, ctx), [drafts, ctx]);
  const pickerProducts: PickerProduct[] = useMemo(
    () => ctx.products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, imageUrl: null, section: null, group: null, baseUnitName: p.units.find((u) => u.isBase)?.unitName ?? null })),
    [ctx.products]
  );
  const pickerMenus: PickerProduct[] = useMemo(
    () => ctx.menus.map((m) => ({ id: m.id, name: m.name, sku: m.code ?? "", imageUrl: null, section: null, group: null, baseUnitName: null })),
    [ctx.menus]
  );

  const editRecipe = (ri: number, patch: Partial<RecipeDraftRow>) => setDrafts((all) => all.map((r, k) => (k === ri ? { ...r, ...patch } : r)));
  // A measure is asked ONCE: the size typed for "กะเพรา · กำ" fills every line
  // of every dish that uses กะเพรา by the กำ.
  const editLine = (ri: number, li: number, patch: Partial<IngDraft>) =>
    setDrafts((all) => {
      const shareKey = "ratio" in patch ? measureKey(all[ri].lines[li]) : null;
      return all.map((r, k) => ({
        ...r,
        lines: r.lines.map((l, j) => (k === ri && j === li ? { ...l, ...patch } : shareKey !== null && measureKey(l) === shareKey ? { ...l, ratio: patch.ratio ?? null } : l)),
      }));
    });

  const FILTERS: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "ทั้งหมด", n: drafts.length },
    { key: "need", label: "ต้องแก้", n: counts.need },
    { key: "review", label: "ควรตรวจ", n: counts.review },
    { key: "ready", label: "พร้อม", n: counts.ready },
    { key: "skip", label: "ข้าม", n: counts.skip },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-sunk px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[12.5px] font-semibold tracking-[0.08em] text-warn">ขั้น 3 · ตรวจทาน</span>
          <div className="seg" role="group" aria-label="แสดงเมนู">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`seg-item ${filter === f.key ? "is-on" : ""}`} disabled={f.n === 0 && f.key !== "all"}>
                {f.label} {f.n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip chip-good">พร้อม {counts.ready + counts.review} เมนู</span>
          {counts.need > 0 && <span className="chip chip-bad">ต้องแก้ {counts.need} เมนู</span>}
        </div>
      </div>

      {drafts.map((r, ri) =>
        filter === "all" || bucket(judged[ri].verdict) === filter ? (
          <RecipeBlock
            key={r.key}
            r={r}
            verdict={judged[ri].verdict}
            lineVerdicts={judged[ri].lines}
            ctx={ctx}
            menus={pickerMenus}
            products={pickerProducts}
            onEdit={(p) => editRecipe(ri, p)}
            onEditLine={(li, p) => editLine(ri, li, p)}
          />
        ) : null
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <p className="max-w-[640px] text-[13.5px] text-muted-foreground">
          {counts.need > 0 && <span className="font-medium text-bad">ยังมี {counts.need} เมนูที่ต้องแก้หรือกดข้ามก่อนบันทึก · </span>}
          บันทึกเป็น <b className="font-medium text-foreground">สูตรร่าง</b> ทั้งหมด ยังไม่ตัดสต๊อกจนกว่าจะกด “ใช้สูตร” ทีละเมนูที่หน้าทดลองเมนู
          {plan.newMenus.length > 0 ? ` · เมนูใหม่ ${plan.newMenus.length}` : ""}
          {plan.newProducts.length > 0 ? ` · วัตถุดิบใหม่ ${plan.newProducts.length}` : ""}
        </p>
        <div className="grid justify-items-end gap-1">
          <button type="button" className="btn" disabled={saving || counts.need > 0 || plan.recipes.length === 0} onClick={onSave}>
            {saving ? "กำลังบันทึก…" : `บันทึกเป็นสูตรร่าง ${plan.recipes.length} เมนู`}
          </button>
          {saveError && (
            <span role="alert" className="text-[13px] text-bad">
              {saveError}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function RecipeBlock({
  r,
  verdict,
  lineVerdicts,
  ctx,
  menus,
  products,
  onEdit,
  onEditLine,
}: {
  r: RecipeDraftRow;
  verdict: RecipeVerdict;
  lineVerdicts: IngVerdict[];
  ctx: RecipeContext;
  menus: PickerProduct[];
  products: PickerProduct[];
  onEdit: (p: Partial<RecipeDraftRow>) => void;
  onEditLine: (li: number, p: Partial<IngDraft>) => void;
}) {
  const [picking, setPicking] = useState(r.menu.kind === "UNSET");
  const menu = r.menu.kind === "EXISTING" ? ctx.menus.find((m) => m.id === (r.menu as { id: string }).id) : null;

  if (r.component) {
    return (
      <div className="border-t border-border bg-surface-sunk/50 px-4 py-3 text-sm first:border-t-0">
        <p>
          <b className="font-display font-semibold">{r.menuText}</b>{" "}
          <span className="chip">ของที่ร้านทำเอง · ยังไม่นำเข้า</span>
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {r.menuText} มีสูตรของมันเอง ({r.lines.length} บรรทัด) ในระบบนี้เป็น “ของแปรรูป” ที่มีสูตรการผลิต ไม่ใช่เมนูที่ขาย รอบนี้ยังไม่นำเข้าให้ —{" "}
          <Link href="/recipes" className="underline decoration-dotted underline-offset-4 hover:text-foreground">
            เพิ่มที่หน้าสูตรของแปรรูป
          </Link>{" "}
          แล้วเมนูที่ใช้ {r.menuText} จะจับคู่ได้
        </p>
      </div>
    );
  }

  const skipped = r.menu.kind === "SKIP";
  return (
    <div className="border-t border-border first:border-t-0">
      <div className={`grid gap-2 px-4 py-3 ${skipped ? "bg-surface-sunk/60" : "bg-surface-sunk/70"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-display text-base font-semibold">{r.menuText}</span>
            {!skipped && (
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                ได้
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={r.servings ?? ""}
                  placeholder="1"
                  onChange={(e) => onEdit({ servings: e.target.value === "" ? null : Number(e.target.value) })}
                  aria-label={`${r.menuText} ได้กี่${r.yieldUnit || "จาน"}`}
                  className="input h-8 w-16 px-2 py-1"
                />
                {r.yieldUnit || "จาน"}
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <MenuChip r={r} menu={menu ?? null} />
            {verdict.kind === "NEED" && verdict.why === "LINES" && <span className="chip chip-bad">มีบรรทัดที่ต้องแก้</span>}
            {!skipped && (
              <button type="button" onClick={() => setPicking((v) => !v)} className="text-[12.5px] underline decoration-dotted underline-offset-4 hover:text-warn">
                {picking ? "เสร็จ" : "เปลี่ยนเมนู"}
              </button>
            )}
            <button
              type="button"
              onClick={() => onEdit({ menu: skipped ? (menu ? { kind: "EXISTING", id: menu.id } : { kind: "UNSET" }) : { kind: "SKIP" } })}
              className="text-[12.5px] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              {skipped ? "นำกลับมา" : "ข้ามเมนูนี้"}
            </button>
          </div>
        </div>
        {picking && !skipped && (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <ProductPicker
              products={menus}
              thumbs={false}
              value={r.menu.kind === "EXISTING" ? r.menu.id : ""}
              onChange={(id) => onEdit({ menu: id === "" ? { kind: "UNSET" } : { kind: "EXISTING", id } })}
              placeholder="ค้นหาเมนูใน POS"
            />
            <button type="button" className="btn-secondary btn-sm" onClick={() => onEdit({ menu: { kind: "NEW", name: r.menuText } })}>
              สร้างเป็นเมนูใหม่ “{r.menuText}”
            </button>
          </div>
        )}
        {r.menu.kind === "NEW" && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">ชื่อเมนูใหม่</span>
            <input value={r.menu.name} onChange={(e) => onEdit({ menu: { kind: "NEW", name: e.target.value } })} className="input h-9 max-w-xs py-1" />
            <span className="text-[12.5px] text-muted-subtle">เมนูที่ยังไม่มีในไฟล์ยอดขาย · ถ้าภายหลังมาจาก POS ชื่ออื่น รวมเมนูได้ที่หน้ารวมเมนู</span>
          </label>
        )}
        {menu?.hasRecipe && !skipped && <p className="text-[13px] text-warn">เมนูนี้มีสูตรใช้อยู่แล้ว — นำเข้าเป็นร่าง ไม่แทนของเดิมจนกว่าจะกดใช้สูตร</p>}
        {menu && menu.drafts > 0 && !skipped && <p className="text-[13px] text-warn">เมนูนี้มีสูตรร่างอยู่แล้ว {menu.drafts} ร่าง — ถ้าเคยนำเข้าไปแล้ว กด “ข้ามเมนูนี้”</p>}
      </div>

      {!skipped && (
        <>
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_150px_minmax(0,1.5fr)] gap-3 border-t border-border px-4 py-2 font-display text-[12.5px] font-semibold text-muted-foreground lg:grid">
            <span>วัตถุดิบในสูตร</span>
            <span>วัตถุดิบในระบบ</span>
            <span className="text-right">ปริมาณ</span>
            <span>ผลการตรวจ</span>
          </div>
          <ol className="divide-y divide-border border-t border-border">
            {r.lines.map((l, li) => (
              <IngRow key={l.line} l={l} v={lineVerdicts[li]} ctx={ctx} products={products} onEdit={(p) => onEditLine(li, p)} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function MenuChip({ r, menu }: { r: RecipeDraftRow; menu: RecipeContext["menus"][number] | null }) {
  if (r.menu.kind === "SKIP") return <span className="chip">ข้ามเมนูนี้</span>;
  if (r.menu.kind === "UNSET") return <span className="chip chip-bad">ไม่พบเมนูนี้ · เลือกเมนูหรือสร้างใหม่</span>;
  if (r.menu.kind === "NEW") return <span className="chip chip-good">เมนูใหม่ · สร้างให้</span>;
  const code = menu?.code ? ` (${menu.code})` : "";
  if (r.menuHow === "EXACT" && menu && nameMatches(menu.name, r.menuText)) return <span className="chip chip-good">ตรงกับเมนู{code}</span>;
  return <span className="chip chip-warn">ใกล้ “{menu?.name}{code}” · ตรวจว่าใช่</span>;
}
const nameMatches = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const NEED_TH = { PRODUCT: "ต้องเลือกวัตถุดิบ", NAME: "ต้องใส่ชื่อ", BASE_UNIT: "ต้องเลือกหน่วยนับ", QTY: "ต้องใส่ปริมาณ", RATIO: "ต้องบอกขนาดของหน่วย" } as const;

function IngRow({ l, v, ctx, products, onEdit }: { l: IngDraft; v: IngVerdict; ctx: RecipeContext; products: PickerProduct[]; onEdit: (p: Partial<IngDraft>) => void }) {
  const choice = l.choice;
  const product = choice.kind === "PRODUCT" ? ctx.products.find((p) => p.id === choice.id) : null;
  const base = choice.kind === "NEW" ? choice.baseUnit : product?.units.find((u) => u.isBase)?.unitName ?? null;
  const label = "text-[11.5px] font-semibold text-muted-foreground lg:hidden";
  const skipped = v.kind === "SKIP";
  const doubt = l.unsure.replace(FROM_METHOD_MARK, "").replace(/^[\s,·;:–-]+|[\s,·;:–-]+$/g, "");

  return (
    <li
      className={`grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 text-sm lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_150px_minmax(0,1.5fr)] lg:gap-3 ${v.kind === "NEED" ? "border-l-[3px] border-l-bad" : ""} ${skipped ? "bg-surface-sunk/40 text-muted-foreground" : ""}`}
    >
      <div className="col-span-2 grid min-w-0 content-start gap-0.5 max-lg:order-1 lg:col-span-1">
        <span className="font-medium">{l.ingredient}</span>
        {l.original !== "" && <span className="text-[12.5px] text-muted-foreground">“{l.original}”</span>}
      </div>

      <div className="col-span-2 grid min-w-0 content-start gap-1.5 max-lg:order-3 lg:col-span-1">
        <span className={label}>วัตถุดิบในระบบ</span>
        {choice.kind === "NEW" ? (
          <div className="grid gap-1.5">
            <input value={choice.name} onChange={(e) => onEdit({ choice: { ...choice, name: e.target.value } })} aria-label="ชื่อวัตถุดิบใหม่" className="input h-9 py-1" />
            <select
              value={choice.baseUnit ?? ""}
              onChange={(e) => onEdit({ choice: { ...choice, baseUnit: e.target.value === "" ? null : e.target.value } })}
              aria-label="หน่วยนับของวัตถุดิบใหม่"
              className={`input h-9 py-1 ${v.kind === "NEED" && v.why === "BASE_UNIT" ? "border-bad" : ""}`}
            >
              <option value="">นับสต๊อกเป็น…</option>
              {ctx.templates.map((t) => (
                <option key={t.unitName} value={t.unitName}>
                  {t.unitName}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => onEdit({ choice: l.proposal ? { kind: "PRODUCT", id: l.proposal.productId } : { kind: "UNSET" } })} className="justify-self-start text-[12.5px] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
              ยกเลิกการสร้างใหม่
            </button>
          </div>
        ) : (
          <>
            <ProductPicker
              products={products}
              thumbs={false}
              value={choice.kind === "PRODUCT" ? choice.id : ""}
              onChange={(id) => onEdit({ choice: id === "" ? { kind: "UNSET" } : { kind: "PRODUCT", id } })}
              placeholder="ค้นหาวัตถุดิบ…"
              invalid={v.kind === "NEED" && v.why === "PRODUCT"}
              footer={
                ctx.canCreateProducts
                  ? {
                      label: `สร้างเป็นวัตถุดิบใหม่ “${l.ingredient}”`,
                      onClick: () => onEdit({ choice: { kind: "NEW", name: l.ingredient, baseUnit: l.unit !== null && ctx.templates.some((t) => t.unitName === l.unit) ? l.unit : null } }),
                    }
                  : undefined
              }
            />
            {product && l.proposal?.productId === product.id && (
              <span className="text-[12.5px] text-muted-foreground">{l.proposal.how === "EXACT" ? "ชื่อตรงกัน" : "ชื่อใกล้ · ตรวจว่าใช่"}</span>
            )}
          </>
        )}
      </div>

      <div className="col-span-2 grid content-start gap-1 max-lg:order-4 lg:col-span-1 lg:justify-items-end lg:text-right">
        <span className={label}>ปริมาณ</span>
        {l.qty === null && !skipped ? (
          <span className="flex items-center gap-1.5 lg:justify-end">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              onChange={(e) => onEdit({ qty: e.target.value === "" ? null : Number(e.target.value) > 0 ? Number(e.target.value) : null })}
              aria-label={`ปริมาณ ${l.ingredient}`}
              placeholder={l.qtyText || "ปริมาณ"}
              className="input h-8 w-20 border-bad px-2 py-1"
            />
            {l.unit ?? base}
          </span>
        ) : (
          <span className="tabular-nums">
            {l.qty !== null ? l.qty.toLocaleString("th-TH", { maximumFractionDigits: 3 }) : "—"} {l.unit ?? base ?? ""}
          </span>
        )}
      </div>

      <div className="col-span-2 flex min-w-0 flex-wrap content-start items-center gap-1.5 max-lg:order-2 lg:col-span-1 lg:grid lg:justify-items-start">
        {v.kind === "SKIP" ? (
          <>
            <span className="chip">{l.fromMethod ? "ไม่ใช้ในสูตรนี้" : "ข้ามบรรทัดนี้"}</span>
            <button
              type="button"
              onClick={() => onEdit({ choice: l.proposal ? { kind: "PRODUCT", id: l.proposal.productId } : { kind: "UNSET" } })}
              className="text-[12.5px] underline decoration-dotted underline-offset-4 hover:text-warn"
            >
              นำกลับมา
            </button>
          </>
        ) : v.kind === "NEED" ? (
          <>
            <span className="chip chip-bad whitespace-normal">{NEED_TH[v.why]}</span>
            {l.fromMethod && <span className="chip chip-warn">พบในวิธีทำ</span>}
            {v.why === "RATIO" && <RatioInput l={l} base={base} ctx={ctx} onEdit={onEdit} />}
          </>
        ) : (
          <>
            {v.flags.includes("FROM_METHOD") && <span className="chip chip-warn">พบในวิธีทำ</span>}
            {v.flags.includes("MATCH_TO_CHECK") && <span className="chip chip-warn">ชื่อใกล้ · ตรวจว่าใช่</span>}
            {v.flags.includes("NEW_PRODUCT") && <span className="chip chip-warn">สร้างวัตถุดิบใหม่</span>}
            {v.flags.includes("NO_UNIT") && <span className="chip chip-warn">ไม่ระบุหน่วย ใช้ {v.unitName}</span>}
            {v.flags.every((f) => f === "UNIT_CONVERTED") && <span className="chip chip-good">พร้อม</span>}
            {v.unitIsNew && v.ratio !== null && (
              <span className="text-[12.5px] text-muted-foreground">
                เพิ่มหน่วย {v.unitName} = {v.ratio.toLocaleString("th-TH", { maximumFractionDigits: 4 })} {base}
              </span>
            )}
          </>
        )}
        {doubt !== "" && <span className="text-[12.5px] text-warn">AI: “{doubt}”</span>}
        {v.kind !== "SKIP" && (
          <button type="button" onClick={() => onEdit({ choice: { kind: "SKIP" } })} className="text-[12.5px] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
            {l.fromMethod ? "ไม่ใช้ในสูตรนี้" : "ข้ามบรรทัดนี้"}
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * "1 ช้อนโต๊ะ = ? ขวด" has no answer anyone knows; "1 ขวด มี ? ml" does. When
 * the recipe's measure is a standard size (ช้อนโต๊ะ = 15 ml) and the product is
 * counted in pieces, ask the size of ONE piece and work the ratio out.
 */
function RatioInput({ l, base, ctx, onEdit }: { l: IngDraft; base: string | null; ctx: RecipeContext; onEdit: (p: Partial<IngDraft>) => void }) {
  const t = ctx.templates.find((x) => x.unitName === l.unit);
  const baseT = ctx.templates.find((x) => x.unitName === base);
  const bySize = t?.toSiRatio != null && (baseT === undefined || baseT.toSiRatio === null);
  const [size, setSize] = useState("");
  if (bySize && t) {
    const si = t.unitDimension === "VOLUME" ? "ml" : "g";
    return (
      <label className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
        1 {base} มี
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={size}
          onChange={(e) => {
            setSize(e.target.value);
            const n = Number(e.target.value);
            onEdit({ ratio: e.target.value !== "" && n > 0 ? t.toSiRatio! / n : null });
          }}
          aria-label={`1 ${base} มีกี่ ${si}`}
          className="input h-8 w-20 border-bad px-2 py-1"
        />
        {si} · ระบบคิดให้ว่า 1 {l.unit} = {t.toSiRatio} {si}
      </label>
    );
  }
  return (
    <label className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
      1 {l.unit} =
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={l.ratio ?? ""}
        onChange={(e) => onEdit({ ratio: e.target.value === "" ? null : Number(e.target.value) })}
        aria-label={`1 ${l.unit} เท่ากับกี่ ${base ?? "หน่วยนับ"}`}
        className="input h-8 w-20 border-bad px-2 py-1"
      />
      {base} · จำไว้ใช้ทุกสูตร
    </label>
  );
}

// ------------------------------------------------------------
// After the save
// ------------------------------------------------------------

function Done({ done, onAgain }: { done: Extract<ImportRecipesState, { ok: true }>; onAgain: () => void }) {
  return (
    <section className="card grid gap-3">
      <h3 className="text-xl font-semibold">บันทึกเป็นสูตรร่างแล้ว {done.drafts.toLocaleString("th-TH")} เมนู</h3>
      <ul className="grid gap-1 text-sm text-muted-foreground">
        <li>· สูตรร่างยังไม่ตัดสต๊อกและยังไม่คิดต้นทุน จนกว่าจะกด “ใช้สูตร” ทีละเมนูที่หน้าทดลองเมนู</li>
        {done.menusCreated > 0 && <li>· สร้างเมนูใหม่ {done.menusCreated} รายการ (เมนูที่ยังไม่มีในไฟล์ยอดขาย)</li>}
        {done.productsCreated > 0 && <li>· สร้างวัตถุดิบใหม่ {done.productsCreated} รายการ</li>}
        {done.unitsAdded > 0 && <li>· เพิ่มหน่วยให้วัตถุดิบ {done.unitsAdded} หน่วย ใช้ต่อได้ทุกสูตร</li>}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href="/menus/lab" className="btn">
          ไปตรวจและใช้สูตรที่หน้าทดลองเมนู
        </Link>
        <Link href="/dashboard" className="btn-secondary">
          ไปขั้นต่อไปของการตั้งร้าน
        </Link>
        <button type="button" onClick={onAgain} className="btn-secondary">
          นำเข้าไฟล์อื่น
        </button>
      </div>
    </section>
  );
}
